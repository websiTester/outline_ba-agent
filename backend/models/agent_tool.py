import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class AgentTool(Base):
    __tablename__ = "agent_tools"

    id: Mapped[str] = mapped_column("id", Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    workspace_id: Mapped[str] = mapped_column("workspaceId", String, nullable=False, index=True)
    section_id: Mapped[str] = mapped_column("sectionId", String, nullable=False)
    tool_name: Mapped[str] = mapped_column("toolName", String, nullable=False)
    model: Mapped[str] = mapped_column("model", String, nullable=False, default="gemini-2.5-flash")
    tool_description: Mapped[str] = mapped_column("toolDescription", Text, nullable=False)
    default_prompt: Mapped[str] = mapped_column("defaultPrompt", Text, nullable=False)
    instruction: Mapped[str] = mapped_column("instruction", Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        "createdAt", DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
