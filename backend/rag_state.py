"""Workspace-isolated LightRAG state management.

Each Outline team gets a dedicated `ExtendedLightRAG` instance, lazily created
on first request. The instance:

  - Filters all Neo4j/PostgreSQL data by `workspace` parameter
  - Uses the workspace's own Gemini API key (from `gemini_api_keys` table)
  - Auto-rotates to the next key when the active one hits a 429 quota error
  - Runs LLM and embedding calls via `lightrag.llm.gemini` (Google official API)

Workspace locks prevent concurrent indexing/delete operations on the same
workspace, while allowing parallelism across different workspaces.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from pathlib import Path
from typing import Any

import numpy as np
from dotenv import load_dotenv
from fastapi import HTTPException
from google.genai.errors import ClientError
from lightrag.llm.gemini import gemini_complete_if_cache, gemini_embed
from lightrag.utils import wrap_embedding_func_with_attrs
from sqlalchemy import select

from database import AsyncSessionLocal
from lightrag_extended import ExtendedLightRAG
from models.gemini_api_key import GeminiApiKey
from services.encryption_service import decrypt_key
from services.gemini_service import get_active_key_record, rotate_to_next_key

# Load .env from project root
load_dotenv(Path(__file__).parent.parent / ".env")

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# LLM / Embedding configuration
# ─────────────────────────────────────────────────────────────────────────────
LLM_MODEL: str = os.getenv("LLM_MODEL", "gemini-2.5-flash")
EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "gemini-embedding-001")
EMBEDDING_DIM: int = int(os.getenv("EMBEDDING_DIM", "1536"))
EMBEDDING_MAX_TOKEN_SIZE: int = int(os.getenv("EMBEDDING_MAX_TOKEN_SIZE", "2048"))

# ─────────────────────────────────────────────────────────────────────────────
# Working directory (per-workspace subdirs created on demand)
# ─────────────────────────────────────────────────────────────────────────────
_BASE_DIR = Path(__file__).parent
WORKING_DIR = Path(os.getenv("LIGHTRAG_WORKING_DIR", str(_BASE_DIR / "rag_storage")))
WORKING_DIR.mkdir(parents=True, exist_ok=True)

# ─────────────────────────────────────────────────────────────────────────────
# Neo4j configuration
# ─────────────────────────────────────────────────────────────────────────────
NEO4J_URI: str = os.getenv("NEO4J_URI", "")
NEO4J_USERNAME: str = os.getenv("NEO4J_USERNAME", "")
NEO4J_PASSWORD: str = os.getenv("NEO4J_PASSWORD", "")
NEO4J_DATABASE: str = os.getenv("NEO4J_DATABASE", "neo4j")

if not all([NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD]):
    raise ValueError(
        "Missing Neo4j env vars. Set NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD in .env"
    )

# ─────────────────────────────────────────────────────────────────────────────
# PostgreSQL connection string for LightRAG's built-in PG storage backends
# ─────────────────────────────────────────────────────────────────────────────
PG_HOST: str = os.getenv("POSTGRES_HOST", "localhost")
PG_PORT: int = int(os.getenv("POSTGRES_PORT", "5432"))
PG_USER: str = os.getenv("POSTGRES_USER", "")
PG_PASSWORD: str = os.getenv("POSTGRES_PASSWORD", "")
PG_DATABASE: str = os.getenv("POSTGRES_DATABASE", "")
_PG_URL: str = f"postgresql://{PG_USER}:{PG_PASSWORD}@{PG_HOST}:{PG_PORT}/{PG_DATABASE}"

# ═════════════════════════════════════════════════════════════════════════════
# WORKSPACE ISOLATION — caches + locks
# ═════════════════════════════════════════════════════════════════════════════
# Per-workspace ExtendedLightRAG instances (lazy-created, cached forever)
rag_instances: dict[str, ExtendedLightRAG] = {}
rag_lock = asyncio.Lock()  # Guard against race condition during instance creation

# Per-workspace operation locks: workspace_id → operation name ("indexing" | "merging" | None)
# None = idle. Cross-workspace operations run in parallel; same-workspace are serialized.
workspace_locks: dict[str, str | None] = {}
workspace_lock_time: dict[str, float] = {}


# ─────────────────────────────────────────────────────────────────────────────
# Workspace lock helpers
# ─────────────────────────────────────────────────────────────────────────────
async def acquire_workspace_lock(workspace_id: str, operation: str) -> bool:
    """Try to acquire exclusive lock for workspace operation.

    Returns True if lock acquired, False if workspace already locked.
    """
    if workspace_locks.get(workspace_id) is not None:
        return False
    workspace_locks[workspace_id] = operation
    workspace_lock_time[workspace_id] = time.time()
    logger.info(f"🔒 Workspace lock acquired: {workspace_id} ({operation})")
    return True


def release_workspace_lock(workspace_id: str) -> None:
    """Release workspace lock (idempotent — safe to call without prior acquire)."""
    workspace_locks[workspace_id] = None
    workspace_lock_time.pop(workspace_id, None)
    logger.info(f"🔓 Workspace lock released: {workspace_id}")


async def check_workspace_lock(workspace_id: str) -> dict | None:
    """Check if workspace is locked. Returns error response if locked, None if idle."""
    if workspace_id not in workspace_locks or workspace_locks[workspace_id] is None:
        return None

    operation = workspace_locks[workspace_id]
    lock_start_time = workspace_lock_time.get(workspace_id, time.time())

    operation_duration = {
        "indexing": 300,    # 5 min typical
        "merging": 60,      # 1 min typical
        "dedup": 1800,      # 30 min (LLM-heavy)
    }
    estimated_duration = operation_duration.get(operation, 600)
    estimated_unlock_time = lock_start_time + estimated_duration

    return {
        "status": "locked",
        "message": f"Workspace busy with {operation}.",
        "operation": operation,
        "locked_since": lock_start_time,
        "estimated_unlock_time": estimated_unlock_time,
        "retry_after_seconds": 10,
    }


async def monitor_stuck_locks() -> None:
    """Background task: warn if workspace lock held > 1 hour."""
    while True:
        try:
            for workspace_id, operation in list(workspace_locks.items()):
                if operation is None:
                    continue
                elapsed = time.time() - workspace_lock_time.get(workspace_id, time.time())
                if elapsed > 3600:
                    logger.warning(
                        f"⚠️  Workspace {workspace_id} lock held for {elapsed:.0f}s "
                        f"(operation={operation}). Consider manual unlock if stuck."
                    )
            await asyncio.sleep(300)  # check every 5 minutes
        except Exception as e:
            logger.error(f"monitor_stuck_locks error: {e!r}")
            await asyncio.sleep(60)


# ─────────────────────────────────────────────────────────────────────────────
# Gemini key lookup (per workspace from gemini_api_keys table)
# ─────────────────────────────────────────────────────────────────────────────
async def _fetch_gemini_key(workspace_id: str) -> str | None:
    """Internal: fetch the active (decrypted) Gemini API key for a workspace.

    Returns None if no active key exists. Raises only on decryption failure
    (which indicates corrupted DB data, not missing config).
    """
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(GeminiApiKey)
            .where(
                GeminiApiKey.workspace_id == workspace_id,
                GeminiApiKey.is_active.is_(True),
            )
            .order_by(GeminiApiKey.created_at)
            .limit(1)
        )
        key_record = result.scalar_one_or_none()

    if key_record is None:
        return None

    try:
        return decrypt_key(key_record.key_value)
    except Exception as exc:
        logger.error(f"Failed to decrypt Gemini key for workspace {workspace_id}: {exc!r}")
        raise HTTPException(
            status_code=500,
            detail="Gemini API key bị lỗi mã hóa. Vui lòng tạo key mới.",
        ) from exc


async def get_gemini_key_for_workspace(workspace_id: str) -> str:
    """Public: fetch the active Gemini key, raising HTTP 400 if missing.

    Use this from endpoints that REQUIRE a Gemini call (e.g. upload, which
    triggers entity extraction). For storage-only operations (list / delete /
    clear) use `get_rag_for_workspace()` directly — it tolerates a missing
    key by binding a placeholder.
    """
    key = await _fetch_gemini_key(workspace_id)
    if key is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "Workspace chưa cấu hình Gemini API key. "
                "Vui lòng thêm và activate một key trong Settings trước khi upload."
            ),
        )
    return key


# ─────────────────────────────────────────────────────────────────────────────
# Build closures with auto-rotation on 429 quota errors
# ─────────────────────────────────────────────────────────────────────────────
# Closures don't capture the key statically. Instead, each call fetches the
# current active key from DB. On a 429 ClientError, the closure rotates to
# the next key (via services.gemini_service.rotate_to_next_key) and retries.
# A `tried_key_ids` set per call prevents infinite loops once every key in
# the workspace has been tried.
#
# Concurrency note: parallel chunk processing (LightRAG runs up to 4
# concurrent LLM calls per doc via Semaphore) may cause occasional skipped
# keys when several chunks hit 429 simultaneously and all rotate. Accepted
# tradeoff for simpler code per spec3.md Q3.
# ─────────────────────────────────────────────────────────────────────────────

_EXHAUSTED_MSG = "All API keys exhausted for this workspace. Add or wait for quota reset."


def _is_quota_error(exc: Exception) -> bool:
    """Detect 429 quota errors from google-genai SDK.

    `gemini_complete_if_cache` and `gemini_embed` use google-genai which
    raises `google.genai.errors.ClientError(code=429, ...)`. This differs
    from `langchain-google-genai` (used in gemini_service.call_gemini) which
    raises `google.api_core.exceptions.ResourceExhausted`.
    """
    return isinstance(exc, ClientError) and getattr(exc, "code", None) == 429


def _build_workspace_llm_func(workspace_id: str):
    """Closure: per-workspace LLM function with auto-rotation on 429.

    Each invocation:
      1. Fetches the currently-active key from DB (fresh — picks up rotations)
      2. Tries the LLM call
      3. On 429: rotates to the next key, retries
      4. When all keys exhausted: raises RuntimeError (LightRAG marks doc FAILED)
    """

    async def workspace_llm(
        prompt: str,
        system_prompt: str | None = None,
        history_messages: list[dict[str, Any]] | None = None,
        keyword_extraction: bool = False,
        **kwargs: Any,
    ) -> str:
        # Strip kwargs that lightrag may inject but gemini_complete_if_cache doesn't use
        kwargs.pop("hashing_kv", None)

        tried_key_ids: set[str] = set()
        while True:
            key_record = await get_active_key_record(workspace_id)
            if key_record.id in tried_key_ids:
                raise RuntimeError(_EXHAUSTED_MSG)
            tried_key_ids.add(key_record.id)

            api_key = decrypt_key(key_record.key_value)
            try:
                return await gemini_complete_if_cache(
                    model=LLM_MODEL,
                    prompt=prompt,
                    system_prompt=system_prompt,
                    history_messages=history_messages,
                    keyword_extraction=keyword_extraction,
                    api_key=api_key,
                    **kwargs,
                )
            except Exception as exc:
                if not _is_quota_error(exc):
                    raise
                next_key = await rotate_to_next_key(workspace_id, key_record.id)
                if next_key is None:
                    raise RuntimeError(_EXHAUSTED_MSG) from exc
                # loop continues with the freshly-activated key

    return workspace_llm


def _build_workspace_embed_func(workspace_id: str):
    """Closure: per-workspace embedding function with auto-rotation on 429.

    Wrapped with `wrap_embedding_func_with_attrs` so LightRAG can introspect
    dimension and max_token_size for table/collection naming.

    Important: `gemini_embed` returns 3072-dim vectors by default — we MUST
    pass `embedding_dim=EMBEDDING_DIM` so Gemini's `output_dimensionality`
    config truncates+normalizes vectors to the declared dimension.
    """

    @wrap_embedding_func_with_attrs(
        embedding_dim=EMBEDDING_DIM,
        max_token_size=EMBEDDING_MAX_TOKEN_SIZE,
        model_name=EMBEDDING_MODEL,
    )
    async def workspace_embed(texts: list[str]) -> np.ndarray:
        tried_key_ids: set[str] = set()
        while True:
            key_record = await get_active_key_record(workspace_id)
            if key_record.id in tried_key_ids:
                raise RuntimeError(_EXHAUSTED_MSG)
            tried_key_ids.add(key_record.id)

            api_key = decrypt_key(key_record.key_value)
            try:
                return await gemini_embed(
                    texts,
                    model=EMBEDDING_MODEL,
                    api_key=api_key,
                    embedding_dim=EMBEDDING_DIM,
                )
            except Exception as exc:
                if not _is_quota_error(exc):
                    raise
                next_key = await rotate_to_next_key(workspace_id, key_record.id)
                if next_key is None:
                    raise RuntimeError(_EXHAUSTED_MSG) from exc

    return workspace_embed


# ─────────────────────────────────────────────────────────────────────────────
# get_rag_for_workspace — main entry point
# ─────────────────────────────────────────────────────────────────────────────
async def get_rag_for_workspace(workspace_id: str) -> ExtendedLightRAG:
    """Get or create a workspace-isolated ExtendedLightRAG instance.

    All storage layers (Neo4j, PostgreSQL KV/Vector/DocStatus) are filtered
    by the `workspace` parameter — no cross-workspace data leakage.

    The LLM and embedding closures fetch their key dynamically from DB on
    each call, so rotation in `gemini_api_keys` is immediately picked up
    without re-creating the cached RAG instance.

    Raises:
        ValueError:    Workspace ID is whitespace-only
        RuntimeError:  workspace parameter not propagated to storage
    """
    if workspace_id and not workspace_id.strip():
        raise ValueError(
            f"workspace_id cannot be whitespace-only (got {workspace_id!r})"
        )

    # Fast path: return cached instance
    if workspace_id in rag_instances:
        return rag_instances[workspace_id]

    # Slow path: create new instance under lock
    async with rag_lock:
        # Double-check pattern
        if workspace_id in rag_instances:
            return rag_instances[workspace_id]

        # Safeguard against env var override (would silently override workspace param)
        neo4j_workspace_env = os.getenv("NEO4J_WORKSPACE")
        if neo4j_workspace_env:
            logger.warning(
                f"⚠️  NEO4J_WORKSPACE env var is set to '{neo4j_workspace_env}' — "
                f"this OVERRIDES workspace parameter '{workspace_id}' in Neo4JStorage. "
                f"Remove NEO4J_WORKSPACE from .env immediately for correct isolation."
            )

        logger.info(f"🔧 Initializing ExtendedLightRAG for workspace: {workspace_id!r}")

        # Per-workspace working dir
        workspace_dir = WORKING_DIR / (workspace_id or "_default")
        workspace_dir.mkdir(parents=True, exist_ok=True)

        # Build closures — they fetch & rotate Gemini keys dynamically on each call.
        # No initial key lookup needed at create time; storage-only ops (list /
        # delete / clear) never invoke the LLM so they work even when the
        # workspace has no Gemini key configured.
        llm_func = _build_workspace_llm_func(workspace_id)
        embed_func = _build_workspace_embed_func(workspace_id)

        rag = ExtendedLightRAG(
            working_dir=str(workspace_dir),
            workspace=workspace_id,
            llm_model_func=llm_func,
            llm_model_name=LLM_MODEL,
            embedding_func=embed_func,
            graph_storage="Neo4JStorage",
            kv_storage="PGKVStorage",
            vector_storage="PGVectorStorage",
            doc_status_storage="PGDocStatusStorage",
            addon_params={"postgres_url": _PG_URL},
        )

        await rag.initialize_storages()

        # Validate workspace parameter was set on the instance
        if rag.workspace != workspace_id:
            logger.error(
                f"❌ Workspace parameter mismatch! Expected: {workspace_id!r}, "
                f"Got: {rag.workspace!r}"
            )
            raise RuntimeError(
                f"Workspace parameter validation failed: "
                f"expected={workspace_id!r}, actual={rag.workspace!r}"
            )

        rag_instances[workspace_id] = rag
        logger.info(
            f"✅ ExtendedLightRAG initialized for workspace {workspace_id!r}\n"
            f"   Working dir: {workspace_dir}\n"
            f"   Neo4j URI  : {NEO4J_URI} / db={NEO4J_DATABASE}\n"
            f"   LLM model  : {LLM_MODEL}"
        )

        return rag
