# `dbdd` workflow

## Purpose

Database Design Document — BA business view (§I-III: data classification, entity dictionary, business rules). SA appends §IV-VI tech via `/fis:ba ddd-business --type=dbdd`.

## Inputs

- PRD-NNNN or FSD-NNNN

## Output

`artifacts/dbdd/DBDD-NNNN.md` with frontmatter pointing to the FIS docx template.

Template: `references/templates/dbdd.template.md` (when present).

## Process

1. Read parent artifact for context.
2. Render from `references/templates/dbdd.template.md`.
3. Save under `artifacts/<type>/`.
4. Validate: parent artifact cited; required sections complete.

## Pass criteria

- All required sections present.
- Cross-references to upstream artifacts use file:line or §-anchors.
- Unresolved questions listed at the end.

## Render to .docx

`/fis:docs export <md-path>` resolves the template (project `.fis/templates/` overrides kit defaults) and writes `.docx`.

