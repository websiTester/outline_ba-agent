"""Admin-only routes for BA Kit template management.

All endpoints under `/ba-kit/admin/*` require `users.isInstanceAdmin = true`
(Q11, Q48). They mutate the global Template / TemplateSection / Agent /
Example rows.

Endpoints:
  POST   /ba-kit/admin/templates/upload                  — upload .md + parse
  GET    /ba-kit/admin/templates                          — list summaries
  GET    /ba-kit/admin/templates/{id}                     — detail w/ sections
  PATCH  /ba-kit/admin/templates/{id}                     — toggle enabled
  PATCH  /ba-kit/admin/templates/{id}/sections/{sid}/agent — update agent cfg
  POST   /ba-kit/admin/templates/{id}/sections/{sid}/examples — upsert example
  DELETE /ba-kit/admin/templates/{id}/sections/{sid}/examples/{eid} — remove
  DELETE /ba-kit/admin/templates/{id}                     — delete template
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from middlewares.auth import require_instance_admin
from schemas.ba_kit import (
    SectionDetail,
    TemplateDetail,
    TemplateSummary,
    ToggleTemplateRequest,
    UpdateAgentRequest,
    UpsertExampleRequest,
)
from services.default_prompt_builder import build_default_prompts
from services.template_parser import parse_template_markdown
from services.template_service import (
    count_sections_per_template,
    create_template_from_parsed,
    delete_section_example,
    delete_template,
    get_template_by_code,
    get_template_with_sections,
    list_templates,
    toggle_template_enabled,
    update_section_agent,
    upsert_section_example,
)

router = APIRouter(prefix="/ba-kit/admin", tags=["ba-kit-admin"])


# ─────────────────────────────────────────────────────────────────────────────
# Upload + list
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/templates/upload", response_model=TemplateDetail)
async def upload_template(
    file: UploadFile = File(...),
    code: str = "",  # optional override; else derived from filename
    db: AsyncSession = Depends(get_db),
    identity: tuple[str, str] = Depends(require_instance_admin),
) -> TemplateDetail:
    """Parse uploaded markdown and create the Template + sections + agents.

    `code` defaults to the filename stem uppercased — e.g. `my-template.md` →
    `MY-TEMPLATE`. Rejects duplicates.
    """
    admin_user_id = identity[0]

    # step 1: read upload bytes; reject empties early
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    markdown_text = raw.decode("utf-8", errors="replace")

    # step 2: derive code from filename if not provided
    if not code:
        stem = (file.filename or "TEMPLATE").rsplit("/", 1)[-1].rsplit(".", 1)[0]
        code = stem.upper().replace(" ", "_") or "TEMPLATE"

    # step 3: reject duplicate code so we don't shadow seeded templates
    if await get_template_by_code(db, code) is not None:
        raise HTTPException(status_code=409, detail=f"Template code {code} already exists")

    # step 4: parse markdown → ParsedTemplate; reject if no Roman sections found
    parsed = parse_template_markdown(markdown_text, code=code)
    if not parsed.sections:
        raise HTTPException(
            status_code=400,
            detail="No Roman-numeral sections (## I., ## II., …) found in markdown",
        )

    # step 5: pre-fill default prompts (without workflow dir — admin upload)
    defaults: dict[int, tuple[str, str]] = {}
    for section in parsed.sections:
        sys_prompt, instr = build_default_prompts(
            template_code=code,
            section_roman=section.roman,
            section_title=section.title,
            body_template=section.body_template,
            workflow_dir=None,
        )
        defaults[section.order_index] = (sys_prompt, instr)

    # step 6: persist + return the full detail back to admin UI
    template = await create_template_from_parsed(
        db,
        parsed,
        created_by_user_id=admin_user_id,
        default_prompts=defaults,
        is_enabled=True,
    )
    full = await get_template_with_sections(db, template.id)
    return _serialize_template_detail(full)


@router.get("/templates", response_model=list[TemplateSummary])
async def list_admin_templates(
    db: AsyncSession = Depends(get_db),
    _identity: tuple[str, str] = Depends(require_instance_admin),
) -> list[TemplateSummary]:
    """Compact summary used by the admin Templates table (A1)."""
    # step 1: pull all templates regardless of enabled state
    templates = await list_templates(db, only_enabled=False)

    # step 2: bulk-fetch section counts in a single query
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


@router.get("/templates/{template_id}", response_model=TemplateDetail)
async def get_admin_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    _identity: tuple[str, str] = Depends(require_instance_admin),
) -> TemplateDetail:
    """Full template with sections + agents + examples — for the editor (A2)."""
    template = await get_template_with_sections(db, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return _serialize_template_detail(template)


# ─────────────────────────────────────────────────────────────────────────────
# Mutate
# ─────────────────────────────────────────────────────────────────────────────


@router.patch("/templates/{template_id}", response_model=TemplateSummary)
async def patch_template(
    template_id: str,
    body: ToggleTemplateRequest,
    db: AsyncSession = Depends(get_db),
    _identity: tuple[str, str] = Depends(require_instance_admin),
) -> TemplateSummary:
    """Flip the global isEnabled flag (Q12)."""
    template = await toggle_template_enabled(db, template_id, body.is_enabled)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    # Section count needed for summary response
    counts = await count_sections_per_template(db, [template.id])
    return TemplateSummary(
        id=template.id,
        code=template.code,
        name=template.name,
        description=template.description,
        is_enabled=template.is_enabled,
        section_count=counts.get(template.id, 0),
        updated_at=template.updated_at,
    )


@router.patch(
    "/templates/{template_id}/sections/{section_id}/agent",
    response_model=SectionDetail,
)
async def patch_section_agent(
    template_id: str,
    section_id: str,
    body: UpdateAgentRequest,
    db: AsyncSession = Depends(get_db),
    _identity: tuple[str, str] = Depends(require_instance_admin),
) -> SectionDetail:
    """PATCH model/system_prompt/instruction on a section's agent."""
    agent = await update_section_agent(
        db,
        section_id,
        model=body.model,
        system_prompt=body.system_prompt,
        instruction=body.instruction,
    )
    if agent is None:
        raise HTTPException(status_code=404, detail="Section/agent not found")

    # Return refreshed section view for the editor.
    template = await get_template_with_sections(db, template_id)
    section = next((s for s in (template.sections if template else []) if s.id == section_id), None)
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found after update")
    return _serialize_section(section)


