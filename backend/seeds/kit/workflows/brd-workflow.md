# `brd` workflow

## Purpose

Business Requirements Document — sponsor / vendor RFP / pre-PRD business case. BRD = business case + ROI; PRD = product detail. Some FIS projects use BRD instead of PRD at concept phase.

## Inputs

- Project name + business problem

## Output

`artifacts/brd/BRD-NNNN.md` with frontmatter pointing to the FIS docx template.

Template: `references/templates/brd.template.md` (when present).

## Process

1. Read parent artifact for context.
2. Render from `references/templates/brd.template.md`.
3. Save under `artifacts/<type>/`.
4. Validate: parent artifact cited; required sections complete.

## Pass criteria

- All required sections present.
- Cross-references to upstream artifacts use file:line or §-anchors.
- Unresolved questions listed at the end.

## Render to .docx

`/fis:docs export <md-path>` resolves the template (project `.fis/templates/` overrides kit defaults) and writes `.docx`.

