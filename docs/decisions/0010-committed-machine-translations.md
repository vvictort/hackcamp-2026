# 0010. Translations: committed per-language files, machine-translated from a static catalogue

Status: accepted, 2026-11-07

## Context
The interface supports 36 languages (English plus 35). Live first-use translation took 13 to 70 seconds per language, so switching looked broken, and long scripts once failed with a 503. Whole-page translators (such as the Google Website Translator widget) would send student names on screen to an outside service.

## Decision
- A small custom i18n system in `src/i18n/` (no i18next). English text lives in `src/i18n/en/*.ts`, shown with `t('key')` or `<T>`.
- Other languages are machine-translated with Claude through `/api/i18n/:lang`. That route accepts no text: it translates only the static English catalogue, for listed language codes.
- `scripts/i18n-sync.mjs` writes `src/i18n/locales/<lang>.json`, and those files are committed, so languages load instantly. The live route is a fallback for stale or missing strings; missing keys fall back to English.
- Lesson Lens output is not run through the translator; the agent writes in the teacher's language (see 0003).

## Consequences
- After editing English text, run `npm run i18n:sync` and commit the locale files. A full run costs about 44 DeepSpace credits.
- Translations are not reviewed by native speakers. Assumption: quality is good enough for a pilot.

## Evidence
- Commits: 74c6f19, 691defd, 20c5721, 67f738d, 5e2043d (committed files, sync script), 26765ad (all 35 languages), 7233fb5.
- Code: `src/server/i18n-routes.ts`, `src/i18n/version.ts`.
- Brain: `architecture.data.flow` (facts 2ed266d2, fda6a11a), `project.i18n.livecost` (fact 72005094), `architecture.boundaries.rationale` (fact 2e4b7687).
