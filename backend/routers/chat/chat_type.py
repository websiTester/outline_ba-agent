from typing import Optional

from pydantic import BaseModel


class CreateConversationRequest(BaseModel):
    """Body cho POST /api/conversations."""

    title: Optional[str] = "New conversation"


class SendMessageRequest(BaseModel):
    """Body cho POST /api/conversations/{id}/messages."""

    content: str


class RenameConversationRequest(BaseModel):
    """Body cho PATCH /api/conversations/{id}."""

    title: str
