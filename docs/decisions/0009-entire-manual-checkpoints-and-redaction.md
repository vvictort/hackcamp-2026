# 0009. Entire with a manual checkpoint push policy and redaction

Status: accepted, 2026-11-07

## Context
Several Claude Code agents build Altamyra in parallel. Entire captures each session as a checkpoint, maps the code (Graph) and keeps shared project memory (Brain). The GitHub repository is public, so checkpoints pushed with git would publish full session transcripts.

## Decision
- Entire is enabled for Claude Code session capture.
- The checkpoint push policy is `manual`. A checkpoint is published only on purpose, after review with `entire checkpoint explain`. Brain also says not to push any until checkpoints point at a private remote. No `entire import` into this repo.
- Redaction is on: PII (email, phone) in `.entire/settings.json`, plus the rule pack `.entire/redactors/altamyra.yaml` (BC student PEN, Maritime and Google key shapes, DeepSpace secret lines).

## Consequences
- Transcripts stay on each developer's machine by default.
- Redaction applies only to checkpoints written after it was turned on (2026-11-07 23:12); older ones may still hold email addresses.
- Every teammate sets the manual policy when setting up Entire (README).
- The push policy is a local setting, not in the committed `settings.json`, so it relies on each teammate's setup.

## Evidence
- Commits: 0c69031 (enable Entire), a029c35, 51ad8c0, 6cd335d (redaction and rule pack).
- Brain: `workflow.branching.rules` (facts 3bc76b4b, 2675f402), `project.privacy.checkpoints` (fact 93390ecd), `constraints.invariants.general` (fact e43109f5).
