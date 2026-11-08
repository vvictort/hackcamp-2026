# 0002. MyEducation BC stays the legal IEP record; the AI suggests and a teacher approves

Status: accepted, 2026-11-07

## Context
BC IEPs are kept in MyEducation BC. Altamyra drafts adaptations and reports with AI help. The team's product analysis set hard rules: the AI never edits an IEP, contacts families or files a report without a person approving.

## Decision
- Altamyra is a working layer around MyEducation BC, not a replacement. The landing page and FAQ say so.
- AI output is saved as a suggestion, never applied. Lesson Lens rows are stored as `pending`; the teacher approves or rejects each one (`lessonLensFeedback` accepts only `approved` or `rejected`).
- Approving a modification asks for confirmation first, because it changes the learning outcome.
- No autonomous AI actions and no student-facing screens in v1.

## Consequences
- Every new module (Progress Drafts, Family Bridge) needs an approval step before anything leaves the teacher.
- Altamyra does not write back to MyEducation BC. Team belief: an integration would need district approval; this is not verified.

## Evidence
- Commits: 3f002ad (approve/reject on the dashboard), 490a3c3 (README principles).
- Code: `src/server/altamyra/routes/lesson-plans.ts`, `src/i18n/en/landing.ts` (`landing.control.p5`, `landing.faq.q1`).
- Brain: `project.product.rules` (fact 6b9a4e69).
- Memory: project-altamyra.md (hard rules).
