from datetime import datetime, timezone

from google.api_core.exceptions import ResourceExhausted
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from sqlalchemy import select

from database import AsyncSessionLocal
from models.gemini_api_key import GeminiApiKey
from services.encryption_service import decrypt_key


async def _get_active_key_record(workspace_id: str) -> GeminiApiKey:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(GeminiApiKey)
            .where(
                GeminiApiKey.workspace_id == workspace_id,
                GeminiApiKey.is_active == True,  # noqa: E712
            )
        )
        key = result.scalar_one_or_none()
        if key is None:
            raise RuntimeError(f"No active API key configured for this workspace: {workspace_id}")
        return key


async def _rotate_to_next_key(workspace_id: str, failed_key_id: str) -> GeminiApiKey | None:
    async with AsyncSessionLocal() as db:
        all_result = await db.execute(
            select(GeminiApiKey)
            .where(GeminiApiKey.workspace_id == workspace_id)
            .order_by(GeminiApiKey.created_at)
        )
        keys = all_result.scalars().all()

        # find index of failed key and pick the next one not yet tried
        ids = [k.id for k in keys]
        if failed_key_id not in ids:
            return None

        failed_index = ids.index(failed_key_id)
        next_index = failed_index + 1
        if next_index >= len(keys):
            return None

        next_key = keys[next_index]

        # deactivate failed key, activate next
        for k in keys:
            k.is_active = k.id == next_key.id
            k.updated_at = datetime.now(timezone.utc)

        await db.commit()
        await db.refresh(next_key)
        print(
            f"[GeminiRotator] workspace={workspace_id} | "
            f"rotated from key ...{failed_key_id[-8:]} "
            f"to key ...{next_key.id[-8:]}"
        )
        return next_key


def _build_llm(model: str, api_key: str) -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(model=model, google_api_key=api_key)


async def call_gemini(
    model: str,
    system_prompt: str,
    user_prompt: str,
    workspace_id: str,
) -> str:
    tried_key_ids: set[str] = set()

    while True:
        key_record = await _get_active_key_record(workspace_id)

        if key_record.id in tried_key_ids:
            raise RuntimeError("All API keys exhausted for this workspace")
        tried_key_ids.add(key_record.id)

        llm = _build_llm(model, decrypt_key(key_record.key_value))
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ]
        try:
            response = await llm.ainvoke(messages)
            return str(response.content)
        except ResourceExhausted:
            next_key = await _rotate_to_next_key(workspace_id, key_record.id)
            if next_key is None:
                raise RuntimeError("All API keys exhausted for this workspace")


async def call_gemini_structured(
    model: str,
    prompt: str,
    schema: type,
    workspace_id: str,
) -> object:
    tried_key_ids: set[str] = set()

    while True:
        key_record = await _get_active_key_record(workspace_id)

        if key_record.id in tried_key_ids:
            raise RuntimeError("All API keys exhausted for this workspace")
        tried_key_ids.add(key_record.id)

        llm = _build_llm(model, decrypt_key(key_record.key_value))
        try:
            return await llm.with_structured_output(schema).ainvoke(prompt)
        except ResourceExhausted:
            next_key = await _rotate_to_next_key(workspace_id, key_record.id)
            if next_key is None:
                raise RuntimeError("All API keys exhausted for this workspace")
