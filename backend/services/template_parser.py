"""Parse BA Kit template markdown files into structured (template, sections).

Convention (see kit `Archive/templates/*.template.md`):
  * Optional YAML frontmatter delimited by `---` at the top
  * `# <Title>` — template-level H1
  * `## I. <Section>` … `## XI. <Section>` — Roman-numeral H2 marks each
    agent-owned section
  * H2s without Roman numerals (e.g. `## Bảng ghi nhận thay đổi`, `## Trang
    ký`) are boilerplate and are skipped

Per Q41, the body block between two H2s (verbatim, including subheadings,
tables, mermaid fenced blocks) becomes the `body_template` for that section.
The agent's job is to fill in `[FILL: …]` markers without disturbing the
skeleton.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


# Matches a Roman numeral followed by a separator and section title.
# Examples that match: "I. Tổng quan", "VII. KPI", "XI. Glossary".
_ROMAN_HEADING_RE = re.compile(r"^\s*([IVX]+)\.\s+(.+?)\s*$")


@dataclass
class ParsedSection:
    """One agent-owned section after parsing."""

    order_index: int            # 0-based for stable sorting
    roman: str                  # "I", "II", … "XI"
    title: str                  # "Tổng quan" (without the Roman prefix)
    body_template: str          # markdown between this H2 and the next


@dataclass
class ParsedTemplate:
    """Result of parsing one template markdown file."""

    code: str                   # short identifier (BRD, PRD, SOD …)
    name: str                   # human label extracted from H1
    description: str = ""       # first non-heading paragraph after H1
    sections: list[ParsedSection] = field(default_factory=list)


def parse_template_markdown(md: str, code: str) -> ParsedTemplate:
    """Top-level entry point — parse a template `.md` into ParsedTemplate."""
    # step 1: strip optional YAML frontmatter so it doesn't pollute body text
    body = _strip_frontmatter(md)

    # step 2: extract H1 title and short intro paragraph for the template
    name, description, remainder = _extract_h1(body, fallback_name=code)

    # step 3: walk through every H2; only those with Roman-numeral prefix
    # become agent-owned sections
    sections = _split_into_roman_sections(remainder)

    return ParsedTemplate(code=code, name=name, description=description, sections=sections)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def _strip_frontmatter(md: str) -> str:
    """Remove YAML frontmatter if present (`---\\n...\\n---\\n`)."""
    # Frontmatter must start at the very first line.
    if not md.startswith("---"):
        return md
    # Find the closing `---` on its own line.
    end_match = re.search(r"\n---\s*\n", md)
    if not end_match:
        return md
    return md[end_match.end():]


def _extract_h1(md: str, fallback_name: str) -> tuple[str, str, str]:
    """Return (template_name, description, remaining_body_after_h1).

    The description is the first non-blank, non-heading paragraph after H1
    (typically a `> FIS analog: …` blockquote or short intro). Best effort.
    """
    h1_match = re.search(r"^#\s+(.+)$", md, re.MULTILINE)
    if not h1_match:
        return fallback_name, "", md

    # step 1: clean the H1 line — drop placeholders like "BRD-{{NNNN}}:" and
    # everything before/including a ":" so we keep only the human title
    raw_h1 = h1_match.group(1).strip()
    if ":" in raw_h1:
        raw_h1 = raw_h1.split(":", 1)[1].strip()
    # Drop any leftover {{…}} placeholders.
    name = re.sub(r"\{\{[^}]+\}\}", "", raw_h1).strip()
    if not name:
        name = fallback_name

    # step 2: grab the next non-empty paragraph as description (1-3 lines max)
    after_h1 = md[h1_match.end():]
    description = ""
    for paragraph in re.split(r"\n\s*\n", after_h1.strip()):
        para = paragraph.strip()
        if not para or para.startswith("#") or para.startswith("---"):
            continue
        # Take the first qualifying paragraph; cap at ~500 chars to keep DB sane.
        description = para[:500]
        break

    return name, description, after_h1


def _split_into_roman_sections(md: str) -> list[ParsedSection]:
    """Walk H2 headings and emit one ParsedSection per Roman-numeral H2."""
    # step 1: locate every H2 in the body with its byte offset and raw text
    h2_positions: list[tuple[int, str]] = [
        (m.start(), m.group(1).strip())
        for m in re.finditer(r"^##\s+(.+)$", md, re.MULTILINE)
    ]
    if not h2_positions:
        return []

    sections: list[ParsedSection] = []
    order = 0

    # step 2: for each H2, slice body up to the next H2 to capture the body_template
    for idx, (offset, heading_text) in enumerate(h2_positions):
        match = _ROMAN_HEADING_RE.match(heading_text)
        if not match:
            # Non-Roman H2 (boilerplate like "Trang ký") — skip
            continue
        roman, title = match.group(1), match.group(2)

        # End of this section's body = start of next H2, or EOF
        next_offset = h2_positions[idx + 1][0] if idx + 1 < len(h2_positions) else len(md)
        # Skip past the H2 line itself
        body_start = md.find("\n", offset)
        body_start = body_start + 1 if body_start != -1 else offset
        body_template = md[body_start:next_offset].rstrip()

        sections.append(
            ParsedSection(
                order_index=order,
                roman=roman,
                title=title,
                body_template=body_template,
            )
        )
        order += 1

    return sections
