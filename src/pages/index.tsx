/**
 * Landing page: a STATIC page (top level of src/pages/, no DeepSpace
 * providers, prerendered at build). Keep it renderable without a browser:
 * no window/document or Date during render. `<Seo>` comes first.
 *
 * Altamyra: a living IEP for BC grade-school teachers. Copy follows the product
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
import { Link } from 'react-router'
import {
  Activity,
  ArrowRight,
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
} from 'lucide-react'
import { Logo } from '../components/LogoMark'
import { Seo } from '../components/Seo'
import { StatusBadge, buttonVariants } from '../components/ui'
import { APP_NAME } from '../constants'
import { useLang } from '@/i18n'
import type { MessageKey } from '@/i18n/en'
import { T } from '@/i18n/rich'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
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
  ['#modules', 'landing.nav.modules'],
  ['#how', 'landing.nav.how'],
  ['#faq', 'landing.nav.faq'],
] as const satisfies readonly (readonly [string, MessageKey])[]

const STATS: { value: string; label: MessageKey }[] = [
  { value: '14.3%', label: 'landing.stats.designation' },
  { value: '3×', label: 'landing.stats.autism' },
  { value: '80 weeks', label: 'landing.stats.wait' },
]

/** span: columns taken on large screens. ink: dark feature tile. */
const MODULES = [
  { Icon: UserRound, span: 1, key: 'landing.modules.profile' },
  { Icon: ScanSearch, span: 2, ink: true, key: 'landing.modules.lens' },
  { Icon: ShieldCheck, span: 1, key: 'landing.modules.guardrail' },
  { Icon: Activity, span: 2, key: 'landing.modules.pulse' },
  { Icon: FileText, span: 2, ink: true, key: 'landing.modules.summaries' },
  { Icon: Languages, span: 2, key: 'landing.modules.family' },
  { Icon: ChartColumn, span: 2, key: 'landing.modules.district' },
] as const

const STEPS = [
  { img: '/images/teachers.webp', key: 'landing.how.step1' },
  { img: '/images/students.webp', key: 'landing.how.step2' },
  { img: '/images/feedback.webp', key: 'landing.how.step3' },
] as const

const CONTROL = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const

const TEAM = [
  { Icon: GraduationCap, key: 'landing.team.teachers' },
  { Icon: BookOpenCheck, key: 'landing.team.resource' },
  { Icon: ClipboardList, key: 'landing.team.eas' },
  { Icon: HeartHandshake, key: 'landing.team.families' },
] as const

const FAQ = [1, 2, 3, 4, 5, 6] as const

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

