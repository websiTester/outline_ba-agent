"""Request/response models for the documents router."""

from __future__ import annotations

from typing import List

from pydantic import BaseModel


class DeleteDocumentsRequest(BaseModel):
    """Body for DELETE /api/documents/delete.

    Fields:
        doc_ids:     LightRAG doc_id list (e.g. ["doc-d062a9e8ac8c570..."]).
                     Frontend reads these directly from `doc.id` in the list
                     response — no filename lookup needed.
        delete_file: Kept for backward-compatibility with the reference API.
                     No-op in this build (LightRAG stores content in PostgreSQL,
                     not on disk).
    """

    doc_ids: List[str]
    delete_file: bool = True
