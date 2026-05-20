# Outline BA — Project Conventions

> Some legacy code may violate these rules. Always follow the rule, not the legacy pattern.

## Tech stack

- **TypeScript** stack: React 17 + MobX 4 + styled-components 5 (frontend), Koa 3 + sequelize-typescript 2 + PostgreSQL + Redis/Bull (server), TypeScript 5.9 strict.
- **Python** stack: FastAPI 0.115 + SQLAlchemy 2.0 async + asyncpg + Pydantic 2 (REST API), LightRAG-hku + Neo4j + pgvector + Gemini (RAG/LLM), LangGraph for agent flows.
- Yarn 4 monorepo, Vite for FE build, Jest for TS tests, Oxlint + Prettier enforced via Husky.

## Path aliases (TS)

- `@server/*` → `./server/*`
- `@shared/*` → `./shared/*`
- `~/*` → `./app/*`
- Use these — never relative paths across top-level folders.

## Folder map

```
app/        React frontend (MobX stores, models, scenes, components)
server/     Koa API server (routes, commands, models, policies, presenters)
backend/    Python FastAPI service (LightRAG, Gemini, BA Agent)
shared/     Code shared FE↔BE (types, utils, i18n, editor, styles)
plugins/    Optional auth/integration plugins (azure, discord, email, ...)
```

## Request flow

**TS server (Koa)** — `route → auth() → validate(schema) → transaction() → policy check → command (if multi-model) → model → presenter → ctx.body`

**Python backend (FastAPI)** — `route → header identity extraction → Pydantic body validation → service / inline logic → SQLAlchemy model (async) → dict response`

---

## TypeScript conventions

### Code style

- Strict mode on. Never use `any`; avoid `unknown` unless boundary.
- Prefer `interface` over `type` for object shapes.
- Avoid type assertions (`as`, `!`); model the type instead.
- Use early returns. Always use curly braces for `if`.
- Named exports only for new components/classes; one default per file is allowed for commands and route modules (existing convention).
- Event handlers prefixed `handle` (`handleClick`, `handleSubmit`).
- Do NOT import React unless used directly (JSX runtime is `react-jsx`).
- Do NOT create new `.md` files unless explicitly requested.
- Do NOT add i18n strings manually — extracted by `i18next-parser`.

### State management (MobX 4)

- Global state lives in `app/stores/*Store.ts`, registered in `app/stores/RootStore.ts`.
- Stores extend `Store<Model>` from `app/stores/base/Store.ts`.
- Models extend `Model` / `ParanoidModel` / `ArchivableModel` in `app/models/base/`.
- Use `@observable`, `@action`, `@computed` decorators. Prefer `@computed` over inline render math.
- Business logic in stores/models; components remain thin.
- `app/models/decorators/` provides `@Field`, `@Relation` — use them on observable fields.

### API & routes (server/)

- One folder per route group: `server/routes/api/<name>/{<name>.ts, index.ts, schema.ts, <name>.test.ts}`.
- Endpoint names are RPC-style: `router.post("apiKeys.create", ...)` — under `/api/`.
- Auth endpoints under `/auth/`. Use `auth({ role, type })` middleware.
- Always run `validate(T.Schema)` from `./schema.ts` before handler body.
- Use `transaction()` middleware for writes that touch multiple rows.
- Authorize with `authorize(actor, "action", model)` from `@server/policies` before mutations.
- Body always wrapped: `ctx.body = { data: presentXxx(model) }` (or `{ data: [...] }` + `pagination` middleware).
- Multi-model logic → extract into `server/commands/<name>.ts` (default export async function `(ctx, args)`).

### DB & models (server/)

- Sequelize models in `server/models/` use sequelize-typescript decorators (`@Table`, `@Column`, `@BelongsTo`, `@HasMany`, `@Default`, `@AllowNull`).
- Create migrations: `yarn db:create-migration --name=add-field-to-table`. Apply: `yarn db:migrate`.
- Always wrap multi-table writes in a transaction (`transaction()` middleware injects it into `ctx`).
- Use `Model.createWithCtx(ctx, attrs)` / `model.saveWithCtx(ctx)` so transaction + actor flow through.
- Add index for any column used in `WHERE`/`ORDER BY` at query scale.

### Testing (TS)

- Tests colocate next to source: `foo.ts` + `foo.test.ts`. Do NOT add new test folders.
- Run single file: `yarn test path/to/file.test.ts`. Avoid `yarn test` (whole suite).
- Use factories in `server/test/factories.ts` (`buildUser`, `buildDocument`, ...) — not raw inserts.
- Mock external deps in `__mocks__/` folder, not inline.

### Error handling (TS)

- Throw factory errors from `server/errors.ts` (`AuthenticationError`, `AuthorizationError`, `ValidationError`, `NotFoundError`, ...). Don't construct `httpErrors` inline.
- Errors propagate to global handlers in `server/onerror.ts`; do not catch-and-rethrow without adding context.
- Frontend network calls go through `app/utils/ApiClient.ts` (`client.post(...)`) — it normalizes errors.

---

## Python conventions

### Code style

