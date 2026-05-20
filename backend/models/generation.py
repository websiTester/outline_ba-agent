"""BA Kit generation job models — workspace-scoped runtime state.

Tables: generation_jobs, generation_section_states. Mirror LangGraph state
into normalized rows for fast polling by frontend (Q9). Source of truth for
content is generation_section_states.content (Q32 — survives Outline append
failures).
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
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


def _new_id() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# Job lifecycle = user intent (sticky, never overwritten by the runner).
# Once a job is `cancelled` it stays that way; no code path may flip it back.
JOB_LIFECYCLES = {
    "active",     # default — runner is free to drive `progress`
    "cancelled",  # user clicked Cancel; runner must short-circuit
}

# Job progress = computed status driven by the section state machine.
# The runner writes here; it must NEVER touch `lifecycle`.
JOB_PROGRESS = {
    "pending",               # created, not yet started
    "running",               # at least one section currently executing
    "awaiting_input",        # paused, waiting for user to submit need_info answers
    "completed",             # all sections terminal (done/skipped/error)
    "error",                 # blocking error, paused for retry
    "paused_after_restart",  # Q35 recovery
}

# Legacy single-field statuses returned over the wire. Derived from
# (lifecycle, progress) via `GenerationJob.status`. Frontend types in
# app/scenes/BAKit/types.ts mirror this set.
JOB_STATUSES = JOB_PROGRESS | {"cancelled"}

SECTION_STATUSES = {
    "pending",
    "running",
    "awaiting_input",
    "done",
    "done_unsynced",    # generated OK but Outline append failed (Q32)
    "skipped",          # user clicked Skip section (Q31)
    "error",            # LLM/timeout/etc — see error_code/error_message
}


class GenerationJob(Base):
    """A user-initiated run of one template against one workspace.

    Linked to exactly one Outline Document (created at job start — Q10).
    Snapshot of all section prompts captured here at start (Q37) for
    reproducibility despite admin edits.
    """

    __tablename__ = "ba_kit_generation_jobs"

    id: Mapped[str] = mapped_column("id", Uuid(as_uuid=False), primary_key=True, default=_new_id)
    user_id: Mapped[str] = mapped_column("userId", String, nullable=False, index=True)
    workspace_id: Mapped[str] = mapped_column("workspaceId", String, nullable=False, index=True)
    template_id: Mapped[str] = mapped_column(
        "templateId",
        Uuid(as_uuid=False),
        ForeignKey("ba_kit_templates.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # Outline document linkage (created when job starts; Q10).
    outline_document_id: Mapped[str | None] = mapped_column(
        "outlineDocumentId", String, nullable=True
    )
    outline_collection_id: Mapped[str | None] = mapped_column(
        "outlineCollectionId", String, nullable=True
    )
    document_title: Mapped[str] = mapped_column("documentTitle", String, nullable=False)

    # User-provided context at start (Q33).
    ad_hoc_context: Mapped[str] = mapped_column(
        "adHocContext", Text, nullable=False, default=""
    )
    user_hint: Mapped[str] = mapped_column("userHint", Text, nullable=False, default="")

    # Snapshot of {section_id: {system_prompt, instruction, model, body_template, examples}}
    # taken at job-start time so admin edits mid-run don't disturb this job (Q37).
    snapshot_prompts: Mapped[dict] = mapped_column(
        "snapshotPrompts", JSONB, nullable=False, default=dict
    )

    # LangGraph thread id used with PostgresSaver checkpointer.
    langgraph_thread_id: Mapped[str] = mapped_column(
        "langgraphThreadId", String, nullable=False, default=_new_id, unique=True
    )

    # User intent — sticky. Runner reads this to short-circuit; no progress
    # write may ever flip it back to "active".
    lifecycle: Mapped[str] = mapped_column(
        "lifecycle", String, nullable=False, default="active", index=True
    )
    # Runner-driven progress. All "is the runner doing X?" writes land here.
    progress: Mapped[str] = mapped_column(
        "progress", String, nullable=False, default="pending", index=True
    )
    error_message: Mapped[str | None] = mapped_column("errorMessage", Text, nullable=True)

    @property
    def status(self) -> str:
        """Wire-format status combining lifecycle + progress.

        Single source of truth for everything outside the engine (FE polling,
        recovery, recent-jobs list). `cancelled` always wins over progress so
        the user's cancel intent survives any later runner write.
        """
        if self.lifecycle == "cancelled":
            return "cancelled"
        return self.progress

    created_at: Mapped[datetime] = mapped_column(
        "createdAt", DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), nullable=False,
        default=_utcnow, onupdate=_utcnow,
    )

    sections: Mapped[list["GenerationSectionState"]] = relationship(
        "GenerationSectionState",
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="GenerationSectionState.order_index",
    )


class GenerationSectionState(Base):
    """Per-section runtime state. One row per (job × section).

    Created at job start as `pending` for every section in the template (so
    frontend can render the section list immediately). Updated as the agent
    progresses. Content is the source of truth even if Outline sync fails (Q32).
    """

    __tablename__ = "ba_kit_generation_section_states"

    id: Mapped[str] = mapped_column("id", Uuid(as_uuid=False), primary_key=True, default=_new_id)
    job_id: Mapped[str] = mapped_column(
        "jobId",
        Uuid(as_uuid=False),
        ForeignKey("ba_kit_generation_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    section_id: Mapped[str] = mapped_column(
        "sectionId",
        Uuid(as_uuid=False),
        ForeignKey("ba_kit_template_sections.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    order_index: Mapped[int] = mapped_column("orderIndex", Integer, nullable=False)
    title: Mapped[str] = mapped_column("title", String, nullable=False)

    status: Mapped[str] = mapped_column("status", String, nullable=False, default="pending")

    # Generated markdown (None until first successful generate).
    content: Mapped[str | None] = mapped_column("content", Text, nullable=True)

    # need_info loop bookkeeping (Q27).
    need_info_rounds: Mapped[int] = mapped_column(
        "needInfoRounds", Integer, nullable=False, default=0
    )
    need_info_questions: Mapped[list | None] = mapped_column(
        "needInfoQuestions", JSONB, nullable=True
    )
    # {question_index: user_answer_text}
    user_answers: Mapped[dict | None] = mapped_column(
        "userAnswers", JSONB, nullable=True
    )

    # Error info (Q30).
    error_code: Mapped[str | None] = mapped_column("errorCode", String, nullable=True)
    error_message: Mapped[str | None] = mapped_column("errorMessage", Text, nullable=True)

    # Q35 — heartbeat for restart recovery.
    last_heartbeat: Mapped[datetime | None] = mapped_column(
        "lastHeartbeat", DateTime(timezone=True), nullable=True
    )

    # Whether the frontend has appended this section's content into the
    # Outline document yet. Backend doesn't talk to Outline directly anymore;
    # the FE polls, calls Outline's documents.update with the user's session,
    # then POSTs /mark-synced to flip this flag.
    appended_to_doc: Mapped[bool] = mapped_column(
        "appendedToDoc", Boolean, nullable=False, default=False
    )

    started_at: Mapped[datetime | None] = mapped_column(
        "startedAt", DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        "completedAt", DateTime(timezone=True), nullable=True
    )

    job: Mapped[GenerationJob] = relationship("GenerationJob", back_populates="sections")
