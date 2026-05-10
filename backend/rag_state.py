import logging
import time
import os
from datetime import datetime, timezone
from lightrag_extended import ExtendedLightRAG
from dotenv import load_dotenv
from lightrag.utils import wrap_embedding_func_with_attrs
from pathlib import Path
import numpy as np
import asyncio
from lightrag.llm.gemini import gemini_model_complete, gemini_embed

# Load environment variables
# 1) Load root .env to read NODE_ENV
_root_env = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_root_env, encoding='latin-1')

# 2) Load .env.{NODE_ENV} (e.g. .env.local, .env.production)
_node_env = os.getenv("NODE_ENV", "local")
_env_file = _root_env.parent / f".env.{_node_env}"
print(f"DEBUG: NODE_ENV={_node_env}, env_file={_env_file}, exists={_env_file.exists()}")
if _env_file.exists():
    load_dotenv(_env_file, encoding='latin-1', override=True)

# ─────────────────────────────────────────────────────────────
# LLM CONFIG — unified configuration for all LLM providers.
# LLM_BINDING: "gemini" or "claude" (or any OpenAI-compatible)
# Change these in .env to switch models without touching code.
# ─────────────────────────────────────────────────────────────
LLM_BINDING: str = os.getenv("LLM_BINDING", "gemini")  # "gemini" or "claude"
LLM_MODEL: str = os.getenv("LLM_MODEL", "gemini-2.5-flash")
LLM_BINDING_HOST: str = os.getenv("LLM_BINDING_HOST", "")
LLM_BINDING_API_KEY: str = os.getenv("LLM_BINDING_API_KEY", "")

# ─────────────────────────────────────────────────────────────
# GEMINI_API_KEY: Module-level variable, updated at runtime.
#
# Priority order:
#   1. Database (gemini_api_keys table, first row by created_at)
#   2. Environment variable GEMINI_API_KEY (fallback)
#   3. None — RAG calls will raise RuntimeError with helpful message
#
# Python resolves module globals at CALL TIME, not definition time.
# Updating this variable from refresh_gemini_api_key() is immediately
# visible to all callers of llm_model_func() and embedding_func().
# ─────────────────────────────────────────────────────────────
GEMINI_API_KEY: str | None = os.getenv("GEMINI_API_KEY")



# Paths (defaults are relative to this file's directory, so they work in any environment)
_BASE_DIR = Path(__file__).parent
WORKING_DIR = Path(os.getenv("LIGHTRAG_WORKING_DIR", str(_BASE_DIR / "rag_storage")))

# Ensure directories exist
WORKING_DIR.mkdir(parents=True, exist_ok=True)


NEO4J_URI = os.getenv("NEO4J_URI")           # Ví dụ: neo4j://127.0.0.1:7687
NEO4J_USERNAME = os.getenv("NEO4J_USERNAME") # Ví dụ: neo4j
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD") # Ví dụ: 123456789
NEO4J_DATABASE = os.getenv("NEO4J_DATABASE", "neo4j")  # Mặc định: "neo4j"


# ─────────────────────────────────────────────────────────────
# PostgreSQL connection for LightRAG's built-in PG storage backends.
# LightRAG uses these to build its own asyncpg connection pool.
# ─────────────────────────────────────────────────────────────
PG_HOST     = os.getenv("POSTGRES_HOST", "localhost")
PG_PORT     = int(os.getenv("POSTGRES_PORT", "5432"))
PG_USER     = os.getenv("POSTGRES_USER", "postgres")
PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "")
PG_DATABASE = os.getenv("POSTGRES_DATABASE", "outline")

# asyncpg connection string format expected by LightRAG PG backends
_PG_URL = f"postgresql://{PG_USER}:{PG_PASSWORD}@{PG_HOST}:{PG_PORT}/{PG_DATABASE}"
# Neon.tech (and similar cloud PG hosts) reject plain connections — require SSL
if "neon.tech" in PG_HOST:
    _PG_URL += "?sslmode=require"

# Fail fast: Nếu thiếu bất kỳ biến bắt buộc nào, dừng ngay khi khởi động
if not all([NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD]):
    raise ValueError(
        "Thiếu biến môi trường Neo4j. "
        "Hãy đặt NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD trong file .env"
    )

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def llm_model_func(prompt, system_prompt=None, history_messages=[], **kwargs):
    return await gemini_model_complete(
        prompt,
        system_prompt=system_prompt,
        history_messages=history_messages,
        api_key=GEMINI_API_KEY,
        model_name="gemini-2.5-flash",
        **kwargs,
    )


