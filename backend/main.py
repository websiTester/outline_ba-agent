# THÊM VÀO — đầu file, trước mọi import
import sys
import asyncio
import sqlalchemy
# On Windows, asyncio.create_subprocess_exec requires ProactorEventLoop.
# SelectorEventLoop does NOT implement subprocess transport on Windows and
# raises NotImplementedError immediately when spawning a subprocess.
# This must be set BEFORE uvicorn initialises the event loop.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    
import logging
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, BackgroundTasks, HTTPException, Body, Request 
#(thêm Body — dùng cho request body validation):
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import aiofiles
from routers.chat.chat import router as chat_router
from routers.documents.document import router as document_router
from routers.graph.graph import router as graph_router
from rag_state import get_rag_for_workspace, monitor_stuck_locks
from lightrag.utils import generate_track_id
# Import ExtendedLightRAG (inherits from LightRAG)

from database import engine, Base


# Import our helper functions
from lightrag_helpers import pipeline_index_file, pipeline_index_content

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
# 1. Khởi tạo app

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── STARTUP ──────────────────────────────────────────
    global rag_instance
    logger.info("🚀 FastAPI đang khởi động — kết nối Neo4j và các storages...")


    # ─────────────────────────────────────────────────────
    # Tạo tables chat_conversations và chat_messages nếu chưa tồn tại.
    # create_all dùng "CREATE TABLE IF NOT EXISTS" — an toàn khi restart.
    # run_sync() chạy hàm sync bên trong async context của engine.
    # ─────────────────────────────────────────────────────
    async with engine.begin() as conn:

        # Enable pgvector extension (idempotent — safe every restart)
        # Required for LightRAG PGVectorStorage to create vector(N) columns
        await conn.execute(sqlalchemy.text("CREATE EXTENSION IF NOT EXISTS vector"))
        logger.info("pgvector extension verified")

        await conn.run_sync(Base.metadata.create_all)
    logger.info("✅ Database tables created/verified")

    # ─────────────────────────────────────────────────────────────────────
    # Create Neo4j indexes for workspace isolation performance
    # ──────────────────────────setup_neo4j_workspace_indexes───────────────────────────────────────────
    await setup_neo4j_workspace_indexes()
    logger.info("✅ Neo4j workspace indexes verified")

    # ─────────────────────────────────────────────────────────────────────
    # Start workspace lock monitor background task
    # ─────────────────────────────────────────────────────────────────────
    asyncio.create_task(monitor_stuck_locks())
    logger.info("✅ Workspace lock monitor started")


    # BƯỚC 1: Lấy singleton (đã configured với Neo4JStorage)
    # Dùng await get_rag_for_workspace("") thay vì get_rag() để tránh
    # RuntimeError: This event loop is already running trong async lifespan
    rag = await get_rag_for_workspace("")

    # BƯỚC 2: Initialize async storages (kết nối thực tế tới Neo4j)
    # Hàm này phải được await — nó mở kết nối Neo4j bolt, tạo indexes,
    # và chuẩn bị tất cả storage backends để sẵn sàng nhận dữ liệu
    await rag.initialize_storages()
    logger.info("✅ ExtendedLightRAG ready")


    yield



# ═══════════════════════════════════════════════════════════════════════════════
# HELPER FUNCTION: setup_neo4j_workspace_indexes
# ═══════════════════════════════════════════════════════════════════════════════
# Create Neo4j indexes for workspace isolation performance.
# Indexes ensure fast MATCH queries when filtering by workspace label.
# Idempotent: CREATE ... IF NOT EXISTS — safe to call every startup.
# ═══════════════════════════════════════════════════════════════════════════════
async def setup_neo4j_workspace_indexes():
    """Create Neo4j indexes for workspace-filtered queries if not exist."""
    from neo4j import AsyncGraphDatabase
    from rag_state import NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE

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
        # Non-fatal: indexes are performance optimization, not required for correctness
    finally:
        await driver.close()


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


app.add_middleware(

    CORSMiddleware,

    #allow_origins=origins,

    allow_origins=["*"],

    allow_credentials=True,

    allow_methods=["*"], # Cho phép tất cả các method (GET, POST, etc.)

    allow_headers=["*"],

)


# 1. Gắn router Products

