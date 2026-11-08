/**
 * Landing page: a STATIC page (top level of src/pages/, no DeepSpace
 * providers, prerendered at build). Keep it renderable without a browser:
 * no window/document or Date during render. `<Seo>` comes first.
 *
 * Altamira: a living IEP for BC grade-school teachers. Copy follows the product
 * doc: the AI suggests, a person approves; MyEducation BC stays the legal
 * record; names are removed before the AI; data is stored in Canada. Canadian
 * spelling.
 *
 * Look (ink-first): grey canvas, a floating pill nav, a centred hero over a
 * product preview, a bento grid of modules, big ink panels, and one signal
 * accent in small doses. Motion is CSS only and kept light: the hero eases in once on
 * load (animate-rise, animate-grow) and sections fade up as they scroll into
 * view (.reveal). prefers-reduced-motion turns all of it off. Photos are public domain
 * (CC0) from rawpixel and StockSnap.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  ArrowRightLeft,
  BookOpenCheck,
  ChartColumn,
  Check,
  ClipboardList,
  FileText,
  GraduationCap,
  HeartHandshake,
  Languages,
  Plus,
  ScanSearch,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react'
import { Logo } from '../components/LogoMark'
import { Seo } from '../components/Seo'
import { StatusBadge, buttonVariants } from '../components/ui'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

/** Stagger an entrance by `step` steps of --stagger (styles.css). */
const delay = (step: number): CSSProperties => ({ animationDelay: `calc(var(--stagger) * ${step})` })

/** Footer links on the ink panel: muted text lifts to white, and an underline
 * grows from the left on hover or keyboard focus (and shrinks back on leave),
 * on the shared 200ms ease-out. Pure CSS; reduced motion makes it instant. */
const footerLink =
  'group inline-flex min-h-11 items-center text-body font-semibold text-ink-muted transition-colors hover:text-ink-foreground focus-visible:text-ink-foreground'
const footerLinkLabel =
  'bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_2px] bg-[position:0_100%] bg-no-repeat pb-0.5 transition-[background-size] group-hover:bg-[length:100%_2px] group-focus-visible:bg-[length:100%_2px]'

const NAV = [
  ['#modules', 'Modules'],
  ['#how', 'How it works'],
  ['#faq', 'Questions'],
] as const

const STATS = [
  { value: '14.3%', label: 'of BC students have a designation' },
  { value: '3×', label: 'more autism designations since 2015' },
  { value: '80 weeks', label: 'average wait for an autism assessment' },
]

/** span: columns taken on large screens. ink: dark feature tile. */
const MODULES = [
  { Icon: UserRound, span: 1, title: 'Student Profile', body: 'Each IEP structured like the BC Competency-Based IEP, imported from MyEd or typed in, and never overwritten.' },
  { Icon: ScanSearch, span: 2, ink: true, title: 'Lesson Lens', body: 'Upload a lesson and get adaptations for every student with an IEP, each tagged to the goal it serves.' },
  { Icon: ShieldCheck, span: 1, title: 'Adapt/Modify Guardrail', body: 'Every suggestion is labelled adaptation or modification, so outcomes never change by accident.' },
  { Icon: Activity, span: 1, title: 'Pulse', body: 'One tap or a voice note after class, tagged to IEP goals. Evidence builds up while you teach.' },
  { Icon: FileText, span: 2, ink: true, title: 'Progress Drafts', body: 'Goal-by-goal reports drafted from real evidence. Every sentence links back to its source.' },
  { Icon: Users, span: 1, title: 'Team and Today View', body: 'A shared timeline, and a one-page plan that EAs and substitutes open with a QR code.' },
  { Icon: ArrowRightLeft, span: 2, title: 'Transition Handoff', body: 'An end-of-term summary, so the right support follows the student to the next classroom.' },
  { Icon: Languages, span: 1, title: 'Family Bridge', body: 'Plain-language summaries in the home language, with audio, sent only after you approve them.' },
  { Icon: ChartColumn, span: 1, title: 'District Insights', body: 'Anonymized goal-progress trends for FESL reporting. Small groups are never shown.' },
]

