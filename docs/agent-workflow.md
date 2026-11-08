# Agent workflow

How coding agents and teammates work in this repository. Altamyra was built by several Claude Code agents working in parallel, with Entire keeping their sessions, code map and shared memory connected. The full operating guide for agents is `.entire/agent-guide.md`; this page is the short version.

Sources: the repository [README](../README.md), `.entire/agent-guide.md`, `package.json`, and team decisions recorded in Entire Brain. Every command below was checked against `entire agent-help`, `entire brain <command> --help` or `entire graph <command> --help`.

## 1. Before you start a task

Run both, in this order. Neither replaces the other.

```sh
entire brain brief "<task>" --json
entire graph query --repo . --profile full --head --format agent --max-context-bytes 4096 --query "<task>"
```

The brief answers why and what was decided. The graph query answers where the code is and what depends on it.

For past decisions or rejected approaches, ask Brain directly:

```sh
entire brain recall "<question>" --json
```

## 2. Before you edit shared code

Check the blast radius of any function or type you change:

```sh
entire graph impact --repo . --head --max-context-bytes 4096 --symbol <Name>
```

Use `entire graph def` (what a symbol is) and `entire graph neighbors --direction in` (its callers) for other code questions. Use grep only for literal strings, config keys, environment variable names and file names. Drop `--head` only when the answer depends on uncommitted edits.

## 3. After you make a decision

Record anything durable that the code does not already say, with a kind and a path:

```sh
entire brain remember "<decision>" --kind decision --path project.<area>.<name> --agent none
```

- Kinds: `decision`, `invariant`, `gotcha`, `preference`, `convention`.
- Path categories: `architecture`, `constraints`, `preferences`, `project`, `workflow`.
- `--path` sets where the memory is filed. `--agent none` turns off agent classification, which would otherwise cost tokens.
- Paths are three levels with no hyphens.

A memory one teammate records syncs to everyone through Brain.

## 4. Committing

- Commit only your own paths: `git add <paths>`, never `git add -A`. Several agents may share one clone.
- When parallel subagents share a worktree, they do not commit themselves. The orchestrating session checks each group's files and commits them with explicit paths, so agents never race on git or sweep up each other's half-written files.
- No `Co-authored-by` trailer or other AI attribution in commit messages.
- Push only when asked.
- One dev server per clone (`npm run dev`, on port 5173). A second server, including a preview server, shares the same `.wrangler` local-data folder and can crash the first.

## 5. Secrets

App settings and secrets go in the DeepSpace secret store, never in `.dev.vars`:

```sh
npx deepspace secrets set KEY=value
printf %s "$VALUE" | npx deepspace secrets set KEY --stdin   # for secret values
npx deepspace secrets list                                  # shows values masked
```

DeepSpace rewrites `.dev.vars` on every dev, test and deploy run, so anything added there by hand disappears. Restart the dev server after changing a secret. Never commit or print a secret value. The Lesson Lens agent's Gemini key lives in its Maritime environment. The `/api/v1` backend can also read an optional `GEMINI_API_KEY` from the secret store; without it, its AI features use a built-in fixture provider.

## 6. Data and prompts

- Use fictional or de-identified student data only, in code, tests, fixtures, screenshots and docs.
- Never paste real student information or any secret into an agent prompt. Entire captures sessions, and redaction is best effort: it covers email, phone and the rules in `.entire/redactors/altamyra.yaml` (BC student PEN, Maritime and Google key formats, DeepSpace secret lines), and only for checkpoints written after it was turned on.
- Student names never reach an AI model. Follow the existing de-identification in `src/actions/lesson-lens.ts` for any new AI call.

## 7. Checkpoints stay local

This repository is public, and checkpoints currently sync to the public origin. So:

- The checkpoint push policy stays `manual` (`entire configure --checkpoint-push-policy manual`). Do not switch it to automatic.
- Nothing is pushed with `entire checkpoint push` until a private checkpoint remote exists (set with `entire configure --checkpoint-remote github:<owner>/<private-repo>`) and `entire status` shows it as the sync target.
- `entire import <agent>` (bringing your past sessions in) is fine because it stays local, but only after redaction is on (`.entire/settings.json` and `.entire/redactors/`). Imported and older checkpoints may still hold emails or paths, so never publish them.

## 8. Parallel agents

- Split work so each agent owns different files. Two agents never edit the same file.
- Each piece gets an independent reviewer: a different agent or a teammate checks the work before it is committed.

## 9. Before you push

```sh
npm run validate      # tsc --noEmit, then vitest
node --test agent/    # Lesson Lens agent tests
```

Run `npm run lint` and the Playwright suites (`npm run test`) when your change touches the areas they cover.
