from models.agent_tool import AgentTool
from services.gemini_service import call_gemini


async def executor_node(state: dict) -> dict:
    execution_plan: list[str] = state["execution_plan"]
    tools: list[AgentTool] = state["tools"]
    file_content: str = state["file_content"]
    workspace_id: str = state["workspace_id"]
    prompt_override: str | None = state.get("prompt_override")

    if not execution_plan:
        return {"agent_results": []}

    tools_by_name = {t.tool_name: t for t in tools}
    agent_results: list[dict] = []

    for tool_name in execution_plan:
        tool = tools_by_name.get(tool_name)
        if not tool:
            raise ValueError(f"Tool '{tool_name}' not found in pool")

        effective_prompt = prompt_override if prompt_override else tool.default_prompt
        user_prompt = f"{file_content}\n\n{effective_prompt}"
        print(f"Executing tool '{tool_name}' with prompt:\n{user_prompt}\n")
        content = await call_gemini(tool.model, tool.instruction, user_prompt, workspace_id)

        agent_results.append({
            "tool_name": tool.tool_name,
            "section_id": tool.section_id,
            "content": content,
        })
        print(f"Completed tool '{tool_name}' (section {tool.section_id})")

    return {"agent_results": agent_results}
