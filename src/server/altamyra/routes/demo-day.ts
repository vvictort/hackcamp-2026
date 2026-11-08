// Response bodies are read loosely here; the real routes validate them.
import type { Hono } from 'hono'
import { ACTOR_ROLES, type ActorRole } from '../contract/permissions'
import type { Env } from '../../../../worker'
import { hasGeminiKey } from '../ai/provider'
import { DEMO_IEP_SD23_TEXT, DEMO_LESSON, DEMO_TRANSLATION_SAMPLE, DEMO_STUDENT, DEMO_PARENT } from '../fixtures/demo-iep-sd23'
import { devDemoStudent } from '../fixtures/demo-day'
import { USER_IDS } from '../fixtures/school'
import type { AltamyraEnv } from '../middleware/auth'
import { AltamyraError } from '../contract/errors'
import { devRoleSwitch } from '../services/dev'
import type { Kit } from './context'
import type { AltamyraRouteDeps } from './deps'
import { seedDemoSchool } from './student-flows'

/**
 * Dev only: POST /dev/demo-day runs one whole school day for one new fictional student through the real /api/v1
 * routes, acting as every role in turn (design: "Run full demo day" button on Home).
 *
 * How the roles act: the steps are dispatched as INTERNAL requests to a second copy of the same Altamyra app
 * (`createInner`). Its sign-in resolver reads a module-private WeakMap keyed by the Request object this file
 * created, so no header, cookie or body from outside can name a user, and the copy is not mounted anywhere.
 * Every step goes through the normal sign-in, permission matrix, validation, audit log and AI provider chain.
 */

export type DemoRole = ActorRole | 'system'
export type DemoStep = { role: DemoRole; action: string; ok: boolean; detail: string; page: string }
export type DemoDayResult = { studentId: string; steps: DemoStep[] }

/** Request object -> fixture user it acts as. Not exported, so only code in this file can add to it. */
const identities = new WeakMap<Request, string>()

const WHO = {
  case_manager: USER_IDS.caseManager,
  teacher: USER_IDS.teacher,
  ea: USER_IDS.ea,
  parent: DEMO_PARENT.id,
  district_lead: USER_IDS.districtLead,
  school_admin: USER_IDS.schoolAdmin,
} satisfies Record<ActorRole, string>

type Res = { status: number; body: any }

/** The same routes the app serves, minus this one, answering only requests this file built. */
function internalDeps(deps: AltamyraRouteDeps): AltamyraRouteDeps {
  return {
    ...deps,
    resolveUserId: async (req) => identities.get(req) ?? null,
    // The demo voice note names an upload that never existed; deleting nothing is fine.
    deleteFile: async (env, key, owner) => {
      try {
        await deps.deleteFile(env, key, owner)
      } catch {
        /* nothing was uploaded */
      }
    },
  }
}

