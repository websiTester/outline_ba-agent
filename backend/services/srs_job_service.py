import json
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.srs_job import SrsJob


async def create_job(db: AsyncSession, workspace_id: str) -> SrsJob:
    job = SrsJob(
        id=str(uuid.uuid4()),
        workspace_id=workspace_id,
        status="pending",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


async def get_job(db: AsyncSession, job_id: str) -> SrsJob | None:
    result = await db.execute(select(SrsJob).where(SrsJob.id == job_id))
    return result.scalar_one_or_none()


async def update_job_status(
    db: AsyncSession,
    job_id: str,
    status: str,
    error: str | None = None,
    results: list[dict] | None = None,
) -> None:
    result = await db.execute(select(SrsJob).where(SrsJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        return
    job.status = status
    if error is not None:
        job.error = error
    if results is not None:
        job.results = json.dumps(results, ensure_ascii=False)
    await db.commit()
