import Router from "koa-router";
import env from "@server/env";
import auth from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import type { APIContext } from "@server/types";
import { getFileFromRequest } from "@server/utils/koa";
import * as T from "./schema";

const router = new Router();

const PYTHON_URL = env.PYTHON_BACKEND_URL ?? "http://localhost:8000";

/**
 * Build headers to forward to the Python backend. Includes:
 *   - X-Workspace-Id: the user's teamId (drives all per-workspace isolation)
 *   - X-User-Key:     user id for audit/logging
 *   - X-Internal-Secret: backend-to-backend auth (only if INTERNAL_API_SECRET is set)
 */
function buildPythonHeaders(
  userId: string,
  workspaceId: string
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-User-Key": userId,
    "X-Workspace-Id": workspaceId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// graph.data.nx
// POST /api/graph.data.nx → GET python/api/graphs/nx?label=...&max_depth=...&max_nodes=...
//
// Returns NetworkX node_link_data with analytics (community, degree_centrality,
// degree) — D3 force simulation compatible.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "graph.data.nx",
  auth(),
  validate(T.GraphDataNxSchema),
  async (ctx: APIContext<T.GraphDataNxReq>) => {
    const { user } = ctx.state.auth;
    const { label, max_depth, max_nodes } = ctx.input.body;

    const qs = new URLSearchParams({
      label: label ?? "*",
      max_depth: String(max_depth ?? 3),
      max_nodes: String(max_nodes ?? 500),
    });

    const response = await fetch(`${PYTHON_URL}/api/graphs/nx?${qs}`, {
      method: "GET",
      headers: buildPythonHeaders(user.id, user.teamId),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as Record<string, string>;
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        err.detail ?? "Graph query failed"
      );
    }

    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// graph.labels.popular
// POST /api/graph.labels.popular → GET python/api/graph/label/popular?limit=...
//
// Returns the most popular entity labels for the workspace, used by the
// LabelCheckboxPanel filter dropdown in the Knowledge Graph viewer.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "graph.labels.popular",
  auth(),
  validate(T.GraphLabelsPopularSchema),
  async (ctx: APIContext<T.GraphLabelsPopularReq>) => {
    const { user } = ctx.state.auth;
    const { limit } = ctx.input.body;

    const qs = new URLSearchParams({ limit: String(limit ?? 50) });

    const response = await fetch(
      `${PYTHON_URL}/api/graph/label/popular?${qs}`,
      {
        method: "GET",
        headers: buildPythonHeaders(user.id, user.teamId),
      }
    );

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as Record<string, string>;
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        err.detail ?? "Popular labels query failed"
      );
    }

    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// graph.documents.list
// POST /api/graph.documents.list → GET python/api/documents?...
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "graph.documents.list",
  auth(),
  validate(T.GraphDocumentsListSchema),
  async (ctx: APIContext<T.GraphDocumentsListReq>) => {
    const { user } = ctx.state.auth;
    const { status, search, page, page_size, sort_field, sort_direction } =
      ctx.input.body;

    const qs = new URLSearchParams({
      page: String(page ?? 1),
      page_size: String(page_size ?? 20),
      sort_field: sort_field ?? "updated_at",
      sort_direction: sort_direction ?? "desc",
    });
    if (status) {
      qs.set("status", status);
    }
    if (search) {
      qs.set("search", search);
    }

    const response = await fetch(`${PYTHON_URL}/api/documents?${qs}`, {
      method: "GET",
      headers: buildPythonHeaders(user.id, user.teamId),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as Record<string, string>;
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        err.detail ?? "Documents list failed"
      );
    }

    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// graph.documents.delete
// POST /api/graph.documents.delete → DELETE python/api/documents/delete
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "graph.documents.delete",
  auth(),
  validate(T.GraphDocumentsDeleteSchema),
  async (ctx: APIContext<T.GraphDocumentsDeleteReq>) => {
    const { user } = ctx.state.auth;
    const { doc_ids, delete_file } = ctx.input.body;

    const response = await fetch(`${PYTHON_URL}/api/documents/delete`, {
      method: "DELETE",
      headers: buildPythonHeaders(user.id, user.teamId),
      body: JSON.stringify({ doc_ids, delete_file }),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as Record<string, string>;
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        err.detail ?? "Delete failed"
      );
    }

    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// graph.documents.clear
// POST /api/graph.documents.clear → DELETE python/api/documents/clear
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "graph.documents.clear",
  auth(),
  validate(T.GraphDocumentsClearSchema),
  async (ctx: APIContext<T.GraphDocumentsClearReq>) => {
    const { user } = ctx.state.auth;

    const response = await fetch(`${PYTHON_URL}/api/documents/clear`, {
      method: "DELETE",
      headers: buildPythonHeaders(user.id, user.teamId),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as Record<string, string>;
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        err.detail ?? "Clear failed"
      );
    }

    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// graph.pipeline.status
// POST /api/graph.pipeline.status → GET python/api/pipeline/status
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "graph.pipeline.status",
  auth(),
  validate(T.GraphPipelineStatusSchema),
  async (ctx: APIContext<T.GraphPipelineStatusReq>) => {
    const { user } = ctx.state.auth;

    const response = await fetch(`${PYTHON_URL}/api/pipeline/status`, {
      method: "GET",
      headers: buildPythonHeaders(user.id, user.teamId),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as Record<string, string>;
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        err.detail ?? "Pipeline status failed"
      );
    }

    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// graph.documents.upload
// POST /api/graph.documents.upload → POST python/api/upload-document (multipart)
//
// Reads the uploaded file from the multipart form, repackages it into a
// native FormData blob, and forwards to Python with the right headers.
// Renames Python's `status` field to `upload_status` in the response so the
// `apiResponse` middleware (which overwrites `status` with the HTTP code)
// doesn't lose Python's intent.
// ─────────────────────────────────────────────────────────────────────────────
router.post("graph.documents.upload", auth(), async (ctx: APIContext) => {
  const { user } = ctx.state.auth;
  const file = getFileFromRequest(ctx.request);

  if (!file) {
    ctx.throw(400, "No file provided");
    return;
  }

  const fs = await import("fs");
  const fileBuffer = fs.readFileSync(file.filepath);
  const blob = new Blob([fileBuffer as unknown as ArrayBuffer], {
    type: file.mimetype ?? "application/octet-stream",
  });

  // Native FormData (Node.js 18+) — fetch sets Content-Type + boundary automatically
  const fd = new FormData();
  fd.append("file", blob, file.originalFilename ?? "upload");

  // Do NOT set Content-Type — let fetch generate the multipart boundary
  const headers: Record<string, string> = {
    "X-User-Key": user.id,
    "X-Workspace-Id": user.teamId,
  };

  const response = await fetch(`${PYTHON_URL}/api/upload-document`, {
    method: "POST",
    headers,
    body: fd,
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as Record<string, string>;
    ctx.throw(
      response.status >= 500 ? 502 : response.status,
      err.detail ?? "Upload failed"
    );
  }

  // apiResponse middleware overwrites `status` with the HTTP status code.
  // Preserve Python's status field as `upload_status` so the frontend can
  // distinguish "success" from "duplicate".
  const pyData = (await response.json()) as Record<string, unknown>;
  ctx.body = { ...pyData, upload_status: pyData.status };
});

export default router;
