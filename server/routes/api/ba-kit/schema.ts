/**
 * Zod schemas for BA Kit endpoints — mirrors `routes/api/chat/schema.ts`.
 *
 * Each schema extends `BaseSchema` so the shared `body` / `query` / `file`
 * envelope is preserved. Files in multipart endpoints are NOT validated here
 * — formidable populates `ctx.request.files` directly which the handler
 * reads via raw access.
 */

import { z } from "zod";
import { BaseSchema } from "../schema";

// ─────────────────────────────────────────────────────────────────────────────
// Public (workspace member)
// ─────────────────────────────────────────────────────────────────────────────

// Just listing enabled templates — no body fields needed.
export const TemplatesListSchema = BaseSchema.extend({
  body: z.object({}),
});
export type TemplatesListReq = z.infer<typeof TemplatesListSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Admin — templates CRUD
// ─────────────────────────────────────────────────────────────────────────────

export const AdminTemplatesListSchema = BaseSchema.extend({
  body: z.object({}),
});
export type AdminTemplatesListReq = z.infer<typeof AdminTemplatesListSchema>;

export const AdminTemplateDetailSchema = BaseSchema.extend({
  body: z.object({
    id: z.string().uuid(),
  }),
});
export type AdminTemplateDetailReq = z.infer<typeof AdminTemplateDetailSchema>;

// Multipart endpoint — body holds optional `code` text field. The actual
// markdown file is read from `ctx.request.files.file` in the handler.
export const AdminTemplateUploadSchema = BaseSchema.extend({
  body: z.object({
    code: z.string().optional(),
  }),
});
export type AdminTemplateUploadReq = z.infer<typeof AdminTemplateUploadSchema>;

export const AdminTemplateToggleSchema = BaseSchema.extend({
  body: z.object({
    id: z.string().uuid(),
    isEnabled: z.boolean(),
  }),
});
export type AdminTemplateToggleReq = z.infer<typeof AdminTemplateToggleSchema>;

export const AdminTemplateDeleteSchema = BaseSchema.extend({
  body: z.object({
    id: z.string().uuid(),
  }),
});
export type AdminTemplateDeleteReq = z.infer<typeof AdminTemplateDeleteSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Admin — section agent + examples
// ─────────────────────────────────────────────────────────────────────────────

export const AdminSectionUpdateAgentSchema = BaseSchema.extend({
  body: z.object({
    template_id: z.string().uuid(),
    section_id: z.string().uuid(),
    model: z.string().optional(),
    systemPrompt: z.string().optional(),
    instruction: z.string().optional(),
  }),
});
export type AdminSectionUpdateAgentReq = z.infer<typeof AdminSectionUpdateAgentSchema>;

export const AdminSectionAddExampleSchema = BaseSchema.extend({
  body: z.object({
    template_id: z.string().uuid(),
    section_id: z.string().uuid(),
    label: z.string().min(1).default("Example"),
    content: z.string().min(1),
  }),
});
export type AdminSectionAddExampleReq = z.infer<typeof AdminSectionAddExampleSchema>;

export const AdminSectionRemoveExampleSchema = BaseSchema.extend({
  body: z.object({
    template_id: z.string().uuid(),
    section_id: z.string().uuid(),
    example_id: z.string().uuid(),
  }),
});
export type AdminSectionRemoveExampleReq = z.infer<typeof AdminSectionRemoveExampleSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Generation jobs
// ─────────────────────────────────────────────────────────────────────────────

// Multipart endpoint — body holds the form fields below; uploaded files come
// from `ctx.request.files.files` (multi-file array).
export const JobsStartSchema = BaseSchema.extend({
  body: z.object({
    template_id: z.string().uuid(),
    document_title: z.string().min(1),
    outline_collection_id: z.string().uuid(),
    outline_document_id: z.string().uuid().optional(),
    user_hint: z.string().optional().default(""),
    free_text_context: z.string().optional().default(""),
    // Multipart coerces booleans to strings; accept either form.
    force_proceed: z
      .union([z.boolean(), z.literal("true"), z.literal("false")])
      .optional()
      .transform((v) => v === true || v === "true"),
  }),
});
export type JobsStartReq = z.infer<typeof JobsStartSchema>;

export const JobsListSchema = BaseSchema.extend({
  body: z.object({}),
});
export type JobsListReq = z.infer<typeof JobsListSchema>;

export const JobsDetailSchema = BaseSchema.extend({
  body: z.object({
    id: z.string().uuid(),
  }),
});
export type JobsDetailReq = z.infer<typeof JobsDetailSchema>;

export const JobsAnswerSchema = BaseSchema.extend({
  body: z.object({
    id: z.string().uuid(),
    section_id: z.string().uuid(),
    // Keys come back as stringified indices ("0", "1", "2")
    answers: z.record(z.string(), z.string()).default({}),
    skip: z.boolean().optional().default(false),
  }),
});
export type JobsAnswerReq = z.infer<typeof JobsAnswerSchema>;

// Stop a single running section — aborts the in-flight LLM call so we don't
// keep burning Gemini tokens. Replaces the previous job-level cancel.
export const JobsStopSchema = BaseSchema.extend({
  body: z.object({
    id: z.string().uuid(),
    section_id: z.string().uuid(),
  }),
});
export type JobsStopReq = z.infer<typeof JobsStopSchema>;

// Hard-delete a job (and cascade its section states). Owner-only on the
// Python side; this schema just validates the job id reaching the proxy.
export const JobsDeleteSchema = BaseSchema.extend({
  body: z.object({
    id: z.string().uuid(),
  }),
});
export type JobsDeleteReq = z.infer<typeof JobsDeleteSchema>;

export const JobsRegenerateSchema = BaseSchema.extend({
  body: z.object({
    id: z.string().uuid(),
    section_id: z.string().uuid(),
  }),
});
export type JobsRegenerateReq = z.infer<typeof JobsRegenerateSchema>;

// FE → backend after a successful `documents.update` append; flips the
// section's `appended_to_doc` flag so subsequent polls don't re-append.
export const JobsMarkSyncedSchema = BaseSchema.extend({
  body: z.object({
    id: z.string().uuid(),
    section_id: z.string().uuid(),
  }),
});
export type JobsMarkSyncedReq = z.infer<typeof JobsMarkSyncedSchema>;
