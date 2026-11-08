# Altamira backend

All Altamira server code lives in this folder. The specification is the backend design doc. The PRD is the source of truth for rules.

## Folders and owners

| Folder | Owner | Holds |
|---|---|---|
| `contract/` | Contract | Zod schemas and types for every entity and API body, enums, the permission matrix with `can()`, AI function contracts and the `AiProvider` interface, room op types, error codes |
| `db/` | Contract | `SqlExecutor` interface, Durable Object adapter (`do-sqlite.ts`), node:sqlite test adapter (`node-sqlite.ts`), DDL and `migrate()` per room (`schema/`), row mapping, `appendAudit()` |
| `fixtures/` | Contract | One fictional school, its schedule, staff for every role, and three fictional CB-IEP students (Kai, Amara, Sofía, matching `src/components/altamira/exampleData.ts`). Also a CB-IEP text sample and `seedSchool()` / `seedStudent()` |
| `services/registry.ts` | Contract (skeleton), Domain (contents) | `studentOps`, `schoolOps`, `insightsOps` |
| `services/`, `repos/` | Domain | Lesson Lens (1A), measurement (1B), analytics, summaries and consent, district insights logic, plus SQL access helpers |
| `ai/` | Intelligence | De-identification, fixture provider (default), Vertex stub, guardrail, citation checker |
| `rooms/`, `middleware/` | Platform | `AltamiraStudentRoom`, `AltamiraSchoolRoom`, `AltamiraInsightsRoom`; `altamiraAuth`, which builds an `Actor` |
| `routes/` | Integrator | Hono routes under `/api/v1` |

## Roles and capabilities

Six roles: `case_manager`, `teacher`, `ea`, `parent`, `district_lead`, `school_admin`. There is no student role and no session or link principal. The matrix is `PERMISSION_MATRIX` in `contract/permissions.ts` (tests: `contract/permissions.test.ts`, `e2e/permissions.test.ts`). A missing cell is a 403.

| Capability | Who |
|---|---|
| `iep.view` | case manager (caseload), teacher (class students), EA (assigned students), read only |
| `iep.import`, `objective.confirm` | case manager (import and confirm objectives at upload) |
| `ticket.submit` | case manager (IEP change tickets, next round) |
| `ticket.review`, `membership.manage` | school administrator |
| `lesson_plan.view` | teacher, plus case manager and EA for approved plans only |
| `lesson_plan.edit`, `adaptation.approve`, `modification.apply`, `proficiency.set` | teacher (EA and case manager read approved plans only) |
| `evidence.capture` | teacher, EA |
| `review.confirm` | teacher, EA, own captures only (`/review-queue`, `/data-points/:id/correct`) |
| `summary.view` | teacher and EA (drafts too), case manager and parent (approved only) |
| `summary.edit`, `summary.approve` | teacher, EA |
| `progress.view` | case manager, teacher, EA |
| `consent.manage` | parent (own child): `voice_note` and `video` |
| `insights.view` | district lead (anonymized, groups under 10 suppressed) |

## Routes

Role set: `ea`, `teacher`, `case_manager`, `parent`, `district_lead`, `school_admin`. Dev routes (`POST /dev/seed`, `GET /dev/roles`, `POST /dev/role`) exist only when `ALTAMIRA_DEV_SEED === 'true'`, otherwise 404.

Me and admin: `GET /me`, `/me/day-review`, `/me/summaries/pending`, `/me/weekly` (case manager weekly summary), `/admin/schools/:sid/memberships` (school administrator), `/districts/:id/insights` (district lead, anonymized).

Lesson plans: `/lesson-plans/today`, `/students/:id/lesson-plans`, `/lesson-plans/:id` and `/lesson-plans/:id/approve` (original, proposed changes, tailored; teacher approves).

IEP tickets: `/students/:id/tickets` (case manager submits), `/tickets`, `/tickets/:id/apply`, `/tickets/:id/decline` (school administrator).

Capture and days: `/students/:id/notes`, `/students/:id/videos`, `/students/:id/days`, `/students/:id/days/:date`, `/students/:id/days/:date/complete`.

Summaries: `/students/:id/summaries`, `/students/:id/summaries/generate`, `/summaries/:id`, `/summaries/:id/approve`, `/family/:id/summaries` (approved only).

Removed (no route, op, table or test): student mode and sessions, teacher proposals, Progress Drafts, parent input, substitute Today View links, Transition Handoff, the decision-rule digest (replaced by the case manager weekly summary). Migrations drop their tables (`db/schema/student.ts` v3, `db/schema/school.ts` v2).

## Execution model

1. A request reaches the Hono router at `/api/v1/*`. `resolveAuth` returns the `userId`. `altamiraAuth` then loads memberships, parent links and classes from the school room and builds an `Actor` (`contract/permissions.ts`).
2. The route validates the body with the schema in `contract/api.ts`. Then it calls `can(actor, capability, studentId, opts)`. A refusal answers 403 and writes nothing.
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
- AI content (tailored lesson plans, summaries) is a draft until an EA or the teacher approves it. Only `approved_only` readers (case manager, parent) never see drafts, and the room filters in SQL.

## Checks

```
npx tsc --noEmit
npx vitest run src/server/altamira
```
