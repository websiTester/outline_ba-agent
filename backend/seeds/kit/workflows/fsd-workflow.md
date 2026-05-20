# `fsd` workflow

## Purpose

Per-module Functional Specification Document. Common at FIS for SAP / EHRP / utility-billing engagements where modules are sized > Feature.

## Inputs

- PRD-NNNN + module name

## Output

`artifacts/fsd/FSD-NNNN.md` with frontmatter pointing to the FIS docx template.

Template: `references/templates/fsd.template.md` (when present).

## Process

1. Read parent artifact for context.
2. Render from `references/templates/fsd.template.md`.
3. Save under `artifacts/<type>/`.
4. Validate: parent artifact cited; required sections complete.

## Pass criteria

- All required sections present.
- Cross-references to upstream artifacts use file:line or §-anchors.
- Unresolved questions listed at the end.

## Render to .docx

`/fis:docs export <md-path>` resolves the template (project `.fis/templates/` overrides kit defaults) and writes `.docx`.

