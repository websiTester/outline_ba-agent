"""LightRAG pipeline helpers for in-memory content indexing.

These helpers wrap LightRAG's enqueue + process pipeline so the upload
endpoint can index documents without writing to disk first.

Unlike the reference project, this version does NOT override `llm_model_func`
inside the helper — each per-workspace RAG instance is already configured
with the workspace's own Gemini key (closure binding in rag_state.py).
"""

from __future__ import annotations

import logging
from typing import Tuple

from lightrag_extended import ExtendedLightRAG

logger = logging.getLogger(__name__)


async def pipeline_enqueue_content(
    rag: ExtendedLightRAG,
    text_content: str,
    filename: str,
    track_id: str | None = None,
) -> Tuple[bool, str | None]:
    """Enqueue a document for LightRAG processing from an in-memory text string.

    Skips disk I/O — caller already has decoded UTF-8 text (HTTP upload payload
    or PostgreSQL full_docs row).

    LightRAG:
      - Computes doc_id = MD5(text_content)
      - Writes content to `lightrag_kv_full_docs` with status PENDING
      - Adds to internal processing queue

    Args:
        rag:          Per-workspace ExtendedLightRAG instance
        text_content: Decoded UTF-8 document text
        filename:     Used as `file_path` metadata in doc_status
        track_id:     Optional tracking ID (caller-generated)

    Returns:
        (True, track_id)  on success
        (False, track_id) on empty content or LightRAG error
    """
    try:
        content = text_content.strip()
        if not content:
            logger.error(f"Empty content for: {filename}")
            return False, track_id

        logger.info(f"Enqueueing in-memory content: {filename} ({len(content)} chars)")

        await rag.apipeline_enqueue_documents(
            input=[content],
            file_paths=[filename],
            track_id=track_id,
        )

        logger.info(f"Enqueued: {filename} (track_id={track_id})")
        return True, track_id

    except Exception as e:
        logger.error(f"Enqueue error for {filename}: {e!r}")
        return False, track_id


async def pipeline_index_content(
    rag: ExtendedLightRAG,
    text_content: str,
    filename: str,
    track_id: str | None = None,
) -> None:
    """Complete pipeline orchestrator: enqueue → process → knowledge graph built.

    Drop-in replacement for the reference's `pipeline_index_file()` when
    content is already available as a string. Runs both enqueue and process
    phases against the per-workspace RAG instance.

    The RAG instance's `llm_model_func` and `embedding_func` were bound to
    the workspace's active Gemini key inside `get_rag_for_workspace()`, so
    no LLM override is needed here.

    Args:
        rag:          Per-workspace ExtendedLightRAG instance
        text_content: Decoded UTF-8 document text
        filename:     Original filename used as `file_path` metadata
        track_id:     Optional tracking ID
    """
    try:
        logger.info(f"Starting in-memory pipeline: {filename}")

        success, _ = await pipeline_enqueue_content(
            rag, text_content, filename, track_id
        )

        if success:
            logger.info("Processing enqueued documents...")
            await rag.apipeline_process_enqueue_documents()
            logger.info(f"Pipeline complete: {filename}")
        else:
            logger.error(f"Enqueue failed, skipping process step: {filename}")

    except Exception as e:
        logger.error(f"pipeline_index_content error for {filename}: {e!r}")
        import traceback
        logger.error(traceback.format_exc())