@wrap_embedding_func_with_attrs(
    embedding_dim=768,
    send_dimensions=True,
    max_token_size=1024,
    model_name="models/gemini-embedding-001",
)
async def embedding_func(texts: list[str], **kwargs) -> np.ndarray:
    return await gemini_embed.func(
        texts, api_key=GEMINI_API_KEY, model="models/gemini-embedding-001", **kwargs
    )

# ═══════════════════════════════════════════════════════════════════════════════
# WORKSPACE ISOLATION — Per-workspace RAG instances + exclusive operation locks
# ═══════════════════════════════════════════════════════════════════════════════
# rag_instances: Cache of per-workspace ExtendedLightRAG instances
#   Key: workspace_id (e.g., "team-123")
#   Value: ExtendedLightRAG instance (lazy-created on first access)
# Reason: LightRAG workspace parameter filters Neo4j data by workspace label
# ───────────────────────────────────────────────────────────────────────────────
rag_instances: dict[str, ExtendedLightRAG] = {}
rag_lock = asyncio.Lock()  # Prevent race condition during instance creation

# workspace_locks: Exclusive locks per workspace (prevent concurrent KG modifications)
#   Key: workspace_id
#   Value: operation name (str) — "dedup" | "indexing" | "merging" | None
#   None = workspace is idle (not locked)
# Reason: Ensure atomic knowledge graph updates (no interleaved modifications)
# ───────────────────────────────────────────────────────────────────────────────
workspace_locks: dict[str, str | None] = {}
workspace_lock_time: dict[str, float] = {}  # Lock acquisition timestamp (for monitoring)


# ═══════════════════════════════════════════════════════════════════════════════
# FUNCTION: acquire_workspace_lock
# ═══════════════════════════════════════════════════════════════════════════════
# Try to acquire exclusive lock for workspace.
# Returns: bool — True if lock acquired, False if workspace already locked
# Usage:
#   if not await acquire_workspace_lock("workspace-a", "dedup"):
#       return {"status": "busy"}, 429
#   try:
#       # Perform operation...
#   finally:
#       release_workspace_lock("workspace-a")
# ═══════════════════════════════════════════════════════════════════════════════
async def acquire_workspace_lock(workspace_id: str, operation: str) -> bool:
    """Try to acquire exclusive lock for workspace operation."""
    if workspace_locks.get(workspace_id) is not None:
        return False  # Workspace already locked

    workspace_locks[workspace_id] = operation
    workspace_lock_time[workspace_id] = time.time()
    logger.info(f"🔒 Workspace lock acquired: {workspace_id} ({operation})")
    return True


# ═══════════════════════════════════════════════════════════════════════════════
# FUNCTION: release_workspace_lock
# ═══════════════════════════════════════════════════════════════════════════════
# Release exclusive lock for workspace.
# ═══════════════════════════════════════════════════════════════════════════════
def release_workspace_lock(workspace_id: str):
    """Release workspace lock."""
    workspace_locks[workspace_id] = None
    workspace_lock_time[workspace_id] = None
    logger.info(f"🔓 Workspace lock released: {workspace_id}")


