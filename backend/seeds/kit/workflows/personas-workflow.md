# Mode: personas — Three Amigos + Stakeholders

## Trigger
"Setup personas" / "Define stakeholders" / "Three Amigos team"

## Output
`artifacts/personas/PERSONAS.md`.

## Sections

1. **Three Amigos:** Sarah (BA), Marcus (SA), Priya (QA) — default
2. **Primary user personas (3-5):** role + tech savvy + goals + pain points + anti-goals + tần suất
3. **Business stakeholders:** CFO, Compliance, PO — decision authority + sync/async + SLA
4. **Technical stakeholders:** DevOps, Platform, Security teams; external vendors
5. **Anti-personas:** cố ý không phục vụ — external contractors, guest, etc.

## Modes

- `--init`: detect domain → seed personas (banking/telco/generic)
- `--add <name>`: append persona mới qua structured AskUserQuestion
