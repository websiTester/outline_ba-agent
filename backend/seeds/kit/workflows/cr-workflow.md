# Mode: cr — Change Request

## Trigger
"Đổi scope PRD-XXXX" / "Add feature mid-flight"

## Steps

### 1. Auto-assign CR ID
Count `artifacts/change-requests/CR-*.md`.

### 2. Gather change context
- What's changing
- Why now (business reason)
- Impact estimate
- Stakeholder driving

### 3. Write CR document

```yaml
---
id: CR-NNNN
type: change-request
target_artifact: PRD-NNNN
target_version_before: 1
target_version_after: 2
status: Open
---
```

Body: original requirement, proposed change, impact, decision.

### 4. Cascade re-review
Nếu Accept:
- PRD: bump version 1 → 2
- Clear amigos_signoff
- status: Approved → Draft
- Update §Change Log
- Find downstream artifacts → flag stale qua `parent_version_seen`

### 5. Auto-chain
