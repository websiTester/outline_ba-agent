"""Public (workspace-member) template listing.

Used by the BA Kit gallery (B1) — shows only enabled templates so admins can
hide a template without deleting it. No auth beyond identity headers.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from middlewares.auth import extract_identity
from schemas.ba_kit import TemplateSummary
from services.template_service import count_sections_per_template, list_templates

router = APIRouter(prefix="/ba-kit", tags=["ba-kit-public"])


@router.get("/templates", response_model=list[TemplateSummary])
async def list_enabled_templates(
    db: AsyncSession = Depends(get_db),
    _identity: tuple[str, str] = Depends(extract_identity),
) -> list[TemplateSummary]:
    """Return enabled templates only (Q12) for the workspace gallery."""
    # step 1: pull enabled templates ordered by name
    templates = await list_templates(db, only_enabled=True)
    # step 2: bulk fetch counts so cards can render '11 sections' badge
    counts = await count_sections_per_template(db, [t.id for t in templates])
    return [
        TemplateSummary(
            id=t.id,
            code=t.code,
            name=t.name,
            description=t.description,
            is_enabled=t.is_enabled,
            section_count=counts.get(t.id, 0),
            updated_at=t.updated_at,
        )
        for t in templates
    ]
