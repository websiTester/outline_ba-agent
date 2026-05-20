# Mode: ddd-business — DDD §I-IV (BA-owned)

## Trigger
"Viết DDD business cho US-XXXX" / "Screen intent" / "User actions cho màn hình" / "DDD phần BA"

## Collaborative ownership

DDD = BA + SA collaborative (user confirm 2026-05-05). BA viết §I-IV (business behavior + screen intent), SA append §V-VIII (data binding + tech validation) qua `/fis:ba ddd-business`.

## Khi dùng

- Story `ui_story: true` cần DDD chi tiết
- Stakeholder cần screen design document (FIS DDD format)
- Pre-implementation: clarify business rule cho mỗi screen field/action

## Steps

### 1. Resolve input

- `--from-elicit=EL-NNNN` → input persona + JTBD insights
- `--screen-name=<slug>` freeform

### 2. Auto-assign DDD ID

Count `artifacts/ddd/DDD-*.md` → next NNNN.

### 3. Generate wireframe (default HTML — Tailwind + shadcn/ui)


**Design config:** Skill đọc `artifacts/design/design.md` (nếu tồn tại) để áp dụng theme/colors/typography. User init: `/fis:wireframe init-design` → copy template.

User AskUserQuestion: fidelity?
- HTML (default) — Tailwind v4 CDN + shadcn/ui inline + Lucide icons. Live preview Cowork artifact panel.
- Mermaid user flow — cho navigation visualization (đa screen)
- ASCII — fallback nếu CDN blocked
- Figma — escalate stakeholder review meeting

### 4. Gather BA-owned content qua AskUserQuestion (batched)

**Batch 1 — §I Tổng quan:**
- Mục đích screen (1-2 câu)
- Phạm vi (story reference: US-XXXX)
- Persona primary + secondary

**Batch 2 — §II Screen intent:**
- Screen task (gì user làm trên screen này?)
- Pre-condition để vào screen
- Success criteria (khi nào user "xong" task?)
- Mockup placeholder (link tới WF-NNNN.html)

**Batch 3 — §III User actions:**
- Liệt kê action user thực hiện trên screen (vd Submit, Cancel, Edit, Delete, Filter, Export)
- Mỗi action: Trigger / Pre-condition / Effect (business level — chưa cần API endpoint)
- Permission required per action

**Batch 4 — §IV Business validation rules:**
- Field-level business rules (vd "Số tiền > 0", "Nội dung không trống")
- Cross-field rules (vd "Ngày kết thúc > ngày bắt đầu")
- Edge cases business (empty / error / permission denied / data conflict)

### 5. Fill DDD template (BA section §I-IV)

Use `references/templates/ddd.template.md` — fill §I-IV. §V-VIII để placeholder cho SA.

### 6. Save + handoff

Output `artifacts/ddd/DDD-NNNN-<slug>.md` với frontmatter:

```yaml
---
id: DDD-NNNN
type: ddd
title: "{{Screen Title}}"
parents: [US-NNNN]
collaborator: ba
sections_completed: [I, II, III, IV]
sections_pending: [V, VI, VII, VIII]
version: 1
project_code: ""
document_code: ""
---
```


### 7. Review

Sau khi BA fill xong §I-IV, AskUserQuestion: Manual / AI review (three-amigos BA lens).

## Convergence check (BA section)

- §I.1 Mục đích cụ thể (≠ "improve UX")
- §II Screen intent ≠ "user uses screen" (cần action verb concrete)
- §III ≥ 2 user actions
- §IV ≥ 3 business validation rules
- §IV ≥ 3 edge cases identified

## Reference

- `references/templates/ddd.template.md`
- Wireframe: `/fis:wireframe`
