"""Document CRUD endpoints (list / delete / clear / pipeline status).

All endpoints require `X-Workspace-Id` header (injected by Node.js proxy
from authenticated user's teamId). The per-workspace `ExtendedLightRAG`
instance filters all data by workspace, ensuring no cross-tenant leakage.

Endpoints:
    GET    /api/documents              List documents with pagination/filter/search/sort
    DELETE /api/documents/delete       Async background delete of doc_ids
    DELETE /api/documents/clear        Drop all LightRAG storages for the workspace
    GET    /api/pipeline/status        Read in-memory pipeline busy flag
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from lightrag.base import DocStatus
from lightrag.kg.shared_storage import get_namespace_data

from rag_state import (
    acquire_workspace_lock,
    check_workspace_lock,
    get_rag_for_workspace,
    release_workspace_lock,
)
from routers.documents.document_helper import background_delete_documents
from routers.documents.document_type import DeleteDocumentsRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["Documents"])


async def _is_pipeline_busy() -> bool:
    """Read the shared `pipeline_status.busy` flag set by LightRAG."""
    try:
        pipeline_status = await get_namespace_data("pipeline_status")
        return bool(pipeline_status.get("busy", False))
    except Exception:
        return True  # fail-safe: assume busy if state cannot be read


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/documents — list with pagination, status filter, search, sort
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/documents")
async def list_documents(
    request: Request,
    status: str | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 50,
    sort_field: str = "updated_at",
    sort_direction: str = "desc",
) -> dict:
    """Return paginated document list from LightRAG's doc_status storage.

    Query params:
        status:         optional "pending"|"processing"|"preprocessed"|"processed"|"failed"
        search:         optional substring match on file_path or content_summary
        page:           1-based page number
        page_size:      max 200
        sort_field:     "created_at" | "updated_at" | "id"
        sort_direction: "asc" | "desc"

    Response:
        {
          documents: [
            { id, file_path, content_summary, status, content_length,
              chunks_count, created_at, updated_at, error_msg, track_id }
          ],
          total, page, page_size
        }
    """
    workspace_id = request.headers.get("X-Workspace-Id", "").strip()
    if not workspace_id:
        raise HTTPException(status_code=400, detail="Missing X-Workspace-Id header")

    if page < 1:
        raise HTTPException(status_code=400, detail="page must be >= 1")
    page_size = max(1, min(page_size, 200))

    try:
        rag = await get_rag_for_workspace(workspace_id)

        status_filter: DocStatus | None = None
        if status:
            try:
                status_filter = DocStatus(status)
            except ValueError as exc:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Invalid status '{status}'. Must be one of: "
                        "pending, processing, preprocessed, processed, failed"
                    ),
                ) from exc

        # When search is active, fetch all matching docs then filter+paginate in Python
        # (get_docs_paginated has no built-in search). For small/medium workspaces this
        # is fine; for very large workspaces consider a server-side search index later.
        if search and search.strip():
            search_lower = search.strip().lower()
            all_docs, _ = await rag.doc_status.get_docs_paginated(
                status_filter=status_filter,
                page=1,
                page_size=10000,
                sort_field=sort_field,
                sort_direction=sort_direction,
            )
            filtered = [
                (doc_id, doc)
                for doc_id, doc in all_docs
                if search_lower in (getattr(doc, "file_path", "") or "").lower()
                or search_lower in (getattr(doc, "content_summary", "") or "").lower()
            ]
            total_count = len(filtered)
            start = (page - 1) * page_size
            docs = filtered[start : start + page_size]
        else:
            docs, total_count = await rag.doc_status.get_docs_paginated(
                status_filter=status_filter,
                page=page,
                page_size=page_size,
                sort_field=sort_field,
                sort_direction=sort_direction,
            )

        documents = [
            {
                "id": doc_id,
                "file_path": doc.file_path,
                "content_summary": doc.content_summary,
                "status": doc.status.value if hasattr(doc.status, "value") else doc.status,
                "content_length": doc.content_length,
                "chunks_count": doc.chunks_count or 0,
                "created_at": doc.created_at,
                "updated_at": doc.updated_at,
                "error_msg": doc.error_msg,
                "track_id": doc.track_id,
            }
            for doc_id, doc in docs
        ]

        logger.info(
            f"📋 Listed {len(documents)} documents "
            f"(total={total_count}, ws={workspace_id})"
        )
        return {
            "documents": documents,
            "total": total_count,
            "page": page,
            "page_size": page_size,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ list_documents error: {e!r}")
        raise HTTPException(status_code=500, detail=str(e)) from e


# ─────────────────────────────────────────────────────────────────────────────
# DELETE /api/documents/delete — async background deletion
# ─────────────────────────────────────────────────────────────────────────────
@router.delete("/documents/delete")
async def delete_documents(
    request: Request,
    body: DeleteDocumentsRequest,
    background_tasks: BackgroundTasks,
) -> dict:
    """Register a background task to delete `doc_ids` from this workspace.

    Returns "deletion_started" immediately — frontend polls `/api/documents`
    every ~2s to see when docs disappear from the list.

    Responses:
        200 deletion_started — background task scheduled
        200 busy             — pipeline currently indexing; user should retry later
        429                  — another workspace operation in progress
        400                  — empty doc_ids or missing header
    """
    workspace_id = request.headers.get("X-Workspace-Id", "").strip()
    if not workspace_id:
        raise HTTPException(status_code=400, detail="Missing X-Workspace-Id header")

    if not body.doc_ids:
        raise HTTPException(status_code=400, detail="doc_ids cannot be empty")

    if await _is_pipeline_busy():
        logger.warning("⚠️ Cannot delete — pipeline is currently processing")
        return {
            "status": "busy",
            "message": (
                "Pipeline is currently processing documents. "
                "Please wait for indexing to complete before deleting."
            ),
            "doc_ids": [],
        }

    if not await acquire_workspace_lock(workspace_id, "indexing"):
        raise HTTPException(
            status_code=429, detail="Workspace busy with another operation"
        )

    try:
        rag = await get_rag_for_workspace(workspace_id)

        async def _delete_with_lock_release() -> None:
            try:
                await background_delete_documents(rag, body.doc_ids, body.delete_file)
            finally:
                release_workspace_lock(workspace_id)

        background_tasks.add_task(_delete_with_lock_release)
        logger.info(
            f"✅ Background delete scheduled — ws={workspace_id}, "
            f"count={len(body.doc_ids)}"
        )

        return {
            "status": "deletion_started",
            "message": f"Deletion of {len(body.doc_ids)} document(s) started in background",
            "doc_ids": body.doc_ids,
        }

    except Exception as e:
        # Release lock on synchronous error (background_tasks won't fire)
        release_workspace_lock(workspace_id)
        logger.error(f"❌ delete_documents error: {e!r}")
        raise HTTPException(status_code=500, detail=str(e)) from e


# ─────────────────────────────────────────────────────────────────────────────
# DELETE /api/documents/clear — drop all storages for the workspace
# ─────────────────────────────────────────────────────────────────────────────
@router.delete("/documents/clear")
async def clear_all_documents(request: Request) -> dict:
    """Drop all 11 LightRAG storages in parallel for this workspace.

    Blocking (waits for all drops to finish) — faster than looping
    `adelete_by_doc_id()` per document.

    Storages dropped:
      text_chunks, full_docs, full_entities, full_relations,
      entity_chunks, relation_chunks, entities_vdb, relationships_vdb,
      chunks_vdb, chunk_entity_relation_graph (Neo4j), doc_status
    """
    workspace_id = request.headers.get("X-Workspace-Id", "").strip()
    if not workspace_id:
        raise HTTPException(status_code=400, detail="Missing X-Workspace-Id header")

    if not await acquire_workspace_lock(workspace_id, "indexing"):
        raise HTTPException(
            status_code=429, detail="Workspace busy with another operation"
        )

    try:
        rag = await get_rag_for_workspace(workspace_id)

        # Storages to drop — getattr with default None to handle version differences
        storage_attrs = [
            "text_chunks",
            "full_docs",
            "full_entities",
            "full_relations",
            "entity_chunks",
            "relation_chunks",
            "entities_vdb",
            "relationships_vdb",
            "chunks_vdb",
            "chunk_entity_relation_graph",
            "doc_status",
        ]

        storages_to_drop: list[tuple[str, object]] = []
        for attr in storage_attrs:
            storage = getattr(rag, attr, None)
            if storage is not None and hasattr(storage, "drop"):
                storages_to_drop.append((attr, storage))
            else:
                logger.warning(f"⚠️ Storage '{attr}' not found or has no drop() method")

        logger.info(f"🗑️ Dropping {len(storages_to_drop)} storages concurrently...")

        async def _drop_storage(name: str, storage: object) -> bool:
            try:
                await storage.drop()
                logger.info(f"  ✅ Dropped: {name}")
                return True
            except Exception as e:
                logger.error(f"  ❌ Failed to drop {name}: {e}")
                return False

        results = await asyncio.gather(
            *[_drop_storage(name, storage) for name, storage in storages_to_drop],
            return_exceptions=True,
        )

        success_count = sum(1 for r in results if r is True)
        fail_count = len(results) - success_count
        logger.info(f"📊 Drop complete: {success_count} success, {fail_count} failed")

        status_str = "success" if fail_count == 0 else "partial_success"
        message = (
            f"All {success_count} storages cleared"
            if fail_count == 0
            else f"{success_count}/{len(storages_to_drop)} storages cleared, {fail_count} failed"
        )
        return {
            "status": status_str,
            "message": message,
            "total_deleted": success_count,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ clear_all_documents error: {e!r}")
        raise HTTPException(status_code=500, detail=str(e)) from e
    finally:
        release_workspace_lock(workspace_id)


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/pipeline/status — busy flag for the frontend
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/pipeline/status")
async def get_pipeline_status(request: Request) -> dict:
    """Return pipeline busy state (in-memory RAM flag, resets on server restart).

    Frontend polls this every ~3s to gate Delete/Clear buttons during indexing.
    """
    workspace_id = request.headers.get("X-Workspace-Id", "").strip()
    if not workspace_id:
        raise HTTPException(status_code=400, detail="Missing X-Workspace-Id header")

    # Workspace lock takes precedence — covers cross-operation conflicts
    lock_error = await check_workspace_lock(workspace_id)
    if lock_error:
        return {
            "busy": True,
            "job_name": lock_error.get("operation", "unknown"),
            "cur_batch": 0,
            "batchs": 0,
            "workspace_locked": True,
        }

    try:
        pipeline_status = await get_namespace_data("pipeline_status")
        return {
            "busy": bool(pipeline_status.get("busy", False)),
            "job_name": pipeline_status.get("job_name", "-"),
            "cur_batch": pipeline_status.get("cur_batch", 0),
            "batchs": pipeline_status.get("batchs", 0),
        }
    except Exception:
        return {"busy": False, "job_name": "-", "cur_batch": 0, "batchs": 0}
