import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class GeminiApiKey(Base):
    __tablename__ = "gemini_api_keys"

    id: Mapped[str] = mapped_column("id", Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    workspace_id: Mapped[str] = mapped_column("workspaceId", String, nullable=False, index=True)
    key_value: Mapped[str] = mapped_column("keyValue", Text, nullable=False)
    is_active: Mapped[bool] = mapped_column("isActive", Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        "createdAt", DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