const STEPS = [
  { img: '/images/teachers.webp', alt: 'A teacher and students working around a table covered in sticky notes', title: 'Adapt the lesson', body: 'Lesson Lens suggests adaptations for each student, tied to their IEP goals. You pick what to use.' },
  { img: '/images/students.webp', alt: 'A student writing in a spiral notebook with a ruler', title: 'Capture evidence', body: 'After class, a tap or a short voice note records what happened, tagged to the right goals.' },
  { img: '/images/feedback.webp', alt: 'An open textbook of equations beside a notebook and pen', title: 'Draft the report', body: 'Altamira drafts the progress report from your evidence. Review it, then copy it into MyEd.' },
]

const CONTROL = [
  'Every AI output is a suggestion you approve, edit or reject',
  'Modifications carry a warning and need your confirmation',
  'Student names are removed before anything reaches the AI',
  'Data is stored in Canada',
  'MyEducation BC stays the official IEP record',
  'Nothing reaches a family without your approval',
]

const TEAM = [
  { Icon: GraduationCap, title: 'Classroom teachers', body: 'Plan, adapt and report for every student with an IEP, without the extra evenings.' },
  { Icon: BookOpenCheck, title: 'Resource teachers', body: 'See every caseload goal and the evidence behind it, and share the plan with the team.' },
  { Icon: ClipboardList, title: 'EAs and substitutes', body: 'Open the Today View with a QR code. One page, no login, everything needed for the day.' },
  { Icon: HeartHandshake, title: 'Families', body: 'Read-only updates in their home language, in plain words and approved by the teacher.' },
]

const FAQ = [
  { q: 'Does Altamira replace MyEducation BC?', a: 'No. MyEd stays the legal IEP record. Altamira is the working layer around it, where lessons, evidence and drafts live.' },
  { q: 'Will the AI change an IEP or contact families?', a: 'Never on its own. It only suggests. A person approves every change, every family message and every report.' },
  { q: 'What is the difference between an adaptation and a modification?', a: 'An adaptation changes how a student learns or shows learning. A modification changes the learning outcomes themselves, so Altamira marks it with a warning and asks you to confirm.' },
  { q: 'Where is student data stored?', a: 'In Canada. Student names are removed before anything is sent to the AI.' },
  { q: 'Is it in French?', a: 'The interface is in English and French. Family summaries can be written in any home language.' },
  { q: 'What does it cost?', a: 'Free for teachers using fictional or de-identified profiles. Schools and districts license the team features.' },
]

/** Pill with a detached round arrow. One link, one focus stop. */
function ArrowPill({ to, href, outline = false, children }: { to?: string; href?: string; outline?: boolean; children: ReactNode }) {
  const cls = 'group inline-flex items-center gap-1 rounded-full active:translate-y-px transition-[translate]'
  const body = (
    <>
      <span
        className={`inline-flex h-12 items-center rounded-full px-6 text-body font-semibold uppercase tracking-wide transition-[background-color,box-shadow] ${
          outline ? 'border border-foreground bg-transparent group-hover:shadow-lift' : 'bg-primary text-primary-foreground shadow-ink group-hover:bg-primary-soft'
        }`}
      >
        {children}
      </span>
      <span
        aria-hidden
        className={`inline-flex size-12 items-center justify-center rounded-full transition-[background-color,box-shadow] ${
          outline ? 'border border-foreground group-hover:shadow-lift' : 'bg-primary text-primary-foreground shadow-ink group-hover:bg-primary-soft'
        }`}
      >
        <ArrowRight className="size-5 -rotate-45 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </span>
    </>
  )
  return to ? <Link to={to} className={cls}>{body}</Link> : <a href={href} className={cls}>{body}</a>
}

function SectionHeader({ id, title, intro }: { id: string; title: ReactNode; intro: string }) {
  return (
    <div className="reveal flex max-w-2xl flex-col gap-4">
      <h2 id={id} className="text-display-sm sm:text-display">
        {title}
      </h2>
      <p className="text-body-lg text-muted-foreground">{intro}</p>
    </div>
  )
}

function Section({ id, labelledBy, children }: { id?: string; labelledBy: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={labelledBy} className="mx-auto flex w-full max-w-6xl scroll-mt-24 flex-col gap-12 px-4 py-20 sm:px-6 sm:py-28">
      {children}
    </section>
  )
}

