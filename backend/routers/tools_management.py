import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import AgentTool
from services.file_extractor import extract_text
from services.graph_service import run_srs_graph
from services.srs_job_service import create_job, get_job

router = APIRouter(prefix="/tools_management", tags=["tools_management"])


class AgentToolUpsertRequest(BaseModel):
    workspaceId: str
    sectionId: str
    toolName: str
    model: str
    toolDescription: str
    defaultPrompt: str
    instruction: str


class AgentToolResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    workspaceId: str = Field(validation_alias="workspace_id")
    sectionId: str = Field(validation_alias="section_id")
    toolName: str = Field(validation_alias="tool_name")
    model: str
    toolDescription: str = Field(validation_alias="tool_description")
    defaultPrompt: str = Field(validation_alias="default_prompt")
    instruction: str
    createdAt: datetime = Field(validation_alias="created_at")
    updatedAt: datetime = Field(validation_alias="updated_at")


class DocumentInfo(BaseModel):
    id: str
    title: str
    content: str


class RunToolRequest(BaseModel):
    agentTool: AgentToolResponse
    prompt: str
    document: DocumentInfo


@router.get("/agent-tools/by-tool-name", response_model=AgentToolResponse)
async def get_agent_tool_by_tool_name(
    toolName: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AgentTool).where(AgentTool.tool_name == toolName)
    )
    tool = result.scalar_one_or_none()
    if tool is None:
        raise HTTPException(status_code=404, detail="Agent tool not found")
    return AgentToolResponse.model_validate(tool)


@router.post("/run-tool", status_code=200)
async def run_tool(
    data: RunToolRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    job = await create_job(db, data.agentTool.workspaceId)

    background_tasks.add_task(
        run_srs_graph,
        job_id=job.id,
        workspace_id=data.agentTool.workspaceId,
        section_ids=[data.agentTool.sectionId],
        file_content=data.document.content,
        user_prompt=data.prompt,
        prompt_override=data.prompt,
    )

    return {"job_id": job.id}


@router.get("/agent-tools/list", response_model=list[AgentToolResponse])
async def list_agent_tools_by_workspace(
    workspaceId: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    print(f"Listing agent tools for workspaceId: {workspaceId}")
    result = await db.execute(
        select(AgentTool).where(AgentTool.workspace_id == workspaceId)
    )
    tools = result.scalars().all()
    return [AgentToolResponse.model_validate(t) for t in tools]


@router.get("/agent-tools", response_model=AgentToolResponse | None)
async def get_agent_tool(
    workspaceId: str = Query(...),
    sectionId: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AgentTool).where(
            AgentTool.workspace_id == workspaceId,
            AgentTool.section_id == sectionId,
        )
    )
    tool = result.scalar_one_or_none()
    if tool is None:
        return None
    return AgentToolResponse.model_validate(tool)


@router.post("/generate-srs")
async def generate_srs(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    file: UploadFile = File(...),
    prompt: str = Form(...),
    workspaceId: str = Form(...),
    sectionIds: str = Form(...),
):
    raw = await file.read()
    file_content = extract_text(file.filename or "", raw)
    section_ids: list[str] = json.loads(sectionIds)

    job = await create_job(db, workspaceId)

    background_tasks.add_task(
        run_srs_graph,
        job_id=job.id,
        workspace_id=workspaceId,
        section_ids=section_ids,
        file_content=file_content,
        user_prompt=prompt,
    )

    return {"job_id": job.id}


@router.get("/jobs/{job_id}")
async def get_job_status(
    job_id: str,
    db: AsyncSession = Depends(get_db),
):
    job = await get_job(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    results = json.loads(job.results) if job.results else None
    return {"status": job.status, "error": job.error, "results": results}


@router.delete("/agent-tools/{tool_id}", status_code=204)
async def delete_agent_tool(
    tool_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AgentTool).where(AgentTool.id == tool_id)
    )
    tool = result.scalar_one_or_none()
    if tool is None:
        raise HTTPException(status_code=404, detail="Tool not found")
    await db.delete(tool)
    await db.commit()


@router.post("/agent-tools", response_model=AgentToolResponse)
async def upsert_agent_tool(
    data: AgentToolUpsertRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AgentTool).where(
            AgentTool.workspace_id == data.workspaceId,
            AgentTool.section_id == data.sectionId,
        )
    )
    tool = result.scalar_one_or_none()

    normalized_tool_name = data.toolName.replace(" ", "_")

    if tool is not None:
        tool.tool_name = normalized_tool_name
        tool.model = data.model
        tool.tool_description = data.toolDescription
        tool.default_prompt = data.defaultPrompt
        tool.instruction = data.instruction
        tool.updated_at = datetime.now(timezone.utc)
    else:
        tool = AgentTool(
            id=str(uuid.uuid4()),
            workspace_id=data.workspaceId,
            section_id=data.sectionId,
            tool_name=normalized_tool_name,
            model=data.model,
            tool_description=data.toolDescription,
            default_prompt=data.defaultPrompt,
            instruction=data.instruction,
        )
        db.add(tool)

    await db.commit()
    await db.refresh(tool)
    return AgentToolResponse.model_validate(tool)
