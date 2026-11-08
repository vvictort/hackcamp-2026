# Architecture Decision Records

Short records of decisions the team actually made while building Altamyra, each checked against git history and the code. Format: Context, Decision, Consequences, Evidence. Evidence lists commit hashes (`git show <hash>`) and Entire Brain memory paths (`entire brain recall "<topic>"`).

| ADR | Decision |
| --- | --- |
| [0001](0001-student-names-never-reach-ai.md) | Student names never reach an AI model |
| [0002](0002-myeducation-bc-is-the-legal-record.md) | MyEducation BC stays the legal IEP record; the AI suggests and a teacher approves |
| [0003](0003-lesson-lens-agent-on-maritime.md) | Lesson Lens agent runs on Maritime with a Gemini lite model and a rules fallback |
| [0004](0004-secrets-in-deepspace-secret-store.md) | App secrets live in the DeepSpace secret store, not .dev.vars |
| [0005](0005-backend-frontend-layout.md) | Backend/frontend layout inside one DeepSpace app |
| [0006](0006-one-design-system.md) | One design system: tokens, shared components, CSS motion, Lenis, light only |
| [0007](0007-brand-from-app-name.md) | The brand comes from APP_NAME (rename to Altamyra) |
| [0008](0008-oauth-sign-up-with-profile-and-consent.md) | Sign-up through Google/GitHub OAuth, profile stages and a consent stage |
| [0009](0009-entire-manual-checkpoints-and-redaction.md) | Entire with a manual checkpoint push policy and redaction |
| [0010](0010-committed-machine-translations.md) | Translations: committed per-language files, machine-translated from a static catalogue |

To add one: copy the shape of an existing ADR, take the next number, and record only a decision that has landed in a commit.
