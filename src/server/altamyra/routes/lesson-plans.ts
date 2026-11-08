import type { Hono } from 'hono'
import { z } from 'zod'
import type { AltamyraEnv } from '../middleware/auth'
import { aiFailureResponse } from '../middleware/errors'
import { PlanApproveBody, PlanCreateBody, PlanPatchBody, PlansTodayResponse, StudentPlansResponse, LessonPlanView, type ProposedChange } from '../contract/plans'
import { DateString } from '../contract/common'
import { maritimeAgent, maritimeFeedback, teacherHash } from '../ai/providers/maritime'
import { newId } from '../repos/base'
import { lensContext } from '../services/lens'
import { composeTailored, lessonPlansApprove, lessonPlansCreate, lessonPlansForStudent, lessonPlansToday, lessonPlansUpdate, toView } from '../services/lesson-plans'
import { guardrail } from '../services/student-common'
import type { Kit, Req } from './context'
import { studentToken } from './student-flows'

const PlanResponse = z.object({ plan: LessonPlanView })
const DateQuery = z.object({ date: DateString.optional() })
/** Subject used when a plan is not tied to a scheduled class. */
const GENERAL_SUBJECT = 'general'

/**
 * Runs Lesson Lens for one student on de-identified input (the IEP profile and the lesson text).
 * Each adaptation becomes a proposed change the teacher accepts or drops; a modification the IEP does not authorize is left out.
 */
async function proposeChanges(r: Req, studentId: string, title: string, text: string): Promise<ProposedChange[]> {
  const { token, grade } = await studentToken(r, studentId)
  const { profile, whatWorks } = await r.student(studentId, lensContext, { studentToken: token, grade })
  const ai = await r.ai([studentId])
  const lessonId = newId()
  const analysis = await ai.analyseLesson({ lessonId, title, subject: GENERAL_SUBJECT, grade, text, file: null })
  const lens = await ai.lensForStudent({ lessonId, subject: GENERAL_SUBJECT, analysis, lessonText: text, profile, whatWorks })
  const proposed: ProposedChange[] = []
  for (const a of lens.adaptations) {
    const { label, blocked } = guardrail(a.changesOutcome, a.modelLabel, GENERAL_SUBJECT, profile.modificationSubjects)
    if (blocked) continue
    proposed.push({ id: newId(), text: `${a.title}: ${a.text}`, label, accepted: true })
  }
  return proposed
}

function teachAgent(r: Req, studentId: string, proposed: ProposedChange[]): void {
  const agent = maritimeAgent(r.env)
  if (!agent || !proposed.length) return
  const job = (async () => {
    const [ai, teacher] = await Promise.all([r.ai([studentId]), teacherHash(r.actor.userId)])
    await Promise.all(
      proposed.map((p) => maritimeFeedback(agent, { teacher, kind: p.label, text: ai.deidText(p.text), decision: p.accepted ? 'approved' : 'rejected' })),
    )
  })().catch(() => console.warn('[maritime] feedback not delivered'))
  try {
    r.c.executionCtx.waitUntil(job)
  } catch {
    return
  }
}

/** Per-student lesson plans: original, proposed changes, tailored. The teacher edits and approves; EA and case manager read approved plans. */
export function lessonPlanRoutes(app: Hono<AltamyraEnv>, kit: Kit): void {
  const { mw, signedIn, req } = kit

  /** Home screens: teacher sees every class student (draft or missing plan); EA and case manager see approved plans only. */
  app.get('/lesson-plans/today', signedIn, async (c) => {
    const r = req(c)
    return r.json(PlansTodayResponse, await r.school(lessonPlansToday, { date: r.today() }))
  })

  app.get('/students/:id/lesson-plans', signedIn, mw.requireCapability('lesson_plan.view'), async (c) => {
    const r = req(c)
    const { date } = r.query(DateQuery, { date: c.req.query('date') })
    return r.json(StudentPlansResponse, await r.school(lessonPlansForStudent, { studentId: r.param('id'), date: date ?? r.today() }))
  })

  /** Stores the original, runs Lesson Lens for this student and saves a draft: proposed changes and a tailored plan. */
  app.post('/students/:id/lesson-plans', signedIn, mw.requireCapability('lesson_plan.edit'), async (c) => {
    const r = req(c)
    const studentId = r.param('id')
    const body = await r.body(PlanCreateBody)
    let proposed: ProposedChange[]
    try {
      proposed = await proposeChanges(r, studentId, body.title, body.text)
    } catch (err) {
      const res = aiFailureResponse(err)
      if (res) return res
      throw err
    }
    const { plan } = await r.school(lessonPlansCreate, {
      studentId,
      date: body.date ?? r.today(),
      title: body.title,
      originalText: body.text,
      proposed,
      tailoredText: composeTailored(body.text, proposed),
    })
    return r.json(PlanResponse, { plan: toView(plan) }, 201)
  })

  /** Teacher edits; the plan returns to draft until approved again. 409 when the version is stale. */
  app.patch('/lesson-plans/:planId', signedIn, async (c) => {
    const r = req(c)
    const { studentId, ...patch } = await r.body(PlanPatchBody)
    r.allow('lesson_plan.edit', studentId)
    const { plan } = await r.school(lessonPlansUpdate, { ...patch, studentId, planId: r.param('planId') })
    return r.json(PlanResponse, { plan: toView(plan) })
  })

  app.post('/lesson-plans/:planId/approve', signedIn, async (c) => {
    const r = req(c)
    const { studentId, version } = await r.body(PlanApproveBody)
    r.allow('adaptation.approve', studentId)
    const { plan } = await r.school(lessonPlansApprove, { studentId, version, planId: r.param('planId') })
    teachAgent(r, studentId, plan.proposed)
    return r.json(PlanResponse, { plan: toView(plan) })
  })
}
