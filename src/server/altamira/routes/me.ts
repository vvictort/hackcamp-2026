import type { Hono } from 'hono'
import {
  AdminMembershipBody,
  AdminMembershipResponse,
  DevSeedResponse,
  DigestResponse,
  InsightsQuery,
  InsightsResponse,
  MeResponse,
  ProposalsResponse,
} from '../contract/api'
import { z } from 'zod'
import { DEV_ROLES, devRoleSwitch } from '../rooms/core'
import { HttpError } from '../middleware/errors'
import type { AltamiraEnv } from '../middleware/auth'
import { digestWeekly } from '../services/insight'
import { insightsGet } from '../services/insights'
import { studentDevSeedDemo, devLinkStudent } from '../fixtures/demo'
import { DISTRICT, SCHOOL, STUDENT_IDS, USER_IDS } from '../fixtures/school'
import { ComingUpResponse, comingUpList } from '../services/coming-up'
import { proposalsList } from '../services/measurement'
import { meOverview, membershipsAssign, schoolDevSeed } from '../services/school'
import type { Kit } from './context'

/** Me, Admin, dev seed and District Insights routes. */
export function meRoutes(app: Hono<AltamiraEnv>, kit: Kit): void {
  const { mw, signedIn, req, deps } = kit

  app.get('/me', signedIn, async (c) => {
    const r = req(c)
    const me = MeResponse.parse(await r.school(meOverview, { date: r.today() }))
    // devSeed tells the UI whether to show demo controls; true only when ALTAMIRA_DEV_SEED === 'true'.
    return c.json({ ...me, devSeed: deps.devSeedEnabled(c.env) })
  })

  /** Case manager: every proposal for the caseload. Teacher: their own (PRD "Teachers propose"). */
  app.get('/me/proposals', signedIn, async (c) => {
    const r = req(c)
    const status = c.req.query('status')
    const proposals = []
    for (const studentId of r.staffStudentIds()) {
      if (!r.can('iep.write', studentId) && !r.can('iep.propose', studentId)) continue
      proposals.push(...(await r.student(studentId, proposalsList, status ? { status } : {})).proposals)
    }
    return r.json(ProposalsResponse, { proposals })
  })

  /** PRD 1B: decision-rule alerts go to the case manager only. */
  app.get('/me/digest', signedIn, async (c) => {
    const r = req(c)
    const items = []
    for (const studentId of r.staffStudentIds()) {
      if (!r.actor.studentRoles[studentId]?.includes('case_manager')) continue
      items.push(...(await r.student(studentId, digestWeekly)).items)
    }
    return r.json(DigestResponse, { items })
  })

  /** Scheduled work for the caseload over the next 14 days: IEP meetings, review queue, data due. */
  app.get('/me/coming-up', signedIn, async (c) => {
    const r = req(c)
    const items = []
    for (const studentId of r.staffStudentIds()) {
      try {
        items.push(...(await r.student(studentId, comingUpList)).items)
      } catch {
        /* no access to this student: skip */
      }
    }
    items.sort((a, b) => a.date.localeCompare(b.date))
    return r.json(ComingUpResponse, { items })
  })

  /** PRD: "Role assignment is done by a school administrator outside these roles." */
  app.post(
    '/admin/schools/:id/memberships',
    signedIn,
    mw.requireCapability('membership.manage', 'none', (c) => ({ schoolId: c.req.param('id') })),
    async (c) => {
      const r = req(c)
      const schoolId = r.param('id')
      if (schoolId !== deps.schoolId(r.env)) throw new HttpError('not_found', 'school not found')
      const grant = await r.body(AdminMembershipBody)
      return r.json(AdminMembershipResponse, await r.school(membershipsAssign, { schoolId, grant }))
    },
  )

  /** Dev only: loads the fictional fixtures. 404 unless env ALTAMIRA_DEV_SEED is "true". */
  app.post('/dev/seed', async (c, next) => {
    if (!deps.devSeedEnabled(c.env)) throw new HttpError('not_found', 'not found')
    await next()
  }, signedIn, async (c) => {
    const r = req(c)
    // {reset:true} wipes the demo rows and reloads them dated from now. Same dev flag gate as the route.
    const reset = (await c.req.json().catch(() => ({})))?.reset === true
    if (reset) await r.school(devLinkStudent, { reset: true })
    const seeded = reset
      ? { schoolId: SCHOOL.id, districtId: DISTRICT.id, studentIds: Object.values(STUDENT_IDS), userIds: { ...USER_IDS } as Record<string, string> }
      : await r.school(schoolDevSeed, {})
    for (const studentId of seeded.studentIds) await r.student(studentId, studentDevSeedDemo, reset ? { reset: true } : {})
    // The caller acts as the case manager by default.
    await r.school(devRoleSwitch, { role: 'case_manager' })
    return r.json(DevSeedResponse, seeded)
  })

  /** Dev only: the roles the caller can act as, and the active one. */
  app.get('/dev/roles', async (c, next) => {
    if (!deps.devSeedEnabled(c.env)) throw new HttpError('not_found', 'not found')
    await next()
  }, signedIn, async (c) => {
    const r = req(c)
    return c.json(await r.school(devRoleSwitch, {}))
  })

  /** Dev only: act as another role. Swaps the caller's memberships for a copy of the fixture user's. */
  app.post('/dev/role', async (c, next) => {
    if (!deps.devSeedEnabled(c.env)) throw new HttpError('not_found', 'not found')
    await next()
  }, signedIn, async (c) => {
    const r = req(c)
    const { role } = await r.body(z.object({ role: z.enum(DEV_ROLES) }))
    const result = await r.school(devRoleSwitch, { role })
    // The student demo role needs Kai in scope so a session can start (staff-run, consent-gated).
    if (role === 'student') await r.school(devLinkStudent, {})
    return c.json(result)
  })

  /** District leads see anonymized aggregates only; groups under 10 students are suppressed in the room. */
  app.get(
    '/districts/:id/insights',
    signedIn,
    mw.requireCapability('insights.view', 'none', (c) => ({ districtId: c.req.param('id') })),
    async (c) => {
      const r = req(c)
      const districtId = r.param('id')
      if (districtId !== deps.districtId(r.env)) throw new HttpError('not_found', 'district not found')
      const groupBy = c.req.queries('groupBy')?.flatMap((g) => g.split(',')).filter(Boolean)
      const query = r.query(InsightsQuery, { period: c.req.query('period'), groupBy: groupBy?.length ? groupBy : undefined })
      return r.json(InsightsResponse, await r.insights(insightsGet, { districtId, ...query }))
    },
  )
}
