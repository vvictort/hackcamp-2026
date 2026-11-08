# Lesson Lens agent (Maritime)

A small Node 22 server, with no dependencies, that Altamyra calls to get Lesson Lens suggestions.
It runs on [Maritime](https://maritime.sh) as a custom container.

- `GET /health` returns `200`.
- `POST /chat` takes `{ "message": "<JSON string>" }` and replies with `{ "response": "..." }` well inside Maritime's 30 s limit.
  - `{"task":"lesson-lens", ...}` returns a JSON string `{ "suggestions": [...], "source": "gemini" | "rules" }`. There are at most 2 suggestions per student, `text` and `why` are at most 300 characters, and `kind` is `modification` only when the learning outcome changes.
  - Optional `"language"` in a lesson-lens request is a plain language name such as `"French"` or `"Punjabi (Gurmukhi)"`. Gemini then writes `text` and `why` in that language; `studentKey`, `goalId` and `kind` are never translated. Anything that is not a plain name is ignored (English). The keyword fallback always answers in English.
  - `{"task":"feedback", ...}` returns `ok` and stores the decision in `$DATA_DIR/<teacher>.json` (the 50 most recent). The latest approved and rejected items go to Gemini as examples on that teacher's next lesson-lens call.
- It calls Gemini over REST (`GEMINI_API_KEY`, `GEMINI_MODEL`, default `gemini-3.5-flash-lite`) with a 20 s timeout. With no key, or if the call fails, a keyword rules engine answers with `source: "rules"`.
- Optional `AGENT_TOKEN`: if set, `/chat` needs `Authorization: Bearer <AGENT_TOKEN>` (`/health` stays open). Only for a self-hosted, publicly exposed copy; leave it unset on Maritime (see below).
- Privacy: it only sees pseudonyms ("Student A") and an opaque teacher hash. The app keeps names, ids and emails to itself. The server never logs request bodies, the token or the key.

| Env | Default | Notes |
| --- | --- | --- |
| `PORT` | `8080` | Maritime injects it. Do not set it there. |
| `DATA_DIR` | `/data` | Maritime keeps `/data` across sleep, restart and redeploy. |
| `AGENT_TOKEN` | unset | Secret. Leave unset on Maritime: its chat API does not forward it. |
| `GEMINI_API_KEY` | unset | Secret. |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | A fast lite model: Flash models that think first (for example `gemini-3.8-flash`) can exceed the 20 s budget, and `gemini-2.5-flash` returns 404 for new keys. Either way the agent silently answers with `rules`, so if `source` stays `rules`, check the model first. |

## Run and test locally

```bash
node --test agent/server.test.mjs

PORT=8799 DATA_DIR=/tmp/lesson-lens AGENT_TOKEN=dev-token node agent/server.mjs
curl -s localhost:8799/health
curl -s localhost:8799/chat -H 'Authorization: Bearer dev-token' -H 'content-type: application/json' \
  -d '{"message":"{\"task\":\"lesson-lens\",\"teacher\":\"t1\",\"subject\":\"Numeracy\",\"lesson\":\"Multiplication with arrays\",\"students\":[{\"key\":\"Student A\",\"goals\":[{\"id\":\"g1\",\"area\":\"Math (modified)\",\"text\":\"Count groups to 20 with cubes\",\"level\":\"Developing\"}]}]}"}'
```

Docker: `docker build -t lesson-lens agent && docker run -p 8080:8080 -e AGENT_TOKEN=dev-token lesson-lens`.

## Deploy on Maritime

These commands come from <https://maritime.sh/agents.md> and <https://maritime.sh/docs/cli/llms.txt>.
Run `maritime guide --json` or `maritime <command> --help` before using a flag not shown here.

```bash
# 1. Install the CLI and sign in (onboard covers sign-in, the API key and the free-trial card)
curl -fsSL https://maritime.sh/install.sh | sh     # or: npm install -g maritime-cli
maritime onboard --json                            # repeat with --wait --json until "step" is "done"
# (account already exists: maritime login --json)
```

Maritime builds the `Dockerfile` at the **repo root** and has no build-context option, but this one lives in `agent/`.
Pick one of these two ways to deploy it.

```bash
# 2a. Straight from this folder (the CLI's local-directory option). It zips the folder and builds
#     its Dockerfile; ZIP builds skip .dockerignore, which is fine because the image copies only server.mjs.
#     Run `maritime agents create --help` first: if it offers --framework, pass --framework custom.
maritime agents create --name altamyra-lesson-lens --from-dir ./agent

# 2b. Or from GitHub: push agent/ as its own branch so the Dockerfile sits at its root.
#     subtree split only sees committed files, so commit agent/ first.
git subtree split --prefix agent -b lesson-lens-agent
git push origin lesson-lens-agent
maritime create altamyra-lesson-lens --repo https://github.com/vvictort/hackcamp-2026 --branch lesson-lens-agent --public --json
# redeploy after changes: re-run the split and push, then
maritime deploy altamyra-lesson-lens --source github --repo https://github.com/vvictort/hackcamp-2026 --branch lesson-lens-agent --wait --json
```

What worked for Altamyra (2a, from the local folder). `agents create --from-dir` sets no exposed web
port, so the agent has no public URL: it is reached only through Maritime's chat API, which needs your
Maritime key. That makes `AGENT_TOKEN` unnecessary, and harmful: Maritime does not forward it, so with
it set every chat returns `{"error":"unauthorized"}`.

```bash
# 3. Secrets. Write them to a private file outside the repo, import, check, delete.
install -m 600 /dev/null ~/altamyra-agent.env && nano ~/altamyra-agent.env   # GEMINI_API_KEY=...
maritime env import altamyra-lesson-lens ~/altamyra-agent.env --json
maritime env set altamyra-lesson-lens GEMINI_MODEL=gemini-3.5-flash-lite --no-secret --json
maritime env list altamyra-lesson-lens --json && rm ~/altamyra-agent.env

# 4. Restart: the server reads its env at startup, so a "hot" env update is not enough.
maritime restart altamyra-lesson-lens --json
maritime status altamyra-lesson-lens --json      # wait for "active"; note the id

# 5. Test through Maritime (fictional data); expect "source":"gemini" in a few seconds
maritime agents chat <agent-id> --message '{"task":"lesson-lens","teacher":"demo0001","subject":"Numeracy","lesson":"Multiplication with arrays","students":[{"key":"Student A","goals":[{"id":"g1","area":"Math (modified)","text":"Count, compare and add groups to 20 with cubes","level":"Developing"}]}]}' --json

# 6. A key for the app: chat is in the `deploy` scope (shown once; store it with deepspace secrets set, below)
maritime keys create --name altamyra-app --scopes deploy --json
```

The app's worker calls `POST https://api.maritime.sh/api/agents/<agent-id>/chat` with
`Authorization: Bearer <mk_ key>`. Put both in the app's DeepSpace secret store (not `.dev.vars`, which
DeepSpace rewrites on every run), then restart the dev server:

```sh
npx deepspace secrets set MARITIME_AGENT_URL=https://api.maritime.sh/api/agents/<agent-id>
read -rs MK && printf %s "$MK" | npx deepspace secrets set MARITIME_AGENT_TOKEN --stdin; unset MK
```

Troubleshooting:

- `source` stays `rules`: check the model first. `gemini-2.5-flash` returns 404 for new keys, and thinking
  models such as `gemini-3.8-flash` took over 30 s (their thinking level can't be lowered to `minimal`).
- `maritime logs` shows platform events, not this server's output. To diagnose from inside the agent:
  `maritime exec <agent-id> --body-json '{"command":"..."}' --json` (print status codes only, never the key).
- The image runs as root on purpose: the owner of Maritime's `/data` mount isn't documented, and a non-root
  user could fail to save feedback. The agent runs alone in its own micro-VM.
- Redeploy code changes from this folder with `maritime agents upload-source` (see `--help`), or use the
  GitHub branch route in 2b.
