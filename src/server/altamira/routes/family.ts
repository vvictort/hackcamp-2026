import type { Hono } from 'hono'
import {
  FamilyConsentBody,
  FamilyConsentsResponse,
  FamilyInputBody,
  FamilyInputResponse,
  FamilyProgressResponse,
  FamilySummaryApproveBody,
  FamilySummaryCreateBody,
  FamilySummaryResponse,
  HandoffCreateBody,
  HandoffResponse,
  TodayLinkBody,
  TodayLinkResponse,
  TodayViewResponse,
} from '../contract/api'
import type { AltamiraEnv } from '../middleware/auth'
import { createTodayLink } from '../middleware/session'
import {
  consentsSet,
  familyProgress,
  familySummariesApprove,
  familySummariesSave,
  handoffsCreate,
  handoffsGet,
  parentInputCreate,
  todayViewGet,
} from '../services/family'
import { draftsGet } from '../services/insight'
import { todayViewSchedule } from '../services/integration'
import { lessonsGet } from '../services/school'
import type { Kit } from './context'
import { studentToken } from './lens-flow'

/** Family Bridge, Today View and Transition Handoff (milestone M4). */
export function familyRoutes(app: Hono<AltamiraEnv>, kit: Kit): void {
  const { mw, signedIn, studentRef, req, sessionDeps } = kit

  /** PRD: parents see only confirmed data; the room filters in SQL. */
  app.get('/family/:id/progress', signedIn, mw.requireCapability('progress.view'), async (c) => {
    const r = req(c)
    const studentId = r.param('id')
    const first = await r.student(studentId, familyProgress)
    const lessonTitles: Record<string, string> = {}
    for (const { lessonId } of first.lessons) {
      try {
        lessonTitles[lessonId] = (await r.school(lessonsGet, { lessonId })).lesson.title
      } catch {
        // A lesson the caller cannot open keeps the generic title.
      }
    }
    const lessons = first.lessons.map((l) => ({ ...l, title: lessonTitles[l.lessonId] ?? l.title }))
    return r.json(FamilyProgressResponse, { ...first, lessons })
  })

  app.post('/family/:id/input', signedIn, mw.requireCapability('parent_input.send'), async (c) => {
    const r = req(c)
    const body = await r.body(FamilyInputBody)
    return r.json(FamilyInputResponse, await r.student(r.param('id'), parentInputCreate, body), 201)
  })

  /** Parents manage consent; a case manager may record it (the room enforces which). */
  app.put('/family/:id/consents', signedIn, async (c) => {
    const r = req(c)
    const studentId = r.param('id')
    if (!r.can('consent.manage', studentId) && !r.can('consent.record', studentId)) r.allow('consent.manage', studentId)
    const body = await r.body(FamilyConsentBody)
    return r.json(FamilyConsentsResponse, await r.student(studentId, consentsSet, body))
  })

  /** Family summary drafted by the AI from a Progress Draft; the case manager approves it before parents see it. */
  app.post('/drafts/:did/family-summary', signedIn, studentRef, mw.requireCapability('family_summary.approve'), async (c) => {
    const r = req(c)
    const studentId = r.studentRef()
    const draftId = r.param('did')
    const body = await r.body(FamilySummaryCreateBody)
    const { draft } = await r.student(studentId, draftsGet, { draftId })
    const { token } = await studentToken(r, studentId)
    const ai = await r.ai()
    const out = await ai.summariseForFamily({ studentToken: token, language: body.language, draft: { sentences: draft.sentences } })
    return r.json(FamilySummaryResponse, await r.student(studentId, familySummariesSave, { draftId, language: out.language, text: out.text }), 201)
  })

  app.post('/family-summaries/:fsid/approve', signedIn, studentRef, mw.requireCapability('family_summary.approve'), async (c) => {
    const r = req(c)
    const body = await r.body(FamilySummaryApproveBody)
    return r.json(FamilySummaryResponse, await r.student(r.studentRef(), familySummariesApprove, { summaryId: r.param('fsid'), ...body }))
  })

  // ---------- Today View (PRD: substitute link, no login, expires) ----------

  app.post('/students/:id/today-links', signedIn, mw.requireCapability('today_link.create'), async (c) => {
    const r = req(c)
    const body = await r.body(TodayLinkBody)
    return r.json(TodayLinkResponse, await createTodayLink(sessionDeps, r.env, r.actor, r.param('id'), body.ttlHours), 201)
  })

  /** No login: the link token is the credential. Unknown 404, expired or revoked 410. */
  app.get('/today/:token', mw.todayViewAuth(), async (c) => {
    const r = req(c)
    const studentId = c.get('shareToken').studentId
    const { lessons, schedule } = await r.school(todayViewSchedule, { studentId, date: r.today() })
    return r.json(TodayViewResponse, await r.student(studentId, todayViewGet, { lessons, schedule }))
  })

  // ---------- Transition Handoff ----------

  app.post('/students/:id/handoffs', signedIn, mw.requireCapability('progress.view'), async (c) => {
    const r = req(c)
    const body = await r.body(HandoffCreateBody)
    return r.json(HandoffResponse, await r.student(r.param('id'), handoffsCreate, body), 201)
  })

  app.get('/handoffs/:hid', signedIn, studentRef, mw.requireCapability('progress.view'), async (c) => {
    const r = req(c)
    return r.json(HandoffResponse, await r.student(r.studentRef(), handoffsGet, { handoffId: r.param('hid') }))
  })
}