const short = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function demoDayRoutes(app: Hono<AltamyraEnv>, kit: Kit, createInner: (deps: AltamyraRouteDeps) => Hono<AltamyraEnv>): void {
  const { signedIn, req, deps } = kit

  app.post(
    '/dev/demo-day',
    async (c, next) => {
      if (!deps.devSeedEnabled(c.env)) throw new AltamyraError('not_found', 'not found')
      await next()
    },
    signedIn,
    async (c) => {
      const r = req(c)
      const studentId = crypto.randomUUID()
      const steps: DemoStep[] = []
      const inner = createInner(internalDeps(deps))
      const env = c.env as Env

      const call = async (role: ActorRole, method: string, path: string, body?: unknown): Promise<Res> => {
        const request = new Request(`http://altamyra.internal${path}`, {
          method,
          headers: body !== undefined ? { 'content-type': 'application/json' } : {},
          body: body !== undefined ? JSON.stringify(body) : undefined,
        })
        identities.set(request, WHO[role])
        const res = await inner.fetch(request, env)
        const text = await res.text()
        let parsed: any = null
        try {
          parsed = text ? JSON.parse(text) : null
        } catch {
          parsed = null
        }
        return { status: res.status, body: parsed }
      }
      /** The body of a 2xx answer; anything else is a failed step with the server's own message. */
      const ok = (res: Res, what: string): any => {
        if (res.status < 200 || res.status >= 300) throw new Error(`${what} (${res.status}): ${res.body?.error?.message ?? 'no details'}`)
        return res.body
      }
      const step = async (role: DemoRole, action: string, page: string, fn: () => Promise<string>) => {
        try {
          steps.push({ role, action, ok: true, detail: await fn(), page })
        } catch (e) {
          steps.push({ role, action, ok: false, detail: short(e instanceof Error ? e.message : String(e), 300), page })
        }
      }
      const need = <T>(value: T | undefined | null, what: string): T => {
        if (value === undefined || value === null) throw new Error(`Skipped: ${what} did not finish.`)
        return value
      }

      const home = `/students/${studentId}`
      const ctx: {
        iep?: any
        objectives?: any[]
        plan?: any
        sheetCode?: string
        date?: string
        daily?: any
        weekly?: any
        monthly?: any
        ticketIep?: number
      } = {}
      /** The first confirmed objective of one of these metric types, or undefined. Live AI may propose other types than the fixture. */
      const objectiveFor = (metrics: string[]): any | undefined => need(ctx.objectives, 'Confirming the objectives').find((o) => metrics.includes(o.metricType))
      const eventBase = { classId: null, lessonId: null }

      // ---------- setup: the school and the new student ----------
      let ready = false
      await step('system', 'Load the demo school and add one new fictional student', '/home', async () => {
        await seedDemoSchool(r)
        await r.school(devDemoStudent, { studentId, displayToken: `S-${studentId.slice(0, 4).toUpperCase()}` })
        ready = true
        return `A grade ${DEMO_STUDENT.grade} student with a full-time EA joined the school. Name and IEP come next, from the import.`
      })
      if (!ready) return c.json({ studentId, steps } satisfies DemoDayResult)

      // a. Parent consent
      await step('parent', 'Allow voice notes and video', '/family', async () => {
        for (const kind of ['voice_note', 'video']) ok(await call('parent', 'PUT', `/family/${studentId}/consents`, { kind, granted: true }), `consent ${kind}`)
        return 'Consent for voice notes and video is on.'
      })

      // b. Case manager: IEP import and objectives
      await step('case_manager', 'Import the SD23 IEP text', home, async () => {
        ctx.iep = ok(await call('case_manager', 'POST', `/students/${studentId}/iep/import`, { sourceKind: 'text', text: DEMO_IEP_SD23_TEXT }), 'import')
        const goals = ctx.iep.goals.length
        return `Read ${goals} goals from the IEP. The AI proposed an objective for each, to be checked.`
      })
      await step('case_manager', 'Confirm the IEP', home, async () => {
        const { iep } = need(ctx.iep, 'The IEP import')
        const confirmed = ok(await call('case_manager', 'POST', `/students/${studentId}/iep/${iep.version}/confirm`, { expectedVersion: iep.rowVersion }), 'confirm IEP')
        ctx.ticketIep = confirmed.iep.version
        return `IEP version ${confirmed.iep.version} is confirmed.`
      })
      await step('case_manager', 'Confirm the proposed objectives', home, async () => {
        const goalIds = new Set<string>(need(ctx.iep, 'The IEP import').goals.map((g: any) => g.id))
        const list = ok(await call('case_manager', 'GET', `/students/${studentId}/objectives`), 'objectives').objectives as any[]
        const proposed = list.filter((o) => goalIds.has(o.goalId) && o.status === 'proposed')
        if (!proposed.length) throw new Error('The AI proposed no measurable objective to confirm.')
        const confirmed: any[] = []
        for (const o of proposed) confirmed.push(ok(await call('case_manager', 'POST', `/objectives/${o.id}/confirm?studentId=${studentId}`, { expectedVersion: o.version }), 'confirm objective').objective)
        ctx.objectives = confirmed
        const kinds = [...new Set(confirmed.map((o) => o.metricType))].join(', ')
        return `${confirmed.length} objectives confirmed (${kinds}).`
      })

      // c. Teacher: the day's lesson plan
      await step('teacher', 'Create today\'s lesson plan (the life cycle of a salmon)', home, async () => {
        const created = ok(await call('teacher', 'POST', `/students/${studentId}/lesson-plans`, { title: DEMO_LESSON.title, text: DEMO_LESSON.text }), 'create plan')
        ctx.plan = created.plan
        return `The AI proposed ${ctx.plan.proposed.length} changes for this student. The plan is a draft.`
      })
      await step('teacher', 'Edit one proposed change', home, async () => {
        const plan = need(ctx.plan, 'The lesson plan')
        const first = plan.proposed[0]
        const patch = first
          ? { proposed: [{ id: first.id, accepted: true, text: `${first.text} Keep the picture cards on the desk.` }] }
          : { tailoredText: `${plan.tailoredText}\n\nKeep the picture cards on the desk.` }
        ctx.plan = ok(await call('teacher', 'PATCH', `/lesson-plans/${plan.id}`, { studentId, version: plan.version, ...patch }), 'edit plan').plan
        return first ? 'Added one line to the first proposed change.' : 'The AI proposed nothing, so the teacher added a note to the plan.'
      })
      await step('teacher', 'Approve the tailored plan', home, async () => {
        const plan = need(ctx.plan, 'The lesson plan')
        ctx.plan = ok(await call('teacher', 'POST', `/lesson-plans/${plan.id}/approve`, { studentId, version: plan.version }), 'approve plan').plan
        return `The tailored plan is ${ctx.plan.status}.`
      })

      // d. EA: reads the plan and records the day
      await step('ea', 'Read the approved plan', home, async () => {
        const plans = ok(await call('ea', 'GET', `/students/${studentId}/lesson-plans`), 'plans').plans as any[]
        if (!plans.some((p) => p.status === 'approved')) throw new Error('The EA sees no approved plan.')
        return `The EA sees ${plans.length} approved plan with the tailored lesson.`
      })
      await step('ea', 'Log a typed note', '/capture', async () => {
        ok(await call('ea', 'POST', `/students/${studentId}/notes`, { text: 'Used the picture card to ask for help twice during the reading passage.' }), 'note')
        return 'Typed note saved to today.'
      })
      await step('ea', 'Log a prompt level, a count and a timed break', '/capture', async () => {
        // Each event kind only feeds objectives of matching metric types (services/measurement.ts EVENT_METRICS).
        const planned = [
          { what: 'a gesture prompt', objective: objectiveFor(['prompt_level']), event: { kind: 'prompt_level', promptLevel: 'gesture' } },
          { what: 'a count of 5', objective: objectiveFor(['frequency', 'rate']), event: { kind: 'counter', count: 5 } },
          { what: 'a 4 minute return to task', objective: objectiveFor(['duration', 'latency']), event: { kind: 'timer', durationSeconds: 240 } },
        ]
        const saved: string[] = []
        const skipped: string[] = []
        for (const p of planned) {
          if (!p.objective) {
            skipped.push(p.what)
            continue
          }
          ok(await call('ea', 'POST', `/students/${studentId}/events`, { ...p.event, objectiveId: p.objective.id, ...eventBase }), `${p.event.kind} event`)
          saved.push(p.what)
        }
        if (!saved.length) throw new Error('No confirmed objective takes a prompt level, a count or a timer.')
        return `Saved ${saved.join(', ')}.${skipped.length ? ` Skipped ${skipped.join(', ')}: no confirmed objective of that type.` : ''}`
      })
      await step('ea', 'Send a voice note', '/capture', async () => {
        // Real recordings go to the AI; with Gemini on there is no audio to send, so only the fixture provider runs this step.
        if (hasGeminiKey(env)) return 'Skipped: a voice note needs a real recording. Try it on the Capture page.'
        const res = ok(await call('ea', 'POST', `/students/${studentId}/voice-notes`, { audio: { fileKey: `demo/${studentId}/voice-note.webm`, contentType: 'audio/webm' } }), 'voice note')
        return `The voice note became ${res.dataPoints.length} entries and the recording was deleted.`
      })
      await step('teacher', 'Print the sample coded sheet', '/capture', async () => {
        const res = ok(await call('teacher', 'POST', '/captures/sample-sheet', { studentId }), 'sample sheet')
        ctx.sheetCode = res.code
        return `Sheet ${res.code} is ready for a photo.`
      })
      await step('ea', 'Photograph the coded sheet', '/capture', async () => {
        const code = need(ctx.sheetCode, 'The sample sheet')
        const batch = ok(await call('ea', 'POST', '/captures/photos', { pages: [{ fileKey: `captures/sample-sheet-code-${code}.jpg`, contentType: 'image/jpeg' }] }), 'photo').batch
        const page = batch.pages[0]
        if (page.status !== 'scored') throw new Error(`The sheet was not scored (${page.status}).`)
        return 'The page was scored. Items the AI was unsure about wait for review.'
      })
      await step('ea', 'Confirm the review queue', '/capture', async () => {
        const queue = ok(await call('ea', 'GET', `/review-queue?studentId=${studentId}`), 'review queue').items as any[]
        const mine = queue.filter((i) => i.studentId === studentId)
        for (const entry of mine) ok(await call('ea', 'POST', `/review-queue/${entry.item.id}/confirm?studentId=${studentId}`, { expectedVersion: entry.item.version }), 'confirm review')
        return mine.length ? `Confirmed ${mine.length} item${mine.length === 1 ? '' : 's'}.` : 'Nothing needed review.'
      })

      // e. Teacher observation
      await step('teacher', 'Add an observation note', home, async () => {
        ok(await call('teacher', 'POST', `/students/${studentId}/notes`, { text: 'Joined the group activity and placed two stage cards in the right order.' }), 'note')
        return 'Observation saved to today.'
      })

      // f. EA: end of day
      await step('ea', 'Finish the day for this student', '/end-of-day', async () => {
        const review = ok(await call('ea', 'GET', '/me/day-review'), 'day review')
        ctx.date = review.date
        const listed = (review.students as any[]).find((s) => s.studentId === studentId)
        if (!listed) throw new Error('The student is not on the EA\'s end of day list.')
        const done = ok(await call('ea', 'POST', `/students/${studentId}/days/${review.date}/complete`, { note: 'A calm day with the picture cards.' }), 'complete day')
        ctx.daily = done.dailySummary
        return `Day reviewed with ${listed.entriesToday} entries. ${done.dailySummary ? 'A daily summary was drafted.' : 'The daily summary could not be drafted.'}`
      })
      await step('ea', 'Approve the daily summary', '/summaries', async () => {
        if (!ctx.daily) {
          ctx.daily = ok(await call('ea', 'POST', `/students/${studentId}/summaries/generate`, { kind: 'daily', period: need(ctx.date, 'The day review') }), 'daily summary').summary
        }
        const approved = ok(await call('ea', 'POST', `/summaries/${ctx.daily.id}/approve`, { studentId, version: ctx.daily.version }), 'approve daily').summary
        return `The daily summary is ${approved.status}.`
      })

      // g/h. Weekly and monthly drafts, the approval rule, then approvals and readers
      await step('teacher', 'Draft the weekly summary', '/summaries', async () => {
        ctx.weekly = ok(await call('teacher', 'POST', `/students/${studentId}/summaries/generate`, { kind: 'weekly' }), 'weekly').summary
        return `Weekly draft for ${ctx.weekly.period}.`
      })
      await step('teacher', `Draft the monthly family summary (${DEMO_STUDENT.homeLanguageName})`, '/summaries', async () => {
        let monthly = ok(await call('teacher', 'POST', `/students/${studentId}/summaries/generate`, { kind: 'monthly', language: DEMO_STUDENT.homeLanguage }), 'monthly').summary
        let note = `The AI wrote the ${DEMO_STUDENT.homeLanguageName} version.`
        if (!monthly.translatedText) {
          // The offline fixture only writes English: the teacher adds a short sample translation, as a real teacher fixes a translation.
          monthly = ok(
            await call('teacher', 'PATCH', `/summaries/${monthly.id}`, { studentId, text: monthly.text, translatedText: DEMO_TRANSLATION_SAMPLE, language: DEMO_STUDENT.homeLanguage, version: monthly.version }),
            'add translation',
          ).summary
          note = `The offline AI writes English only, so the teacher added a short ${DEMO_STUDENT.homeLanguageName} sample.`
        }
        ctx.monthly = monthly
        return `Monthly draft for ${monthly.period}. ${note}`
      })
      await step('parent', 'Check the AI approval rule', '/family', async () => {
        const weekly = need(ctx.weekly, 'The weekly draft')
        const monthly = need(ctx.monthly, 'The monthly draft')
        const parentSees = ok(await call('parent', 'GET', `/family/${studentId}/summaries`), 'parent list').summaries as any[]
        if (parentSees.length) throw new Error(`The parent can see ${parentSees.length} summary before approval.`)
        const cmWeekly = (ok(await call('case_manager', 'GET', '/me/weekly'), 'weekly list').summaries as any[]).filter((s) => s.studentId === studentId)
        if (cmWeekly.length) throw new Error('The case manager can see a weekly draft before approval.')
        const parentApprove = await call('parent', 'POST', `/summaries/${monthly.id}/approve`, { studentId, version: monthly.version })
        const cmApprove = await call('case_manager', 'POST', `/summaries/${weekly.id}/approve`, { studentId, version: weekly.version })
        if (parentApprove.status !== 403 || cmApprove.status !== 403) throw new Error('Someone other than the EA or teacher could approve a summary.')
        return 'Before approval: the parent sees no monthly summary, the case manager sees no weekly summary, and neither can approve.'
      })
      await step('teacher', 'Approve the weekly summary', '/summaries', async () => {
        const weekly = need(ctx.weekly, 'The weekly draft')
        const approved = ok(await call('teacher', 'POST', `/summaries/${weekly.id}/approve`, { studentId, version: weekly.version }), 'approve weekly').summary
        return `The weekly summary is ${approved.status}.`
      })
      await step('case_manager', 'Read the weekly summary', '/summaries', async () => {
        const weekly = need(ctx.weekly, 'The weekly draft')
        const list = ok(await call('case_manager', 'GET', '/me/weekly'), 'weekly list').summaries as any[]
        if (!list.some((s) => s.id === weekly.id)) throw new Error('The approved weekly summary is not in the case manager\'s list.')
        return 'The case manager sees the approved weekly summary.'
      })
      await step('teacher', 'Approve the monthly family summary', '/summaries', async () => {
        const monthly = need(ctx.monthly, 'The monthly draft')
        const approved = ok(await call('teacher', 'POST', `/summaries/${monthly.id}/approve`, { studentId, version: monthly.version }), 'approve monthly').summary
        return `The monthly summary is ${approved.status}.`
      })
      await step('parent', `Read the monthly summary in ${DEMO_STUDENT.homeLanguageName}`, '/family', async () => {
        const monthly = need(ctx.monthly, 'The monthly draft')
        const list = ok(await call('parent', 'GET', `/family/${studentId}/summaries`), 'parent list').summaries as any[]
        const seen = list.find((s) => s.id === monthly.id)
        if (!seen) throw new Error('The approved monthly summary is not visible to the parent.')
        return `${seen.translatedText ? `Shown in ${seen.language === DEMO_STUDENT.homeLanguage ? DEMO_STUDENT.homeLanguageName : seen.language}` : 'Shown in English'}${seen.audioScript ? ', with a read-aloud script' : ''}.`
      })

      // i. IEP change ticket
      await step('case_manager', 'File an IEP change ticket', '/admin/tickets', async () => {
        ok(
          await call('case_manager', 'POST', `/students/${studentId}/tickets`, {
            target: 'accommodations',
            proposedChange: 'Offer a choice of two seats during group activities.',
            reason: 'Group work was easier when she could choose where to sit.',
          }),
          'ticket',
        )
        return 'Ticket filed against the confirmed IEP.'
      })
      await step('school_admin', 'Apply the ticket', '/admin/tickets', async () => {
        const pending = (ok(await call('school_admin', 'GET', '/tickets?status=pending'), 'tickets').tickets as any[]).find((t) => t.studentId === studentId)
        if (!pending) throw new Error('The ticket is not waiting for the school administrator.')
        const applied = ok(await call('school_admin', 'POST', `/tickets/${pending.id}/apply`), 'apply ticket')
        const before = need(ctx.ticketIep, 'The IEP confirmation')
        if (applied.iepVersion <= before) throw new Error('The IEP version did not increase.')
        return `The IEP went from version ${before} to version ${applied.iepVersion}.`
      })

      // j. District lead
      await step('district_lead', 'Read the monthly anonymized summary', '/insights', async () => {
        const res = ok(await call('district_lead', 'GET', `/districts/${deps.districtId(env)}/insights`), 'insights')
        const suppressed = (res.groups as any[]).filter((g) => g.suppressed).length
        return res.groups.length ? `${res.groups.length} groups, ${suppressed} hidden because they have fewer than 10 students.` : `No group is large enough to show yet. ${short(res.monthlyNarrative.text, 90)}`
      })

      // Give the caller the view of the role they were using (their access now includes the new student).
      try {
        const active = (await r.school(devRoleSwitch, {})).active
        await r.school(devRoleSwitch, { role: ACTOR_ROLES.find((x) => x === active) ?? 'case_manager' })
      } catch {
        /* the steps above are the result; the UI refreshes the role */
      }
      return c.json({ studentId, steps } satisfies DemoDayResult)
    },
  )
}
