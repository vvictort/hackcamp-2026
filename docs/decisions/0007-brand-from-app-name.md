# 0007. The brand comes from APP_NAME (rename to Altamyra)

Status: accepted, 2026-11-07

## Context
The product is called Altamyra. A brand name typed into many pages and 36 languages is hard to change and easy to miss.

## Decision
- The name lives only in `APP_NAME` in `src/constants.ts`.
- UI code reads `APP_NAME`; i18n strings interpolate `{app}`.
- Altamyra stays on the translation do-not-translate list (`KEEP` in `src/i18n/version.ts`).
- Internal code names use the brand too: `src/server/altamyra/`, `src/lib/altamyra/`, `Altamyra*` identifiers and `ALTAMYRA_*` environment variables.

## Consequences
- A future rename is a one-line change. The cached translation version hashes the do-not-translate list, so a change there invalidates stale translations automatically.
- The i18n storage key followed the rename.

## Evidence
- Commits: e1bd560 (rename; landing reads APP_NAME), cb29568 (keep brand in do-not-translate list), e24fcee (storage key).
- Brain: `project.branding.name` (fact a0753763), `project.tooling.stack` (fact a2d7dee6), `architecture.data.flow` (fact 9364ee32).
- Memory: project-altamyra.md.
