"""Chat router — conversations + messages with LightRAG (Gemini default).

Endpoints (RESTful):
  POST   /api/conversations
  GET    /api/conversations
  PATCH  /api/conversations/{id}
  DELETE /api/conversations/{id}
  POST   /api/conversations/{id}/messages
  GET    /api/conversations/{id}/messages

All endpoints scope by X-User-Key + X-Workspace-Id headers (injected by
the Outline Node.js proxy). LLM calls use rag.aquery_llm() with the
default Gemini model_func (no Claude override). Citations stripped.
"""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from lightrag import QueryParam
from sqlalchemy import delete as sql_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from rag_state import get_rag_for_workspace
from routers.chat.chat_helper import serialize_conversation, serialize_message
from routers.chat.chat_models import Conversation, Message
from routers.chat.chat_type import (
    CreateConversationRequest,
    RenameConversationRequest,
    SendMessageRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Chat"])

HISTORY_LIMIT = 10  # 5 cặp user/assistant


def _extract_identity(request: Request) -> tuple[str, str]:
    """Extract X-User-Key + X-Workspace-Id headers (validated by Node.js proxy)."""
    user_id = request.headers.get("X-User-Key", "").strip()
    workspace_id = request.headers.get("X-Workspace-Id", "").strip()
    if not user_id or not workspace_id:
        raise HTTPException(status_code=400, detail="Missing identity headers")
    return user_id, workspace_id


async def _get_owned_conversation(
    db: AsyncSession,
    conversation_id: str,
    user_id: str,
    workspace_id: str,
) -> Conversation:
    """Fetch a conversation and verify it belongs to the caller. 404 otherwise."""
    conv = await db.get(Conversation, conversation_id)
    if not conv or conv.user_id != user_id or conv.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Not Found")
    return conv


@router.post("/conversations")
async def create_conversation(
    body: CreateConversationRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a new (empty) conversation owned by the caller."""
    user_id, workspace_id = _extract_identity(request)

    conv = Conversation(
        title=body.title or "New conversation",
        user_id=user_id,
        workspace_id=workspace_id,
    )
    db.add(conv)
    await db.commit()
    await db.refresh(conv)

    logger.info(f"[Chat] Created conversation: {conv.id} — '{conv.title}'")
    return serialize_conversation(conv)


@router.get("/conversations")
async def list_conversations(request: Request, db: AsyncSession = Depends(get_db)):
    """List the caller's conversations, newest first, with a last-message preview."""
    user_id, workspace_id = _extract_identity(request)

    result = await db.execute(
        select(Conversation)
        .where(Conversation.user_id == user_id)
        .where(Conversation.workspace_id == workspace_id)
        .order_by(Conversation.updated_at.desc())
    )
    conversations = result.scalars().all()

    items: list[dict] = []
    for conv in conversations:
        last_msg_result = await db.execute(
            select(Message)
            .where(Message.conversation_id == conv.id)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        last_msg = last_msg_result.scalar_one_or_none()
        if last_msg and len(last_msg.content) > 80:
            preview = last_msg.content[:80] + "..."
        elif last_msg:
            preview = last_msg.content
        else:
            preview = ""
        items.append(serialize_conversation(conv, preview=preview))

    logger.info(f"[Chat] Listed {len(items)} conversations")
    return {"conversations": items}


@router.post("/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    body: SendMessageRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Persist user message → query LightRAG (hybrid, Gemini) → persist AI reply."""
    user_id, workspace_id = _extract_identity(request)
    conv = await _get_owned_conversation(db, conversation_id, user_id, workspace_id)

    # 1. Stage user message (flush to obtain ID without committing)
    user_msg = Message(
        conversation_id=conversation_id,
        role="user",
        content=body.content,
    )
    db.add(user_msg)
    await db.flush()
    logger.info(f"[Chat] User message staged — conv={conversation_id}")

    # 2. Build conversation history (multi-turn, last 10 messages)
    history_result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .where(Message.id != user_msg.id)
        .order_by(Message.created_at.desc())
        .limit(HISTORY_LIMIT)
    )
    history_messages = list(reversed(history_result.scalars().all()))

    if history_messages:
        history_lines: list[str] = []
        for m in history_messages:
            role_label = "User" if m.role == "user" else "Assistant"
            history_lines.append(f"{role_label}: {m.content}")
        history_text = "\n".join(history_lines)
        full_query = (
            f"Conversation history:\n{history_text}\n\n"
            f"Current question: {body.content}"
        )
        logger.info(f"[Chat] Built query with {len(history_messages)} history messages")
    else:
        full_query = body.content
        logger.info("[Chat] No history — querying directly")

    # 3. Auto-rename conversation from the first user message
    if len(history_messages) == 0 and conv.title == "New conversation":
        conv.title = body.content.strip()[:60]

    # 4. Query LightRAG (default Gemini llm_model_func, no override)
    try:
        rag = await get_rag_for_workspace(workspace_id)
    except RuntimeError as exc:
        msg = str(exc)
        if "No active API key" in msg:
            raise HTTPException(
                status_code=400,
                detail={
                    "error_code": "GEMINI_KEY_MISSING",
                    "message": "No Gemini API key configured for this workspace. Please add a key in BA Agent settings.",
                },
            ) from exc
        logger.error(f"[Chat] RAG init failed: {msg}")
        raise HTTPException(
            status_code=503,
            detail={
                "error_code": "RAG_UNAVAILABLE",
                "message": "System is starting up, please try again in a few seconds.",
            },
        ) from exc

    ai_content: str
    try:
        result: dict = await rag.aquery_llm(
            full_query,
            param=QueryParam(mode="hybrid"),
        )
        llm_response: dict = result.get("llm_response", {}) or {}
        ai_content = (llm_response.get("content") or "").strip()
        if not ai_content:
            ai_content = (
                "I couldn't find relevant information in the uploaded documents. "
                "Try rephrasing your question or upload more documents."
            )
        logger.info(f"[Chat] LightRAG responded — length={len(ai_content)} chars")
    except RuntimeError as exc:
        msg = str(exc)
        if "All API keys exhausted" in msg:
            await db.rollback()
            raise HTTPException(
                status_code=400,
                detail={
                    "error_code": "GEMINI_QUOTA_EXHAUSTED",
                    "message": "All Gemini API keys are exhausted. Please add a new key.",
                },
            ) from exc
        if "No active API key" in msg:
            await db.rollback()
            raise HTTPException(
                status_code=400,
                detail={
                    "error_code": "GEMINI_KEY_MISSING",
                    "message": "No Gemini API key configured for this workspace. Please add a key in BA Agent settings.",
                },
            ) from exc
        logger.error(f"[Chat] RAG runtime error: {msg}")
        ai_content = (
            "Sorry, an error occurred while processing your question. Please try again."
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(f"[Chat] LightRAG query failed: {exc}", exc_info=True)
        ai_content = (
            "Sorry, an error occurred while processing your question. Please try again."
        )

    # 5. Persist AI message + touch conversation
    ai_msg = Message(
        conversation_id=conversation_id,
        role="assistant",
        content=ai_content,
    )
    db.add(ai_msg)
    conv.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(user_msg)
    await db.refresh(ai_msg)

    logger.info(
        f"[Chat] Transaction committed — conv={conversation_id}, "
        f"user={user_msg.id}, ai={ai_msg.id}"
    )

    return {
        "user_message": serialize_message(user_msg),
        "ai_message": serialize_message(ai_msg),
    }


@router.get("/conversations/{conversation_id}/messages")
async def get_messages(
    conversation_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Return all messages in a conversation, oldest first."""
    user_id, workspace_id = _extract_identity(request)
    await _get_owned_conversation(db, conversation_id, user_id, workspace_id)

    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    messages = result.scalars().all()

    logger.info(f"[Chat] Loaded {len(messages)} messages for conv={conversation_id}")
    return {"messages": [serialize_message(m) for m in messages]}


@router.patch("/conversations/{conversation_id}")
async def rename_conversation(
    conversation_id: str,
    body: RenameConversationRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Rename a conversation owned by the caller."""
    user_id, workspace_id = _extract_identity(request)
    conv = await _get_owned_conversation(db, conversation_id, user_id, workspace_id)

    conv.title = body.title.strip() or "New conversation"
    await db.commit()
    await db.refresh(conv)

    logger.info(f"[Chat] Renamed conversation {conversation_id} → '{conv.title}'")
    return serialize_conversation(conv)


@router.delete("/conversations/{conversation_id}", status_code=200)
async def delete_conversation(
    conversation_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Hard-delete a conversation (and its messages via FK cascade)."""
    user_id, workspace_id = _extract_identity(request)
    conv = await _get_owned_conversation(db, conversation_id, user_id, workspace_id)

    await db.execute(
        sql_delete(Message).where(Message.conversation_id == conversation_id)
    )
    await db.delete(conv)
    await db.commit()

    logger.info(f"[Chat] Deleted conversation {conversation_id}")
    return {"deleted": True, "id": conversation_id}
