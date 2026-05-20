/**
 * Type definitions for BA Kit (M2).
 *
 * Mirrors the Pydantic schemas in `backend/schemas/ba_kit.py`. Field names use
 * the camelCase serialization aliases the backend emits (`isEnabled`,
 * `outlineDocumentId`, etc.) so React components can consume responses as-is.
 */

// Per-section status (mirrors SECTION_STATUSES in backend/models/generation.py)
export type SectionStatus =
  | "pending"
  | "running"
  | "awaiting_input"
  | "done"
  | "done_unsynced"
  | "skipped"
  | "error";

// Job-level status (mirrors JOB_STATUSES in backend/models/generation.py)
export type JobStatus =
  | "pending"
  | "running"
  | "awaiting_input"
  | "completed"
  | "cancelled"
  | "error"
  | "paused_after_restart";

// Compact template card used in the gallery (B1)
export type TemplateSummary = {
  id: string;
  code: string;
  name: string;
  description: string;
  isEnabled: boolean;
  section_count: number;
  updatedAt: string;
};

// Section editor row in admin (A2) and detailed admin view
export type SectionAgent = {
  model: string;
  systemPrompt: string;
  instruction: string;
};

export type SectionExample = {
  id: string;
  label: string;
  content: string;
};

export type SectionDetail = {
  id: string;
  orderIndex: number;
  title: string;
  bodyTemplate: string;
  retrievalQueryHint: string;
  agent: SectionAgent | null;
  examples: SectionExample[];
};

export type TemplateDetail = {
  id: string;
  code: string;
  name: string;
  description: string;
  isEnabled: boolean;
  sections: SectionDetail[];
  createdAt: string;
  updatedAt: string;
};

// Per-section runtime state, polled every 1.5s during a job
export type SectionStateDTO = {
  id: string;
  sectionId: string;
  orderIndex: number;
  title: string;
  status: SectionStatus;
  content: string | null;
  needInfoRounds: number;
  needInfoQuestions: string[] | null;
  userAnswers: Record<string, string> | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  // FE flips this true via documents.update + ba-kit.jobs.markSynced after
  // pushing this section's content into the Outline document.
  appendedToDoc: boolean;
};

// Compact row for "My active jobs" list
export type JobSummary = {
  id: string;
  templateId: string;
  documentTitle: string;
  outlineDocumentId: string | null;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
};

// Full job detail with sections — used by JobView (B3)
export type JobDetail = JobSummary & {
  userHint: string;
  errorMessage: string | null;
  sections: SectionStateDTO[];
};

// Response from POST /ba-kit/jobs — outline doc id + non-blocking warnings
export type StartJobResponse = {
  jobId: string;
  outlineDocumentId: string | null;
  warnings: string[];
};

// Error codes the backend may surface so the UI can branch deterministically
export type BAKitErrorCode =
  | "CONTEXT_EMPTY"          // Q34 — workspace RAG + ad-hoc all empty
  | "CONTEXT_TOO_LARGE"      // Q36 — total chars > 200K
  | "SECTION_BUSY"           // Q47 — concurrent regenerate
  | "QUOTA_EXHAUSTED"        // Gemini quota exhausted after rotation
  | "OUTLINE_SYNC_FAILED"    // Q32 — done_unsynced badge
  | "SERVER_RESTART"         // Q35 — section was crashed by restart
  | "LLM_TIMEOUT"            // Q46
  | "LLM_ERROR";
