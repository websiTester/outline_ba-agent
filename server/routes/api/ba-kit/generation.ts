/**
 * BA Kit job (generation) routes — workspace member only.
 *
 * Mirrors chat.ts pattern. One explicit handler per Outline RPC action.
 * Jobs are private per user (Q39) — FastAPI enforces ownership; we just
 * forward identity headers.
 *
 *   ba-kit.jobs.start       → POST multipart /ba-kit/jobs
 *   ba-kit.jobs.list        → GET    /ba-kit/jobs
 *   ba-kit.jobs.detail      → GET    /ba-kit/jobs/:id
 *   ba-kit.jobs.answer      → POST   /ba-kit/jobs/:id/answer
 *   ba-kit.jobs.stop        → POST   /ba-kit/jobs/:id/sections/:sid/stop
 *   ba-kit.jobs.delete      → DELETE /ba-kit/jobs/:id
 *   ba-kit.jobs.regenerate  → POST   /ba-kit/jobs/:id/sections/:sid/regenerate
 */

import fs from "node:fs";
import type Router from "koa-router";
import auth from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import type { APIContext } from "@server/types";
import {
  PYTHON_URL,
  buildPythonHeaders,
  forwardErrorPayload,
} from "./helpers";
import * as T from "./schema";

/**
 * Attach generation/job routes onto the shared BA Kit router. See note in
 * `admin.ts` — we register on the passed-in router to avoid koa-router's
 * nested-router edge cases.
 */