- Python 3.11+ syntax. `from __future__ import annotations` at top of new modules.
- Mandatory type hints on every function signature and return.
- Use `str | None` union syntax, not `Optional[str]`.
- 4-space indent, double quotes, snake_case for functions/vars, PascalCase for classes.
- Async-first: every IO function is `async def`; never call sync DB / sync HTTP from request paths.
- Use `logger = logging.getLogger(__name__)` per module; never `print` in production code.

### FastAPI routers (backend/routers/)

- Each domain is a subpackage: `backend/routers/<domain>/{<domain>.py, <domain>_helper.py, <domain>_type.py}` (e.g. `chat/`, `documents/`, `graph/`).
- Declare `router = APIRouter(prefix="/api", tags=["<Domain>"])` once per file. Import into `backend/main.py`.
- Pydantic request bodies live in `<domain>_type.py`; SQLAlchemy ORM in `<domain>_models.py` if domain-local, otherwise `backend/models/`.
- Identity comes from headers, not auth dependencies: extract `X-User-Key` and `X-Workspace-Id` (set by Node proxy). Reject with `HTTPException(400, "Missing identity headers")` if absent.
- DB session: `db: AsyncSession = Depends(get_db)` — never instantiate sessions manually in handlers.
- Return plain `dict` or Pydantic model; do NOT leak SQLAlchemy ORM instances directly.

### Services (backend/services/)

- One file per concern: stateful logic, DB CRUD spanning multiple queries, external API clients.
- Functions take `db: AsyncSession` as first argument when DB-touching.
- Encryption / API-key handling goes through `encryption_service.py` — never store secrets plaintext.
- LightRAG access is always per-workspace: `await get_rag_for_workspace(workspace_id)` — never share the global instance.

### DB & models (backend/)

- `backend/database.py` owns the async engine + `get_db()` dependency. Don't create a second engine.
- Models use SQLAlchemy 2.0 declarative style: `class Foo(Base): ... id: Mapped[str] = mapped_column(...)`.
- Column names map to the Outline TS convention via first arg: `mapped_column("workspaceId", ...)` (camelCase in DB).
- Index workspace-scoped columns (`workspace_id`, `user_id`) and any field used in filters.
- Migrations: schema for new tables is created at startup via `Base.metadata.create_all` in `main.py` lifespan — coordinate with TS migrations in `server/migrations/` for shared tables.

### Testing (Python)

- Add tests next to the module as `test_<name>.py`. Use `pytest` (add to requirements if introducing it).
- Mock external HTTP (Gemini, Neo4j) — never call live services from tests.

### Error handling (Python)

- Raise `HTTPException(status_code, detail)` from FastAPI handlers; `detail` is either a string or `{"error_code": "...", "message": "..."}` for structured codes the TS proxy can branch on.
- Catch broad `Exception` only at lifespan / background-task boundaries, log with `logger.error(...)`, never silently swallow.

---

## Shared & plugins

- `shared/` is imported by both `app/` and `server/`. **Never import from `~/`, `@server/`, or `plugins/` inside `shared/`.**
- Frontend-only components go in `app/components/`, not `shared/components/` (the latter is for FE+BE usage like editor + email rendering).
- `plugins/<name>/{plugin.json, client/, server/}` is the plugin shape. `plugin.json` declares `id`, `name`, `priority`, `description`. New auth/integration providers should be a plugin, not edits in `server/`.

## Cross-stack integration (TS ↔ Python)

- TS server proxies to Python at `env.PYTHON_BACKEND_URL` (default `http://localhost:8000`). Frontend never calls Python directly.
- Forward identity via headers `X-User-Key: <user.id>` and `X-Workspace-Id: <team.id>`. Python trusts these — do NOT add a second auth layer there.
- TS endpoint shape is RPC (`chat.conversations.list`); Python is REST (`POST /api/conversations`). The TS route adapts the shape.
- On Python non-2xx: TS forwards `err.detail` as `ctx.body = { error: detail }`; status 5xx is downgraded to 502 from the FE's perspective.
- Same Postgres instance is shared by both stacks. TS owns user/team/document tables (Sequelize migrations); Python owns RAG/agent tables (created via `Base.metadata.create_all`). Do not cross-write a table owned by the other stack.

## Anti-patterns

- ❌ `ctx.body = user` — exposes raw model fields. ✅ `ctx.body = { data: presentUser(user) }`.
- ❌ Skipping `authorize(...)` because "the route is authed". Authentication ≠ authorization.
- ❌ Calling Sequelize from a route handler when it touches 2+ models — move to `server/commands/`.
- ❌ Using `any` to "make it compile". Model the type instead.
- ❌ `import ... from "../../../shared/..."` — use `@shared/...`.
- ❌ Adding a new auth provider by editing `server/` — create a plugin under `plugins/`.
- ❌ Creating a second SQLAlchemy engine in Python services — use `database.get_db()`.
- ❌ Bypassing `get_rag_for_workspace()` and reading the global LightRAG — leaks data across tenants.
- ❌ Querying RAG/agent tables without a `workspace_id` filter.
- ❌ `print(...)` in Python production code — use `logger`.
- ❌ Hand-writing i18n strings into a translation JSON — the parser extracts them from `t("...")` calls.
- ❌ New `.md` files at the repo root unless explicitly requested by the user.
