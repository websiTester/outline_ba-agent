/**
 * BA Kit API client.
 *
 * Wraps `client.post(...)` from `~/utils/ApiClient` so every BA Kit action
 * follows the proxy convention `/ba-kit.<area>.<verb>`. The Node proxy
 * (`server/routes/api/ba-kit/proxy.ts`) translates those RPC names into HTTP
 * verbs against the FastAPI service.
 */

import { client } from "~/utils/ApiClient";
import type {
  JobDetail,
  JobSummary,
  SectionDetail,
  StartJobResponse,
  TemplateDetail,
  TemplateSummary,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Public (workspace member) endpoints
// ─────────────────────────────────────────────────────────────────────────────

export async function listTemplates(): Promise<TemplateSummary[]> {
  // Returns enabled templates only (Q12 — global flag).
  const res = await client.post("/ba-kit.templates.list", {});
  return (res?.data ?? res ?? []) as TemplateSummary[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation jobs (user-scoped)
// ─────────────────────────────────────────────────────────────────────────────

export type StartJobParams = {
  templateId: string;
  documentTitle: string;
  outlineCollectionId: string;
  outlineDocumentId?: string; // created by frontend before calling start
  userHint?: string;
  freeTextContext?: string;
  forceProceed?: boolean;
  files?: File[];
};

export async function startJob(params: StartJobParams): Promise<StartJobResponse> {
  // step 1: build multipart body — files + form fields
  const form = new FormData();
  form.append("template_id", params.templateId);
  form.append("document_title", params.documentTitle);
  form.append("outline_collection_id", params.outlineCollectionId);
  if (params.outlineDocumentId) {
    form.append("outline_document_id", params.outlineDocumentId);
  }
  form.append("user_hint", params.userHint ?? "");
  form.append("free_text_context", params.freeTextContext ?? "");
  form.append("force_proceed", String(params.forceProceed ?? false));
  (params.files ?? []).forEach((f) => form.append("files", f));

  // step 2: use the Outline RPC convention; the proxy unpacks multipart
  const res = await client.post("/ba-kit.jobs.start", form);
  return (res?.data ?? res) as StartJobResponse;
}

export async function listMyJobs(): Promise<JobSummary[]> {
  const res = await client.post("/ba-kit.jobs.list", {});
  return (res?.data ?? res ?? []) as JobSummary[];
}

export async function getJob(id: string): Promise<JobDetail> {
  const res = await client.post("/ba-kit.jobs.detail", { id });
  return (res?.data ?? res) as JobDetail;
}

export async function submitJobAnswer(
  jobId: string,
  sectionId: string,
  answers: Record<string, string>,
  skip = false
): Promise<void> {
  await client.post("/ba-kit.jobs.answer", {
    id: jobId,
    section_id: sectionId,
    answers,
    skip,
  });
}

// Abort the in-flight LLM call for one running section. Section ends up at
// `error` with `error_code="USER_STOPPED"` so the FE renders a soft
// "Section stopped" branch instead of treating it like a real failure.
export async function stopSection(
  jobId: string,
  sectionId: string
): Promise<void> {
  await client.post("/ba-kit.jobs.stop", {
    id: jobId,
    section_id: sectionId,
  });
}

// Hard-delete a job (owner-only on the backend). Auto-cancels first if the
// job is still active so the runner can release its section row before we
// drop the parent.
export async function deleteJob(jobId: string): Promise<void> {
  await client.post("/ba-kit.jobs.delete", { id: jobId });
}

export async function regenerateSection(
  jobId: string,
  sectionId: string
): Promise<void> {
  await client.post("/ba-kit.jobs.regenerate", {
    id: jobId,
    section_id: sectionId,
  });
}

/**
 * Flip the backend's `appended_to_doc` flag after a successful
 * `documents.update` append. Idempotent on the backend so retries are safe.
 */
export async function markSectionSynced(
  jobId: string,
  sectionId: string
): Promise<void> {
  await client.post("/ba-kit.jobs.markSynced", {
    id: jobId,
    section_id: sectionId,
  });
}

/**
 * Append a section's markdown into the existing Outline document using the
 * user's own session. Uses the built-in `documents.update` with editMode
 * "append" so realtime collaborators see the change.
 */
export async function appendSectionToOutlineDoc(
  outlineDocumentId: string,
  sectionTitle: string,
  markdown: string
): Promise<void> {
  // Prefix an H2 so the section is identifiable inside the document. The
  // leading blank line ensures it doesn't fuse with prior section content.
  const text = `\n\n## ${sectionTitle}\n\n${markdown.trim()}\n`;
  await client.post("/documents.update", {
    id: outlineDocumentId,
    text,
    append: true,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin (instance-admin only) endpoints
// ─────────────────────────────────────────────────────────────────────────────

export async function listAdminTemplates(): Promise<TemplateSummary[]> {
  // Returns every template, regardless of isEnabled.
  const res = await client.post("/ba-kit.admin.templates.list", {});
  return (res?.data ?? res ?? []) as TemplateSummary[];
}

export async function getAdminTemplate(id: string): Promise<TemplateDetail> {
  const res = await client.post("/ba-kit.admin.templates.detail", { id });
  return (res?.data ?? res) as TemplateDetail;
}

export async function uploadTemplate(
  file: File,
  code?: string
): Promise<TemplateDetail> {
  const form = new FormData();
  form.append("file", file);
  if (code) {
    form.append("code", code);
  }
  const res = await client.post("/ba-kit.admin.templates.upload", form);
  return (res?.data ?? res) as TemplateDetail;
}

export async function toggleTemplate(
  id: string,
  isEnabled: boolean
): Promise<TemplateSummary> {
  const res = await client.post("/ba-kit.admin.templates.toggle", {
    id,
    isEnabled,
  });
  return (res?.data ?? res) as TemplateSummary;
}

export async function deleteTemplate(id: string): Promise<void> {
  await client.post("/ba-kit.admin.templates.delete", { id });
}

export async function updateSectionAgent(
  templateId: string,
  sectionId: string,
  patch: Partial<{ model: string; systemPrompt: string; instruction: string }>
): Promise<SectionDetail> {
  const res = await client.post("/ba-kit.admin.sections.updateAgent", {
    template_id: templateId,
    section_id: sectionId,
    ...patch,
  });
  return (res?.data ?? res) as SectionDetail;
}

export async function addSectionExample(
  templateId: string,
  sectionId: string,
  label: string,
  content: string
): Promise<SectionDetail> {
  const res = await client.post("/ba-kit.admin.sections.addExample", {
    template_id: templateId,
    section_id: sectionId,
    label,
    content,
  });
  return (res?.data ?? res) as SectionDetail;
}

export async function removeSectionExample(
  templateId: string,
  sectionId: string,
  exampleId: string
): Promise<void> {
  await client.post("/ba-kit.admin.sections.removeExample", {
    template_id: templateId,
    section_id: sectionId,
    example_id: exampleId,
  });
}
