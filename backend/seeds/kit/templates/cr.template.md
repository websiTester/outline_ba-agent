---
id: CR-{{NNNN}}
type: change-request
title: "{{Title}}"
status: Submitted                # Submitted | Review | Approved | Rejected | Applied | Closed
owner: ba
parents: [PRD-{{NNNN}}]
children: []                     # affected artifact IDs (TRD, Story, TS) khi Approved
submitted_by: ""
submitted_at: ""
applied_at: null
priority: ""                     # P0 hotfix | P1 next-sprint | P2 backlog
---

# CR-{{NNNN}}: {{Title}}

## 1. Change Description

> Stakeholder muốn gì thay đổi? Ngữ cảnh.

## 2. Reason

- Business: ...
- Technical: ...
- User feedback: ...

## 3. Impact Analysis

### Artifact affected
| Artifact | Section | Change |
|---|---|---|
| PRD-XXXX | §X.Y | ... |
| TRD-XXXX | §X | ... |
| US-XXXX |  | scope thay đổi |
| TS-XXXX |  | re-test cần thêm |

### Effort estimate
- Person-days:
- Calendar days (with dependencies):

### Risk if not applied
-

### Risk if applied (tech debt, breaking change)
-

## 4. Recommendation

- ✅ Approve — apply ngay sprint hiện tại
- 🔄 Approve — apply sprint sau
- ❌ Reject — lý do
- 📋 Defer — review lại sau X tuần

## 5. Cascade Plan (nếu Approved)

```
1. BA cập nhật PRD-XXXX → version++ → status: Draft → re-approve
2. SA cập nhật TRD-XXXX (nếu affected) → re-approve
3. SA cập nhật Story affected → re-Three-Amigos
4. QA cập nhật TestSpec affected → re-run test
```

## 6. Sign-off

| Role | Name | Verdict | Date |
|---|---|---|---|
| BA |  |  |  |
| SA |  |  |  |
| QA |  |  |  |
| Product owner |  |  |  |

## 7. Implementation tracking

- Applied at: [commit hash]
- New artifact versions: PRD v2, TRD v2, US-XXXX v2