export function registerGenerationRoutes(router: Router) {

  // ─────────────────────────────────────────────────────────────────────────────
  // ba-kit.jobs.start  (multipart — body fields + optional file array)
  // ─────────────────────────────────────────────────────────────────────────────
  router.post(
    "ba-kit.jobs.start",
    auth(),
    // Multipart upload: we DON'T validate via zod because formidable's parsed
    // body fields are all strings (form-data has no real types). Body fields
    // are read individually below with manual fall-backs.
    async (ctx) => {
      const { user } = ctx.state.auth;

      // step 1: read body fields (form-data → all strings)
      const body = (ctx.request.body ?? {}) as Record<string, unknown>;
      const stringField = (key: string, fallback = ""): string => {
        const v = body[key];
        return typeof v === "string" ? v : fallback;
      };
      const template_id = stringField("template_id");
      const document_title = stringField("document_title");
      const outline_collection_id = stringField("outline_collection_id");
      if (!template_id || !document_title || !outline_collection_id) {
        ctx.status = 400;
        ctx.body = {
          error: "template_id, document_title, outline_collection_id are required",
        };
        return;
      }
      const outline_document_id = stringField("outline_document_id");
      const user_hint = stringField("user_hint");
      const free_text_context = stringField("free_text_context");
      const force_proceed = stringField("force_proceed") === "true";

      // step 2: gather uploaded files (multiple under field name "files")
      const filesField = (
        ctx.request as unknown as {
          files?: Record<
            string,
            | { filepath: string; originalFilename?: string; mimetype?: string }
            | Array<{ filepath: string; originalFilename?: string; mimetype?: string }>
          >;
        }
      ).files;
      const rawFiles = filesField?.files;
      const fileList = Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : [];

      // step 3: build FormData for FastAPI and append everything
      const form = new FormData();
      form.append("template_id", template_id);
      form.append("document_title", document_title);
      form.append("outline_collection_id", outline_collection_id);
      if (outline_document_id) form.append("outline_document_id", outline_document_id);
      form.append("user_hint", user_hint);
      form.append("free_text_context", free_text_context);
      form.append("force_proceed", String(force_proceed));

      for (const file of fileList) {
        if (!file.filepath) continue;
        const buffer = await fs.promises.readFile(file.filepath);
        form.append(
          "files",
          new Blob([new Uint8Array(buffer)], {
            type: file.mimetype || "application/octet-stream",
          }),
          file.originalFilename || "upload"
        );
      }

      const response = await fetch(`${PYTHON_URL}/ba-kit/jobs`, {
        method: "POST",
        headers: {
          "X-User-Key": user.id,
          "X-Workspace-Id": user.teamId,
        },
        body: form,
      });
      if (!response.ok) {
        await forwardErrorPayload(ctx, response, "Failed to start job");
        return;
      }
      ctx.body = await response.json();
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // ba-kit.jobs.list
  // ─────────────────────────────────────────────────────────────────────────────
  router.post(
    "ba-kit.jobs.list",
    auth(),
    validate(T.JobsListSchema),
    async (ctx: APIContext<T.JobsListReq>) => {
      const { user } = ctx.state.auth;
      const response = await fetch(`${PYTHON_URL}/ba-kit/jobs`, {
        method: "GET",
        headers: buildPythonHeaders(user.id, user.teamId),
      });
      if (!response.ok) {
        await forwardErrorPayload(ctx, response, "Failed to list jobs");
        return;
      }
      // Wrap array as { data: [...] } — Outline apiResponse spreads ctx.body,
      // which would otherwise corrupt a top-level array into an indexed object.
      const list = await response.json();
      ctx.body = { data: list };
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // ba-kit.jobs.detail
  // ─────────────────────────────────────────────────────────────────────────────
  router.post(
    "ba-kit.jobs.detail",
    auth(),
    validate(T.JobsDetailSchema),
    async (ctx: APIContext<T.JobsDetailReq>) => {
      const { user } = ctx.state.auth;
      const { id } = ctx.input.body;
      const response = await fetch(
        `${PYTHON_URL}/ba-kit/jobs/${encodeURIComponent(id)}`,
        {
          method: "GET",
          headers: buildPythonHeaders(user.id, user.teamId),
        }
      );
      if (!response.ok) {
        await forwardErrorPayload(ctx, response, "Failed to fetch job detail");
        return;
      }
      // CRITICAL: Wrap as { data: jobDetail } so Outline's apiResponse
      // middleware (`{ ...ctx.body, status, ok }`) doesn't overwrite the
      // domain `status` field on JobDetail (running / awaiting_input / ...)
      // with the HTTP status code (200). Without this, polling stops after
      // tick #1 because `isJobActive` sees status=200 and treats the job as
      // terminal.
      const detail = await response.json();
      ctx.body = { data: detail };
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // ba-kit.jobs.answer
  // ─────────────────────────────────────────────────────────────────────────────
  router.post(
    "ba-kit.jobs.answer",
    auth(),
    validate(T.JobsAnswerSchema),
    async (ctx: APIContext<T.JobsAnswerReq>) => {
      const { user } = ctx.state.auth;
      const { id, section_id, answers, skip } = ctx.input.body;
      const response = await fetch(
        `${PYTHON_URL}/ba-kit/jobs/${encodeURIComponent(id)}/answer`,
        {
          method: "POST",
          headers: buildPythonHeaders(user.id, user.teamId),
          body: JSON.stringify({ sectionId: section_id, answers, skip }),
        }
      );
      if (!response.ok) {
        await forwardErrorPayload(ctx, response, "Failed to submit answer");
        return;
      }
      ctx.status = 204;
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // ba-kit.jobs.stop — abort the LLM call for one running section (saves tokens)
  // ─────────────────────────────────────────────────────────────────────────────
  router.post(
    "ba-kit.jobs.stop",
    auth(),
    validate(T.JobsStopSchema),
    async (ctx: APIContext<T.JobsStopReq>) => {
      const { user } = ctx.state.auth;
      const { id, section_id } = ctx.input.body;
      const response = await fetch(
        `${PYTHON_URL}/ba-kit/jobs/${encodeURIComponent(
          id
        )}/sections/${encodeURIComponent(section_id)}/stop`,
        {
          method: "POST",
          headers: buildPythonHeaders(user.id, user.teamId),
        }
      );
      if (!response.ok) {
        await forwardErrorPayload(ctx, response, "Failed to stop section");
        return;
      }
      ctx.status = 204;
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // ba-kit.jobs.delete — RPC stays POST (Outline convention) but forwards to
  // FastAPI as a real HTTP DELETE so the FastAPI endpoint can use @router.delete.
  // ─────────────────────────────────────────────────────────────────────────────
  router.post(
    "ba-kit.jobs.delete",
    auth(),
    validate(T.JobsDeleteSchema),
    async (ctx: APIContext<T.JobsDeleteReq>) => {
      const { user } = ctx.state.auth;
      const { id } = ctx.input.body;
      const response = await fetch(
        `${PYTHON_URL}/ba-kit/jobs/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
          headers: buildPythonHeaders(user.id, user.teamId),
        }
      );
      if (!response.ok) {
        await forwardErrorPayload(ctx, response, "Failed to delete job");
        return;
      }
      ctx.status = 204;
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // ba-kit.jobs.regenerate
  // ─────────────────────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────────
  // ba-kit.jobs.markSynced — FE → backend after documents.update append
  // ─────────────────────────────────────────────────────────────────────────────
  router.post(
    "ba-kit.jobs.markSynced",
    auth(),
    validate(T.JobsMarkSyncedSchema),
    async (ctx: APIContext<T.JobsMarkSyncedReq>) => {
      const { user } = ctx.state.auth;
      const { id, section_id } = ctx.input.body;
      const response = await fetch(
        `${PYTHON_URL}/ba-kit/jobs/${encodeURIComponent(
          id
        )}/sections/${encodeURIComponent(section_id)}/mark-synced`,
        {
          method: "POST",
          headers: buildPythonHeaders(user.id, user.teamId),
        }
      );
      if (!response.ok) {
        await forwardErrorPayload(ctx, response, "Failed to mark section synced");
        return;
      }
      ctx.status = 204;
    }
  );

  router.post(
    "ba-kit.jobs.regenerate",
    auth(),
    validate(T.JobsRegenerateSchema),
    async (ctx: APIContext<T.JobsRegenerateReq>) => {
      const { user } = ctx.state.auth;
      const { id, section_id } = ctx.input.body;
      const response = await fetch(
        `${PYTHON_URL}/ba-kit/jobs/${encodeURIComponent(
          id
        )}/sections/${encodeURIComponent(section_id)}/regenerate`,
        {
          method: "POST",
          headers: buildPythonHeaders(user.id, user.teamId),
        }
      );
      if (!response.ok) {
        await forwardErrorPayload(ctx, response, "Failed to regenerate section");
        return;
      }
      ctx.status = 204;
    }
  );
}
