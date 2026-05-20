"""BA Kit (M2) router package.

Exposes three routers:
  * admin_router    — /ba-kit/admin/* (instance-admin only)
  * generation_router — /ba-kit/jobs/* (any workspace member)
  * public_router   — /ba-kit/templates (read-only template listing)
"""

from .admin import router as admin_router
from .generation import router as generation_router
from .public import router as public_router

__all__ = ["admin_router", "generation_router", "public_router"]
