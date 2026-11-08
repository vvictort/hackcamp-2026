# 0001. Student names never reach an AI model

Status: accepted, 2026-11-07

## Context
Altamyra works with IEP goals for named students. Lesson Lens sends lesson and goal text to an outside AI agent. The product rules say names never reach the model, and the pilot uses fictional or de-identified data only.

## Decision
The `lessonLensSuggest` server action builds a de-identified request on the server (`src/actions/lesson-lens-core.ts`):
- each student becomes "Student A", "Student B" (then AA, AB for big rosters);
- names are scrubbed from goal text and pasted lesson details, ignoring accents, case and hyphens;
- goal ids become `g1`, `g2`, because real ids such as `kai-r` contain first names;
- the teacher id is sent as a SHA-256 hash.
Names and real ids are put back only inside the app, after the reply is validated. Feedback sent to the agent is scrubbed the same way.

## Consequences
- The agent never needs, and never sees, real identities.
- The pure half (`lesson-lens-core.ts`) has no network code, so the privacy rules are unit-tested in `lesson-lens-core.test.ts`.
- Any new AI feature must follow the same rule (see also 0010 for translation). The `/api/v1` backend added later has its own de-identification in `src/server/altamyra/ai/deidentify.ts`, which refuses the AI call if it fails (374dd12).

## Evidence
- Commits: 3f002ad (de-identified server actions), 6210da6 (agent).
- Brain: `constraints.invariants.general` (facts d291174f, a967cab7), `project.privacy.studentdata` (fact 1e19188a), `architecture.data.flow` (fact 34a7b238).
- Memory: project-altamyra.md (hard rules).
