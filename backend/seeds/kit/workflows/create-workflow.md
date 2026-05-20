# Mode: create — Greenfield PRD

## Trigger
"Tạo PRD cho [feature]" / "Write PRD for..." / "Initiative mới"

## Steps

### 1. Resolve project context
Read `.fisrc.json` → mode, tech_stack, team_size.

### 2. Auto-assign ID
Count `artifacts/prd/PRD-*.md` → next ID padded 4 digits.

### 3. Gather input qua AskUserQuestion (batched)

**Batch 1 — Problem & Goal:**
- Business problem (1-2 câu)
- Why now
- Who is affected
- Success KPI

**Batch 2 — Scope:**
- Top 3 FR Must
- Top 3 Should
- Top 3 out-of-scope
- NFR target

**Batch 3 — Constraints:**
- Tech stack, timeline, budget, compliance

### 4. Fill template
`templates/core/prd.template.md`. Auto-fill frontmatter (id, type=prd, status=Draft, mode=create, version=1).

### 5. Save + suggest review
- Output: `artifacts/prd/PRD-NNNN.md`

## Solo mode override
Nếu `team_size: 1`: skip persona setup nếu PERSONAS.md tồn tại; auto-Three-Amigos solo review.