function SectionHeader({ id, title, intro }: { id: string; title: MessageKey; intro: MessageKey }) {
  const { t } = useLang()
  return (
    <div className="reveal flex max-w-2xl flex-col gap-4">
      <h2 id={id} className="text-display-sm sm:text-display">
        {t(title)}
      </h2>
      <p className="text-body-lg text-muted-foreground">{t(intro)}</p>
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
  const { t } = useLang()
  const rows = [
    { who: 'S', text: 'landing.preview.row1', tone: 'warning', tag: 'landing.tag.modification' },
    { who: 'M', text: 'landing.preview.row2', tone: 'success', tag: 'landing.tag.adaptation' },
    { who: 'J', text: 'landing.preview.row3', tone: 'success', tag: 'landing.tag.adaptation' },
  ] as const
  return (
    <div aria-hidden className="animate-rise relative overflow-hidden rounded-panel bg-ink p-3 shadow-ink sm:p-4" style={delay(3)}>
      <div className="relative grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-4 rounded-xl bg-card p-5 text-left text-foreground sm:p-6">
          <div>
            <p className="text-small font-semibold text-muted-foreground">{t('landing.preview.title')}</p>
            <p className="text-h2 font-bold">{t('landing.preview.lesson')}</p>
          </div>
          <ul className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <li key={r.text} className="animate-rise flex items-center gap-3 rounded-md border border-border p-3" style={delay(4 + i)}>
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-label font-bold text-primary-foreground">
                  {r.who}
                </span>
                <span className="flex flex-1 flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-body">{t(r.text)}</span>
                  <StatusBadge tone={r.tone}>{t(r.tag)}</StatusBadge>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col justify-between gap-6 rounded-xl bg-ink-raised p-5 text-left text-ink-foreground sm:p-6">
          <div>
            <p className="text-small font-semibold text-ink-muted">{t('landing.preview.progress')}</p>
            <p className="mt-1 text-display font-bold tabular-nums">68%</p>
          </div>
          <div className="flex flex-col gap-3">
            <div className="h-2 overflow-hidden rounded-full bg-ink-foreground/15">
              <div className="animate-grow h-full w-[68%] rounded-full bg-signal" style={delay(6)} />
            </div>
            <p className="text-small text-ink-muted">{t('landing.preview.evidence')}</p>
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
  const { t } = useLang()
  const active = useActiveSection()
  return (
    <header className="sticky top-0 z-30 px-4 pt-4 sm:px-6">
      <nav aria-label={t('landing.nav.label')} className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <Link
          to="/"
          aria-label={t('landing.nav.home', { app: APP_NAME })}
          className="rounded-2xl bg-ink px-4 py-2.5 text-ink-foreground shadow-ink transition-colors hover:bg-primary-soft"
        >
          <Logo inverted labelClassName="max-sm:sr-only" />
        </Link>

        <ul className="hidden items-center gap-1 rounded-full bg-card/90 p-1 shadow-raised backdrop-blur lg:flex">
          {NAV.map(([href, label]) => (
            <li key={href}>
              <a
                href={href}
                aria-current={active === href.slice(1) ? 'location' : undefined}
                className="inline-flex min-h-11 items-center rounded-full px-5 text-label font-semibold text-foreground transition-[background-color,color,translate] hover:bg-secondary active:translate-y-px aria-[current=location]:bg-primary aria-[current=location]:text-primary-foreground"
              >
                {t(label)}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <LanguageSwitcher className="h-11 w-auto gap-2 rounded-full sm:min-w-36" />
          <span className="hidden sm:contents">
            <Link to="/sign-in" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
              {t('common.signIn')}
            </Link>
          </span>
          <Link to="/sign-up" className={buttonVariants({ size: 'lg', className: 'max-sm:h-11 max-sm:px-4 max-sm:text-label' })}>
            {t('common.getStarted')}
          </Link>
        </div>
      </nav>
    </header>
  )
}

export default function Landing() {
  const { t } = useLang()
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
              <h1 id="hero-title" className="animate-rise text-hero-sm font-medium text-balance hyphens-auto [overflow-wrap:anywhere] sm:text-hero lg:text-mega">
                <T k="landing.hero.title" />
              </h1>
              <p className="animate-rise max-w-[52ch] text-body-lg text-foreground/80" style={delay(1)}>
                <T k="landing.hero.body" vars={{ app: APP_NAME }} />
              </p>
              <div className="animate-rise flex flex-wrap justify-center gap-3" style={delay(2)}>
                <ArrowPill to="/sign-up">{t('common.getStarted')}</ArrowPill>
                <ArrowPill href="#how" outline>{t('landing.hero.seeHow')}</ArrowPill>
              </div>
            </div>

            <Preview />

            <dl className="reveal grid w-full grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {STATS.map((s) => (
                <div key={s.value} className="flex flex-col items-center gap-1 px-6 py-5">
                  <dt className="order-2 max-w-[24ch] text-small text-muted-foreground">{t(s.label)}</dt>
                  <dd className="order-1 text-display font-bold tabular-nums">{s.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <Section id="modules" labelledBy="modules-title">
            <SectionHeader
              id="modules-title"
              title="landing.modules.title"
              intro="landing.modules.intro"
            />
            <ul className="grid grid-flow-dense gap-5 md:grid-cols-2 lg:grid-cols-4">
              {MODULES.map(({ Icon, span, key, ...rest }) => {
                const ink = 'ink' in rest
                return (
                  <li
                    key={key}
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
                      <h3 className="text-h2">{t(`${key}.title` as const)}</h3>
                      <p className={`max-w-[44ch] text-body ${ink ? 'text-ink-muted' : 'text-muted-foreground'}`}>{t(`${key}.body` as const)}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Section>

          <Section id="how" labelledBy="how-title">
            <SectionHeader
              id="how-title"
              title="landing.how.title"
              intro="landing.how.intro"
            />
            <ol className="grid gap-10 md:grid-cols-3 md:gap-5">
              {STEPS.map((step, i) => (
                <li key={step.key} className="reveal group flex flex-col gap-5">
                  <div className="overflow-hidden rounded-xl shadow-raised">
                    <img
                      src={step.img}
                      alt={t(`${step.key}.alt` as const)}
                      loading="lazy"
                      width={1024}
                      height={683}
                      className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-103"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <p className="text-h1 font-bold tabular-nums text-muted-foreground">0{i + 1}</p>
                    <h3 className="text-h2">{t(`${step.key}.title` as const)}</h3>
                    <p className="text-body text-muted-foreground">{t(`${step.key}.body` as const, { app: APP_NAME })}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          <section id="control" aria-labelledby="control-title" className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-8 sm:px-6">
            <div className="reveal relative grid items-center gap-12 overflow-hidden rounded-panel bg-ink p-8 text-ink-foreground shadow-ink sm:p-12 lg:grid-cols-[1.2fr_1fr] lg:p-16">
              <div className="relative flex flex-col gap-8">
                <h2 id="control-title" className="max-w-[14ch] text-display-sm hyphens-auto [overflow-wrap:anywhere] sm:text-hero">
                  {t('landing.control.title')}
                </h2>
                <ul className="flex flex-col gap-3">
                  {CONTROL.map((point) => (
                    <li key={point} className="flex items-start gap-3 text-body text-ink-muted">
                      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-ink-foreground text-ink">
                        <Check className="size-3.5" strokeWidth={3} aria-hidden />
                      </span>
                      {t(`landing.control.${point}` as const)}
                    </li>
                  ))}
                </ul>
              </div>
              <div aria-hidden className="relative flex flex-col gap-4 rounded-xl bg-card p-6 text-foreground">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-small font-semibold text-muted-foreground">{t('landing.control.cardTitle')}</p>
                  <StatusBadge tone="warning">{t('landing.tag.modification')}</StatusBadge>
                </div>
                <p className="text-body">{t('landing.control.cardBody')}</p>
                <p className="rounded-md bg-muted px-4 py-3 text-small text-muted-foreground">
                  {t('landing.control.cardWarning')}
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-label font-semibold text-primary-foreground">{t('landing.control.approve')}</span>
                  <span className="inline-flex h-10 items-center rounded-full border border-input px-5 text-label font-semibold">{t('landing.control.edit')}</span>
                  <span className="inline-flex h-10 items-center rounded-full border border-input px-5 text-label font-semibold">{t('landing.control.reject')}</span>
                </div>
              </div>
            </div>
          </section>

          <Section id="team" labelledBy="team-title">
            <SectionHeader
              id="team-title"
              title="landing.team.title"
              intro="landing.team.intro"
            />
            <ul className="grid gap-x-8 gap-y-10 md:grid-cols-2 lg:grid-cols-4">
              {TEAM.map(({ Icon, key }) => (
                <li key={key} className="reveal flex flex-col gap-4 border-t-2 border-foreground pt-6">
                  <Icon className="size-7" strokeWidth={1.5} aria-hidden />
                  <div className="flex flex-col gap-1.5">
                    <h3 className="text-h2">{t(`${key}.title` as const)}</h3>
                    <p className="text-body text-muted-foreground">{t(`${key}.body` as const)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <section id="faq" aria-labelledby="faq-title" className="mx-auto grid w-full max-w-6xl scroll-mt-24 gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[1fr_1.6fr]">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <SectionHeader
                id="faq-title"
                title="landing.faq.title"
                intro="landing.faq.intro"
              />
            </div>
            <div className="reveal divide-y divide-border border-y border-border">
              {FAQ.map((n) => (
                <details key={n} name="faq" className="group">
                  <summary className="group/faq flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-5 text-body-lg font-semibold [&::-webkit-details-marker]:hidden">
                    {t(`landing.faq.q${n}` as const, { app: APP_NAME })}
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-card shadow-raised transition-shadow group-hover/faq:shadow-lift">
                      <Plus className="size-5 transition-transform group-open:rotate-45" aria-hidden />
                    </span>
                  </summary>
                  <p className="max-w-[62ch] pb-6 text-body text-muted-foreground">{t(`landing.faq.a${n}` as const, { app: APP_NAME })}</p>
                </details>
              ))}
            </div>
          </section>
        </main>

        <footer className="mx-auto w-full max-w-6xl px-4 pb-8 sm:px-6">
          <div className="reveal relative flex flex-col items-center gap-8 overflow-hidden rounded-panel bg-ink px-6 pt-16 pb-8 text-center text-ink-foreground shadow-ink">
            <h2 className="relative max-w-[16ch] text-display-sm hyphens-auto [overflow-wrap:anywhere] sm:text-hero">
              {t('landing.footer.title')}
            </h2>
            <div className="relative flex flex-wrap justify-center gap-3">
              <Link to="/sign-up" className={buttonVariants({ variant: 'raised', size: 'lg' })}>
                {t('common.getStarted')}
                <ArrowRight className="size-5" aria-hidden />
              </Link>
            </div>
            <div className="relative flex w-full flex-col items-center justify-between gap-6 border-t border-ink-foreground/15 pt-8 md:flex-row">
              <Logo inverted />
              <nav aria-label={t('landing.nav.footerLabel')} className="flex flex-wrap justify-center gap-x-6">
                {NAV.map(([href, label]) => (
                  <a key={href} href={href} className={footerLink}>
                    <span className={footerLinkLabel}>{t(label)}</span>
                  </a>
                ))}
                <Link to="/sign-in" className={footerLink}>
                  <span className={footerLinkLabel}>{t('common.signIn')}</span>
                </Link>
              </nav>
            </div>
          </div>
        </footer>
      </div>
    </>
  )
}