/** Decorative product preview shown under the hero. */
function Preview() {
  const rows = [
    { who: 'S', text: 'Use numbers to 20 with the same hands-on blocks', tone: 'warning', tag: 'Modification' },
    { who: 'M', text: 'Pre-fold the paper strips into equal parts', tone: 'success', tag: 'Adaptation' },
    { who: 'J', text: 'Offer a voice note instead of a written answer', tone: 'success', tag: 'Adaptation' },
  ] as const
  return (
    <div aria-hidden className="animate-rise relative overflow-hidden rounded-panel bg-ink p-3 shadow-ink sm:p-4" style={delay(3)}>
      <div className="relative grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-4 rounded-xl bg-card p-5 text-left text-foreground sm:p-6">
          <div>
            <p className="text-small font-semibold text-muted-foreground">Lesson Lens</p>
            <p className="text-h2 font-bold">Fractions, grade 4</p>
          </div>
          <ul className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <li key={r.text} className="animate-rise flex items-center gap-3 rounded-md border border-border p-3" style={delay(4 + i)}>
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-label font-bold text-primary-foreground">
                  {r.who}
                </span>
                <span className="flex flex-1 flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-body">{r.text}</span>
                  <StatusBadge tone={r.tone}>{r.tag}</StatusBadge>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col justify-between gap-6 rounded-xl bg-ink-raised p-5 text-left text-ink-foreground sm:p-6">
          <div>
            <p className="text-small font-semibold text-ink-muted">Goal progress this term</p>
            <p className="mt-1 text-display font-bold tabular-nums">68%</p>
          </div>
          <div className="flex flex-col gap-3">
            <div className="h-2 overflow-hidden rounded-full bg-ink-foreground/15">
              <div className="animate-grow h-full w-[68%] rounded-full bg-signal" style={delay(6)} />
            </div>
            <p className="text-small text-ink-muted">14 pieces of evidence, 3 drafts ready to review</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// Only sections that have a nav link (plus 'top' to clear it at the hero). The
// highlight changes only when one of these crosses the middle of the screen,
// so it stays on the last link through unlinked sections (control, team).
const SECTION_IDS = ['top', 'modules', 'how', 'faq']

/** Id of the section crossing the middle of the viewport. Browser only (effects do not run in prerender). */
function useActiveSection() {
  const [active, setActive] = useState('')
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: '-45% 0px -50% 0px' },
    )
    SECTION_IDS.forEach((id) => {
      const el = document.getElementById(id)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [])
  return active
}

function SiteNav() {
  const active = useActiveSection()
  return (
    <header className="sticky top-0 z-30 px-4 pt-4 sm:px-6">
      <nav aria-label="Main" className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <Link
          to="/"
          aria-label={`${APP_NAME} home`}
          className="rounded-2xl bg-ink px-4 py-2.5 text-ink-foreground shadow-ink transition-colors hover:bg-primary-soft"
        >
          <Logo inverted />
        </Link>

        <ul className="hidden items-center gap-1 rounded-full bg-card/90 p-1 shadow-raised backdrop-blur md:flex">
          {NAV.map(([href, label]) => (
            <li key={href}>
              <a
                href={href}
                aria-current={active === href.slice(1) ? 'location' : undefined}
                className="inline-flex min-h-11 items-center rounded-full px-5 text-label font-semibold text-foreground transition-[background-color,color,translate] hover:bg-secondary active:translate-y-px aria-[current=location]:bg-primary aria-[current=location]:text-primary-foreground"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <span className="hidden sm:contents">
            <Link to="/sign-in" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
              Sign in
            </Link>
          </span>
          <Link to="/sign-up" className={buttonVariants({ size: 'lg' })}>
            Get started
          </Link>
        </div>
      </nav>
    </header>
  )
}

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen overflow-x-clip bg-background text-foreground">
        <SiteNav />

        <main>
          <section id="top" aria-labelledby="hero-title" className="relative mx-auto flex w-full max-w-6xl flex-col items-center gap-12 px-4 pb-16 pt-20 text-center sm:px-6 sm:pt-28">
            {/* Soft grid and a pale signal orb behind the headline (decorative; ink text stays 10:1+ on it). */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[40rem] bg-grid"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-24 -z-10 size-[34rem] -translate-x-1/2 rounded-full opacity-70 blur-3xl sm:size-[44rem] bg-signal-orb"
            />
            <div className="flex max-w-5xl flex-col items-center gap-6">
              <h1 id="hero-title" className="animate-rise text-hero-sm font-medium sm:text-hero lg:text-mega">
                Make the <span className="text-highlight">IEP</span> part of every lesson.
              </h1>
              <p className="animate-rise max-w-[52ch] text-body-lg text-foreground/80" style={delay(1)}>
                Built for BC classrooms and the <strong className="font-semibold text-foreground">Competency-Based IEP</strong>. {APP_NAME} links each lesson to your students&apos;
                IEP goals, collects progress evidence as you teach, and drafts the reports.
              </p>
              <div className="animate-rise flex flex-wrap justify-center gap-3" style={delay(2)}>
                <ArrowPill to="/sign-up">Get started</ArrowPill>
                <ArrowPill href="#how" outline>See how it works</ArrowPill>
              </div>
            </div>

            <Preview />

            <dl className="reveal grid w-full grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {STATS.map((s) => (
                <div key={s.value} className="flex flex-col items-center gap-1 px-6 py-5">
                  <dt className="order-2 max-w-[24ch] text-small text-muted-foreground">{s.label}</dt>
                  <dd className="order-1 text-display font-bold tabular-nums">{s.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <Section id="modules" labelledBy="modules-title">
            <SectionHeader
              id="modules-title"
              title={<>A living IEP, <span className="text-highlight">lesson by lesson</span></>}
              intro="Nine modules that connect the plan, the teaching, the evidence and the report."
            />
            <ul className="grid grid-flow-dense gap-5 md:grid-cols-2 lg:grid-cols-4">
              {MODULES.map(({ Icon, span, title, body, ...rest }) => {
                const ink = 'ink' in rest
                return (
                  <li
                    key={title}
                    className={`reveal relative flex flex-col justify-between gap-5 overflow-hidden md:min-h-56 rounded-xl p-6 ${
                      span === 2 ? 'md:col-span-2' : ''
                    } ${ink ? 'bg-ink text-ink-foreground shadow-ink' : 'bg-card shadow-raised'}`}
                  >
                    <span
                      className={`relative inline-flex size-11 items-center justify-center rounded-md ${
                        ink ? 'bg-ink-foreground text-ink' : 'bg-secondary'
                      }`}
                    >
                      <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                    </span>
                    <div className="relative flex flex-col gap-1.5">
                      <h3 className="text-h2">{title}</h3>
                      <p className={`max-w-[44ch] text-body ${ink ? 'text-ink-muted' : 'text-muted-foreground'}`}>{body}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Section>

          <Section id="how" labelledBy="how-title">
            <SectionHeader
              id="how-title"
              title="The daily loop"
              intro="Three steps that fit into the school day you already have."
            />
            <ol className="grid gap-10 md:grid-cols-3 md:gap-5">
              {STEPS.map((step, i) => (
                <li key={step.title} className="reveal group flex flex-col gap-5">
                  <div className="overflow-hidden rounded-xl shadow-raised">
                    <img
                      src={step.img}
                      alt={step.alt}
                      loading="lazy"
                      width={1024}
                      height={683}
                      className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-103"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <p className="text-h1 font-bold tabular-nums text-muted-foreground">0{i + 1}</p>
                    <h3 className="text-h2">{step.title}</h3>
                    <p className="text-body text-muted-foreground">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          <section id="control" aria-labelledby="control-title" className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-8 sm:px-6">
            <div className="reveal relative grid items-center gap-12 overflow-hidden rounded-panel bg-ink p-8 text-ink-foreground shadow-ink sm:p-12 lg:grid-cols-[1.2fr_1fr] lg:p-16">
              <div className="relative flex flex-col gap-8">
                <h2 id="control-title" className="max-w-[14ch] text-display-sm sm:text-hero">
                  The AI suggests. <span className="text-ink-muted">You decide.</span>
                </h2>
                <ul className="flex flex-col gap-3">
                  {CONTROL.map((point) => (
                    <li key={point} className="flex items-start gap-3 text-body text-ink-muted">
                      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-ink-foreground text-ink">
                        <Check className="size-3.5" strokeWidth={3} aria-hidden />
                      </span>
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
              <div aria-hidden className="relative flex flex-col gap-4 rounded-xl bg-card p-6 text-foreground">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-small font-semibold text-muted-foreground">Suggestion for Sof&iacute;a, math goal</p>
                  <StatusBadge tone="warning">Modification</StatusBadge>
                </div>
                <p className="text-body">Use numbers to 20 instead of fractions, with the same hands-on materials as the class.</p>
                <p className="rounded-md bg-muted px-4 py-3 text-small text-muted-foreground">
                  This changes the learning outcome. Check it against the IEP before approving.
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-label font-semibold text-primary-foreground">Approve</span>
                  <span className="inline-flex h-10 items-center rounded-full border border-input px-5 text-label font-semibold">Edit</span>
                  <span className="inline-flex h-10 items-center rounded-full border border-input px-5 text-label font-semibold">Reject</span>
                </div>
              </div>
            </div>
          </section>

          <Section id="team" labelledBy="team-title">
            <SectionHeader
              id="team-title"
              title={<>One plan, <span className="text-highlight">the whole team</span></>}
              intro="Everyone who supports a student sees the same goals, in the way that suits their role."
            />
            <ul className="grid gap-x-8 gap-y-10 md:grid-cols-2 lg:grid-cols-4">
              {TEAM.map(({ Icon, title, body }) => (
                <li key={title} className="reveal flex flex-col gap-4 border-t-2 border-foreground pt-6">
                  <Icon className="size-7" strokeWidth={1.5} aria-hidden />
                  <div className="flex flex-col gap-1.5">
                    <h3 className="text-h2">{title}</h3>
                    <p className="text-body text-muted-foreground">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <section id="faq" aria-labelledby="faq-title" className="mx-auto grid w-full max-w-6xl scroll-mt-24 gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[1fr_1.6fr]">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <SectionHeader
                id="faq-title"
                title="Before you sign up"
                intro="The questions teachers, resource teams and districts ask us most."
              />
            </div>
            <div className="reveal divide-y divide-border border-y border-border">
              {FAQ.map((item) => (
                <details key={item.q} name="faq" className="group">
                  <summary className="group/faq flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-5 text-body-lg font-semibold [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-card shadow-raised transition-shadow group-hover/faq:shadow-lift">
                      <Plus className="size-5 transition-transform group-open:rotate-45" aria-hidden />
                    </span>
                  </summary>
                  <p className="max-w-[62ch] pb-6 text-body text-muted-foreground">{item.a}</p>
                </details>
              ))}
            </div>
          </section>
        </main>

        <footer className="mx-auto w-full max-w-6xl px-4 pb-8 sm:px-6">
          <div className="reveal relative flex flex-col items-center gap-8 overflow-hidden rounded-panel bg-ink px-6 py-16 text-center text-ink-foreground shadow-ink">
            <h2 className="relative max-w-[16ch] text-display-sm sm:text-hero">
              Less paperwork. <span className="text-ink-muted">More teaching.</span>
            </h2>
            <div className="relative flex flex-wrap justify-center gap-3">
              <Link to="/sign-up" className={buttonVariants({ variant: 'raised', size: 'lg' })}>
                Get started
                <ArrowRight className="size-5" aria-hidden />
              </Link>
            </div>
            <div className="relative flex w-full flex-col items-center justify-between gap-6 border-t border-ink-foreground/15 pt-8 md:flex-row">
              <Logo inverted />
              <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-6">
                {NAV.map(([href, label]) => (
                  <a key={href} href={href} className={footerLink}>
                    <span className={footerLinkLabel}>{label}</span>
                  </a>
                ))}
                <Link to="/sign-in" className={footerLink}>
                  <span className={footerLinkLabel}>Sign in</span>
                </Link>
              </nav>
            </div>
          </div>
        </footer>
      </div>
    </>
  )
}
