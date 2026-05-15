"""Serializers for chat response payloads."""

from typing import Any

from routers.chat.chat_models import Conversation, Message


def serialize_conversation(conv: Conversation, preview: str = "") -> dict[str, Any]:
    return {
        "id": conv.id,
        "title": conv.title,
        "preview": preview,
        "created_at": conv.created_at.isoformat(),
        "updated_at": conv.updated_at.isoformat(),
    }


def serialize_message(msg: Message) -> dict[str, Any]:
    return {
        "id": msg.id,
        "conversation_id": msg.conversation_id,
        "role": msg.role,
        "content": msg.content,
        "created_at": msg.created_at.isoformat(),
    }
