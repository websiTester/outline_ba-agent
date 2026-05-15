import { z } from "zod";
import { BaseSchema } from "../schema";

// ── Knowledge Graph Routes (read-only viewer) ───────────────────────────────

export const GraphDataNxSchema = BaseSchema.extend({
  body: z.object({
    label: z.string().optional().default("*"),
    max_depth: z.number().int().min(1).max(10).optional().default(3),
    max_nodes: z.number().int().min(1).max(2000).optional().default(500),
  }),
});
export type GraphDataNxReq = z.infer<typeof GraphDataNxSchema>;

export const GraphLabelsPopularSchema = BaseSchema.extend({
  body: z.object({
    limit: z.number().int().min(1).max(500).optional().default(50),
  }),
});
export type GraphLabelsPopularReq = z.infer<typeof GraphLabelsPopularSchema>;

// ── Document Routes ──────────────────────────────────────────────────────────

export const GraphDocumentsListSchema = BaseSchema.extend({
  body: z.object({
    status: z.string().optional(),
    search: z.string().optional(),
    page: z.number().int().min(1).optional().default(1),
    page_size: z.number().int().min(1).max(10000).optional().default(20),
    sort_field: z.string().optional().default("updated_at"),
    sort_direction: z.enum(["asc", "desc"]).optional().default("desc"),
  }),
});
export type GraphDocumentsListReq = z.infer<typeof GraphDocumentsListSchema>;

export const GraphDocumentsDeleteSchema = BaseSchema.extend({
  body: z.object({
    doc_ids: z.array(z.string()).min(1),
    delete_file: z.boolean().optional().default(true),
  }),
});
export type GraphDocumentsDeleteReq = z.infer<typeof GraphDocumentsDeleteSchema>;

export const GraphDocumentsClearSchema = BaseSchema.extend({
  body: z.object({}),
});
export type GraphDocumentsClearReq = z.infer<typeof GraphDocumentsClearSchema>;

export const GraphPipelineStatusSchema = BaseSchema.extend({
  body: z.object({}),
});
export type GraphPipelineStatusReq = z.infer<typeof GraphPipelineStatusSchema>;

// Upload uses multipart/form-data — no JSON body schema needed.
// The graph.documents.upload route validates only that a file is present.
