"""Inner LangGraph subgraph: one section attempt.

Per Q40 + Q44, each section run is a 4-node graph:

  retrieve  →  generate  →  decide  →  persist

  * retrieve  — pull workspace context from LightRAG (hybrid, top_k=5; Q43)
  * generate  — call `call_gemini_structured(SectionOutput)` with full prompt
                (Q6); wrapped in `asyncio.wait_for(timeout=600s)` per Q46
  * decide    — branch on SectionOutput.status:
                  - ok           → go to persist
                  - need_info    → END subgraph; outer flow pauses for user
                  - (3rd round)  → caller forces final attempt; persist
  * persist   — write content to `generation_section_states` and call Outline
                append helper (retries; falls back to `done_unsynced` per Q32)

The subgraph reads/writes via a small TypedDict state isolated from the outer
graph so it can be unit-tested in isolation. The outer engine assembles the
inputs from `BAKitState` (Q45) and merges results back.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from lightrag import QueryParam

from database import AsyncSessionLocal
from models.generation import GenerationSectionState
from rag_state import get_rag_for_workspace
from schemas.ba_kit import SectionOutput
from services.gemini_service import call_gemini_structured

# NOTE: Outline document append used to live here (`services.outline_client`)
# but the flow moved to the frontend — it now polls and calls
# `documents.update` directly with the user's session, then POSTs
# `/ba-kit/jobs/:id/sections/:sid/mark-synced` to flip `appended_to_doc`.
# We no longer touch Outline from Python.

logger = logging.getLogger(__name__)


# Hard cap on a single LLM call so a hung Gemini request can't park a job
# forever (Q46). Heartbeat will continue to refresh until completion.
_LLM_TIMEOUT_S = 600

# Q27 — once need_info_rounds reaches this limit the prompt switches to
# force-generate mode (no more questions allowed).
_NEED_INFO_LIMIT = 3


# ─────────────────────────────────────────────────────────────────────────────
# Subgraph state
# ─────────────────────────────────────────────────────────────────────────────


class SectionAgentInput(TypedDict, total=False):
    """Inputs the outer engine passes in when invoking the subgraph."""

    # Identity (used by retrieve + persist nodes).
    job_id: str
    section_state_id: str   # PK of generation_section_states row to update
    workspace_id: str
    outline_document_id: str | None

    # Snapshot agent config (Q37) — never look up the live agent here.
    model: str
    system_prompt: str
    instruction: str
    body_template: str
    section_title: str
    examples: list[dict]    # [{label, content}, …] — few-shot (Q42)

    # Context sources merged into the prompt at generate time.
    ad_hoc_context: str          # uploaded files + free text (Q33)
    user_hint: str               # short hint typed in Start form
    previous_sections_md: str    # rendered §I..§X-1 (Q28)
    user_answers: dict           # from earlier need_info rounds, indexed by Q

    # Round bookkeeping (Q27).
    need_info_rounds: int


class SectionAgentState(SectionAgentInput, total=False):
    """Internal state — adds fields populated by intermediate nodes."""

    retrieved_context: str           # filled by retrieve_node
    llm_result: SectionOutput | None  # filled by generate_node
    final_status: str                # filled by decide_node / persist_node
    error_code: str | None           # set when something goes wrong
    error_message: str | None
    persisted_content: str | None    # markdown that was saved
    sync_status: str                 # 'synced' | 'unsynced'


# ─────────────────────────────────────────────────────────────────────────────
# Node implementations
# ─────────────────────────────────────────────────────────────────────────────


async def retrieve_node(state: SectionAgentState) -> dict:
    """Pull relevant workspace context from LightRAG (Q43: hybrid, top_k=5)."""
    # step 1: build retrieval query from section title + user hint (Q43)
    query = f"{state['section_title']} {state.get('user_hint', '')}".strip()
    workspace_id = state["workspace_id"]

    try:
        # step 2: get the per-workspace RAG instance and run a hybrid query
        rag = await get_rag_for_workspace(workspace_id)
        result: dict = await rag.aquery_llm(query, param=QueryParam(mode="hybrid"))
        llm_response = result.get("llm_response", {}) or {}
        # `aquery_llm` already runs the LLM with retrieved context; we want the
        # retrieval-only context. LightRAG returns the synthesized answer; if
        # the workspace has no docs the content will be empty/placeholder.
        retrieved = (llm_response.get("content") or "").strip()
    except RuntimeError as exc:
        # No API key, empty workspace, RAG not started, etc — surface as
        # empty context (per Q33 we still allow generation to proceed).
        logger.warning("retrieve_node fallback: %s", exc)
        retrieved = ""
    except Exception as exc:  # noqa: BLE001
        logger.exception("retrieve_node unexpected error: %s", exc)
        retrieved = ""

    return {"retrieved_context": retrieved}


async def generate_node(state: SectionAgentState) -> dict:
    """Call Gemini with structured output to produce SectionOutput."""
    # step 1: assemble the full user prompt blending all 5 context sources (Q28)
    user_prompt = _build_user_prompt(state)

    # step 2: when need_info_rounds == limit, force LLM to skip need_info (Q27)
    system_prompt = state["system_prompt"]
    if state.get("need_info_rounds", 0) >= _NEED_INFO_LIMIT:
        system_prompt += (
            "\n\nLƯU Ý CUỐI CÙNG: User đã trả lời nhiều lần nhưng vẫn thiếu context. "
            "BẮT BUỘC trả về status=\"ok\" với content tốt nhất bạn có thể, "
            "đánh dấu các chỗ thiếu bằng `[TBD: …]` để user fill sau. "
            "TUYỆT ĐỐI không trả status=need_info."
        )

    # step 3: invoke Gemini with hard timeout (Q46) + structured output (Q6)
    try:
        result = await asyncio.wait_for(
            call_gemini_structured(
                model=state.get("model", "gemini-2.5-flash"),
                prompt=f"{system_prompt}\n\n{user_prompt}",
                schema=SectionOutput,
                workspace_id=state["workspace_id"],
            ),
            timeout=_LLM_TIMEOUT_S,
        )
        # call_gemini_structured returns an instance of the schema class.
        if not isinstance(result, SectionOutput):
            # Pydantic v2 may return a dict-shaped object — coerce.
            result = SectionOutput.model_validate(result)
        return {"llm_result": result}
    except asyncio.TimeoutError:
        # Q30: no retry — surface the error so persist_node can mark error.
        return {
            "llm_result": None,
            "error_code": "LLM_TIMEOUT",
            "error_message": f"Gemini call exceeded {_LLM_TIMEOUT_S}s",
        }
    except RuntimeError as exc:
        # Bubbles up from gemini_service when all keys exhausted (Q30).
        return {
            "llm_result": None,
            "error_code": "QUOTA_EXHAUSTED" if "exhausted" in str(exc) else "LLM_ERROR",
            "error_message": str(exc),
        }
    except Exception as exc:  # noqa: BLE001
        # Malformed schema, network, etc — Q30 fail fast.
        logger.exception("generate_node unexpected error")
        return {
            "llm_result": None,
            "error_code": "LLM_ERROR",
            "error_message": f"{type(exc).__name__}: {exc}",
        }


def decide_node(state: SectionAgentState) -> dict:
    """Route based on llm_result. Pure function — no IO."""
    # step 1: bubble errors straight through
    if state.get("error_code") is not None:
        return {"final_status": "error"}

    result = state.get("llm_result")
    if result is None:
        return {
            "final_status": "error",
            "error_code": "LLM_ERROR",
            "error_message": "No llm_result produced",
        }

    # step 2: ok → persist, need_info → end subgraph (outer waits for user)
    if result.status == "ok" and result.content:
        return {"final_status": "ok"}
    if result.status == "need_info":
        return {"final_status": "need_info"}

    # Pathological case: ok but content empty.
    return {
        "final_status": "error",
        "error_code": "EMPTY_CONTENT",
        "error_message": "LLM returned status=ok with empty content",
    }


async def persist_node(state: SectionAgentState) -> dict:
    """Save section content to DB. Outline document sync is done by the FE poll."""
    # step 1: ensure the agent actually produced content
    result = state.get("llm_result")
    if result is None or result.content is None:
        # decide_node should have caught this, but guard anyway.
        return {"final_status": "error", "error_code": "EMPTY_CONTENT"}

    content = result.content

    # step 2: write content + status to DB. `appended_to_doc` stays False so
    # the next FE poll picks it up and pushes into the Outline document.
    async with AsyncSessionLocal() as db:
        section_state = await db.get(GenerationSectionState, state["section_state_id"])
        if section_state is None:
            return {
                "final_status": "error",
                "error_code": "STATE_MISSING",
                "error_message": f"section_state {state['section_state_id']} not found",
            }
        section_state.content = content
        section_state.status = "done"
        section_state.completed_at = datetime.now(timezone.utc)
        section_state.last_heartbeat = datetime.now(timezone.utc)
        await db.commit()

    return {
        "final_status": "ok",
        "persisted_content": content,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def _build_user_prompt(state: SectionAgentState) -> str:
    """Compose the LLM user prompt by stitching the 5 context sources (Q28)."""
    parts: list[str] = []

    # Skeleton always first — sets the structural contract.
    parts.append(
        f"## Section đang viết\n§ {state['section_title']}\n\n"
        f"## Skeleton phải giữ nguyên\n```markdown\n{state['body_template']}\n```"
    )

    # Few-shot examples (Q42) — up to 2 per section.
    examples = state.get("examples") or []
    if examples:
        chunks = []
        for ex in examples[:2]:
            chunks.append(
                f"### Example: {ex.get('label', 'example')}\n{ex.get('content', '')}"
            )
        parts.append("## Examples\n" + "\n\n".join(chunks))

    # User-provided ad-hoc context (Q33).
    ad_hoc = (state.get("ad_hoc_context") or "").strip()
    if ad_hoc:
        # Cap to 200K chars upstream — here we just include verbatim.
        parts.append(f"## Context user cung cấp (file upload + free text)\n{ad_hoc}")

    user_hint = (state.get("user_hint") or "").strip()
    if user_hint:
        parts.append(f"## Hint từ user\n{user_hint}")

    # Previous sections of this same document (Q28) — coherence anchor.
    prev = (state.get("previous_sections_md") or "").strip()
    if prev:
        parts.append(f"## Nội dung các section trước (§I..§X-1)\n{prev}")

    # LightRAG retrieval result.
    retrieved = (state.get("retrieved_context") or "").strip()
    if retrieved:
        parts.append(f"## Context từ knowledge graph workspace\n{retrieved}")

    # User answers from prior need_info rounds.
    answers = state.get("user_answers") or {}
    if answers:
        formatted = "\n".join(f"- Q{k}: {v}" for k, v in answers.items())
        parts.append(f"## User đã trả lời trong vòng trước\n{formatted}")

    # Final instruction with the structured-output contract reminder.
    parts.append(
        "## Yêu cầu output\n"
        "Trả về JSON khớp `SectionOutput`:\n"
        "- `status=\"ok\"` + `content` (markdown đầy đủ) — nếu đủ context\n"
        "- `status=\"need_info\"` + `questions` (1-3 câu cụ thể) — nếu thiếu"
    )

    return "\n\n".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# Public: build the compiled subgraph
# ─────────────────────────────────────────────────────────────────────────────


def _route_after_decide(state: SectionAgentState) -> str:
    """Conditional edge: 'persist' or END based on decide_node output."""
    if state.get("final_status") == "ok":
        return "persist"
    # need_info or error → end this subgraph; outer engine handles next step.
    return END


def build_section_agent_graph():
    """Compile the 4-node section agent into a reusable LangGraph subgraph."""
    graph = StateGraph(SectionAgentState)
    # step 1: register nodes
    graph.add_node("retrieve", retrieve_node)
    graph.add_node("generate", generate_node)
    graph.add_node("decide", decide_node)
    graph.add_node("persist", persist_node)

    # step 2: wire the linear edges
    graph.add_edge(START, "retrieve")
    graph.add_edge("retrieve", "generate")
    graph.add_edge("generate", "decide")

    # step 3: branch after decide based on llm_result.status
    graph.add_conditional_edges(
        "decide",
        _route_after_decide,
        {"persist": "persist", END: END},
    )
    graph.add_edge("persist", END)

    return graph.compile()


# Module-level singleton for cheap reuse across requests.
SECTION_AGENT_APP = build_section_agent_graph()
