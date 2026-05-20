"""CLI tool — promote an Outline user to instance super admin.

Usage:
  python -m cli.promote_admin <email>            # promote (default)
  python -m cli.promote_admin <email> --revoke   # demote back to normal user

The script connects to the same DATABASE_URL the FastAPI server uses and
toggles the `users.isInstanceAdmin` column. See Q11 + Q48.

It exists so ops doesn't need to write raw SQL to grant admin access — and so
the Outline Node side can wrap it via `yarn ops promote-admin <email>` later.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import text

from database import AsyncSessionLocal


async def _set_instance_admin(email: str, value: bool) -> int:
    """Update isInstanceAdmin for the user matching `email`. Returns rowcount."""
    async with AsyncSessionLocal() as db:
        # step 1: do the update; rely on Postgres to do case-sensitive match
        result = await db.execute(
            text(
                'UPDATE users SET "isInstanceAdmin" = :v, "updatedAt" = NOW() '
                'WHERE email = :email'
            ),
            {"v": value, "email": email},
        )
        await db.commit()
        return result.rowcount or 0


def main(argv: list[str] | None = None) -> int:
    # step 1: parse CLI args
    parser = argparse.ArgumentParser(description="Toggle BA Kit instance admin flag")
    parser.add_argument("email", help="Outline account email")
    parser.add_argument(
        "--revoke",
        action="store_true",
        help="Demote (set isInstanceAdmin = false) instead of promote",
    )
    args = parser.parse_args(argv)

    # step 2: execute the async update
    rows = asyncio.run(_set_instance_admin(args.email, value=not args.revoke))

    # step 3: report what happened so ops can verify
    if rows == 0:
        print(f"No user found with email {args.email!r}", file=sys.stderr)
        return 1
    action = "Revoked" if args.revoke else "Promoted"
    print(f"{action} instance admin for {args.email} (rows updated: {rows})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
