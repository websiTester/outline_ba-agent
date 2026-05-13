from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from database import AsyncSessionLocal
from models.agent_tool import AgentTool
from services.agent_tool_service import get_tools_by_section_ids
from services.executor_node import executor_node
from services.planner_node import planner_node
from services.srs_job_service import update_job_status


class PlanExecuteState(TypedDict):
    user_prompt: str
    file_content: str
    workspace_id: str
    tools: list[AgentTool]
    execution_plan: list[str]
    agent_results: list[dict]
    prompt_override: str | None


def _build_graph():
    graph = StateGraph(PlanExecuteState)
    graph.add_node("planner", planner_node)
    graph.add_node("executor", executor_node)
    graph.add_edge(START, "planner")
    graph.add_edge("planner", "executor")
    graph.add_edge("executor", END)
    return graph.compile()


_app = _build_graph()


async def run_srs_graph(
    job_id: str,
    workspace_id: str,
    section_ids: list[str],
    file_content: str,
    user_prompt: str,
    prompt_override: str | None = None,
) -> None:
    async with AsyncSessionLocal() as db:
        try:
            await update_job_status(db, job_id, "running")

            tools = await get_tools_by_section_ids(db, workspace_id, section_ids)

            initial_state: PlanExecuteState = {
                "user_prompt": user_prompt,
                "file_content": file_content,
                "workspace_id": workspace_id,
                "tools": tools,
                "execution_plan": [],
                "agent_results": [],
                "prompt_override": prompt_override,
            }

            final_state = await _app.ainvoke(initial_state)
            agent_results: list[dict] = final_state.get("agent_results", [])

            await update_job_status(db, job_id, "completed", results=agent_results)

        except Exception as e:
            print(f"SRS job {job_id} failed: {type(e).__name__}: {e}")
            await update_job_status(db, job_id, "failed", error=str(e))
