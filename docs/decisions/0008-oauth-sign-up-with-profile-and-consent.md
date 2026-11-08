# 0008. Sign-up through Google/GitHub OAuth, profile stages and a consent stage

Status: accepted, 2026-11-07

## Context
DeepSpace has no public email/password sign-up; it is closed platform-wide. A new account is created on the first Google or GitHub sign-in. DeepSpace roles are permissions only, so teacher details must live on our own user row. The pilot accepts fictional or de-identified data only, and we want a record that each teacher agreed to that.

## Decision
Sign-up has four short stages (`src/pages/(app)/sign-up.tsx`):
1. continue with Google or GitHub;
2. about you: name (from the OAuth account) and position;
3. school and interface language;
4. consent to the pilot data rule, saved as `consentAt` (ISO time) on the user's own `users` row.
A profile is complete only with school, position and `consentAt` (`isComplete` in `src/components/auth/onboarding.tsx`). OAuth always lands on `/home`, so a session flag brings a new account back to finish. Sign-in also offers email for existing accounts.

## Consequences
- No account can use the app without recorded consent.
- Automated reviewers cannot create accounts normally; they use DeepSpace-provided test accounts.

## Evidence
- Commits: 8206407 (`consentAt` column), 2bc2b66, f1fb792 (staged sign-up), fcc68d6 (consent required), 198f323.
- Code: `src/schemas/users-schema.ts`.
- Brain: `project.tooling.stack` (fact 05463186), `project.architecture.layout` (fact 02cd0609), `constraints.invariants.general` (fact 9b06a9af).