# ═══════════════════════════════════════════════════════════════════════════════
# FUNCTION: check_workspace_lock
# ═══════════════════════════════════════════════════════════════════════════════
# Check if workspace is locked. Returns error response if locked, None if idle.
# Usage:
#   lock_error = await check_workspace_lock("workspace-a")
#   if lock_error:
#       return lock_error, 429  # Return to client
# ═══════════════════════════════════════════════════════════════════════════════
async def check_workspace_lock(workspace_id: str) -> dict | None:
    """Check if workspace locked, return error response if so."""
    if workspace_id not in workspace_locks or workspace_locks[workspace_id] is None:
        return None  # Not locked

    operation = workspace_locks[workspace_id]
    lock_start_time = workspace_lock_time[workspace_id]

    # Estimate unlock time based on operation type
    operation_duration = {
        "dedup": 1800,      # 30 minutes (LLM-heavy)
        "indexing": 300,    # 5 minutes (typical)
        "merging": 60,      # 1 minute (typically fast)
    }
    estimated_duration = operation_duration.get(operation, 1800)
    estimated_unlock_time = lock_start_time + estimated_duration

    return {
        "status": "locked",
        "message": f"Workspace busy with {operation}. Try after {estimated_unlock_time}.",
        "operation": operation,
        "locked_since": lock_start_time,
        "estimated_unlock_time": estimated_unlock_time,
        "retry_after_seconds": 10,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# FUNCTION: monitor_stuck_locks (Background Task)
# ═══════════════════════════════════════════════════════════════════════════════
# Background monitoring: log warnings if workspace lock held > 1 hour
# Called from FastAPI startup event. Runs indefinitely.
# ═══════════════════════════════════════════════════════════════════════════════
async def monitor_stuck_locks():
    """Background task: monitor and warn about locks held too long."""
    while True:
        for workspace_id, operation in workspace_locks.items():
            if operation is None:
                continue

            elapsed = time.time() - workspace_lock_time[workspace_id]
            if elapsed > 3600:  # 1 hour
                logger.warning(
                    f"⚠️  Workspace {workspace_id} lock held for {elapsed:.0f}s "
                    f"(operation={operation}). Consider manual unlock if stuck."
                )

        await asyncio.sleep(300)  # Check every 5 minutes


# ═══════════════════════════════════════════════════════════════════════════════
# FUNCTION: get_rag_for_workspace
# ═══════════════════════════════════════════════════════════════════════════════
# Get or create ExtendedLightRAG instance for workspace.
# Lazy-loaded: instance created only on first access, then cached.
# Thread-safe: asyncio.Lock prevents race condition during creation.
# ═══════════════════════════════════════════════════════════════════════════════
async def get_rag_for_workspace(workspace_id: str) -> ExtendedLightRAG:
    """
    Get or create a workspace-isolated ExtendedLightRAG instance (lazy-load, cached).

    ═════════════════════════════════════════════════════════════════════════════════
    🎯 PURPOSE
    ═════════════════════════════════════════════════════════════════════════════════
    Returns a per-workspace ExtendedLightRAG instance that ensures:
    - Workspace A's entities are not visible to Workspace B
    - All queries (Neo4j, vector embeddings, documents) are filtered by workspace
    - Only one instance per workspace is created (lazy loading + caching)

    ═════════════════════════════════════════════════════════════════════════════════
    🔒 WORKSPACE ISOLATION MECHANISM
    ═════════════════════════════════════════════════════════════════════════════════
    LAYER 1 (Parameter Flow):
        workspace_id → ExtendedLightRAG(..., workspace=workspace_id, ...)

    LAYER 2 (Storage Filtering):
        - Neo4j: Creates nodes with :workspace_{id} label, queries match only that label
        - PostgreSQL: Filters chunks/embeddings via workspace parameter in WHERE clauses

    LAYER 3 (Parent LightRAG Methods):
        Parent class methods should respect workspace parameter passed to storage

    LAYER 4 (Defensive Validation):
        ExtendedLightRAG override methods validate results contain only workspace's data

    ═════════════════════════════════════════════════════════════════════════════════
    ⚠️  CRITICAL: ENVIRONMENT VARIABLE RISK
    ═════════════════════════════════════════════════════════════════════════════════
    NEO4J_WORKSPACE env var (if set) will OVERRIDE the workspace parameter!

    Example:
        NEO4J_WORKSPACE="workspace_1"  # In .env or environment
        get_rag_for_workspace("workspace_2")  # ← will use workspace_1 instead!

    This env var exists for backward compatibility but is DANGEROUS in multi-tenant contexts.
    Never set NEO4J_WORKSPACE in production.

    ═════════════════════════════════════════════════════════════════════════════════
    🔄 INSTANCE CACHING
    ═════════════════════════════════════════════════════════════════════════════════
    - Fast path (cache hit): Return cached instance from rag_instances[workspace_id]
    - Slow path (cache miss): Create new instance, store in dict, return
    - Thread-safe: asyncio.Lock prevents race condition during creation
    - Per-workspace caching reduces initialization overhead, maintains isolation

    ═════════════════════════════════════════════════════════════════════════════════
    📥 PARAMETERS
    ═════════════════════════════════════════════════════════════════════════════════
    workspace_id : str
        Unique identifier for the workspace (e.g., "workspace_123", team UUID)
        Each workspace sees only its own entities/relationships
        Must not be empty; validated at entry

    ═════════════════════════════════════════════════════════════════════════════════
    📤 RETURNS
    ═════════════════════════════════════════════════════════════════════════════════
    ExtendedLightRAG
        Ready-to-use instance with all storages initialized
        All queries will be filtered to workspace_id
        Inherits 5 override methods for defensive validation

    ═════════════════════════════════════════════════════════════════════════════════
    🚨 RAISES
    ═════════════════════════════════════════════════════════════════════════════════
    ValueError
        If workspace_id is empty or whitespace
    RuntimeError
        If workspace parameter was not properly passed to storage layers

    ═════════════════════════════════════════════════════════════════════════════════
    📝 EXAMPLE USAGE
    ═════════════════════════════════════════════════════════════════════════════════
    # Get instance for workspace A
    rag_a = await get_rag_for_workspace("workspace_a")
    entities_a = await rag_a.get_knowledge_graph()  # Only workspace_a entities

    # Get instance for workspace B — isolated results
    rag_b = await get_rag_for_workspace("workspace_b")
    entities_b = await rag_b.get_knowledge_graph()  # Only workspace_b entities (different from A)

    ═════════════════════════════════════════════════════════════════════════════════
    """
    # ═══════════════════════════════════════════════════════════════════════════════
    # TASK 1.B (pre-creation): Validate workspace_id parameter
    # Reject whitespace-only strings (e.g., "  ") but allow empty "" for backward
    # compat with deprecated get_rag() which calls get_rag_for_workspace("").
    # ═══════════════════════════════════════════════════════════════════════════════
    if workspace_id and not workspace_id.strip():
        raise ValueError(
            f"workspace_id cannot be whitespace-only (got {workspace_id!r}). "
            f"Use a valid workspace identifier or empty string for default workspace."
        )

    # Check cache first (fast path)
    if workspace_id in rag_instances:
        return rag_instances[workspace_id]

    # Cache miss: create new instance (slow path, requires lock)
    async with rag_lock:
        # Double-check pattern: another task may have created it while we waited for lock
        if workspace_id in rag_instances:
            return rag_instances[workspace_id]

        # ═══════════════════════════════════════════════════════════════════════════════
        # TASK 1.A: Environment Variable Safeguard
        # Detect if NEO4J_WORKSPACE env var is set (can override workspace parameter)
        # ═══════════════════════════════════════════════════════════════════════════════
        neo4j_workspace_env = os.getenv("NEO4J_WORKSPACE")
        if neo4j_workspace_env:
            logger.warning(
                f"⚠️  NEO4J_WORKSPACE env var is set to '{neo4j_workspace_env}' — "
                f"this will override workspace parameter '{workspace_id}' in Neo4JStorage. "
                f"Ensure NEO4J_WORKSPACE is NOT set. Remove from .env immediately."
            )

        logger.info(f"🔧 Initializing ExtendedLightRAG for workspace: {workspace_id}")

        # Create per-workspace directory
        workspace_dir = WORKING_DIR / workspace_id
        workspace_dir.mkdir(parents=True, exist_ok=True)

        # Create ExtendedLightRAG instance with workspace parameter
        # This ensures LightRAG's Neo4JStorage uses workspace_id in Cypher queries
        rag_instances[workspace_id] = ExtendedLightRAG(
            working_dir=str(workspace_dir),
            workspace=workspace_id,  # KEY: pass workspace to LightRAG
            llm_model_func=llm_model_func,
            llm_model_name=LLM_MODEL,
            embedding_func=embedding_func,
            # Graph storage — Neo4j filters by workspace_id label
            graph_storage="Neo4JStorage",
            # KV stores — PostgreSQL tables with workspace_id column
            kv_storage="PGKVStorage",
            # Vector stores — PostgreSQL tables with workspace_id column (pgvector)
            vector_storage="PGVectorStorage",
            # Document status — PostgreSQL table with workspace_id column
            doc_status_storage="PGDocStatusStorage",
            # Pass PG connection URL to LightRAG's storage backends
            addon_params={"postgres_url": _PG_URL},
        )

        # ═══════════════════════════════════════════════════════════════════════════════
        # TASK 1.A.5: Initialize storages
        # Must be called before any storage operation (including drop).
        # Neo4JStorage.drop() requires self._DATABASE which is only set inside
        # initialize() — skipping this causes AttributeError on drop/clear calls.
        # ═══════════════════════════════════════════════════════════════════════════════
        await rag_instances[workspace_id].initialize_storages()

        # ═══════════════════════════════════════════════════════════════════════════════
        # TASK 1.B: Parameter Validation
        # Verify workspace parameter was actually set on the instance
        # ═══════════════════════════════════════════════════════════════════════════════
        rag_instance = rag_instances[workspace_id]
        if rag_instance.workspace != workspace_id:
            logger.error(
                f"❌ Workspace parameter mismatch! Expected: {workspace_id}, Got: {rag_instance.workspace}. "
                f"This indicates workspace parameter was not properly passed to storage layers. "
                f"Check Neo4JStorage and PostgreSQL storage initialization."
            )
            raise RuntimeError(
                f"Workspace parameter validation failed for {workspace_id}: "
                f"Expected workspace={workspace_id}, but instance has workspace={rag_instance.workspace}"
            )

        # Enable PathRAG path-based retrieval
        from pathrag_query import patch_lightrag_with_pathrag
        patch_lightrag_with_pathrag(enable=True)

        logger.info(
            f"✅ ExtendedLightRAG initialized for workspace {workspace_id}\n"
            f"   Working dir: {workspace_dir}\n"
            f"   Neo4j URI  : {NEO4J_URI}\n"
            f"   Neo4j DB   : {NEO4J_DATABASE}"
        )

        return rag_instances[workspace_id]