@router.post(
    "/templates/{template_id}/sections/{section_id}/examples",
    response_model=SectionDetail,
)
async def add_section_example(
    template_id: str,
    section_id: str,
    body: UpsertExampleRequest,
    db: AsyncSession = Depends(get_db),
    _identity: tuple[str, str] = Depends(require_instance_admin),
) -> SectionDetail:
    """Append a new example (Q42) to a section — caller is responsible for the 2-max cap."""
    await upsert_section_example(
        db,
        section_id,
        example_id=None,
        label=body.label,
        content=body.content,
    )
    template = await get_template_with_sections(db, template_id)
    section = next((s for s in (template.sections if template else []) if s.id == section_id), None)
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found")
    return _serialize_section(section)


@router.delete(
    "/templates/{template_id}/sections/{section_id}/examples/{example_id}",
    status_code=204,
    # FastAPI 0.115+ infers response_model from `-> None`, which would clash
    # with 204 (no-body). Explicitly disable inference.
    response_model=None,
)
async def remove_section_example(
    template_id: str,
    section_id: str,
    example_id: str,
    db: AsyncSession = Depends(get_db),
    _identity: tuple[str, str] = Depends(require_instance_admin),
) -> None:
    """Hard-delete one example."""
    ok = await delete_section_example(db, example_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Example not found")


@router.delete("/templates/{template_id}", status_code=204, response_model=None)
async def remove_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    _identity: tuple[str, str] = Depends(require_instance_admin),
) -> None:
    """Hard-delete a template (cascade clears sections/agents/examples)."""
    try:
        ok = await delete_template(db, template_id)
    except Exception as exc:  # noqa: BLE001
        # FK violation when jobs reference this template (RESTRICT).
        raise HTTPException(
            status_code=409,
            detail="Template has generation jobs — disable instead of delete",
        ) from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Template not found")


# ─────────────────────────────────────────────────────────────────────────────
# Serialization helpers
# ─────────────────────────────────────────────────────────────────────────────


def _serialize_section(section) -> SectionDetail:
    """Build SectionDetail with optional agent + examples eager-loaded."""
    return SectionDetail.model_validate(
        {
            "id": section.id,
            "order_index": section.order_index,
            "title": section.title,
            "body_template": section.body_template,
            "retrieval_query_hint": section.retrieval_query_hint,
            "agent": (
                {
                    "model": section.agent.model,
                    "system_prompt": section.agent.system_prompt,
                    "instruction": section.agent.instruction,
                }
                if section.agent
                else None
            ),
            "examples": [
                {"id": ex.id, "label": ex.label, "content": ex.content}
                for ex in (section.examples or [])
            ],
        }
    )


def _serialize_template_detail(template) -> TemplateDetail:
    """Build full TemplateDetail response (used by upload + GET detail)."""
    return TemplateDetail.model_validate(
        {
            "id": template.id,
            "code": template.code,
            "name": template.name,
            "description": template.description,
            "is_enabled": template.is_enabled,
            "sections": [
                _serialize_section(s).model_dump(by_alias=False) for s in template.sections
            ],
            "created_at": template.created_at,
            "updated_at": template.updated_at,
        }
    )
