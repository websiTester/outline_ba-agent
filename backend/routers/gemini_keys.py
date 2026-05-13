import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.gemini_api_key import GeminiApiKey
from services.encryption_service import decrypt_key, encrypt_key, mask_key

router = APIRouter(prefix="/gemini-keys", tags=["gemini-keys"])


class AddKeyRequest(BaseModel):
    workspaceId: str
    keyValue: str


class GeminiKeyResponse(BaseModel):
    id: str
    workspaceId: str
    keyValue: str  # masked
    isActive: bool
    createdAt: datetime
    updatedAt: datetime


def _to_response(key: GeminiApiKey) -> GeminiKeyResponse:
    return GeminiKeyResponse(
        id=key.id,
        workspaceId=key.workspace_id,
        keyValue=mask_key(decrypt_key(key.key_value)),
        isActive=key.is_active,
        createdAt=key.created_at,
        updatedAt=key.updated_at,
    )


async def _get_next_key(db: AsyncSession, workspace_id: str, exclude_id: str) -> GeminiApiKey | None:
    result = await db.execute(
        select(GeminiApiKey)
        .where(GeminiApiKey.workspace_id == workspace_id, GeminiApiKey.id != exclude_id)
        .order_by(GeminiApiKey.created_at)
        .limit(1)
    )
    return result.scalar_one_or_none()


@router.get("", response_model=list[GeminiKeyResponse])
async def list_keys(
    workspaceId: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(GeminiApiKey)
        .where(GeminiApiKey.workspace_id == workspaceId)
        .order_by(GeminiApiKey.created_at)
    )
    keys = result.scalars().all()
    return [_to_response(k) for k in keys]


@router.post("", response_model=GeminiKeyResponse, status_code=201)
async def add_key(
    data: AddKeyRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(GeminiApiKey).where(GeminiApiKey.workspace_id == data.workspaceId)
    )
    existing = result.scalars().all()
    is_first = len(existing) == 0

    key = GeminiApiKey(
        id=str(uuid.uuid4()),
        workspace_id=data.workspaceId,
        key_value=encrypt_key(data.keyValue),
        is_active=is_first,  # auto-activate if first key in workspace
    )
    db.add(key)
    await db.commit()
    await db.refresh(key)
    return _to_response(key)


@router.delete("/{key_id}", status_code=204)
async def delete_key(
    key_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(GeminiApiKey).where(GeminiApiKey.id == key_id))
    key = result.scalar_one_or_none()
    if key is None:
        raise HTTPException(status_code=404, detail="Key not found")

    was_active = key.is_active
    workspace_id = key.workspace_id

    await db.delete(key)
    await db.flush()

    if was_active:
        next_key = await _get_next_key(db, workspace_id, key_id)
        if next_key is not None:
            next_key.is_active = True
            next_key.updated_at = datetime.now(timezone.utc)

    await db.commit()


@router.put("/{key_id}/activate", response_model=GeminiKeyResponse)
async def activate_key(
    key_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(GeminiApiKey).where(GeminiApiKey.id == key_id))
    key = result.scalar_one_or_none()
    if key is None:
        raise HTTPException(status_code=404, detail="Key not found")

    # deactivate all keys in workspace first
    all_result = await db.execute(
        select(GeminiApiKey).where(
            GeminiApiKey.workspace_id == key.workspace_id,
            GeminiApiKey.is_active == True,  # noqa: E712
        )
    )
    for active_key in all_result.scalars().all():
        active_key.is_active = False
        active_key.updated_at = datetime.now(timezone.utc)

    key.is_active = True
    key.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(key)
    return _to_response(key)
