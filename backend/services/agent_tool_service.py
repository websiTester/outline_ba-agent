from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import AgentTool


def get_tool_descriptions(tools: list[AgentTool]) -> str:
    return "\n".join(
        f"  - {tool.tool_name}: {tool.tool_description}"
        for tool in tools
    )


async def get_all_tools(db: AsyncSession, workspace_id: str) -> list[AgentTool]:
    result = await db.execute(
        select(AgentTool).where(AgentTool.workspace_id == workspace_id)
    )
    return list(result.scalars().all())


async def get_tools_by_section_ids(
    db: AsyncSession,
    workspace_id: str,
    section_ids: list[str],
) -> list[AgentTool]:
    result = await db.execute(
        select(AgentTool).where(
            AgentTool.workspace_id == workspace_id,
            AgentTool.section_id.in_(section_ids),
        )
    )
    return list(result.scalars().all())
