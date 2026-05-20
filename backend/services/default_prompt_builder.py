"""Build a sensible default agent prompt for each parsed section.

Used by the seed task (Q17): when seeding the 8 kit templates, every section
needs a starter `system_prompt` + `instruction` so admins can hit "Generate"
immediately. Admin can later customise via the agent editor (A2).

Strategy:
  1. Read the matching `*-workflow.md` from `backend/seeds/kit/workflows/`
     (if present) and extract bullet-points relevant to this section.
  2. Compose a Vietnamese-first prompt (Q38) that wraps the section title,
     the kit-derived instruction, and the structured-output contract.
"""

from __future__ import annotations

import re
from pathlib import Path

# Mapping from template code → workflow file we mine for section guidance.
_WORKFLOW_FILES: dict[str, str] = {
    "BRD": "brd-workflow.md",
    "PRD": "create-workflow.md",
    "CR": "cr-workflow.md",
    "DBDD": "dbdd-workflow.md",
    "DDD": "ddd-business-workflow.md",
    "FSD": "fsd-workflow.md",
    "SOD": "sod-workflow.md",
    "PERSONAS": "personas-workflow.md",
}


# Common system-prompt preamble — applied to every section agent.
# Q38: always Vietnamese output. Q6: must return SectionOutput JSON.
_PROMPT_PREAMBLE = """Bạn là Business Analyst agent chuyên viết tài liệu nghiệp vụ \
theo chuẩn FIS Vietnam. Nhiệm vụ của bạn là sinh nội dung cho MỘT section duy nhất \
của tài liệu, dựa trên context được cung cấp.

Quy tắc tuyệt đối:
1. Viết toàn bộ content bằng TIẾNG VIỆT. Giữ nguyên tên riêng (FIS, ERP, SAP, …) \
và thuật ngữ kỹ thuật tiếng Anh khi cần.
2. Tuân thủ NGUYÊN VẸN cấu trúc của `body_template` đã cho: giữ đúng các H3, \
H4, bảng, mermaid block. CHỈ điền vào các chỗ `[FILL: …]` hoặc placeholder rõ ràng.
3. Nếu context KHÔNG đủ để fill chính xác → trả về `status="need_info"` kèm \
1-3 câu hỏi cụ thể cho user (KHÔNG đoán bừa).
4. Nếu context đủ → trả về `status="ok"` kèm `content` là markdown đầy đủ \
của section (bao gồm các H3 đã render, bảng đầy đủ data, mermaid hợp lệ).
5. Không lặp lại H2 heading của section (system sẽ tự prepend).
"""


def build_default_prompts(
    template_code: str,
    section_roman: str,
    section_title: str,
    body_template: str,
    workflow_dir: Path | None = None,
) -> tuple[str, str]:
    """Return (system_prompt, instruction) for one section.

    `instruction` is the short label shown to the user as the section
    description (e.g. in the Start form). `system_prompt` is the full prompt
    sent to the LLM.
    """
    # step 1: pull a 1-3 line instruction from the workflow file (best-effort)
    instruction = _mine_workflow_for_instruction(
        template_code, section_roman, section_title, workflow_dir
    )

    # step 2: compose the full system prompt the agent will use at runtime
    system_prompt = _compose_system_prompt(
        template_code=template_code,
        section_roman=section_roman,
        section_title=section_title,
        body_template=body_template,
        instruction=instruction,
    )

    return system_prompt, instruction


# ─────────────────────────────────────────────────────────────────────────────
# Internals
# ─────────────────────────────────────────────────────────────────────────────


def _mine_workflow_for_instruction(
    template_code: str,
    section_roman: str,
    section_title: str,
    workflow_dir: Path | None,
) -> str:
    """Best-effort: read the matching workflow file and extract 1-3 lines
    that mention this section. Returns a short instruction string.

    Falls back to a generic instruction derived from the section title if
    the workflow file is missing or no match is found.
    """
    # step 1: pick the workflow file mapped to this template code
    fallback = f"Sinh nội dung mục §{section_roman}. {section_title} dựa trên context dự án."
    if workflow_dir is None:
        return fallback
    file_name = _WORKFLOW_FILES.get(template_code.upper())
    if not file_name:
        return fallback
    workflow_path = workflow_dir / file_name
    if not workflow_path.exists():
        return fallback

    # step 2: search for bullet lines mentioning this section's title or Roman
    try:
        content = workflow_path.read_text(encoding="utf-8")
    except OSError:
        return fallback

    candidates: list[str] = []
    # Look for any line referencing the Roman numeral (e.g. "§VII", "§III")
    # or fragments of the section title (case-insensitive).
    title_token = section_title.split()[0].lower() if section_title else ""
    for line in content.splitlines():
        stripped = line.strip().lstrip("-*•").strip()
        if not stripped or len(stripped) > 240:
            continue
        if (
            f"§{section_roman}" in stripped
            or (title_token and title_token in stripped.lower())
        ):
            candidates.append(stripped)
        if len(candidates) >= 3:
            break

    if not candidates:
        return fallback
    return " · ".join(candidates)[:500]


def _compose_system_prompt(
    template_code: str,
    section_roman: str,
    section_title: str,
    body_template: str,
    instruction: str,
) -> str:
    """Assemble the full LLM system prompt for one section agent."""
    # Truncate body_template snippet to keep prompt size predictable.
    body_snippet = body_template.strip()
    if len(body_snippet) > 4000:
        body_snippet = body_snippet[:4000] + "\n…[truncated]"

    return (
        f"{_PROMPT_PREAMBLE}\n\n"
        f"## Template\n{template_code} — §{section_roman}. {section_title}\n\n"
        f"## Mục tiêu section\n{instruction}\n\n"
        f"## Skeleton markdown phải bảo toàn cấu trúc\n"
        f"```markdown\n{body_snippet}\n```\n"
    )
