# 0003. Lesson Lens agent runs on Maritime with a Gemini lite model and a rules fallback

Status: accepted, 2026-11-07

## Context
Lesson Lens needs an AI agent that keeps per-teacher memory of approvals and rejections. We wanted the Gemini key kept out of the DeepSpace app.

## Decision
- The agent is a zero-dependency Node server in `agent/` (Dockerfile, `/health`, `/chat`), hosted on Maritime, with per-teacher memory in its persistent `/data`.
- The app reaches it through Maritime's chat API: `MARITIME_AGENT_URL=https://api.maritime.sh/api/agents/<id>`, and the app POSTs to `<URL>/chat` with a Maritime key as the bearer token. Maritime keys have no `chat` scope; chat needs the `deploy` scope.
- The agent's own `AGENT_TOKEN` stays unset, because Maritime's chat proxy does not forward custom bearer headers (it returned 401). The agent has no public port, so the Maritime key is the only way in.
- Model: `gemini-3.5-flash-lite` with a 20 s budget. `gemini-2.5-flash` returned 404 for new keys; `gemini-3.8-flash` took about 38 s on a trivial call, over the 20 s budget and Maritime's 30 s chat limit, and rejected the "minimal" thinking level.
- If Gemini fails or has no key, a keyword rules engine answers with `source: "rules"`.

## Consequences
- The Lesson Lens Gemini key lives only in the agent's Maritime env, never in the repo.
- Later change: the `/api/v1` backend gained its own optional Gemini provider, which reads `GEMINI_API_KEY` from the app's secret store (d32ba58). Lesson Lens itself still goes through Maritime.
- If `source` stays `rules`, check the model first.
- Teammates need no Maritime account; agent redeploys go through the owner.

## Evidence
- Commits: 6210da6, 3f002ad, 8e25999 (2.5 returns 404), 05b78e8 (3.5-flash-lite), ce8f092, 7233fb5.
- Code: `agent/server.mjs`, `agent/README.md`, `src/actions/lesson-lens.ts`.
- Brain: `architecture.boundaries.rationale` (facts ee32da02, 1c54c98c), `architecture.data.flow` (fact 42b215c9), `project.tooling.stack` (facts 513a61f8, d1b96ffa).
