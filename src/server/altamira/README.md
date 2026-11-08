# Altamira backend

All Altamira server code lives in this folder. The specification is the backend design doc. The PRD is the source of truth for rules.

## Folders and owners

| Folder | Owner | Holds |
|---|---|---|
| `contract/` | Contract | Zod schemas and types for every entity and API body, enums, the permission matrix with `can()`, AI function contracts and the `AiProvider` interface, room op types, error codes |
| `db/` | Contract | `SqlExecutor` interface, Durable Object adapter (`do-sqlite.ts`), node:sqlite test adapter (`node-sqlite.ts`), DDL and `migrate()` per room (`schema/`), row mapping, `appendAudit()` |
| `fixtures/` | Contract | One fictional school, its schedule, staff for every role, and three fictional CB-IEP students (Kai, Amara, Sofía, matching `src/components/altamira/exampleData.ts`). Also a CB-IEP text sample and `seedSchool()` / `seedStudent()` |
| `services/registry.ts` | Contract (skeleton), Domain (contents) | `studentOps`, `schoolOps`, `insightsOps` |
| `services/`, `repos/` | Domain | 1A, 1B, analytics, drafts, Today View, handoff, Family Bridge and insights logic, plus SQL access helpers |
| `ai/` | Intelligence | De-identification, fixture provider (default), Vertex stub, guardrail, citation checker |
| `rooms/`, `middleware/` | Platform | `AltamiraStudentRoom`, `AltamiraSchoolRoom`, `AltamiraInsightsRoom`; `altamiraAuth`, which builds an `Actor` |
| `routes/` | Integrator | Hono routes under `/api/v1` |

## Execution model

1. A request reaches the Hono router at `/api/v1/*`. `resolveAuth` returns the `userId`. `altamiraAuth` then loads memberships, parent links and classes from the school room and builds an `Actor` (`contract/permissions.ts`).
2. The route validates the body with the schema in `contract/api.ts`. Then it calls `can(actor, capability, studentId, opts)`. A refusal answers 403 and writes nothing. An expired link answers 410. A `propose_only` refusal names the capability to use instead (`via`).
3. Async work runs in the route, outside any transaction. This includes AI calls through `AiProvider`, always on de-identified input.
4. The route calls the room's only RPC, `run(opName, args, actor)`, which returns `OpResult`. The room looks the op up in `services/registry.ts` and parses `args` with `op.args` when the op sets it. It then runs `op.run(sql, args, actor)` inside one `sql.transaction()`.
5. A room op is synchronous. It appends to `audit_log` (`appendAudit`) in the same transaction as each write. To abort, it throws an `AltamiraError`. That rolls back everything, including the audit row, and the room returns the error as data (`opErr`).

The same op code runs in the Durable Object (`createDoSqlExecutor(ctx.storage)`) and in Vitest (`createNodeSqlExecutor()`).

## Conventions

- Rooms: `student:<uuid>`, `school:<uuid>`, `district:<uuid>` (`contract/common.ts`).
- Entities are camelCase. Columns are snake_case. A field holding an object or array is stored in the column `<field>_json`. Use `toRow()` / `fromRow()` and then parse with the contract schema.
- Every mutable table has `version` for optimistic locking. `iep_versions` uses `row_version` because its `version` column is the IEP number. A version mismatch raises `AltamiraError('version_conflict')`, which answers 409.
- Corrections insert a new row with `supersedes_id`. Rows are never edited in place.
- `audit_log` is append-only: triggers abort UPDATE and DELETE.
- Parent and family reads filter `status IN FAMILY_VISIBLE_STATUSES`.

## Checks

```
npx tsc --noEmit
npx vitest run src/server/altamira
```
