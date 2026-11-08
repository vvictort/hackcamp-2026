# 0006. One design system: tokens, shared components, CSS motion, Lenis, light only

Status: accepted, 2026-11-07

## Context
Several looks were tried and rejected (accessible blue, Nunito, lime stickers, sand/ink editorial, Sunflower neubrutalism as "too kid like", calm plum, pastel dashboard). Screens were drifting apart, with hand-rolled cards and buttons and ad hoc animation.

## Decision
- Ink-first, light theme only: grey canvas, white and near-black cards, soft shadows, one violet accent used sparingly, Atkinson Hyperlegible. Tokens live in `src/styles.css`.
- Shared components in `src/components/ui` (Card, PageHeader, Progress, Button variants, FormField and others) instead of raw hex or hand-rolled UI.
- Motion is plain CSS and Tailwind on shared tokens (`--ease-out`, `--duration-*`, stagger). No animation libraries. Everything is off under `prefers-reduced-motion`.
- Lenis, mounted once in `src/pages/_app.tsx`, is the only smooth scroll. Native `scroll-behavior: smooth` was rejected as too fast.
- Status is shown by icon and word, never colour alone.

## Consequences
- New screens reuse tokens and components; contrast is checked for every new colour pair.
- No dark mode for now.

## Evidence
- Commits: 9fcc7be (new design system, Lenis, motion system), 33bbd6d, 74f97cb, d35a019, 0845a9b, 9659743.
- Code: `src/styles.css` ("Light theme only"), `src/pages/_app.tsx`, `package.json` (`lenis`).
- Brain: `project.design.system` (fact c9853356), `project.design.motion` (fact b585bacb), `constraints.invariants.general` (fact e7e3b6e7).
- Memory: design-direction.md, feedback-delegation-and-motion.md.
