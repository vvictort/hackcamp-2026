# Altamyra

A living IEP for designated students in BC public schools, who always have an education assistant (EA).

Teachers and EAs adapt every lesson to each student's IEP goals and keep a daily record of progress, mostly after hours. Altamyra turns that into one short daily loop and drafts the summaries, so people only review and approve.

Built at HackCamp 2026.

## The daily loop

1. The **teacher** uploads the lesson plan, reviews the proposed changes per student (Lesson Lens) and approves the tailored lesson plan.
2. The **EA** sees the approved plan for each assigned child on opening the app.
3. The EA teaches. During the day the EA (and the teacher if needed) captures observations: photographed coded sheets, video, typed notes and events (prompt levels, counters, timers, voice notes). Each AI-scored capture is confirmed or corrected by whoever made it.
4. At the end of the day the EA goes through each child they helped, one by one, in a short **End of day review** that completes that day's record.

### Summaries

| Summary | Audience |
| --- | --- |
| Daily | EA and teacher |
| Weekly | Case manager (whole caseload) |
| Monthly | Parent or guardian (in the family's language, with audio) and district lead (anonymized aggregates, groups under 10 hidden) |

Only the EA and the teacher can view drafts, edit and approve summaries. The EA or the teacher approves the monthly summary. No other role edits any summary.

**AI approval rule:** anything written or edited by AI (proposed lesson changes, tailored plans, AI-scored captures, summaries, translations, audio scripts) is a draft that only the EA or teacher sees until one of them approves it. The backend enforces this, not just the screens.

### IEP change tickets

The case manager imports an IEP and confirms its measurable objectives. Later changes go through a change ticket the case manager submits. The school administrator reviews it and applies or declines it.

### Roles

- **EA** (assigned students): full IEP, original / proposed / tailored lesson plans, capture, end-of-day review, progress timeline, monthly approval.
- **Teacher** (own classes): the same, plus add and edit lesson plans, and a flag for students without a plan today.
- **Case manager** (caseload): import and view IEPs, submit change tickets, view lesson plans and progress, weekly summary.
- **Parent or guardian** (own child): the monthly summary, and consent for voice notes and videos.
- **District lead**: the monthly anonymized district summary only.
- **School administrator**: reviews IEP change tickets and assigns roles.

### Principles the product holds to

- The AI suggests; an EA or teacher approves before anyone else sees it.
- MyEducation BC stays the legal IEP record. Altamyra is the working layer around it.
- Student names are removed before anything reaches an AI model.
- Data is stored in Canada. No real student data before district privacy approval.
- Accessible by default: Atkinson Hyperlegible, WCAG 2.2 AA, status shown by icon and word, never colour alone.

### Current state

Everything runs in a local demo on fictional data only. **Settings** (profile, preferences, text size, signed-in devices) and **36 interface languages** are available to every role. Lesson Lens is powered by an AI agent on Maritime (see [Lesson Lens on Maritime](#lesson-lens-on-maritime)).

## Tech stack

- **Platform:** [DeepSpace](https://docs.deep.space) SDK (`deepspace`), a real-time collaborative app framework on Cloudflare Workers with auth, record storage, server actions and one-command deploys
- **Frontend:** React 19, TypeScript, Vite, React Router 7 with file-based routes (Generouted)
- **Styling:** Tailwind CSS v4 with design tokens in `src/styles.css`; Base UI primitives; `class-variance-authority` and `tailwind-merge`; `lucide-react` icons; Atkinson Hyperlegible font
- **Backend:** a Cloudflare Worker (`worker.ts`) using Hono, with Durable Objects for record rooms
- **AI and integrations:** DeepSpace's integration proxy (Claude, used for translation); the Vercel AI SDK for the in-app agent
- **Lesson Lens agent:** a zero-dependency Node service on [Maritime](https://maritime.sh) calling Google Gemini (see [Lesson Lens on Maritime](#lesson-lens-on-maritime))
- **Motion:** plain CSS and Tailwind only (shared timing tokens, no animation libraries), plus Lenis for smooth scrolling; everything is off under `prefers-reduced-motion`
- **Languages:** 36 interface languages, machine-translated on first use and cached (see [Languages](#languages))
- **Testing and tooling:** Vitest (unit), Playwright (smoke, API and end-to-end), ESLint, `tsc`
- **Agent workflow:** [Entire](https://docs.entire.com) for session capture, a code graph and shared project memory (see [Built with agents](#built-with-agents-entire))

## How the project is organized

```
worker.ts               Worker entry: registers routes and Durable Objects
wrangler.toml           Cloudflare config
prerender.ts            Build-time prerender of the static landing page
public/                 Static assets (favicon, images, illustrations)
tests/                  Playwright suites (smoke, api, collab)
agent/                  Lesson Lens AI agent deployed on Maritime (Node, Gemini; own README)
.entire/                Entire config and the agent guide (Graph and Brain)
src/
  main.tsx              App entry
  constants.ts          App name and other constants
  nav.ts                Navigation items
  seo.ts                Page metadata
  styles.css            Design tokens, motion utilities, base styles
  pages/                File-based routes
    index.tsx             Landing page (static, prerendered, no providers)
    _app.tsx              Root shell
    (app)/                Dynamic app routes (mounts auth and data providers)
      home.tsx              Role home
      sign-in.tsx, sign-up.tsx
      (protected)/          Routes that require sign-in (Settings, API status)
  components/
    ui/                   Design-system primitives (Button, Card, Select, Progress, ...)
    auth/                 Sign-in and sign-up building blocks
    altamira/             Example data for the dashboard
    Navigation.tsx, LogoMark.tsx, Seo.tsx, ErrorScreen.tsx
  i18n/                 Language provider, t() helper, language list, English strings
  lib/                  Shared hooks and utilities (classroom data, Lesson Lens, sessions, positions)
  schemas.ts, schemas/  Collection schemas and permissions (shared by worker and app)
  actions/              Server actions (Lesson Lens: de-identify, call the agent, save suggestions)
  server/               Backend modules: HTTP, realtime and action routes, i18n route,
                        AI agent and tools, integrations billing, jobs
```

Backend and frontend split: the backend is `worker.ts`, `src/server/**`, `src/actions/` and `src/cron.ts`; the shared layer is `src/schemas*`; everything else under `src/` is frontend.

## Run locally

```sh
npm ci
npx deepspace login
```

Create a secrets config named `avi-local` (any name works; use it with `--secrets-config`). Set `ALTAMIRA_DEV_SEED=true`. `GEMINI_API_KEY`, `MARITIME_AGENT_URL` and `MARITIME_AGENT_TOKEN` are optional: without a Gemini key the AI features use the built-in fixture provider. Never commit or print secret values, and do not edit `.dev.vars` (`deepspace dev` rewrites it from the secret store).

```sh
npx deepspace dev start --host 127.0.0.1 --port 5173 --secrets-config avi-local
```

Open http://127.0.0.1:5173, sign in, then on Home press **Load demo data** (a fictional school, three students, IEPs, lesson plans and progress data). Use **Act as** to switch between EA, teacher, case manager, parent/guardian, district lead and school administrator; the navigation and the data follow the role.

Demo data is dated relative to the moment you press the button, so the demo has a current day's plans, captures and progress on any day. Pressing **Load demo data** a second time answers "already seeded". To start over, use **Reset demo data** on Home (with a confirm dialog): it wipes the demo rows and loads them again dated from today. The API call is `POST /api/v1/dev/seed` with `{"reset": true}`.

**Run full demo day** (same panel) adds one new fictional student (grade 3, autism, full-time EA, Punjabi-speaking family; the IEP is `docs/demo/sample-iep-sd23.txt`) and runs a whole school day through the real `/api/v1` routes, acting as the parent, case manager, teacher, EA, school administrator and district lead in turn: consent, IEP import and objective confirmation, a tailored lesson plan, EA capture and end of day review, daily, weekly and monthly summaries with the approval rule checked, an IEP change ticket, and the district view. It uses live Gemini when `GEMINI_API_KEY` is set and the fixture provider otherwise, takes up to a minute with live AI, and lists each step with a link to the page that shows its result. A failed step is shown and the rest still run. Each press adds another student. The API call is `POST /api/v1/dev/demo-day`.

The demo controls (Load and Reset demo data, Run full demo day, **Act as**) and the `/api/v1/dev/*` routes exist only when `ALTAMIRA_DEV_SEED=true` in the secrets config. They answer 404 otherwise, and the flag must never be set in a deploy.

### Daily demo flow

1. **Act as** teacher. Home shows today's lesson plans and the students with no plan yet. Upload a lesson plan for a student.
2. Review the proposed changes and approve the tailored plan. Until approved it is a draft that only the teacher and EA see. Creating a plan for a student who already has today's plan opens it for editing instead (409 "Edit it instead").
3. **Act as** EA. Home shows the approved plan for each assigned child.
4. Open **Capture** and add a typed note, an event, a coded-sheet photo or a video. Confirm or correct the AI score.
5. Press **End of day review** and go through each child you helped, one by one.
6. Open **Summaries** and approve the daily summary (the teacher or EA can edit it first).
7. Approve the monthly summary, then **Act as** parent/guardian. The family page shows the approved monthly summary in Spanish with audio. Drafts never reach the parent.

Accessibility check (axe-core on each role's screens: EA and teacher Home, Students, a student, Capture, Progress, Summaries and End of day; case manager Home, Students, Progress and Summaries; parent Family; district lead Insights; school administrator Change tickets and Roles. It switches roles with the dev role switch and fails on serious or critical issues). It needs one test account (`npx deepspace test accounts list`; create one with `npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" --password-stdin`) and the `avi-local` secrets config so the demo seed is available:

```sh
npx deepspace test run tests/a11y/axe.spec.ts --port 5197 --secrets-config avi-local
```

Other commands:

```sh
npm run build        # production build and prerender
npm run type-check   # tsc --noEmit
npm run lint         # eslint
npm run test:unit    # vitest
npm run test         # Playwright suites via deepspace
npx deepspace deploy # deploy to <app>.app.space
```

Version control lives in the app's DeepSpace cloud repo by default (`npx deepspace push`). Commit before you deploy.

## Working on this project together

Each teammate works in their own clone with their own Claude Code (or another coding agent). Setup, once per person:

**1. GitHub** (repo owner adds you as a collaborator on `vvictort/hackcamp-2026`). Entire's mirror access follows these permissions too.

```sh
git clone git@github.com:vvictort/hackcamp-2026.git && cd hackcamp-2026 && npm install
```

**2. DeepSpace app** (repo owner adds you; this is also what gives you Lesson Lens):

```sh
npx deepspace app collaborators add teammate@example.com        # owner runs this
npx deepspace app collaborators invites                          # teammate: list, then accept the invite
npx deepspace auth login && npm run dev                          # teammate: secrets load automatically
```

`npm run dev` pulls the app's secrets, including `MARITIME_AGENT_URL` and `MARITIME_AGENT_TOKEN`, so
**Get suggestions** works locally without a Maritime account. Collaborators get owner-level access: they can
read every app secret in plain text and deploy to the live URL (billed to the owner), so only add people you trust.

**3. Entire**: follow [Set up Entire](#set-up-entire-each-teammate-once) below, then restart Claude Code. Your
sessions are captured on your machine and linked to your commits; your agent reads the shared project rules
from Brain (`entire brain brief "<task>"`) and the routine in `.entire/agent-guide.md`. A rule anyone adds with
`entire brain remember` syncs to everyone.

**4. Maritime**: nothing to set up. The Lesson Lens agent runs in the owner's Maritime account, and the app
reaches it through the shared secrets from step 2. To change the agent, edit `agent/`, test it locally
(`node --test agent/`, or `PORT=8799 node agent/server.mjs`), push, and ask the owner to redeploy
(steps in [agent/README.md](agent/README.md)). Your own Maritime account is only needed to run a separate copy.

House rules for every teammate and every agent (they are also in Entire Brain):

- Use fictional or de-identified student data only. Never paste real student information or any secret into an agent prompt: sessions are recorded.
- App settings go in `npx deepspace secrets set KEY=value`, never in `.dev.vars` (DeepSpace rewrites it on every run). Then restart the dev server.
- Several agents may share a clone: commit only your own files (`git add <paths>`, not `git add -A`), keep one dev server per clone, and commit without a `Co-authored-by` trailer.
- Keep Entire's checkpoint push policy on `manual`: this repository is public.
- `CLAUDE.md` and `AGENTS.md` are git-ignored, so each clone has its own. The shared rules live in Entire Brain and `.entire/agent-guide.md`.

## Lesson Lens on Maritime

Lesson Lens suggestions come from an AI agent hosted on [Maritime](https://maritime.sh) (`agent/`), a small
Node server that calls Google Gemini (`gemini-3.5-flash-lite`) and falls back to a rules engine if Gemini is
unavailable. Each teacher's approvals and rejections are kept in the agent's persistent `/data` and used as
examples next time, so suggestions adapt to the teacher.

How it fits together:

1. On the dashboard, a teacher clicks **Get suggestions** on a class in Today (optionally pasting lesson details).
2. The `lessonLensSuggest` server action (`src/actions/lesson-lens.ts`) loads that teacher's own class and
   students on the server, replaces every student name with "Student A, B…" (accent-, case- and
   hyphen-insensitive, also inside pasted text), sends goal ids as `g1, g2…`, and hashes the teacher id.
3. It calls Maritime's chat API (`POST https://api.maritime.sh/api/agents/<id>/chat`) with a `deploy`-scoped key.
4. The reply is validated strictly (known students and goals only, `adaptation` or `modification`, length
   limits), names are put back inside the app, and suggestions are saved as pending.
5. The teacher approves or rejects each one in the Lesson Lens card. Approving a **modification** asks for
   confirmation first, because it changes the learning outcome. Decisions are sent back to the agent (names removed).

Configuration lives in DeepSpace's secret store, which `npm run dev` and deploys both read. Don't edit
`.dev.vars`: DeepSpace regenerates it on every dev, test and deploy run. Restart the dev server after changing:

```sh
npx deepspace secrets set MARITIME_AGENT_URL=https://api.maritime.sh/api/agents/<agent-id>
read -rs MK && printf %s "$MK" | npx deepspace secrets set MARITIME_AGENT_TOKEN --stdin; unset MK   # mk_ key, deploy scope
```

Without them, **Get suggestions** shows "Lesson Lens isn't connected yet." Deploying and testing the agent:
see [agent/README.md](agent/README.md).

## Built with agents: Entire

Altamyra was built by several Claude Code agents working in parallel. [Entire](https://docs.entire.com) keeps their work connected:

- **Sessions:** each Claude Code session in this repo is captured as a checkpoint and linked to its commit (the `Entire-Checkpoint:` trailer). Transcripts stay on the developer's machine: the checkpoint push policy is `manual`, because this repository is public. Review a checkpoint with `entire checkpoint explain` before publishing it with `entire checkpoint push`.
- **Graph:** a code map agents query before editing (`entire graph query ...`).
- **Brain:** shared project memory synced through entire.com. It holds the rules every agent follows: product rules, privacy (fictional data only, names removed before any AI), the brand coming from `APP_NAME`, the design system, accessibility, motion, the backend/frontend layout and the git process. Agents read it with `entire brain brief "<task>"`; add a rule with `entire brain remember "<rule>" --kind convention --path project.<area>.<name> --agent none`.
- **Agent guide:** `.entire/agent-guide.md` tells every coding agent to run `brain brief` and `graph query` before working.

The repository is mirrored on entire.com (`entire` remote); GitHub stays `origin`.

### Set up Entire (each teammate, once)

You need to be a collaborator on the GitHub repository.

```sh
curl -fsSL https://entire.com/install.sh | bash      # macOS: brew install --cask entireio/tap/entire
entire login                                          # use the same provider as your Entire account
# WSL/Linux without a keyring: echo '{"token_store": "file"}' > ~/.config/entire/config.json, then log in again
entire enable -y --agent claude-code                  # or codex, cursor, copilot-cli, opencode
entire configure --checkpoint-push-policy manual      # keep transcripts off the public repo
entire repo remote add entire --cluster aws-us-east-2.entire.io && git fetch entire
entire plugin install graph && entire graph setup
entire plugin install brain && entire brain setup && entire brain connect   # answer no to backfill
```

The first commit after `entire enable` may ask to link it to session context: answer `a` (always). Restart Claude Code afterwards so capture covers the session.

## Languages

The interface shows in 36 languages, chosen from a language picker. English text lives in `src/i18n/en.ts`; other languages are translated automatically the first time someone picks them and cached in the `settings` collection. Only that fixed English catalogue is ever sent to the model, never student names or any record data. To add a language, add one line to `src/i18n/languages.ts`. To add text, add a key to `src/i18n/en.ts` and use `t('key')`.

## Design

Ink-first and light only: a soft grey canvas, white and near-black cards, big tightly tracked headings, one violet accent used sparingly, and no decorative dots. Tokens and shape rules are documented at the top of `src/styles.css`. Reusable pieces live in `src/components/ui`; use them instead of hand-rolling cards and buttons.
