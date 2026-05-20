"""BA Kit template models — instance-level (global) configuration.

Tables: templates, template_sections, template_section_agents, template_section_examples.
All four tables are instance-level (no workspaceId) — managed by users with
`users.isInstanceAdmin = true`. See spec.md Q1, Q3, Q41, Q42.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


def _new_id() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Template(Base):
    """One row per BA Kit template (BRD, PRD, CR, …). Global — no workspaceId.

    Per Q12, `is_enabled` toggles visibility across all workspaces.
    """

    __tablename__ = "ba_kit_templates"

    id: Mapped[str] = mapped_column("id", Uuid(as_uuid=False), primary_key=True, default=_new_id)
    code: Mapped[str] = mapped_column("code", String, nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column("name", String, nullable=False)
    description: Mapped[str] = mapped_column("description", Text, nullable=False, default="")
    is_enabled: Mapped[bool] = mapped_column("isEnabled", Boolean, nullable=False, default=True)
    created_by_user_id: Mapped[str | None] = mapped_column("createdByUserId", String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        "createdAt", DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), nullable=False,
        default=_utcnow, onupdate=_utcnow,
    )

    sections: Mapped[list["TemplateSection"]] = relationship(
        "TemplateSection",
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="TemplateSection.order_index",
    )


class TemplateSection(Base):
    """One row per section in a template (e.g. BRD §I, §II, …).

    `body_template` is the markdown skeleton — agent fills [FILL: …] markers
    while preserving headings/tables/mermaid. See Q41.
    """

    __tablename__ = "ba_kit_template_sections"

    id: Mapped[str] = mapped_column("id", Uuid(as_uuid=False), primary_key=True, default=_new_id)
    template_id: Mapped[str] = mapped_column(
        "templateId",
        Uuid(as_uuid=False),
        ForeignKey("ba_kit_templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order_index: Mapped[int] = mapped_column("orderIndex", Integer, nullable=False)
    title: Mapped[str] = mapped_column("title", String, nullable=False)
    body_template: Mapped[str] = mapped_column("bodyTemplate", Text, nullable=False, default="")
    retrieval_query_hint: Mapped[str] = mapped_column(
        "retrievalQueryHint", String, nullable=False, default=""
    )
    created_at: Mapped[datetime] = mapped_column(
        "createdAt", DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), nullable=False,
        default=_utcnow, onupdate=_utcnow,
    )

    template: Mapped[Template] = relationship("Template", back_populates="sections")
    agent: Mapped["TemplateSectionAgent | None"] = relationship(
        "TemplateSectionAgent",
        back_populates="section",
        cascade="all, delete-orphan",
        uselist=False,
    )
    examples: Mapped[list["TemplateSectionExample"]] = relationship(
        "TemplateSectionExample",
        back_populates="section",
        cascade="all, delete-orphan",
    )


class TemplateSectionAgent(Base):
    """Agent configuration for a section: model + system prompt + instruction.

    1:1 with TemplateSection. Snapshot copied into generation_jobs on start (Q37).
    """

    __tablename__ = "ba_kit_template_section_agents"

    id: Mapped[str] = mapped_column("id", Uuid(as_uuid=False), primary_key=True, default=_new_id)
    section_id: Mapped[str] = mapped_column(
        "sectionId",
        Uuid(as_uuid=False),
        ForeignKey("ba_kit_template_sections.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    model: Mapped[str] = mapped_column("model", String, nullable=False, default="gemini-2.5-flash")
    system_prompt: Mapped[str] = mapped_column("systemPrompt", Text, nullable=False)
    instruction: Mapped[str] = mapped_column("instruction", Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        "createdAt", DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), nullable=False,
        default=_utcnow, onupdate=_utcnow,
    )

    section: Mapped[TemplateSection] = relationship("TemplateSection", back_populates="agent")


class TemplateSectionExample(Base):
    """Optional few-shot example attached to a section (Q42). Up to 2 per section."""

    __tablename__ = "ba_kit_template_section_examples"

    id: Mapped[str] = mapped_column("id", Uuid(as_uuid=False), primary_key=True, default=_new_id)
    section_id: Mapped[str] = mapped_column(
        "sectionId",
        Uuid(as_uuid=False),
        ForeignKey("ba_kit_template_sections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    label: Mapped[str] = mapped_column("label", String, nullable=False, default="Example")
    content: Mapped[str] = mapped_column("content", Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        "createdAt", DateTime(timezone=True), nullable=False, default=_utcnow
    )

    section: Mapped[TemplateSection] = relationship("TemplateSection", back_populates="examples")
