"""[DEPRECATED] Was the Python→Node helper that pushed generated section
content into Outline documents via the internal Bearer-secret endpoint.

The flow has moved to the frontend: after each poll, the FE inspects
`generation_section_states` and calls Outline's own `documents.update` with
the user's session to append any sections marked `appended_to_doc=false`,
then hits `POST /ba-kit/jobs/:id/sections/:sid/mark-synced` to flip the
flag. This removes the need for a shared secret and the reverse RPC channel.

The module is kept as a stub so any leftover import doesn't crash at boot,
but it should not be called. Remove once nothing references it.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


class OutlineAppendError(RuntimeError):
    """Kept for backward compatibility — no longer raised."""


async def append_section_to_document(*_args, **_kwargs) -> None:  # noqa: D401
    """No-op stub: FE handles document mutation now."""
    logger.debug(
        "append_section_to_document called but is deprecated — FE drives sync"
    )
