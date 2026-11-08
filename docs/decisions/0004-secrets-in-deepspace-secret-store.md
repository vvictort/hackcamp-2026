# 0004. App secrets live in the DeepSpace secret store, not .dev.vars

Status: accepted, 2026-11-07

## Context
We first put `MARITIME_AGENT_URL` and `MARITIME_AGENT_TOKEN` in `.dev.vars`. The DeepSpace CLI generates that file and rewrites it on every dev, test and deploy run, so a dev-server restart wiped the values and Lesson Lens showed "not connected".

## Decision
- App settings and secrets go in the DeepSpace secret store: `npx deepspace secrets set KEY=value`, or `--stdin` for secret values. Restart the dev server after a change.
- Never edit `.dev.vars` by hand.
- The Lesson Lens Gemini key is not an app secret: it lives in the Maritime agent's env (see 0003). Later, the `/api/v1` backend added an optional `GEMINI_API_KEY` app secret for its own AI provider (d32ba58).

## Consequences
- `npm run dev` and deploys read the same store, so teammates added as DeepSpace collaborators get working Lesson Lens with no setup.
- Collaborators can read every app secret in plain text, so only trusted people are added.
- Writing secrets is a person's action, not an agent's.

## Evidence
- Commits: 902838b (docs: Maritime settings go in the secret store), 5257379 (README setup).
- Brain: `project.config.secrets` (fact 3b4e40b1), `architecture.boundaries.rationale` (fact 1c54c98c).
- Memory: deepspace-secrets.md.
