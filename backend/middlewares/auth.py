"""Auth dependencies for BA Kit routers.

Two flavours:
  * `extract_identity` — required X-User-Key + X-Workspace-Id headers (injected
    by the Outline Node proxy per Q23). Every workspace endpoint uses this.
  * `require_instance_admin` — same as above, but also asserts the caller has
    `users.isInstanceAdmin = true` in the shared Outline DB (Q11, Q48). Admin
    endpoints use this.

The `users` table is owned by the Outline Node side (Sequelize). FastAPI just
reads from it — schema must contain `"isInstanceAdmin"` column.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db


def extract_identity(request: Request) -> tuple[str, str]:
    """Return (user_id, workspace_id) from proxy-injected headers."""
    user_id = request.headers.get("X-User-Key", "").strip()
    workspace_id = request.headers.get("X-Workspace-Id", "").strip()
    if not user_id or not workspace_id:
        # Missing headers means the request did not come through the Outline
        # proxy — refuse rather than guess identity.
        raise HTTPException(status_code=401, detail="Missing identity headers")
    return user_id, workspace_id


async def require_instance_admin(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> tuple[str, str]:
    """Like `extract_identity` plus an isInstanceAdmin flag check (Q11)."""
    user_id, workspace_id = extract_identity(request)

    # step 1: lookup the flag in the shared Outline users table
    # Note: the column is camelCase because Sequelize created it.
    stmt = text('SELECT "isInstanceAdmin" FROM users WHERE id = :uid')
    row = (await db.execute(stmt, {"uid": user_id})).first()

    # step 2: forbid when row missing or flag false (default behaviour per Q48)
    if row is None or row[0] is not True:
        raise HTTPException(status_code=403, detail="Instance admin only")

    return user_id, workspace_id
