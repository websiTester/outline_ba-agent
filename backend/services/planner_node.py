from pydantic import BaseModel, Field

from models.agent_tool import AgentTool
from services.agent_tool_service import get_tool_descriptions
from services.gemini_service import call_gemini_structured


class ExecutionPlan(BaseModel):
    tool_names: list[str] = Field(description="Ordered list of tool names to invoke")
    reasoning: str = Field(description="Brief explanation of tool selection")


def _build_planner_prompt(user_prompt: str, tools: list[AgentTool]) -> str:
    agent_tool_descriptions = get_tool_descriptions(tools)
    return f"""Bạn là workflow planner cho hệ thống Business Analysis AI.

## Các tools có sẵn:
{agent_tool_descriptions}

## Yêu cầu từ user:
{user_prompt}

## Nhiệm vụ:
Dựa vào yêu cầu của user, chọn ĐÚNG tools cần gọi theo thứ tự hợp lý.

## Quy tắc:
- Chỉ chọn tools từ danh sách có sẵn ở trên (dùng đúng tên tool)
- Nếu user muốn refine/cập nhật một phần → chỉ chọn tool liên quan
- Nếu user muốn tạo mới toàn bộ → chọn tất cả tools theo thứ tự logic
- Không bịa ra tên tool không có trong danh sách

Trả về JSON với execution plan.
"""


async def planner_node(state: dict) -> dict:
    tools: list[AgentTool] = state["tools"]
    user_prompt: str = state["user_prompt"]
    workspace_id: str = state["workspace_id"]
    available_names = [t.tool_name for t in tools]

    if not tools:
        return {"execution_plan": []}

    prompt = _build_planner_prompt(user_prompt, tools)

    try:
        plan: ExecutionPlan = await call_gemini_structured(
            model="gemini-2.5-flash",
            prompt=prompt,
            schema=ExecutionPlan,
            workspace_id=workspace_id,
        )

        validated = [name for name in plan.tool_names if name in available_names]
        if not validated:
            print("Planner returned no valid tool names, fallback to all tools")
            return {"execution_plan": available_names}

        print(f"Execution plan: {validated} | Reasoning: {plan.reasoning}")
        return {"execution_plan": validated}

    except Exception as e:
        print(f"Planner failed ({type(e).__name__}), fallback to all tools: {e}")
        return {"execution_plan": available_names}
