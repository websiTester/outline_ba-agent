"""Generation routes — user-facing.

All endpoints scope by the (user_id, workspace_id) pair extracted from the
proxy-injected headers. Per Q39 jobs are private to their owner.

Endpoints:
  POST   /ba-kit/jobs                         — start a new job (multipart)
  GET    /ba-kit/jobs                         — list caller's jobs
  GET    /ba-kit/jobs/{id}                    — detail with section breakdown
  POST   /ba-kit/jobs/{id}/answer             — submit need_info answers / skip
  POST   /ba-kit/jobs/{id}/cancel             — cancel running job
  POST   /ba-kit/jobs/{id}/sections/{sid}/regenerate — re-run one section
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from middlewares.auth import extract_identity
from models.generation import GenerationJob, GenerationSectionState
from rag_state import get_rag_for_workspace
from schemas.ba_kit import (
    JobDetail,
    JobSummary,
    SectionStateDTO,
    StartJobResponse,
    SubmitAnswerRequest,
)
from services import generation_engine
from utils.file_parser import SUPPORTED_EXTENSIONS, parse_file_to_text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ba-kit", tags=["ba-kit-jobs"])


# Q36 — ad-hoc file upload limits enforced at the router boundary.
_MAX_FILES = 5
_MAX_FILE_BYTES = 5 * 1024 * 1024
_MAX_TOTAL_CHARS = 200_000


# ─────────────────────────────────────────────────────────────────────────────
# Start a job (multipart: optional files + form fields)
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/jobs", response_model=StartJobResponse)
async def start_job_endpoint(
    template_id: Annotated[str, Form()],
    document_title: Annotated[str, Form()],
    outline_collection_id: Annotated[str, Form()],
    user_hint: Annotated[str, Form()] = "",
    free_text_context: Annotated[str, Form()] = "",
    force_proceed: Annotated[bool, Form()] = False,
    outline_document_id: Annotated[str, Form()] = "",
    files: list[UploadFile] = File(default_factory=list),
    db: AsyncSession = Depends(get_db),
    identity: tuple[str, str] = Depends(extract_identity),
) -> StartJobResponse:
    """Create + start a new generation job.

    The Node proxy is expected to create the Outline Document first and pass
    its id via `outline_document_id`. We do not call Outline directly from
    here (Q10) — keeps FastAPI free of Outline SDK concerns.
    """
    user_id, workspace_id = identity

    # step 1: enforce file count + per-file size limits (Q36)
    if len(files) > _MAX_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many files: {len(files)} > max {_MAX_FILES}",
        )

    # step 2: parse uploaded files into a single ad-hoc text blob
    ad_hoc_parts: list[str] = []
    for upload in files:
        if not upload.filename:
            continue
        raw = await upload.read()
        if len(raw) > _MAX_FILE_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"File {upload.filename} exceeds {_MAX_FILE_BYTES} bytes",
            )
        ext = "." + upload.filename.rsplit(".", 1)[-1].lower() if "." in upload.filename else ""
        if ext not in SUPPORTED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type {ext}; allowed: {sorted(SUPPORTED_EXTENSIONS)}",
            )
        try:
            parsed_text = parse_file_to_text(raw, upload.filename)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if parsed_text:
            ad_hoc_parts.append(f"### {upload.filename}\n{parsed_text}")

    # step 3: merge free text into ad-hoc context and enforce total char cap (Q36)
    if free_text_context.strip():
        ad_hoc_parts.append(f"### Free text\n{free_text_context.strip()}")
    ad_hoc_context = "\n\n".join(ad_hoc_parts)
    if len(ad_hoc_context) > _MAX_TOTAL_CHARS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Total ad-hoc context {len(ad_hoc_context)} chars exceeds "
                f"limit {_MAX_TOTAL_CHARS} (CONTEXT_TOO_LARGE)"
            ),
        )

    # step 4: pre-flight CONTEXT_EMPTY warning (Q34) — only when force_proceed=false
    warnings: list[str] = []
    if not ad_hoc_context.strip() and not user_hint.strip():
        # Best-effort check on the LightRAG corpus for this workspace.
        rag_empty = await _is_workspace_rag_empty(workspace_id)
        if rag_empty:
            if not force_proceed:
                # 422 to differentiate from validation errors; UI shows confirm modal.
                raise HTTPException(
                    status_code=422,
                    detail={
                        "error_code": "CONTEXT_EMPTY",
                        "message": (
                            "Workspace knowledge graph is empty and no ad-hoc "
                            "context provided. AI output will be largely TBD."
                        ),
                    },
                )
            warnings.append("CONTEXT_EMPTY")

    # step 5: hand off to the engine — schedules background runner immediately
    try:
        job = await generation_engine.start_job(
            db=db,
            user_id=user_id,
            workspace_id=workspace_id,
            template_id=template_id,
            document_title=document_title,
            outline_document_id=outline_document_id or None,
            outline_collection_id=outline_collection_id,
            ad_hoc_context=ad_hoc_context,
            user_hint=user_hint,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return StartJobResponse(
        job_id=job.id,
        outline_document_id=job.outline_document_id,
        warnings=warnings,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Read
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/jobs", response_model=list[JobSummary])
async def list_my_jobs(
    db: AsyncSession = Depends(get_db),
    identity: tuple[str, str] = Depends(extract_identity),
) -> list[JobSummary]:
    """Return caller's recent jobs, newest first (Q39: private per user)."""
    user_id, workspace_id = identity
    # step 1: filter by both user_id and workspace_id to match privacy contract
    stmt = (
        select(GenerationJob)
        .where(
            GenerationJob.user_id == user_id,
            GenerationJob.workspace_id == workspace_id,
        )
        .order_by(GenerationJob.created_at.desc())
        .limit(50)
    )
    jobs = (await db.execute(stmt)).scalars().all()
    return [JobSummary.model_validate(j) for j in jobs]


