/**
 * BA Kit admin routes — instance-admin only.
 *
 * Mirrors `routes/api/chat/chat.ts` pattern: one explicit handler per
 * endpoint with `auth() + validate(Schema)`. Forwards every action to the
 * FastAPI backend, which performs the actual `users.isInstanceAdmin` check
 * (see `middlewares/auth.py` on the Python side).
 *
 * Outline RPC convention → HTTP verb mapping:
 *   ba-kit.admin.templates.list       → GET    /ba-kit/admin/templates
 *   ba-kit.admin.templates.detail     → GET    /ba-kit/admin/templates/:id
 *   ba-kit.admin.templates.upload     → POST   /ba-kit/admin/templates/upload (multipart)
 *   ba-kit.admin.templates.toggle     → PATCH  /ba-kit/admin/templates/:id
 *   ba-kit.admin.templates.delete     → DELETE /ba-kit/admin/templates/:id
 *   ba-kit.admin.sections.updateAgent → PATCH  /ba-kit/admin/templates/:tid/sections/:sid/agent
 *   ba-kit.admin.sections.addExample  → POST   /ba-kit/admin/templates/:tid/sections/:sid/examples
 *   ba-kit.admin.sections.removeExample → DELETE /ba-kit/admin/templates/:tid/sections/:sid/examples/:eid
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
 * Attach admin routes onto the shared BA Kit router. We register handlers on
 * the passed-in router (rather than creating a new one) so the routes land
 * directly on the same instance the Outline `api` Koa app mounts — avoiding
 * any nested-router resolution quirks in koa-router.
 */
