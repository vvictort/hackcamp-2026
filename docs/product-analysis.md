# Product analysis

What Altamyra is, as the team defined it. This page summarizes the team's product analysis document; it does not add new research.

Sources: the team's product analysis document (Nov 7 2026, summarized here); the repository [README](../README.md); decisions recorded in Entire Brain.

## The problem

In British Columbia, a student with an Individual Education Plan (IEP) needs the adaptations and services in that plan, and evidence of progress against its goals. The team's view is that teachers do this work by hand, often after hours. This is a team belief; it has not been measured.

Altamyra is a "living IEP": it links each lesson to every student's IEP goals, collects progress evidence as teachers teach, and drafts goal-based progress reports for the teacher to review.

Provincial policy requires goal-based written feedback only for students assessed on their IEP goals. Most students with IEPs are reported on the curriculum, like their peers. See [BC IEP policy context](policy/bc-iep.md#reporting-for-students-with-ieps).

## The nine modules

| Module | What it does |
| --- | --- |
| Student Profile | Holds each IEP, structured like the BC Competency-Based IEP. The record is never overwritten. |
| Lesson Lens | Suggests adaptations for each student in a lesson, each tagged to the IEP goal it serves. |
| Adapt/Modify Guardrail | Labels every suggestion as an adaptation or a modification. Modifications change the learning outcome, so they carry a warning. |
| Pulse | A quick tap or voice note after class, tagged to IEP goals. This is the progress evidence. |
| Progress Drafts | Drafts goal-by-goal reports from the evidence. Every sentence links back to its source. |
| Team and Today View | A shared timeline for the student's team, and a one-page plan for the day for EAs and substitutes. |
| Transition Handoff | An end-of-term summary for the next classroom. |
| Family Bridge | Plain-language summaries in the family's home language, sent only after a teacher approves them. |
| District Insights | Anonymized goal-progress trends for the district. Small groups are never shown. |

## Who it is for

- **Classroom teacher**: the primary user. Plans lessons, logs Pulse notes, reviews drafts.
- **Resource or case-manager teacher**: owns and maintains the IEPs and works with classroom teachers.
- **Education assistant (EA)**: follows the day's plan and supports students in class.
- **Substitute teacher**: opens the Today View from a QR code, with no login.
- **Family**: read-only, through Family Bridge.
- **District inclusive-education lead**: the buyer. Sees District Insights.

Students have no screens in v1.

## Hard rules

These are not up for trade-offs:

1. **The AI only suggests.** A person approves every IEP change, every family message and every report. The AI never acts on its own.
2. **MyEducation BC stays the legal IEP record.** Altamyra is the working layer around it, not a replacement.
3. **No real student data before district privacy approval.** Until then the app uses fictional or de-identified data only.
4. **Names never reach the model.** Student names are replaced (Student A, B, and so on) before any text goes to an AI model, and put back only inside the app.
5. **Canadian hosting.** Data is stored in a Canadian region.

How the code follows rules 3 and 4 today: Lesson Lens swaps student names for "Student A, B..." (also inside pasted lesson text), remaps goal ids to `g1, g2...` and sends the teacher as a hash (`src/actions/lesson-lens.ts`). The `/api/v1` backend de-identifies every AI call in `src/server/altamira/ai/deidentify.ts` and refuses the call if that fails (commit 374dd12). The translation route sends only the fixed English interface text, never record data. Sign-up includes a consent step for fictional or de-identified data only.

Open item: this repository does not document which hosting region DeepSpace (Cloudflare Workers), Maritime and Google Gemini use for the prototype. Rule 5 is a design requirement that the team has not yet verified for those services.

## Design brief

- Calm, low-density screens for a tired teacher between classes.
- Any core action in 3 clicks or fewer.
- Status is shown by an icon plus a word, never by colour alone. The brief names Okabe-Ito colours for status and data.
- Atkinson Hyperlegible typeface.
- WCAG 2.2 AA.
- English and French interface. The app now offers 36 interface languages, machine-translated from the English text.

The visual style (ink-first, light theme, one violet accent) and its tokens are documented at the top of `src/styles.css` and in the README's Design section.

## Built today vs designed

Working in the app, as listed in the README's Current state:

- Landing page.
- Sign-in (Google or GitHub, or email for existing accounts) and a four-stage sign-up, including the consent step.
- Teacher dashboard from the `/api/v1` backend: Pulse as goal data coverage, today's schedule and the weekly digest. Dev-only demo controls (only with `ALTAMIRA_DEV_SEED=true`) load a fictional school and switch roles.
- **Lesson Lens**: Get suggestions on a class, then approve or reject each adaptation or modification. Approving a modification asks for confirmation first, which is the Adapt/Modify Guardrail in action. Suggestions come from an AI agent on Maritime that calls Gemini, with a rules fallback.
- Settings: profile, school and position, preferences, text size and signed-in devices.
- 36 interface languages with a language picker.

First versions that have landed on `main` since (git log, 2026-11-07), built on the `/api/v1` backend in `src/server/altamira/`. The README's Current state does not list them yet, and this page has not checked how complete each one is:

- A Lesson Lens page with lesson upload, results and PDF export (cf29524).
- Students list and student profile pages, with goals, a timeline and an IEP import dialog (a27f34a, f41a1b4, 127e638).
- Capture (photo capture), a review list and an EA page (06eaa90).
- Progress Drafts, Family Bridge and a substitute Today page opened by link (d46ebe2).
- District Insights (6e2dbf8).
- Transition Handoff: backend routes only, no page yet (18ed95b).

The app still uses fictional data only.
