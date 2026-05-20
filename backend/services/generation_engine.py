"""Outer generation engine — sequential section orchestrator.

Per Q40 the outer flow is "sequential outer + ReAct-lite inner". Each section
is processed in `order_index` order; the inner `section_agent` subgraph
handles retrieve+generate+decide+persist for one attempt.

Persistence model (simplified vs. plan): rather than wiring a LangGraph
PostgresSaver checkpointer for the outer flow, we store all progress in
`generation_jobs` + `generation_section_states` rows. Resume = "find first
non-terminal section and continue". This is enough for MVP and is easier to
reason about / observe than checkpoint blobs. Inner subgraph remains a
LangGraph so we can add reflection/branching later (Q40).

Public entry points called by routers:
  * `start_job`               — create rows + kick off first section
  * `continue_after_answer`   — resume after user submits need_info answers
  * `regenerate_section`      — re-run one section after job completion
  * `skip_section`            — mark a paused section as skipped (Q31)
  * `stop_section`            — abort the in-flight LLM call for one section
  * `delete_job`              — auto-cancel + hard delete job + section states
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import AsyncSessionLocal
from models.generation import GenerationJob, GenerationSectionState
from models.template import Template, TemplateSection
from services.section_agent import SECTION_AGENT_APP

logger = logging.getLogger(__name__)


# Cap on need_info loop (Q27). Mirrors section_agent._NEED_INFO_LIMIT — kept
# here too so the engine can decide when to call the agent in "force" mode.
_NEED_INFO_LIMIT = 3

# Heartbeat interval — Q35 recovery treats rows with stale heartbeat as crashed.
_HEARTBEAT_INTERVAL_S = 30

# In-memory registry of in-flight section subgraph tasks, keyed by
# `section_state.id`. Populated when `_run_single_section` enters the agent
# call, popped when it returns. `stop_section` looks up the task here and
# `.cancel()`s it to abort the inner LLM HTTP request via httpx — saves
# Gemini output tokens. Single-worker assumption: a multi-worker deployment
# would need shared state (Redis pubsub etc).
_running_section_tasks: dict[str, asyncio.Task] = {}


# ─────────────────────────────────────────────────────────────────────────────
# Public: start a new job
# ─────────────────────────────────────────────────────────────────────────────


async def start_job(
    *,
    db: AsyncSession,
    user_id: str,
    workspace_id: str,
    template_id: str,
    document_title: str,
    outline_document_id: str | None,
    outline_collection_id: str | None,
    ad_hoc_context: str,
    user_hint: str,
) -> GenerationJob:
    """Create the job + per-section state rows, then schedule background run.

    Caller (the router) is responsible for creating the Outline Document
    before calling this and passing the resulting `outline_document_id`.
    """
    # step 1: eager-load template with sections + agent + examples for snapshot
    template_stmt = (
        select(Template)
        .where(Template.id == template_id)
        .options(
            selectinload(Template.sections).selectinload(TemplateSection.agent),
            selectinload(Template.sections).selectinload(TemplateSection.examples),
        )
    )
    template = (await db.execute(template_stmt)).scalar_one_or_none()
    if template is None:
        raise ValueError(f"Template {template_id} not found")
    if not template.is_enabled:
        raise ValueError(f"Template {template.code} is disabled")
    if not template.sections:
        raise ValueError(f"Template {template.code} has no sections")

    # step 2: snapshot per-section prompts so admin edits mid-run can't disturb (Q37)
    snapshot = _snapshot_prompts(template)

    # step 3: insert GenerationJob + one GenerationSectionState per section
    job = GenerationJob(
        user_id=user_id,
        workspace_id=workspace_id,
        template_id=template_id,
        outline_document_id=outline_document_id,
        outline_collection_id=outline_collection_id,
        document_title=document_title,
        ad_hoc_context=ad_hoc_context,
        user_hint=user_hint,
        snapshot_prompts=snapshot,
        lifecycle="active",
        progress="pending",
    )
    db.add(job)
    await db.flush()

    for section in template.sections:
        state = GenerationSectionState(
            job_id=job.id,
            section_id=section.id,
            order_index=section.order_index,
            title=section.title,
            status="pending",
        )
        db.add(state)

    await db.commit()
    await db.refresh(job)

    # step 4: launch background task to start the first section (returns immediately)
    asyncio.create_task(_run_job_from_current(job.id))
    return job


# ─────────────────────────────────────────────────────────────────────────────
# Public: continue after user submits answers to need_info
# ─────────────────────────────────────────────────────────────────────────────


async def continue_after_answer(
    *, job_id: str, section_id: str, answers: dict[str, str]
) -> None:
    """Persist user answers on the paused section and resume the job."""
    async with AsyncSessionLocal() as db:
        # step 1: locate the section state row for this (job, section)
        stmt = select(GenerationSectionState).where(
            GenerationSectionState.job_id == job_id,
            GenerationSectionState.section_id == section_id,
        )
        section_state = (await db.execute(stmt)).scalar_one_or_none()
        if section_state is None:
            raise ValueError(f"section_state not found for job={job_id} section={section_id}")
        if section_state.status != "awaiting_input":
            raise ValueError(
                f"section is in state {section_state.status}, not awaiting_input"
            )

        # step 2: merge new answers into existing user_answers dict
        merged = dict(section_state.user_answers or {})
        merged.update(answers)
        section_state.user_answers = merged
        section_state.status = "pending"
        section_state.error_code = None
        section_state.error_message = None

        # step 2b: lift the job out of any terminal/paused progress synchronously
        # so the FE poller (which stops at terminal job.status) keeps ticking
        # until the resume task settles. `lifecycle == "cancelled"` is sticky;
        # only `progress` is touched here.
        job = await db.get(GenerationJob, job_id)
        if job is not None and job.lifecycle != "cancelled":
            job.progress = "running"
            job.error_message = None

        await db.commit()

    # step 3: relaunch background processing from the paused section
    asyncio.create_task(_run_job_from_current(job_id))


# ─────────────────────────────────────────────────────────────────────────────
# Public: regenerate one section after job completion (Q16)
# ─────────────────────────────────────────────────────────────────────────────


async def regenerate_section(*, job_id: str, section_id: str) -> None:
    """Reset one section to pending and re-run it (only it, downstream stale per Q29)."""
    async with AsyncSessionLocal() as db:
        stmt = select(GenerationSectionState).where(
            GenerationSectionState.job_id == job_id,
            GenerationSectionState.section_id == section_id,
        )
        section_state = (await db.execute(stmt)).scalar_one_or_none()
        if section_state is None:
            raise ValueError(f"section_state not found for job={job_id} section={section_id}")
        # Q47 — reject if section is currently busy (running/awaiting_input)
        if section_state.status in ("running", "awaiting_input"):
            raise RuntimeError("SECTION_BUSY")

        # step 1: clear runtime fields so the agent runs fresh
        section_state.status = "pending"
        section_state.content = None
        section_state.need_info_rounds = 0
        section_state.need_info_questions = None
        section_state.user_answers = None
        section_state.error_code = None
        section_state.error_message = None
        section_state.completed_at = None
        # Clear sync flag too — the FE must re-append once content regenerates.
        section_state.appended_to_doc = False

        # step 1b: lift the job out of any terminal progress synchronously so the
        # FE poller (which stops at terminal job.status) keeps ticking until the
        # spawned task settles. `lifecycle == "cancelled"` is sticky; only
        # `progress` is touched here.
        job = await db.get(GenerationJob, job_id)
        if job is not None and job.lifecycle != "cancelled":
            job.progress = "running"
            job.error_message = None

        await db.commit()

    # step 2: run only this section (NOT downstream — Q29: just mark stale in UI).
    # Wrapper re-evaluates progress after the section finishes so the badge
    # in RecentJobsList settles back to a terminal state instead of "running".
    asyncio.create_task(_regenerate_then_eval(job_id, section_id))


# ─────────────────────────────────────────────────────────────────────────────
# Public: skip a paused section (Q31)
# ─────────────────────────────────────────────────────────────────────────────


async def skip_section(*, job_id: str, section_id: str) -> None:
    """Mark a paused section as skipped with a placeholder, then resume."""
    async with AsyncSessionLocal() as db:
        stmt = select(GenerationSectionState).where(
            GenerationSectionState.job_id == job_id,
            GenerationSectionState.section_id == section_id,
        )
        section_state = (await db.execute(stmt)).scalar_one_or_none()
        if section_state is None or section_state.status != "awaiting_input":
            raise ValueError("section must be in awaiting_input state to skip")

        section_state.status = "skipped"
        section_state.content = f"> _(§{section_state.title} đã được skip)_"
        section_state.completed_at = datetime.now(timezone.utc)
        await db.commit()

    # Continue with the next section.
    asyncio.create_task(_run_job_from_current(job_id))


# ─────────────────────────────────────────────────────────────────────────────
# Public: stop a single running section (abort LLM call to save tokens)
# ─────────────────────────────────────────────────────────────────────────────


async def stop_section(*, job_id: str, section_id: str) -> bool:
    """Abort the in-flight LLM call for a section currently running.

    Returns True if a task was cancelled, False if the section wasn't
    running (race vs. completion) or didn't exist.

    Flow:
      1. Look up the section state and verify it's currently `running`.
      2. Pull the inner asyncio.Task out of `_running_section_tasks`.
      3. If still in flight, call `task.cancel()` → CancelledError raises
         inside `_run_single_section`'s await of the LangGraph subgraph →
         httpx aborts the open connection to Gemini → no further output
         tokens are billed. The runner records `USER_STOPPED` and returns.

    Race window: the LLM call may finish microseconds before cancel lands.
    `task.done()` guards against cancelling a completed task.
    """
    # step 1: locate the section state row and confirm it's eligible to stop
    async with AsyncSessionLocal() as db:
        stmt = select(GenerationSectionState).where(
            GenerationSectionState.job_id == job_id,
            GenerationSectionState.section_id == section_id,
        )
        section_state = (await db.execute(stmt)).scalar_one_or_none()
        if section_state is None or section_state.status != "running":
            return False
        ss_id = section_state.id

    # step 2: look up the in-flight task; no-op if nothing registered (already
    # finished, or running in a different worker process)
    task = _running_section_tasks.get(ss_id)
    if task is None or task.done():
        return False

    # step 3: cancel. The runner catches CancelledError, writes USER_STOPPED,
    # then exits cleanly so `_run_job_from_current` step 4 marks the job error
    # and pauses (existing state machine handles the rest).
    task.cancel()
    return True


# ─────────────────────────────────────────────────────────────────────────────
# Public: delete job (hard delete, cascade section states)
# ─────────────────────────────────────────────────────────────────────────────


# How long we wait for an in-flight section to settle after flagging the job
# cancelled. Long enough that a typical section commit lands before we drop
# the row, short enough that the UI doesn't feel laggy on click.
_DELETE_CANCEL_GRACE_S = 2.0


async def delete_job(*, job_id: str) -> bool:
    """Hard-delete a job and its section states.

    Returns True if a row was deleted, False if the job didn't exist.

    Flow:
      1. If the job is still active (lifecycle == "active") and progress is
         non-terminal, flip lifecycle to "cancelled" first so the runner
         short-circuits at its next section boundary check.
      2. Sleep briefly so an in-flight `_run_single_section` has a chance to
         commit its final section state before we delete the rows.
      3. DELETE the GenerationJob row — `ba_kit_generation_section_states`
         rows go with it via the `ON DELETE CASCADE` foreign key.

    Note: this is a best-effort cleanup, not a hard barrier against the
    runner. If a section commit lands after step 3 the SQLAlchemy session
    will raise (parent row gone). That's logged at the runner level and
    doesn't surface to the user, since the row they care about is gone.
    """
    # step 1: load and flip lifecycle if needed (sticky cancel signal)
    async with AsyncSessionLocal() as db:
        job = await db.get(GenerationJob, job_id)
        if job is None:
            return False
        needs_grace = (
            job.lifecycle == "active"
            and job.progress not in ("completed", "error", "paused_after_restart")
        )
        if job.lifecycle != "cancelled":
            job.lifecycle = "cancelled"
            await db.commit()

    # step 2: yield long enough for any running section to finalize
    if needs_grace:
        await asyncio.sleep(_DELETE_CANCEL_GRACE_S)

    # step 3: drop the row — cascade handles section_states
    async with AsyncSessionLocal() as db:
        job = await db.get(GenerationJob, job_id)
        if job is None:
            # Already gone (e.g. another delete raced us). Treat as success.
            return True
        await db.delete(job)
        await db.commit()
    return True


# ─────────────────────────────────────────────────────────────────────────────
# Internal: background runner
# ─────────────────────────────────────────────────────────────────────────────


async def _run_job_from_current(job_id: str) -> None:
    """Background loop: keep running the next pending section until terminal.

    Pauses (returns) when a section needs user input, hits an error, or the
    job is cancelled.
    """
    while True:
        # step 1: snapshot job + sections to decide what to do next
        async with AsyncSessionLocal() as db:
            job = await _load_job(db, job_id)
            if job is None:
                return
            if job.lifecycle == "cancelled":
                logger.info("Job %s cancelled — stopping runner", job_id)
                return

            # step 2: pick the first non-terminal section to work on
            next_section = _pick_next_pending(job.sections)
            if next_section is None:
                # All sections terminal → job done
                job.progress = "completed"
                await db.commit()
                return

            # Tag job as running while we work on this section
            job.progress = "running"
            await db.commit()

        # step 3: run the section outside the DB transaction; heartbeat in parallel
        try:
            await _run_single_section(job_id, next_section.section_id)
        except Exception as exc:  # noqa: BLE001
            logger.exception("section run crashed: %s", exc)
            # Mark job in error so user can retry; outer loop exits.
            async with AsyncSessionLocal() as db:
                job = await db.get(GenerationJob, job_id)
                if job is not None:
                    job.progress = "error"
                    job.error_message = f"{type(exc).__name__}: {exc}"
                    await db.commit()
            return

        # step 4: inspect what state the section ended in and decide whether to loop
        async with AsyncSessionLocal() as db:
            job = await _load_job(db, job_id)
            if job is None:
                return
            # Re-check cancel — user may have clicked during the section run.
            # We still proceed to record the final section state below, but skip
            # the progress overwrite that would otherwise mask the cancel.
            cancelled_mid_flight = job.lifecycle == "cancelled"
            ran_section = next(
                (s for s in job.sections if s.section_id == next_section.section_id),
                None,
            )
            if ran_section is None:
                return
            # Pause whenever the section did NOT reach a terminal-and-OK state
            if ran_section.status in ("awaiting_input", "error", "done_unsynced"):
                # awaiting_input → wait for user; error/unsynced → wait for retry
                # but if done_unsynced we still want to continue to the next section
                if ran_section.status == "done_unsynced":
                    if cancelled_mid_flight:
                        return
                    continue  # treat as done for sequencing purposes
                if not cancelled_mid_flight:
                    if ran_section.status == "awaiting_input":
                        job.progress = "awaiting_input"
                    else:
                        job.progress = "error"
                    await db.commit()
                return
            # done / skipped → loop to pick the next section (cancel re-checked at top)


async def _evaluate_job_status(job_id: str) -> None:
    """Recompute `job.progress` from current section states.

    Called after the regenerate path (which uses bare `_run_single_section`,
    bypassing the state machine in `_run_job_from_current`) so the badge
    settles back to a terminal/paused status instead of being stuck at the
    "running" we set before spawning the task. Writes only `progress` —
    `lifecycle` is the user's intent and never recomputed.

    Priority mirrors the inline logic in `_run_job_from_current`:
      error > awaiting_input > running/pending > completed
    """
    async with AsyncSessionLocal() as db:
        job = await _load_job(db, job_id)
        if job is None or job.lifecycle == "cancelled":
            return
        statuses = [s.status for s in job.sections]
        if any(s == "error" for s in statuses):
            job.progress = "error"
        elif any(s == "awaiting_input" for s in statuses):
            job.progress = "awaiting_input"
        elif any(s in ("pending", "running") for s in statuses):
            job.progress = "running"
        else:
            job.progress = "completed"
        await db.commit()


async def _regenerate_then_eval(job_id: str, section_id: str) -> None:
    """Run a single section and then refresh job.status.

    `finally` ensures the job status is recomputed even if the section run
    raises — otherwise a crash inside the agent would leave the job pinned at
    "running" forever.
    """
    try:
        await _run_single_section(job_id, section_id)
    finally:
        await _evaluate_job_status(job_id)



async def _run_single_section(job_id: str, section_id: str) -> None:
    """Invoke the inner subgraph once for the given (job, section).

    Handles the need_info round bookkeeping required by Q27.
    """
    # step 1: load all the context the subgraph needs
    async with AsyncSessionLocal() as db:
        job = await _load_job(db, job_id)
        if job is None:
            return
        section_state = next(
            (s for s in job.sections if s.section_id == section_id),
            None,
        )
        if section_state is None:
            return
        if section_state.status in ("done", "skipped"):
            return

        # Pull snapshot config for this section (Q37)
        snapshot = job.snapshot_prompts.get(section_id) if job.snapshot_prompts else None
        if not snapshot:
            section_state.status = "error"
            section_state.error_code = "SNAPSHOT_MISSING"
            section_state.error_message = "No snapshot prompt for section"
            await db.commit()
            return

        # Build previous_sections markdown from already-done sections (Q28)
        previous_md = "\n\n".join(
            f"## {s.title}\n{s.content or ''}"
            for s in job.sections
            if s.order_index < section_state.order_index
            and s.status in ("done", "done_unsynced", "skipped")
            and s.content
        )

        agent_input = {
            "job_id": job.id,
            "section_state_id": section_state.id,
            "workspace_id": job.workspace_id,
            "outline_document_id": job.outline_document_id,
            "model": snapshot["model"],
            "system_prompt": snapshot["system_prompt"],
            "instruction": snapshot.get("instruction", ""),
            "body_template": snapshot.get("body_template", ""),
            "section_title": section_state.title,
            "examples": snapshot.get("examples", []),
            "ad_hoc_context": job.ad_hoc_context or "",
            "user_hint": job.user_hint or "",
            "previous_sections_md": previous_md,
            "user_answers": section_state.user_answers or {},
            "need_info_rounds": section_state.need_info_rounds,
        }

        # Mark running + start heartbeat
        section_state.status = "running"
        section_state.started_at = datetime.now(timezone.utc)
        section_state.last_heartbeat = datetime.now(timezone.utc)
        await db.commit()

    # step 2: launch a heartbeat task in parallel for Q35 recovery
    stop_heartbeat = asyncio.Event()
    heartbeat_task = asyncio.create_task(
        _heartbeat_loop(section_state_id=agent_input["section_state_id"], stop=stop_heartbeat)
    )

    section_state_id = agent_input["section_state_id"]

    try:
        # step 3: invoke the section subgraph (Q40 inner) — wrapped in a
        # child task so `stop_section` can cancel it independently of the
        # outer `_run_job_from_current` task. The await below re-raises any
        # CancelledError that propagates out of httpx; we trap it and
        # convert to USER_STOPPED so the runner can pause cleanly.
        inner_task = asyncio.create_task(SECTION_AGENT_APP.ainvoke(agent_input))
        _running_section_tasks[section_state_id] = inner_task
        try:
            result_state = await inner_task
        except asyncio.CancelledError:
            # User clicked Stop. Persist USER_STOPPED state then exit
            # WITHOUT re-raising — we want the runner loop to handle this
            # like any other error (step 4 in _run_job_from_current).
            await _record_user_stopped(section_state_id)
            return
        finally:
            _running_section_tasks.pop(section_state_id, None)
    finally:
        stop_heartbeat.set()
        await heartbeat_task

    # step 4: write back any state the subgraph didn't already commit
    await _finalize_section(
        section_state_id=section_state_id,
        result_state=result_state,
    )


async def _record_user_stopped(section_state_id: str) -> None:
    """Persist `USER_STOPPED` after `stop_section` cancels the agent task.

    Mirrors the shape of `_finalize_section`'s error branch so the FE error
    flow (or the dedicated "Stopped" branch checking `error_code`) renders
    consistently. Last heartbeat is bumped so the recovery sweep doesn't
    later flag this row as crashed.
    """
    async with AsyncSessionLocal() as db:
        section_state = await db.get(GenerationSectionState, section_state_id)
        if section_state is None:
            return
        section_state.status = "error"
        section_state.error_code = "USER_STOPPED"
        section_state.error_message = (
            "You stopped this section before it finished."
        )
        section_state.last_heartbeat = datetime.now(timezone.utc)
        await db.commit()


async def _finalize_section(*, section_state_id: str, result_state: dict) -> None:
    """Persist subgraph outcome into the section_state row.

    The persist_node already wrote `done` / `done_unsynced` for ok results.
    Here we cover the other branches: need_info (pause), error (fail fast).
    """
    final_status = result_state.get("final_status")

    async with AsyncSessionLocal() as db:
        section_state = await db.get(GenerationSectionState, section_state_id)
        if section_state is None:
            return

        if final_status == "ok":
            # persist_node already updated. Nothing to do.
            return

        if final_status == "need_info":
            # Increment rounds; cap at limit so the next attempt force-generates.
            llm_result = result_state.get("llm_result")
            questions = llm_result.questions if llm_result else None
            section_state.status = "awaiting_input"
            section_state.need_info_rounds = section_state.need_info_rounds + 1
            section_state.need_info_questions = questions or []
            section_state.last_heartbeat = datetime.now(timezone.utc)
            await db.commit()
            return

        # Fallback: error path (Q30)
        section_state.status = "error"
        section_state.error_code = result_state.get("error_code") or "AGENT_ERROR"
        section_state.error_message = result_state.get("error_message") or "Unknown error"
        section_state.last_heartbeat = datetime.now(timezone.utc)
        await db.commit()


async def _heartbeat_loop(*, section_state_id: str, stop: asyncio.Event) -> None:
    """Refresh `last_heartbeat` while the section is running (Q35)."""
    try:
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=_HEARTBEAT_INTERVAL_S)
                return  # stop event fired
            except asyncio.TimeoutError:
                # Heartbeat tick
                async with AsyncSessionLocal() as db:
                    section_state = await db.get(GenerationSectionState, section_state_id)
                    if section_state is None:
                        return
                    section_state.last_heartbeat = datetime.now(timezone.utc)
                    await db.commit()
    except Exception:  # noqa: BLE001
        # Heartbeat failures must never crash the main run.
        logger.exception("heartbeat loop crashed")


# ─────────────────────────────────────────────────────────────────────────────
# Internal: helpers
# ─────────────────────────────────────────────────────────────────────────────


async def _load_job(db: AsyncSession, job_id: str) -> GenerationJob | None:
    """Load job with sections eagerly to avoid lazy IO in async context."""
    stmt = (
        select(GenerationJob)
        .where(GenerationJob.id == job_id)
        .options(selectinload(GenerationJob.sections))
    )
    return (await db.execute(stmt)).scalar_one_or_none()


def _pick_next_pending(
    sections: list[GenerationSectionState],
) -> GenerationSectionState | None:
    """Return the lowest-order section in a non-terminal, non-paused state."""
    # Terminal states (no further work): done, done_unsynced, skipped
    # Paused states (need user action): awaiting_input, error
    # Workable states: pending
    sorted_sections = sorted(sections, key=lambda s: s.order_index)
    for s in sorted_sections:
        if s.status == "pending":
            return s
        if s.status in ("done", "done_unsynced", "skipped"):
            continue
        # Encountered a paused section → must wait for user action before any further
        if s.status in ("awaiting_input", "error", "running"):
            return None
    return None


def _snapshot_prompts(template: Template) -> dict:
    """Build the JSONB snapshot of all section configs at job start (Q37)."""
    snapshot: dict[str, dict] = {}
    for section in template.sections:
        agent = section.agent
        snapshot[section.id] = {
            "model": agent.model if agent else "gemini-2.5-flash",
            "system_prompt": agent.system_prompt if agent else "",
            "instruction": agent.instruction if agent else "",
            "body_template": section.body_template,
            "examples": [
                {"label": ex.label, "content": ex.content}
                for ex in (section.examples or [])
            ],
        }
    return snapshot