# prefix="/products": Tự động thêm chữ /products vào trước mọi link trong file đó

# tags=["Products"]: Gom nhóm trong giao diện Swagger UI cho đẹp


# API Test đơn giản để biết server đang chạy

@app.get("/")

def read_root():

    return {"Hello": "Đây là API BA AI"}

app.include_router(chat_router)
app.include_router(document_router)
app.include_router(graph_router)

@app.post("/api/upload-document")
async def upload_document(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...)
):
    """
    Upload a document for RAG indexing.

    Reads file bytes in memory, decodes to UTF-8, and passes the text
    string directly to LightRAG — no disk write, no extra database table.

    LightRAG stores the content in lightrag_kv_full_docs (PostgreSQL)
    as part of the enqueue step.

    Returns immediately; indexing runs as a background task.
    """
    try:
        logger.info("=" * 60)
        logger.info(f"Upload request: {file.filename}")
        logger.info("=" * 60)

        # ── VALIDATE ────────────────────────────────────────────────
        if not file.filename:
            raise HTTPException(status_code=400, detail="No filename provided")

        safe_filename: str = (
            file.filename
            .replace("/", "")
            .replace("\\", "")
            .replace("..", "")
        )

        SUPPORTED_EXTENSIONS = {
            ".txt", ".md", ".pdf", ".docx",
            ".py", ".js", ".ts", ".json", ".xml",
        }
        file_ext: str = Path(safe_filename).suffix.lower()
        if file_ext not in SUPPORTED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type: {file_ext}. Supported: {SUPPORTED_EXTENSIONS}",
            )

        # ── READ ALL BYTES INTO MEMORY ───────────────────────────────
        # UploadFile.read() streams the full payload — fine for text docs (< 10 MB typical)
        raw_bytes: bytes = await file.read()
        file_size: int = len(raw_bytes)

        # Decode to UTF-8 text — this is what LightRAG indexes
        text_content: str = raw_bytes.decode("utf-8", errors="ignore").strip()

        if not text_content:
            raise HTTPException(
                status_code=400,
                detail="File is empty or contains no readable UTF-8 text",
            )

        # ── DUPLICATE CHECK via doc_status ─────────────────────────
        # Query LightRAG's doc_status (now in PostgreSQL) for any doc with
        # the same filename. LightRAG stores the filename in doc.file_path.
        workspace_id = request.headers.get("X-Workspace-Id", "").strip()
        rag = await get_rag_for_workspace(workspace_id)
        all_docs, _ = await rag.doc_status.get_docs_paginated(
            status_filter=None,
            page=1,
            page_size=10000,
            sort_field="updated_at",
            sort_direction="desc",
        )
        # Build set of filenames already known to LightRAG
        indexed_filenames: set[str] = {doc.file_path for _, doc in all_docs}

        if safe_filename in indexed_filenames:
            logger.warning(f"Duplicate upload rejected: {safe_filename}")
            return {
                "status": "duplicate",
                "message": f"File '{safe_filename}' already exists in the knowledge graph",
                "file_name": safe_filename,
            }

        # ── SCHEDULE BACKGROUND INDEXING ────────────────────────────
        # pipeline_index_content passes the text string directly to LightRAG.
        # LightRAG writes content to lightrag_kv_full_docs and sets status PENDING,
        # then extracts entities/relations and updates all other PG tables.
        track_id: str = generate_track_id("upload")
        background_tasks.add_task(
            pipeline_index_content,   # defined in lightrag_helpers.py (Step 5)
            rag,
            text_content,
            safe_filename,
            track_id,
        )
        logger.info(f"Background indexing scheduled — file={safe_filename}, track_id={track_id}")

        return {
            "status": "success",
            "message": f"File '{safe_filename}' received and queued for indexing.",
            "track_id": track_id,
            "file_name": safe_filename,
            "file_size": file_size,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload error: {e!r}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/documents")
async def list_documents(
    request: Request,
    status: str | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 50,
    sort_field: str = "updated_at",
    sort_direction: str = "desc",
):
    """
    List all documents from LightRAG's doc_status storage.

    ═══════════════════════════════════════════════════════════
    📋 FUNCTION PURPOSE:
    ═══════════════════════════════════════════════════════════
    Returns a paginated list of all documents that have been
    uploaded and processed (or are being processed) by LightRAG.
    This is the data source for the DocumentManagers table in
    the frontend.

    ═══════════════════════════════════════════════════════════
    📥 QUERY PARAMETERS:
    ═══════════════════════════════════════════════════════════
    status: str | None
        - Optional filter by document status
        - Values: "pending" | "processing" | "processed" | "failed" | None
        - None returns all documents across all statuses

    page: int (default: 1)
        - Page number for pagination (1-based)

    page_size: int (default: 50)
        - Number of documents per page (max 200)

    sort_field: str (default: "updated_at")
        - Field to sort by: "created_at" | "updated_at" | "id"

    sort_direction: str (default: "desc")
        - Sort direction: "asc" | "desc"

    ═══════════════════════════════════════════════════════════
    📤 RESPONSE:
    ═══════════════════════════════════════════════════════════
    {
      "documents": [
        {
          "id": "md5_hash_of_content",
          "file_path": "research.pdf",
          "content_summary": "First 100 chars...",
          "status": "processed",
          "content_length": 12345,
          "chunks_count": 15,
          "created_at": "2026-02-15T12:00:00Z",
          "updated_at": "2026-02-15T12:01:30Z",
          "error_msg": null,
          "track_id": "upload_20260215_143052_a7b3c9d1"
        }
      ],
      "total": 42,
      "page": 1,
      "page_size": 50
    }
    """
    try:
        from lightrag.base import DocStatus

        workspace_id = request.headers.get("X-Workspace-Id", "").strip()
        rag = await get_rag_for_workspace(workspace_id)

        # ─────────────────────────────────────────────────────────
        # Convert optional status string → DocStatus enum
        # ─────────────────────────────────────────────────────────
        status_filter: DocStatus | None = None
        if status:
            try:
                status_filter = DocStatus(status)
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid status '{status}'. Must be one of: pending, processing, preprocessed, processed, failed"
                )

        # ─────────────────────────────────────────────────────────
        # Fetch docs from LightRAG's doc_status storage
        # When search is active, fetch ALL matching docs then filter + paginate in Python
        # (get_docs_paginated is a library method that doesn't support search)
        # ─────────────────────────────────────────────────────────
        if search and search.strip():
            search_lower = search.strip().lower()
            all_docs, _ = await rag.doc_status.get_docs_paginated(
                status_filter=status_filter,
                page=1,
                page_size=10000,
                sort_field=sort_field,
                sort_direction=sort_direction,
            )
            logger.info(f"🔍 Search query: '{search_lower}', total docs fetched: {len(all_docs)}")
            # Filter by file_path or content_summary containing search query (case-insensitive)
            filtered = [
                (doc_id, doc) for doc_id, doc in all_docs
                if search_lower in (getattr(doc, 'file_path', '') or "").lower()
                or search_lower in (getattr(doc, 'content_summary', '') or "").lower()
            ]
            logger.info(f"🔍 Filtered results: {len(filtered)}")
            total_count = len(filtered)
            start = (page - 1) * page_size
            docs = filtered[start:start + page_size]
        else:
            docs, total_count = await rag.doc_status.get_docs_paginated(
                status_filter=status_filter,
                page=page,
                page_size=page_size,
                sort_field=sort_field,
                sort_direction=sort_direction,
            )

        # ─────────────────────────────────────────────────────────
        # Serialize DocProcessingStatus dataclass → plain dict
        # Maps field names to match the frontend Document interface
        # ─────────────────────────────────────────────────────────
        documents = [
            {
                "id": doc_id,
                "file_path": doc.file_path,
                "content_summary": doc.content_summary,
                "status": doc.status.value if hasattr(doc.status, "value") else doc.status,     # enum → string
                "content_length": doc.content_length,
                "chunks_count": doc.chunks_count or 0,
                "created_at": doc.created_at,
                "updated_at": doc.updated_at,
                "error_msg": doc.error_msg,
                "track_id": doc.track_id,
            }
            for doc_id, doc in docs
        ]

        logger.info(f"📋 Listed {len(documents)} documents (total: {total_count})")
        return {
            "documents": documents,
            "total": total_count,
            "page": page,
            "page_size": page_size,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error listing documents: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


