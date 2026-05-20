"""Server-restart recovery hook (Q35).

When FastAPI restarts mid-job, background tasks vanish but the DB still
reports `running`/`awaiting_input` jobs. Without intervention they'd appear
permanently stuck. On startup we scan for stale rows (no heartbeat for
5 minutes) and flag them for manual user retry.

Rows are touched conservatively:
  * Section in `running` with stale heartbeat → `error` + `SERVER_RESTART`
  * Job in `running` or `awaiting_input` with no running section progressing
    → `paused_after_restart`
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from database import AsyncSessionLocal
from models.generation import GenerationJob, GenerationSectionState

logger = logging.getLogger(__name__)


# Sections without a heartbeat update for this long are considered crashed.
_STALE_THRESHOLD_S = 5 * 60


async def recover_orphaned_jobs() -> None:
    """Mark crash-orphaned section runs as errored so users can retry."""
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=_STALE_THRESHOLD_S)
    recovered_sections = 0
    paused_jobs = 0

    async with AsyncSessionLocal() as db:
        # step 1: any section row in `running` with stale heartbeat → error
        stale_running_stmt = select(GenerationSectionState).where(
            GenerationSectionState.status == "running",
            GenerationSectionState.last_heartbeat < cutoff,
        )
        stale_sections = (await db.execute(stale_running_stmt)).scalars().all()
        for section in stale_sections:
            section.status = "error"
            section.error_code = "SERVER_RESTART"
            section.error_message = (
                "FastAPI restarted while this section was running. "
                "Click Retry to re-run."
            )
            recovered_sections += 1

        # step 2: any job in non-terminal progress whose runner clearly died → paused.
        # Skip cancelled jobs entirely — user intent is sticky and recovery
        # has no business touching them.
        active_jobs_stmt = select(GenerationJob).where(
            GenerationJob.lifecycle == "active",
            GenerationJob.progress.in_(["running", "awaiting_input"]),
        )
        active_jobs = (await db.execute(active_jobs_stmt)).scalars().all()
        for job in active_jobs:
            # Refresh sections to count current state after step 1 updates.
            sections_stmt = select(GenerationSectionState).where(
                GenerationSectionState.job_id == job.id
            )
            sections = (await db.execute(sections_stmt)).scalars().all()
            still_running = any(s.status == "running" for s in sections)
            if still_running:
                continue  # the runner is presumably alive in this process
            # No section currently running and we're past restart → flag job
            if job.progress == "awaiting_input":
                # Keep awaiting_input; user owes us an answer, runner can resume.
                continue
            job.progress = "paused_after_restart"
            paused_jobs += 1

        await db.commit()

    if recovered_sections or paused_jobs:
        logger.info(
            "BA Kit recovery: %d section(s) → error, %d job(s) → paused_after_restart",
            recovered_sections,
            paused_jobs,
        )
