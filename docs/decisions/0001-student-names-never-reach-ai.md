# 0001. Student names never reach an AI model

Status: accepted, 2026-11-07

## Context
Altamyra works with IEP goals for named students. Lesson Lens sends lesson and goal text to an outside AI agent. The product rules say names never reach the model, and the pilot uses fictional or de-identified data only.

## Decision
Every AI call, Lesson Lens included, goes through one pipeline (`createAi` in `src/server/altamyra/ai/functions.ts`, de-identifier in `ai/deidentify.ts`):
- student names, staff and family names, emails, student numbers and birth dates become stable tokens (students appear as their display token, e.g. `S-K7Q4`);
- the call is refused if any identifier survives, or if a student in the input is not on the roster;
- the provider's output is schema-checked, then names are put back inside the app.
Lesson Lens flows app → `/api/v1` lesson-plans → de-identify → Maritime agent (`ai/providers/maritime.ts`) → Gemini, with direct Gemini (or the fixture) as the fallback. The teacher id reaches the agent only as a SHA-256 hash, and plan feedback sent to the agent is de-identified with the same roster.

## Consequences
- No provider, the Maritime agent included, needs or sees real identities.
- The rules are unit-tested in `ai/deidentify.test.ts` and `ai/functions.test.ts`; the agent mapping in `ai/providers/maritime.test.ts`.
- Any new AI feature must use the same pipeline (see also 0010 for translation). The earlier separate Lesson Lens de-identifier (`src/actions/lesson-lens-core.ts`) was removed so there is one AI path.

## Evidence
- Commits: 3f002ad (de-identified server actions, since removed), 6210da6 (agent), 374dd12 (fail-closed `/api/v1` de-identification).
- Brain: `constraints.invariants.general` (facts d291174f, a967cab7), `project.privacy.studentdata` (fact 1e19188a), `architecture.data.flow` (fact 34a7b238).
- Memory: project-altamyra.md (hard rules).
