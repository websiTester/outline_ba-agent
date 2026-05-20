"""CRUD service for BA Kit templates (admin).

Routers call into this module; this module owns DB transactions and is the
single place where Template + section + agent + example rows get mutated.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.template import (
    Template,
    TemplateSection,
    TemplateSectionAgent,
    TemplateSectionExample,
)
from services.template_parser import ParsedTemplate


# ─────────────────────────────────────────────────────────────────────────────
# Read
# ─────────────────────────────────────────────────────────────────────────────


async def list_templates(db: AsyncSession, *, only_enabled: bool = False) -> list[Template]:
    """Return all templates ordered by name.

    `only_enabled=True` filters to user-visible templates (used by the
    workspace gallery endpoint per Q12).
    """
    stmt = select(Template).order_by(Template.name)
    if only_enabled:
        stmt = stmt.where(Template.is_enabled.is_(True))
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def count_sections_per_template(
    db: AsyncSession, template_ids: Iterable[str]
) -> dict[str, int]:
    """Bulk-count sections so the admin list can show 'N sections' badge."""
    ids = list(template_ids)
    if not ids:
        return {}
    stmt = (
        select(TemplateSection.template_id, func.count(TemplateSection.id))
        .where(TemplateSection.template_id.in_(ids))
        .group_by(TemplateSection.template_id)
    )
    result = await db.execute(stmt)
    return {row[0]: row[1] for row in result.all()}


async def get_template_with_sections(
    db: AsyncSession, template_id: str
) -> Template | None:
    """Eager-load a single template with sections + agents + examples.

    Used by the agent editor (A2) which renders the full tree on one screen.
    """
    stmt = (
        select(Template)
        .where(Template.id == template_id)
        .options(
            selectinload(Template.sections)
            .selectinload(TemplateSection.agent),
            selectinload(Template.sections)
            .selectinload(TemplateSection.examples),
        )
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def get_template_by_code(db: AsyncSession, code: str) -> Template | None:
    """Lookup by short code (BRD/PRD/…). Used by seed to detect duplicates."""
    result = await db.execute(select(Template).where(Template.code == code))
    return result.scalar_one_or_none()


# ─────────────────────────────────────────────────────────────────────────────
# Create / replace from parser output
# ─────────────────────────────────────────────────────────────────────────────


async def create_template_from_parsed(
    db: AsyncSession,
    parsed: ParsedTemplate,
    *,
    created_by_user_id: str | None,
    default_prompts: dict[int, tuple[str, str]],
    is_enabled: bool = True,
) -> Template:
    """Insert a Template + its sections + agent stubs in one transaction.

    `default_prompts` maps `section.order_index → (system_prompt, instruction)`
    so the seed flow can pre-fill agent configs while admin uploads start blank.
    """
    # step 1: create the Template row (parent)
    template = Template(
        code=parsed.code,
        name=parsed.name,
        description=parsed.description,
        is_enabled=is_enabled,
        created_by_user_id=created_by_user_id,
    )
    db.add(template)
    # Flush to assign an id before linking children.
    await db.flush()

    # step 2: create one TemplateSection + TemplateSectionAgent per parsed section
    for parsed_section in parsed.sections:
        section = TemplateSection(
            template_id=template.id,
            order_index=parsed_section.order_index,
            title=f"{parsed_section.roman}. {parsed_section.title}",
            body_template=parsed_section.body_template,
            retrieval_query_hint=parsed_section.title,
        )
        db.add(section)
        await db.flush()

        # Build the agent with either provided default or a placeholder.
        system_prompt, instruction = default_prompts.get(
            parsed_section.order_index,
            (
                # Fallback when no default prompt provided (admin manual upload).
                f"Bạn là BA agent. Viết section §{parsed_section.roman}. "
                f"{parsed_section.title}.",
                f"Sinh nội dung §{parsed_section.roman}. {parsed_section.title}.",
            ),
        )
        agent = TemplateSectionAgent(
            section_id=section.id,
            model="gemini-2.5-flash",
            system_prompt=system_prompt,
            instruction=instruction,
        )
        db.add(agent)

    await db.commit()
    await db.refresh(template)
    return template


# ─────────────────────────────────────────────────────────────────────────────
# Update
# ─────────────────────────────────────────────────────────────────────────────


async def toggle_template_enabled(
    db: AsyncSession, template_id: str, is_enabled: bool
) -> Template | None:
    """Flip the global visibility flag (Q12)."""
    template = await db.get(Template, template_id)
    if template is None:
        return None
    template.is_enabled = is_enabled
    template.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(template)
    return template


async def update_section_agent(
    db: AsyncSession,
    section_id: str,
    *,
    model: str | None = None,
    system_prompt: str | None = None,
    instruction: str | None = None,
) -> TemplateSectionAgent | None:
    """PATCH semantics — only provided fields are updated."""
    # step 1: fetch existing agent (sections always have one after seed/create)
    stmt = select(TemplateSectionAgent).where(TemplateSectionAgent.section_id == section_id)
    result = await db.execute(stmt)
    agent = result.scalar_one_or_none()
    if agent is None:
        return None

    # step 2: apply PATCH fields and bump updated_at
    if model is not None:
        agent.model = model
    if system_prompt is not None:
        agent.system_prompt = system_prompt
    if instruction is not None:
        agent.instruction = instruction
    agent.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(agent)
    return agent


async def upsert_section_example(
    db: AsyncSession,
    section_id: str,
    *,
    example_id: str | None,
    label: str,
    content: str,
) -> TemplateSectionExample:
    """Create or replace an example for a section (Q42, max 2 per section).

    `example_id=None` → create. Otherwise update by id.
    """
    if example_id is not None:
        existing = await db.get(TemplateSectionExample, example_id)
        if existing is not None:
            existing.label = label
            existing.content = content
            await db.commit()
            await db.refresh(existing)
            return existing

    example = TemplateSectionExample(
        section_id=section_id, label=label, content=content
    )
    db.add(example)
    await db.commit()
    await db.refresh(example)
    return example


async def delete_section_example(db: AsyncSession, example_id: str) -> bool:
    example = await db.get(TemplateSectionExample, example_id)
    if example is None:
        return False
    await db.delete(example)
    await db.commit()
    return True


# ─────────────────────────────────────────────────────────────────────────────
# Delete
# ─────────────────────────────────────────────────────────────────────────────


async def delete_template(db: AsyncSession, template_id: str) -> bool:
    """Hard-delete a template (cascade clears sections/agents/examples).

    Note: Existing GenerationJob rows reference Template via RESTRICT FK,
    so this will fail if there are jobs — caller should soft-disable instead.
    """
    template = await db.get(Template, template_id)
    if template is None:
        return False
    await db.delete(template)
    await db.commit()
    return True
