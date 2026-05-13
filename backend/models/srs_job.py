import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class SrsJob(Base):
    __tablename__ = "srs_jobs"

    id: Mapped[str] = mapped_column("id", Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    workspace_id: Mapped[str] = mapped_column("workspaceId", String, nullable=False, index=True)
    status: Mapped[str] = mapped_column("status", String, nullable=False, default="pending")
    error: Mapped[str | None] = mapped_column("error", Text, nullable=True)
    results: Mapped[str | None] = mapped_column("results", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        "createdAt", DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
