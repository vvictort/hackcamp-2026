# Lesson Lens agent (Maritime)

A small Node 22 server, with no dependencies, that Altamyra calls to get Lesson Lens suggestions.
It runs on [Maritime](https://maritime.sh) as a custom container.

- `GET /health` returns `200`.
- `POST /chat` takes `{ "message": "<JSON string>" }` and replies with `{ "response": "..." }` well inside Maritime's 30 s limit.
  - `{"task":"lesson-lens", ...}` returns a JSON string `{ "suggestions": [...], "source": "gemini" | "rules" }`. There are at most 2 suggestions per student, `text` and `why` are at most 300 characters, and `kind` is `modification` only when the learning outcome changes.
  - `{"task":"feedback", ...}` returns `ok` and stores the decision in `$DATA_DIR/<teacher>.json` (the 50 most recent). The latest approved and rejected items go to Gemini as examples on that teacher's next lesson-lens call.
- It calls Gemini over REST (`GEMINI_API_KEY`, `GEMINI_MODEL`, default `gemini-2.5-flash`) with a 20 s timeout. With no key, or if the call fails, a keyword rules engine answers with `source: "rules"`.
- If `AGENT_TOKEN` is set, `/chat` needs `Authorization: Bearer <AGENT_TOKEN>`. `/health` stays open.
- Privacy: it only sees pseudonyms ("Student A") and an opaque teacher hash. The app keeps names, ids and emails to itself. The server never logs request bodies, the token or the key.

| Env | Default | Notes |
| --- | --- | --- |
| `PORT` | `8080` | Maritime injects it. Do not set it there. |
| `DATA_DIR` | `/data` | Maritime keeps `/data` across sleep, restart and redeploy. |
| `AGENT_TOKEN` | unset | Secret. |
| `GEMINI_API_KEY` | unset | Secret. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Google has deprecated it: new keys may get a 404 (the agent then answers with `rules`), and from 1 December 2026 it routes to `gemini-3.5-flash-lite`. Set a current model here if `source` stays `rules`. |

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

```bash
# 3. Secrets: set after create, never in the repo
maritime env set altamyra-lesson-lens GEMINI_API_KEY=<key> AGENT_TOKEN=<long random string> --reload --json

# 4. Public URL: https://<agent-id>.mtm.sh/ (shown as URL on the agent's Overview)
maritime status altamyra-lesson-lens --json     # wait for "status": "active"; note the id
maritime info altamyra-lesson-lens --json
maritime agents url visibility <agent-id> public   # only if you did not pass --public at create

# 5. Check it
curl -s https://<agent-id>.mtm.sh/health
maritime logs altamyra-lesson-lens --json
maritime history altamyra-lesson-lens --json    # build failures (buildLog)
```

The app's worker then calls `POST https://<agent-id>.mtm.sh/chat` with `Authorization: Bearer <AGENT_TOKEN>`.

Notes:

- `maritime chat altamyra-lesson-lens ...` and `POST https://api.maritime.sh/api/agents/<id>/chat` reach `/chat` through Maritime, which authenticates with your `mk_` key. They do not send `AGENT_TOKEN`, so with the token set they get `401`. Test with curl on the public URL instead. Or leave `AGENT_TOKEN` unset and use only the private API route.
- The image runs as the non-root `node` user. If feedback saves fail with `internal error: EACCES` in the logs, `/data` is not writable for that user. Check with `maritime exec <agent-id> --body-json '{"command":"ls -ld /data"}' --json`.
