import json
from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import String, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Message(Base):
    """
    Đại diện cho một tin nhắn trong conversation.

    role = "user"      → tin nhắn từ người dùng
    role = "assistant" → tin nhắn từ AI

    Lưu ý: backend dùng "assistant" (chuẩn OpenAI/Anthropic convention).
    Frontend hiển thị dùng "agent" (theo types.ts hiện tại).
    Mapping xảy ra ở api.ts khi convert response.

    Schema:
        chat_messages (
            id                VARCHAR   PRIMARY KEY,
            conversation_id   VARCHAR   FK → chat_conversations.id,
            role              VARCHAR   NOT NULL,   -- "user" | "assistant"
            content           TEXT      NOT NULL,
            created_at        TIMESTAMP NOT NULL
        )
    """

    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    # ─────────────────────────────────────────────────────────
    # FOREIGN KEY: Liên kết với conversation cha
    # ─────────────────────────────────────────────────────────
    conversation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("chat_conversations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # "user" hoặc "assistant" — VARCHAR(20) đủ dùng
    role: Mapped[str] = mapped_column(String(20), nullable=False)

    # Nội dung tin nhắn — dùng Text (không giới hạn độ dài)
    content: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )

    # Relationship ngược về Conversation
    conversation: Mapped["Conversation"] = relationship(
        "Conversation",
        back_populates="messages",
    )
