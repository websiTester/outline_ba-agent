"""Pydantic schemas for BA Kit.

Two groups:
  * Structured-output schemas for LLM calls (SectionOutput).
  * API request/response shapes used by routers.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


# ─────────────────────────────────────────────────────────────────────────────
# LLM structured output (Q6) — agent's contract with Gemini
# ─────────────────────────────────────────────────────────────────────────────


class SectionOutput(BaseModel):
    """Structured response a section agent must return.

    Either produces final markdown (`status="ok"`) or pauses with 1-3 questions
    for the user (`status="need_info"`). See Q6, Q27, Q44.
    """

    # Discriminator field — decide_node routes on this.
    status: Literal["ok", "need_info"] = Field(
        description="ok = section content ready; need_info = ask user before continuing"
    )
    # Filled when status=ok. Markdown to append into the Outline document.
    content: str | None = Field(
        default=None,
        description="Generated markdown for the section (required when status=ok)",
    )
    # Filled when status=need_info. 1-3 specific questions surfaced inline in UI.
    questions: list[str] | None = Field(
        default=None,
        description="1-3 specific questions for the user (required when status=need_info)",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Template admin API — shapes used by /ba-kit/admin/templates/*
# ─────────────────────────────────────────────────────────────────────────────


class TemplateSummary(BaseModel):
    # Compact row for the admin Templates table (A1 in spec).
    model_config = ConfigDict(from_attributes=True)

    id: str
    code: str
    name: str
    description: str
    is_enabled: bool = Field(validation_alias="is_enabled", serialization_alias="isEnabled")
    section_count: int  # derived in service, not a DB column
    updated_at: datetime = Field(serialization_alias="updatedAt")


class SectionAgentDTO(BaseModel):
    # Shown in the right pane of A2 (agent editor).
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    model: str
    system_prompt: str = Field(serialization_alias="systemPrompt")
    instruction: str


class SectionExampleDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    label: str
    content: str


class SectionDetail(BaseModel):
    # Full section payload for the admin editor; includes agent + examples.
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    order_index: int = Field(serialization_alias="orderIndex")
    title: str
    body_template: str = Field(serialization_alias="bodyTemplate")
    retrieval_query_hint: str = Field(serialization_alias="retrievalQueryHint")
    agent: SectionAgentDTO | None = None
    examples: list[SectionExampleDTO] = Field(default_factory=list)


class TemplateDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    code: str
    name: str
    description: str
    is_enabled: bool = Field(serialization_alias="isEnabled")
    sections: list[SectionDetail]
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: datetime = Field(serialization_alias="updatedAt")


class UpdateAgentRequest(BaseModel):
    # PATCH semantics — only provided fields are updated.
    model: str | None = None
    system_prompt: str | None = Field(default=None, validation_alias="systemPrompt")
    instruction: str | None = None


class ToggleTemplateRequest(BaseModel):
    is_enabled: bool = Field(validation_alias="isEnabled")


class UpsertExampleRequest(BaseModel):
    label: str = "Example"
    content: str


# ─────────────────────────────────────────────────────────────────────────────
# Generation API — shapes used by /ba-kit/jobs/*
# ─────────────────────────────────────────────────────────────────────────────


class SectionStateDTO(BaseModel):
    """Per-section runtime state surfaced to the polling frontend (Q9)."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    section_id: str = Field(serialization_alias="sectionId")
    order_index: int = Field(serialization_alias="orderIndex")
    title: str
    # status ∈ pending|running|awaiting_input|done|done_unsynced|skipped|error
    status: str
    content: str | None
    need_info_rounds: int = Field(serialization_alias="needInfoRounds")
    need_info_questions: list[str] | None = Field(
        default=None, serialization_alias="needInfoQuestions"
    )
    user_answers: dict | None = Field(default=None, serialization_alias="userAnswers")
    error_code: str | None = Field(default=None, serialization_alias="errorCode")
    error_message: str | None = Field(default=None, serialization_alias="errorMessage")
    started_at: datetime | None = Field(default=None, serialization_alias="startedAt")
    completed_at: datetime | None = Field(default=None, serialization_alias="completedAt")
    # Whether the FE has appended this section into the Outline document yet.
    # FE flips this via /ba-kit/jobs/:id/sections/:sid/mark-synced.
    appended_to_doc: bool = Field(
        default=False, serialization_alias="appendedToDoc"
    )


class JobSummary(BaseModel):
    # Compact row for "My active jobs" list.
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    template_id: str = Field(serialization_alias="templateId")
    document_title: str = Field(serialization_alias="documentTitle")
    outline_document_id: str | None = Field(
        default=None, serialization_alias="outlineDocumentId"
    )
    status: str
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: datetime = Field(serialization_alias="updatedAt")


class JobDetail(JobSummary):
    # Adds section breakdown — used by the progress view (B3).
    user_hint: str = Field(serialization_alias="userHint")
    error_message: str | None = Field(default=None, serialization_alias="errorMessage")
    sections: list[SectionStateDTO]


class StartJobRequest(BaseModel):
    # Used as multipart-form body; ad-hoc files come as separate UploadFile params.
    template_id: str = Field(validation_alias="templateId")
    document_title: str = Field(validation_alias="documentTitle")
    outline_collection_id: str = Field(validation_alias="outlineCollectionId")
    user_hint: str = ""
    free_text_context: str = ""
    # Set true by frontend after user accepts the CONTEXT_EMPTY warning (Q34).
    force_proceed: bool = Field(default=False, validation_alias="forceProceed")


class StartJobResponse(BaseModel):
    job_id: str = Field(serialization_alias="jobId")
    outline_document_id: str | None = Field(
        default=None, serialization_alias="outlineDocumentId"
    )
    # Non-blocking warnings (e.g. ["CONTEXT_EMPTY"]) — UI shows confirm modal.
    warnings: list[str] = Field(default_factory=list)


class SubmitAnswerRequest(BaseModel):
    section_id: str = Field(validation_alias="sectionId")
    # {"0": "answer to Q1", "1": "answer to Q2"} — index matches questions[].
    answers: dict[str, str]
    # When true, marks section as skipped instead of submitting answers (Q31).
    skip: bool = False