export function registerAdminRoutes(router: Router) {

// ─────────────────────────────────────────────────────────────────────────────
// ba-kit.admin.templates.list
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "ba-kit.admin.templates.list",
  auth(),
  validate(T.AdminTemplatesListSchema),
  async (ctx: APIContext<T.AdminTemplatesListReq>) => {
    const { user } = ctx.state.auth;
    const response = await fetch(`${PYTHON_URL}/ba-kit/admin/templates`, {
      method: "GET",
      headers: buildPythonHeaders(user.id, user.teamId),
    });
    if (!response.ok) {
      await forwardErrorPayload(ctx, response, "Failed to list templates");
      return;
    }
    // FastAPI returns a bare JSON array. Wrap as { data: [...] } so Outline's
    // apiResponse middleware (which spreads ctx.body) doesn't turn it into
    // an indexed object — frontend expects `res.data` to be the array.
    const list = await response.json();
    ctx.body = { data: list };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// ba-kit.admin.templates.detail
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "ba-kit.admin.templates.detail",
  auth(),
  validate(T.AdminTemplateDetailSchema),
  async (ctx: APIContext<T.AdminTemplateDetailReq>) => {
    const { user } = ctx.state.auth;
    const { id } = ctx.input.body;
    const response = await fetch(
      `${PYTHON_URL}/ba-kit/admin/templates/${encodeURIComponent(id)}`,
      {
        method: "GET",
        headers: buildPythonHeaders(user.id, user.teamId),
      }
    );
    if (!response.ok) {
      await forwardErrorPayload(ctx, response, "Failed to load template");
      return;
    }
    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// ba-kit.admin.templates.upload (multipart — markdown file)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "ba-kit.admin.templates.upload",
  auth(),
  // No `validate` here — multipart body parsing is handled below. Reading
  // `code` from raw form fields keeps the file separately accessible.
  async (ctx) => {
    const { user } = ctx.state.auth;

    // step 1: locate the uploaded markdown file from formidable's output
    const filesField = (
      ctx.request as unknown as {
        files?: Record<
          string,
          | { filepath: string; originalFilename?: string; mimetype?: string }
          | Array<{ filepath: string; originalFilename?: string; mimetype?: string }>
        >;
      }
    ).files;
    const fileItem = filesField?.file
      ? Array.isArray(filesField.file)
        ? filesField.file[0]
        : filesField.file
      : undefined;
    if (!fileItem?.filepath) {
      ctx.status = 400;
      ctx.body = { error: "Missing 'file' upload field" };
      return;
    }

    // step 2: build FormData and forward to FastAPI multipart endpoint
    const form = new FormData();
    const buffer = await fs.promises.readFile(fileItem.filepath);
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], {
        type: fileItem.mimetype || "text/markdown",
      }),
      fileItem.originalFilename || "template.md"
    );
    const code = ((ctx.request.body ?? {}) as Record<string, unknown>).code;
    if (typeof code === "string" && code) form.append("code", code);

    const response = await fetch(`${PYTHON_URL}/ba-kit/admin/templates/upload`, {
      method: "POST",
      // Identity headers only — fetch sets the multipart boundary itself.
      headers: {
        "X-User-Key": user.id,
        "X-Workspace-Id": user.teamId,
      },
      body: form,
    });
    if (!response.ok) {
      await forwardErrorPayload(ctx, response, "Failed to upload template");
      return;
    }
    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// ba-kit.admin.templates.toggle
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "ba-kit.admin.templates.toggle",
  auth(),
  validate(T.AdminTemplateToggleSchema),
  async (ctx: APIContext<T.AdminTemplateToggleReq>) => {
    const { user } = ctx.state.auth;
    const { id, isEnabled } = ctx.input.body;
    const response = await fetch(
      `${PYTHON_URL}/ba-kit/admin/templates/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: buildPythonHeaders(user.id, user.teamId),
        body: JSON.stringify({ isEnabled }),
      }
    );
    if (!response.ok) {
      await forwardErrorPayload(ctx, response, "Failed to toggle template");
      return;
    }
    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// ba-kit.admin.templates.delete
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "ba-kit.admin.templates.delete",
  auth(),
  validate(T.AdminTemplateDeleteSchema),
  async (ctx: APIContext<T.AdminTemplateDeleteReq>) => {
    const { user } = ctx.state.auth;
    const { id } = ctx.input.body;
    const response = await fetch(
      `${PYTHON_URL}/ba-kit/admin/templates/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: buildPythonHeaders(user.id, user.teamId),
      }
    );
    if (!response.ok) {
      await forwardErrorPayload(ctx, response, "Failed to delete template");
      return;
    }
    ctx.status = 204;
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// ba-kit.admin.sections.updateAgent
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "ba-kit.admin.sections.updateAgent",
  auth(),
  validate(T.AdminSectionUpdateAgentSchema),
  async (ctx: APIContext<T.AdminSectionUpdateAgentReq>) => {
    const { user } = ctx.state.auth;
    const { template_id, section_id, model, systemPrompt, instruction } =
      ctx.input.body;

    const response = await fetch(
      `${PYTHON_URL}/ba-kit/admin/templates/${encodeURIComponent(
        template_id
      )}/sections/${encodeURIComponent(section_id)}/agent`,
      {
        method: "PATCH",
        headers: buildPythonHeaders(user.id, user.teamId),
        // Only forward fields the admin actually changed.
        body: JSON.stringify({ model, systemPrompt, instruction }),
      }
    );
    if (!response.ok) {
      await forwardErrorPayload(ctx, response, "Failed to update agent");
      return;
    }
    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// ba-kit.admin.sections.addExample
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "ba-kit.admin.sections.addExample",
  auth(),
  validate(T.AdminSectionAddExampleSchema),
  async (ctx: APIContext<T.AdminSectionAddExampleReq>) => {
    const { user } = ctx.state.auth;
    const { template_id, section_id, label, content } = ctx.input.body;
    const response = await fetch(
      `${PYTHON_URL}/ba-kit/admin/templates/${encodeURIComponent(
        template_id
      )}/sections/${encodeURIComponent(section_id)}/examples`,
      {
        method: "POST",
        headers: buildPythonHeaders(user.id, user.teamId),
        body: JSON.stringify({ label, content }),
      }
    );
    if (!response.ok) {
      await forwardErrorPayload(ctx, response, "Failed to add example");
      return;
    }
    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// ba-kit.admin.sections.removeExample
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "ba-kit.admin.sections.removeExample",
  auth(),
  validate(T.AdminSectionRemoveExampleSchema),
  async (ctx: APIContext<T.AdminSectionRemoveExampleReq>) => {
    const { user } = ctx.state.auth;
    const { template_id, section_id, example_id } = ctx.input.body;
    const response = await fetch(
      `${PYTHON_URL}/ba-kit/admin/templates/${encodeURIComponent(
        template_id
      )}/sections/${encodeURIComponent(
        section_id
      )}/examples/${encodeURIComponent(example_id)}`,
      {
        method: "DELETE",
        headers: buildPythonHeaders(user.id, user.teamId),
      }
    );
    if (!response.ok) {
      await forwardErrorPayload(ctx, response, "Failed to remove example");
      return;
    }
    ctx.status = 204;
  }
);
}
