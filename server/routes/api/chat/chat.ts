import Router from "koa-router";
import env from "@server/env";
import auth from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import type { APIContext } from "@server/types";
import * as T from "./schema";

const router = new Router();

const PYTHON_URL = env.PYTHON_BACKEND_URL ?? "http://localhost:8000";

/**
 * Forward identity headers (X-Workspace-Id, X-User-Key) to the Python backend.
 * Mirrors the pattern used by server/routes/api/graph/graph.ts.
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

/**
 * On non-2xx from Python, surface the JSON detail to the frontend.
 *
 * Python raises HTTPException with detail = string OR { error_code, message }.
 * We pass the detail through under `error` so the frontend can branch on
 * structured error codes (e.g. GEMINI_KEY_MISSING).
 */
async function forwardErrorPayload(
  ctx: APIContext<unknown>,
  response: Response,
  fallback: string
): Promise<void> {
  const err = (await response
    .json()
    .catch(() => ({}))) as Record<string, unknown>;
  ctx.status = response.status >= 500 ? 502 : response.status;
  ctx.body = { error: err.detail !== undefined ? err.detail : fallback };
}

// ─────────────────────────────────────────────────────────────────────────────
// chat.conversations.list   → GET python /api/conversations
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "chat.conversations.list",
  auth(),
  validate(T.ChatConversationsListSchema),
  async (ctx: APIContext<T.ChatConversationsListReq>) => {
    const { user } = ctx.state.auth;
    const response = await fetch(`${PYTHON_URL}/api/conversations`, {
      method: "GET",
      headers: buildPythonHeaders(user.id, user.teamId),
    });
    if (!response.ok) {
      await forwardErrorPayload(ctx, response, "Failed to list conversations");
      return;
    }
    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// chat.conversations.create → POST python /api/conversations
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "chat.conversations.create",
  auth(),
  validate(T.ChatConversationsCreateSchema),
  async (ctx: APIContext<T.ChatConversationsCreateReq>) => {
    const { user } = ctx.state.auth;
    const { title } = ctx.input.body;

    const response = await fetch(`${PYTHON_URL}/api/conversations`, {
      method: "POST",
      headers: buildPythonHeaders(user.id, user.teamId),
      body: JSON.stringify({ title: title ?? "New conversation" }),
    });
    if (!response.ok) {
      await forwardErrorPayload(ctx, response, "Failed to create conversation");
      return;
    }
    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// chat.conversations.rename → PATCH python /api/conversations/{id}
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "chat.conversations.rename",
  auth(),
  validate(T.ChatConversationsRenameSchema),
  async (ctx: APIContext<T.ChatConversationsRenameReq>) => {
    const { user } = ctx.state.auth;
    const { conversation_id, title } = ctx.input.body;

    const response = await fetch(
      `${PYTHON_URL}/api/conversations/${encodeURIComponent(conversation_id)}`,
      {
        method: "PATCH",
        headers: buildPythonHeaders(user.id, user.teamId),
        body: JSON.stringify({ title }),
      }
    );
    if (!response.ok) {
      await forwardErrorPayload(ctx, response, "Failed to rename conversation");
      return;
    }
    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// chat.conversations.delete → DELETE python /api/conversations/{id}
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "chat.conversations.delete",
  auth(),
  validate(T.ChatConversationsDeleteSchema),
  async (ctx: APIContext<T.ChatConversationsDeleteReq>) => {
    const { user } = ctx.state.auth;
    const { conversation_id } = ctx.input.body;

    const response = await fetch(
      `${PYTHON_URL}/api/conversations/${encodeURIComponent(conversation_id)}`,
      {
        method: "DELETE",
        headers: buildPythonHeaders(user.id, user.teamId),
      }
    );
    if (!response.ok) {
      await forwardErrorPayload(ctx, response, "Failed to delete conversation");
      return;
    }
    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// chat.messages.list   → GET python /api/conversations/{id}/messages
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "chat.messages.list",
  auth(),
  validate(T.ChatMessagesListSchema),
  async (ctx: APIContext<T.ChatMessagesListReq>) => {
    const { user } = ctx.state.auth;
    const { conversation_id } = ctx.input.body;

    const response = await fetch(
      `${PYTHON_URL}/api/conversations/${encodeURIComponent(conversation_id)}/messages`,
      {
        method: "GET",
        headers: buildPythonHeaders(user.id, user.teamId),
      }
    );
    if (!response.ok) {
      await forwardErrorPayload(ctx, response, "Failed to list messages");
      return;
    }
    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// chat.messages.send   → POST python /api/conversations/{id}/messages
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "chat.messages.send",
  auth(),
  validate(T.ChatMessagesSendSchema),
  async (ctx: APIContext<T.ChatMessagesSendReq>) => {
    const { user } = ctx.state.auth;
    const { conversation_id, content } = ctx.input.body;

    const response = await fetch(
      `${PYTHON_URL}/api/conversations/${encodeURIComponent(conversation_id)}/messages`,
      {
        method: "POST",
        headers: buildPythonHeaders(user.id, user.teamId),
        body: JSON.stringify({ content }),
      }
    );
    if (!response.ok) {
      await forwardErrorPayload(ctx, response, "Failed to send message");
      return;
    }
    ctx.body = await response.json();
  }
);

export default router;