@router.get("/jobs/{job_id}", response_model=JobDetail)
async def get_job_detail(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    identity: tuple[str, str] = Depends(extract_identity),
) -> JobDetail:
    """Detail used by polling — includes per-section state (Q9)."""
    user_id, workspace_id = identity
    # step 1: eager-load sections so we render the progress sidebar in one query
    stmt = (
        select(GenerationJob)
        .where(GenerationJob.id == job_id)
        .options(selectinload(GenerationJob.sections))
    )
    job = (await db.execute(stmt)).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    # step 2: enforce ownership (Q39)
    if job.user_id != user_id or job.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Job not found")

    return JobDetail.model_validate(
        {
            "id": job.id,
            "template_id": job.template_id,
            "document_title": job.document_title,
            "outline_document_id": job.outline_document_id,
            "status": job.status,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
            "user_hint": job.user_hint,
            "error_message": job.error_message,
            "sections": [SectionStateDTO.model_validate(s) for s in job.sections],
        }
    )


# ─────────────────────────────────────────────────────────────────────────────
# Mutate
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/jobs/{job_id}/answer", status_code=204, response_model=None)
async def submit_answer(
    job_id: str,
    body: SubmitAnswerRequest,
    db: AsyncSession = Depends(get_db),
    identity: tuple[str, str] = Depends(extract_identity),
) -> None:
    """Submit answers to a section's need_info questions, or skip the section."""
    await _ensure_owns_job(db, job_id, identity)
    try:
        if body.skip:
            # Q31 — Skip path bypasses agent entirely.
            await generation_engine.skip_section(
                job_id=job_id, section_id=body.section_id
            )
        else:
            await generation_engine.continue_after_answer(
                job_id=job_id,
                section_id=body.section_id,
                answers=body.answers,
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/jobs/{job_id}/sections/{section_id}/stop",
    status_code=204,
    response_model=None,
)
async def stop_section_endpoint(
    job_id: str,
    section_id: str,
    db: AsyncSession = Depends(get_db),
    identity: tuple[str, str] = Depends(extract_identity),
) -> None:
    """Stop a single running section — aborts the LLM call to save tokens.

    Replaces the previous job-level cancel. Sets the section to `error` with
    `error_code="USER_STOPPED"`; the FE renders a soft "Section stopped"
    branch with a Generate-again button. No-op if the section isn't running
    (e.g. it just finished or was already paused).
    """
    await _ensure_owns_job(db, job_id, identity)
    await generation_engine.stop_section(job_id=job_id, section_id=section_id)


