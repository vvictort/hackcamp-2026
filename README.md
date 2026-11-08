# Altamyra

A living IEP for BC grade-school teachers.

In British Columbia, every student with an Individual Education Plan (IEP) needs adapted lessons, ongoing evidence of progress, and goal-based progress reports. Teachers do this by hand, after hours. Altamyra links each lesson to every student's IEP goals, collects progress evidence as teachers teach, and drafts the reports for the teacher to review.

Built at HackCamp 2026.

## What it does

Nine modules connect the plan, the teaching, the evidence and the report:

| Module | Purpose |
| --- | --- |
| Student Profile | Each IEP structured like the BC Competency-Based IEP; never overwritten |
| Lesson Lens | Suggested adaptations per student for a lesson, tagged to the IEP goal they serve |
| Adapt/Modify Guardrail | Labels every suggestion as an adaptation or a modification, with a warning on modifications |
| Pulse | A tap or voice note after class, tagged to IEP goals |
| Progress Drafts | Goal-by-goal reports drafted from evidence, every sentence linked to its source |
| Team and Today View | A shared timeline, and a one-page plan for EAs and substitutes (QR code, no login) |
| Transition Handoff | An end-of-term summary for the next classroom |
| Family Bridge | Plain-language summaries in the family's home language, sent only after approval |
| District Insights | Anonymized goal-progress trends; small groups are never shown |

Who uses it: classroom teachers (primary), resource/case-manager teachers, education assistants, substitutes, families (read-only) and district inclusive-education leads. Students have no screen in v1.

### Principles the product holds to

- The AI suggests; a person approves every change, family message and report.
- MyEducation BC stays the legal IEP record. Altamyra is the working layer around it.
- Student names are removed before anything reaches an AI model.
- Data is stored in Canada. No real student data before district privacy approval.
- Accessible by default: Atkinson Hyperlegible, WCAG 2.2 AA, status shown by icon and word, never colour alone.

### Current state

Working in the app today: the landing page, sign-in and sign-up, the teacher dashboard (today's schedule, suggestions to review, Pulse progress, progress drafts, coming up), and Settings (profile, school, position, preferences). The dashboard runs on **example data with fictional students** (`src/components/altamira/exampleData.ts`). The module features themselves are designed and described on the landing page but are not wired to real data yet. Every page reads its text through the language system, with a language picker on the landing page, auth pages, dashboard and Settings.

## Tech stack

- **Platform:** [DeepSpace](https://docs.deep.space) SDK (`deepspace`), a real-time collaborative app framework on Cloudflare Workers with auth, record storage, server actions and one-command deploys
- **Frontend:** React 19, TypeScript, Vite, React Router 7 with file-based routes (Generouted)
- **Styling:** Tailwind CSS v4 with design tokens in `src/styles.css`; Base UI primitives; `class-variance-authority` and `tailwind-merge`; `lucide-react` icons; Atkinson Hyperlegible font
- **Backend:** a Cloudflare Worker (`worker.ts`) using Hono, with Durable Objects for record rooms
- **AI and integrations:** DeepSpace's integration proxy (Claude, used for translation); the Vercel AI SDK for the in-app agent
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
      home.tsx              Teacher dashboard
      sign-in.tsx, sign-up.tsx
      (protected)/          Routes that require sign-in (Settings, API status)
  components/
    ui/                   Design-system primitives (Button, Card, Select, Progress, ...)
    auth/                 Sign-in and sign-up building blocks
    altamira/             Example data for the dashboard
    Navigation.tsx, LogoMark.tsx, Seo.tsx, ErrorScreen.tsx
  i18n/                 Language provider, t() helper, language list, English strings
  lib/                  Small shared utilities
  schemas.ts, schemas/  Collection schemas and permissions (shared by worker and app)
  actions/              Server actions (privileged worker functions)
  server/               Backend modules: HTTP, realtime and action routes, i18n route,
                        AI agent and tools, integrations billing, jobs
```

Backend and frontend split: the backend is `worker.ts`, `src/server/**`, `src/actions/` and `src/cron.ts`; the shared layer is `src/schemas*`; everything else under `src/` is frontend.

## Getting started

```sh
npm install
npx deepspace auth login    # authenticate with app.space
npm run dev                 # local dev server (vite + miniflare)
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
