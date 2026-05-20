/**
 * BA Kit public routes — visible to any authenticated workspace member.
 *
 *   ba-kit.templates.list → GET /ba-kit/templates  (enabled templates only, Q12)
 */

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
 * Attach public (workspace member) routes onto the shared BA Kit router.
 */
export function registerPublicRoutes(router: Router) {

// ─────────────────────────────────────────────────────────────────────────────
// ba-kit.templates.list
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "ba-kit.templates.list",
  auth(),
  validate(T.TemplatesListSchema),
  async (ctx: APIContext<T.TemplatesListReq>) => {
    const { user } = ctx.state.auth;
    const response = await fetch(`${PYTHON_URL}/ba-kit/templates`, {
      method: "GET",
      headers: buildPythonHeaders(user.id, user.teamId),
    });
    if (!response.ok) {
      await forwardErrorPayload(ctx, response, "Failed to list templates");
      return;
    }
    // Wrap bare array as { data: [...] } so the apiResponse middleware's
    // `{ ...ctx.body, status, ok }` doesn't collapse the array into an
    // object keyed by indices.
    const list = await response.json();
    ctx.body = { data: list };
  }
);
}
