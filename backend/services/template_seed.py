"""Seed 8 BA Kit templates on first startup (Q17).

Reads `*.template.md` files from `backend/seeds/kit/templates/` and creates
matching `Template` / `TemplateSection` / `TemplateSectionAgent` rows.
Idempotent: re-runs are no-ops when a template with that code already exists.

Default prompts mined from the matching `*-workflow.md` files in
`backend/seeds/kit/workflows/` via `default_prompt_builder` (Q17).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from database import AsyncSessionLocal
from services.default_prompt_builder import build_default_prompts
from services.template_parser import parse_template_markdown
from services.template_service import (
    create_template_from_parsed,
    get_template_by_code,
)

logger = logging.getLogger(__name__)


# Filename → template code mapping (mirrors kit Archive folder).
_TEMPLATE_FILES: dict[str, str] = {
    "brd.template.md": "BRD",
    "prd.template.md": "PRD",
    "cr.template.md": "CR",
    "dbdd.template.md": "DBDD",
    "ddd.template.md": "DDD",
    "fsd.template.md": "FSD",
    "sod.template.md": "SOD",
    "personas/persona.template.md": "PERSONAS",
}


def _seed_root() -> Path:
    """Where the kit files live in the repo (committed under backend/seeds/kit)."""
    # Allow override via env for tests or alternative seed sets.
    override = os.getenv("BA_KIT_SEED_DIR")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent.parent / "seeds" / "kit"


async def seed_templates_if_empty() -> None:
    """Run once on FastAPI startup. Skips any code that already exists."""
    # step 1: locate the seed directory; if missing, just log + bail (dev mode)
    seed_dir = _seed_root()
    templates_dir = seed_dir / "templates"
    workflows_dir = seed_dir / "workflows"

    if not templates_dir.exists():
        logger.warning("BA Kit seed dir not found: %s — skipping seed", templates_dir)
        return

    # step 2: for each known kit file, insert if (code) not already present
    async with AsyncSessionLocal() as db:
        for relative_path, code in _TEMPLATE_FILES.items():
            existing = await get_template_by_code(db, code)
            if existing is not None:
                continue

            file_path = templates_dir / relative_path
            if not file_path.exists():
                logger.warning("Seed file missing: %s (code=%s)", file_path, code)
                continue

            try:
                # step 2a: read raw markdown, parse to ParsedTemplate
                markdown_text = file_path.read_text(encoding="utf-8")
                parsed = parse_template_markdown(markdown_text, code=code)
                if not parsed.sections:
                    logger.warning(
                        "Parsed 0 sections from %s — kit file may use non-Roman H2s",
                        file_path,
                    )
                    continue

                # step 2b: build default prompts for each section from workflow files
                default_prompts: dict[int, tuple[str, str]] = {}
                for section in parsed.sections:
                    system_prompt, instruction = build_default_prompts(
                        template_code=code,
                        section_roman=section.roman,
                        section_title=section.title,
                        body_template=section.body_template,
                        workflow_dir=workflows_dir if workflows_dir.exists() else None,
                    )
                    default_prompts[section.order_index] = (system_prompt, instruction)

                # step 2c: persist Template + Section + Agent rows in one transaction
                await create_template_from_parsed(
                    db,
                    parsed,
                    created_by_user_id=None,  # seed = system-owned
                    default_prompts=default_prompts,
                    is_enabled=True,
                )
                logger.info("Seeded template %s with %d sections", code, len(parsed.sections))
            except Exception as exc:  # noqa: BLE001
                logger.exception("Failed to seed %s: %s", code, exc)
