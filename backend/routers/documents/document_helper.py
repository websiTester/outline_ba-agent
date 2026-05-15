"""Background helpers for the documents router."""

from __future__ import annotations

import logging
from typing import List

from lightrag_extended import ExtendedLightRAG

logger = logging.getLogger(__name__)


async def background_delete_documents(
    rag: ExtendedLightRAG,
    doc_ids: List[str],
    delete_file: bool = True,  # kept for API compat, unused after PG migration
) -> None:
    """Background task: remove documents from all LightRAG storages.

    Runs after `DELETE /api/documents/delete` returns "deletion_started".

    `rag.adelete_by_doc_id()` removes the document from:
      - lightrag_kv_full_docs       (full document content)
      - lightrag_doc_status         (processing status)
      - lightrag_kv_text_chunks     (text chunks)
      - lightrag_vdb_chunks         (chunk vector embeddings)
      - lightrag_vdb_entities       (entity vector embeddings, if isolated)
      - lightrag_vdb_relationships  (relation vector embeddings, if isolated)
      - Neo4j nodes and edges scoped to this doc within the workspace

    No physical files exist after the PostgreSQL migration, so no
    `file.unlink()` step is performed regardless of `delete_file`.
    """
    _ = delete_file  # signal intentional unused param
    logger.info(f"Background delete started for {len(doc_ids)} document(s)")

    for doc_id in doc_ids:
        try:
            await rag.adelete_by_doc_id(doc_id)
            logger.info(f"Deleted from all LightRAG storage: {doc_id}")
        except Exception as e:
            logger.error(f"Failed to delete {doc_id}: {e!r}")
            import traceback
            logger.error(traceback.format_exc())

    logger.info(f"Background delete completed for {len(doc_ids)} document(s)")
