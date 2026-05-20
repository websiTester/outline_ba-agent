/**
 * Shared helpers for BA Kit Outline → FastAPI forwarders.
 *
 * Two routines:
 *   - `buildPythonHeaders`     → identity headers FastAPI expects (Q23)
 *   - `forwardErrorPayload`    → relay structured `detail` from Python errors
 */

import type { Context } from "koa";
import env from "@server/env";

// Single source of truth for the FastAPI base URL — same env var the chat
// router reads, so deployments share configuration.
export const PYTHON_URL = env.PYTHON_BACKEND_URL ?? "http://localhost:8000";

/**
 * Headers attached to every FastAPI request — encodes the caller's identity
 * so the Python side can scope queries by (user_id, workspace_id).
 */
export function buildPythonHeaders(
  userId: string,
  workspaceId: string,
  extra: Record<string, string> = {}
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-User-Key": userId,
    "X-Workspace-Id": workspaceId,
    ...extra,
  };
}

/**
 * Surface non-2xx FastAPI responses with their structured `detail` payload
 * intact. Lets the frontend branch on error codes like `CONTEXT_EMPTY`.
 */
export async function forwardErrorPayload(
  ctx: Context,
  response: Response,
  fallback: string
): Promise<void> {
  const err = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  ctx.status = response.status >= 500 ? 502 : response.status;
  ctx.body = { error: err.detail !== undefined ? err.detail : fallback };
}