@router.delete("/jobs/{job_id}", status_code=204, response_model=None)
async def delete_job_endpoint(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    identity: tuple[str, str] = Depends(extract_identity),
) -> None:
    """Hard-delete a job (owner only). Auto-cancels first if still active.

    Cascades to `ba_kit_generation_section_states` via FK. The linked Outline
    document is intentionally NOT touched — users can still open `/doc/<id>`
    after deleting the BA Kit run that produced it.
    """
    # 404 if caller isn't the owner — same shape as cancel/regenerate
    await _ensure_owns_job(db, job_id, identity)
    await generation_engine.delete_job(job_id=job_id)


@router.post(
    "/jobs/{job_id}/sections/{section_id}/mark-synced",
    status_code=204,
    response_model=None,
)
async def mark_section_synced(
    job_id: str,
    section_id: str,
    db: AsyncSession = Depends(get_db),
    identity: tuple[str, str] = Depends(extract_identity),
) -> None:
    """Flip `appended_to_doc=true` once the FE has pushed section content
    into the Outline document via documents.update.

    Idempotent: re-calling on an already-synced section is a no-op.
    """
    await _ensure_owns_job(db, job_id, identity)
    stmt = select(GenerationSectionState).where(
        GenerationSectionState.job_id == job_id,
        GenerationSectionState.section_id == section_id,
    )
    section_state = (await db.execute(stmt)).scalar_one_or_none()
    if section_state is None:
        raise HTTPException(status_code=404, detail="Section not found")
    if not section_state.appended_to_doc:
        section_state.appended_to_doc = True
        await db.commit()


@router.post(
    "/jobs/{job_id}/sections/{section_id}/regenerate",
    status_code=204,
    response_model=None,
)
async def regenerate_section_endpoint(
    job_id: str,
    section_id: str,
    db: AsyncSession = Depends(get_db),
    identity: tuple[str, str] = Depends(extract_identity),
) -> None:
    """Re-run a single section after job completion (Q16, Q29, Q47)."""
    await _ensure_owns_job(db, job_id, identity)
    try:
        await generation_engine.regenerate_section(
            job_id=job_id, section_id=section_id
        )
    except RuntimeError as exc:
        if str(exc) == "SECTION_BUSY":
            # Q47 — reject concurrent regenerate of the same section
            raise HTTPException(
                status_code=409,
                detail={
                    "error_code": "SECTION_BUSY",
                    "message": "Section is already running or awaiting input",
                },
            ) from exc
        raise


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


async def _ensure_owns_job(
    db: AsyncSession, job_id: str, identity: tuple[str, str]
) -> GenerationJob:
    """Look up the job and 404 if caller isn't its owner."""
    user_id, workspace_id = identity
    job = await db.get(GenerationJob, job_id)
    if job is None or job.user_id != user_id or job.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


async def _is_workspace_rag_empty(workspace_id: str) -> bool:
    """Check whether LightRAG has any docs indexed for this workspace.

    Used by pre-flight (Q34). Best-effort — any error → assume non-empty so
    we don't block on transient infrastructure issues.
    """
    try:
        rag = await get_rag_for_workspace(workspace_id)
        all_docs, total = await rag.doc_status.get_docs_paginated(
            status_filter=None,
            page=1,
            page_size=1,
            sort_field="updated_at",
            sort_direction="desc",
        )
        return total == 0
    except Exception as exc:  # noqa: BLE001
        logger.warning("Pre-flight RAG empty check failed (assuming non-empty): %s", exc)
        return False
