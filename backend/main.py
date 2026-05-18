import asyncio
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import sqlalchemy
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from lightrag.utils import generate_track_id
from neo4j import AsyncGraphDatabase

from database import Base, engine
from lightrag_helpers import pipeline_index_content
from rag_state import (
    NEO4J_DATABASE,
    NEO4J_PASSWORD,
    NEO4J_URI,
    NEO4J_USERNAME,
    get_gemini_key_for_workspace,
    get_rag_for_workspace,
    monitor_stuck_locks,
)
from routers import gemini_keys_router, tools_management_router
from routers.chat import router as chat_router
from routers.documents import router as document_router
from routers.graph import router as graph_router
from utils.file_parser import SUPPORTED_EXTENSIONS, parse_file_to_text

# Windows asyncio event loop policy (required for asyncpg + Neo4j on Windows)
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def setup_neo4j_workspace_indexes() -> None:
    """Create Neo4j indexes for workspace-filtered queries (idempotent)."""
    index_queries = [
        # Composite index: workspace + entity_name for fast entity lookups
        "CREATE INDEX idx_entity_workspace_name IF NOT EXISTS "
        "FOR (n:`__Entity__`) ON (n.workspace, n.entity_name)",
        # Composite index: workspace + entity_type for type-filtered queries
        "CREATE INDEX idx_entity_workspace_type IF NOT EXISTS "
        "FOR (n:`__Entity__`) ON (n.workspace, n.entity_type)",
        # Single index: workspace on relationships for filtered traversal
        "CREATE INDEX idx_relationship_workspace IF NOT EXISTS "
        "FOR ()-[r:`RELATES`]-() ON (r.workspace)",
    ]

    driver = AsyncGraphDatabase.driver(
        NEO4J_URI, auth=(NEO4J_USERNAME, NEO4J_PASSWORD)
    )
    try:
        async with driver.session(database=NEO4J_DATABASE) as session:
            for query in index_queries:
                try:
                    await session.run(query)
                except Exception as e:
                    # Non-fatal: index creation may fail if property doesn't exist yet
                    logger.warning(f"⚠️  Neo4j index creation skipped: {e}")
        logger.info("✅ Neo4j workspace indexes created/verified")
    except Exception as e:
        logger.error(f"❌ Error setting up Neo4j workspace indexes: {e}")
        # Non-fatal: indexes are performance optimization
    finally:
        await driver.close()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Startup: enable pgvector, ensure tables, set up Neo4j indexes, start monitors."""
    logger.info("🚀 FastAPI startup — initializing LightRAG infrastructure...")

    # 1. Ensure pgvector extension + create base tables (existing models)
    async with engine.begin() as conn:
        await conn.execute(sqlalchemy.text("CREATE EXTENSION IF NOT EXISTS vector"))
        logger.info("✅ pgvector extension verified")
        await conn.run_sync(Base.metadata.create_all)
        logger.info("✅ Database tables verified")

    # 2. Neo4j workspace indexes (idempotent)
    await setup_neo4j_workspace_indexes()

    # 3. Background task: monitor stuck workspace locks
    asyncio.create_task(monitor_stuck_locks())
    logger.info("✅ Workspace lock monitor started")

    logger.info("✅ Startup complete")
    yield
    logger.info("🛑 FastAPI shutdown")


app = FastAPI(title="BA Agent API", lifespan=lifespan)

_cors_origins_env = os.getenv("CORS_ALLOWED_ORIGINS", "*").strip()
_cors_regex_env = os.getenv("CORS_ALLOWED_ORIGIN_REGEX", "").strip()

if _cors_origins_env == "*":
    _cors_origins: list[str] = ["*"]
else:
    _cors_origins = [
        origin.strip() for origin in _cors_origins_env.split(",") if origin.strip()
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=_cors_regex_env or None,
    # Credentials only allowed when origins are specific (not "*").
    # Regex mode is considered specific.
    allow_credentials=bool(_cors_regex_env) or _cors_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tools_management_router)
app.include_router(gemini_keys_router)
app.include_router(document_router)
app.include_router(graph_router)
app.include_router(chat_router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/upload-document
# Multipart file upload → parse → enqueue indexing (background task)
# ─────────────────────────────────────────────────────────────────────────────
def _sanitize_filename(filename: str) -> str:
    """Strip path traversal characters; keep only the basename."""
    return (
        filename.replace("/", "")
        .replace("\\", "")
        .replace("..", "")
        .strip()
    )


@app.post("/api/upload-document")
async def upload_document(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
) -> dict:
    """Upload a document for LightRAG indexing into the caller's workspace.

    Headers:
        X-Workspace-Id: <teamId>  (required; injected by Node.js proxy)

    Flow:
      1. Validate workspace_id, filename, extension
      2. Verify workspace has an active Gemini API key (HTTP 400 if missing)
      3. Read bytes → parse_file_to_text (PDF/DOCX/text)
      4. Get per-workspace RAG instance (creates it lazily)
      5. Check duplicate filename via doc_status
      6. Schedule background indexing task; return immediately

    Returns:
        { status: "success" | "duplicate", message, track_id?, file_name, file_size }
    """
    workspace_id = request.headers.get("X-Workspace-Id", "").strip()
    if not workspace_id:
        raise HTTPException(status_code=400, detail="Missing X-Workspace-Id header")

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    safe_filename = _sanitize_filename(file.filename)
    if not safe_filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    ext = Path(safe_filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file type: {ext}. "
                f"Supported: {sorted(SUPPORTED_EXTENSIONS)}"
            ),
        )

    # Verify Gemini key exists for this workspace BEFORE doing expensive work
    # (raises HTTP 400 with user-friendly message if missing)
    await get_gemini_key_for_workspace(workspace_id)

    # Read bytes + parse to text
    raw_bytes = await file.read()
    file_size = len(raw_bytes)

    try:
        text_content = parse_file_to_text(raw_bytes, safe_filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error(f"File parse error ({safe_filename}): {exc!r}")
        raise HTTPException(
            status_code=400,
            detail=f"Failed to parse {ext} file: {exc}",
        ) from exc

    if not text_content:
        raise HTTPException(
            status_code=400,
            detail="File is empty or contains no readable text",
        )

    # Get per-workspace RAG instance
    rag = await get_rag_for_workspace(workspace_id)

    # Duplicate check via LightRAG's doc_status (per workspace)
    all_docs, _total = await rag.doc_status.get_docs_paginated(
        status_filter=None,
        page=1,
        page_size=10000,
        sort_field="updated_at",
        sort_direction="desc",
    )
    indexed_filenames = {doc.file_path for _doc_id, doc in all_docs}

    if safe_filename in indexed_filenames:
        logger.warning(f"Duplicate upload rejected: {safe_filename} (ws={workspace_id})")
        return {
            "status": "duplicate",
            "message": f"File '{safe_filename}' already exists in the knowledge graph",
            "file_name": safe_filename,
            "file_size": file_size,
        }

    track_id = generate_track_id("upload")
    background_tasks.add_task(
        pipeline_index_content, rag, text_content, safe_filename, track_id
    )
    logger.info(
        f"Upload accepted — ws={workspace_id}, file={safe_filename}, "
        f"size={file_size}, track_id={track_id}"
    )

    return {
        "status": "success",
        "message": f"File '{safe_filename}' received and queued for indexing.",
        "track_id": track_id,
        "file_name": safe_filename,
        "file_size": file_size,
    }
