# 0005. Backend/frontend layout inside one DeepSpace app

Status: accepted, 2026-11-07

## Context
We considered a separate Vite React `frontend/` with DeepSpace as backend only. The DeepSpace React auth SDK uses `window.location.origin` and a relative `/api/auth/token`, so it only signs users in from the same origin. Live-data hooks and collection permissions rely on it too. DeepSpace's deploy and add commands also look for files at fixed paths.

## Decision
One DeepSpace full-stack app at the repo root:
- backend: `worker.ts`, `src/server/**`, `src/cron.ts`;
- shared: `src/schemas.ts` and `src/schemas/`;
- frontend: the rest of `src/`.
No top-level `server/` or `client/` folders.

## Consequences
- Auth and live data work with no custom PKCE flow.
- The split is by convention, not by folder, so agents must know it (README and Brain both state it).
- Revisit only if a separate frontend becomes mandatory. It would then need DeepSpace's native PKCE auth flow.

## Evidence
- Commits: fe14eeb (remove frontend scaffold), 9f9bb74 (restructure to DeepSpace), 9fcc7be (split backend into `src/server`).
- Brain: `project.architecture.layout` (fact 02cd0609), `architecture.boundaries.rationale` (facts c4838562, a0defaf9, 30d7a70b).
