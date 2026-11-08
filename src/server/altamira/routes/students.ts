import type { Hono } from 'hono'
import {
  IepConfirmBody,
  IepConfirmResponse,
  IepImportBody,
  IepImportResponse,
  ObjectiveConfirmBody,
  ObjectiveFlagBody,
  ObjectiveResponse,
  ObjectivesResponse,
  ProposalCreateBody,
  ProposalResolveBody,
  ProposalResponse,
  StudentProfileResponse,
} from '../contract/api'
import { HttpError } from '../middleware/errors'
import type { AltamiraEnv } from '../middleware/auth'
import { profileGet } from '../services/lens'
import {
  iepConfirm,
  iepImport,
  objectivesConfirm,
  objectivesFlagUnmeasurable,
  objectivesList,
  objectivesPropose,
  proposalsCreate,
  proposalsResolve,
} from '../services/measurement'
import { studentsGet } from '../services/school'
import { parseCbIepText } from './cbiep'
import type { Kit } from './context'

/** Student profile, CB-IEP import, objectives and proposals. */
export function studentRoutes(app: Hono<AltamiraEnv>, kit: Kit): void {
  const { mw, signedIn, studentRef, req } = kit

  /** Profile shaped by role: EAs and student mode get supports only, never IEP text. */
  app.get('/students/:id', signedIn, mw.requireCapability('iep.view'), async (c) => {
    const r = req(c)
    const studentId = r.param('id')
    const { student } = await r.school(studentsGet, { studentId })
    const profile = await r.student(studentId, profileGet, { displayToken: student.displayToken, grade: student.grade })
    return r.json(StudentProfileResponse, profile)
  })

  /**
   * PRD: only case managers import the IEP; the import is a pending version
   * until confirmed side by side. Each goal gets an AI-proposed objective.
   */
  app.post('/students/:id/iep/import', signedIn, mw.requireCapability('iep.write'), async (c) => {
    const r = req(c)
    const studentId = r.param('id')
    const body = await r.body(IepImportBody)
    if (body.sourceKind === 'pdf' || body.text === null) {
      throw new HttpError('bad_request', 'PDF extraction is not available yet; send the CB-IEP text with sourceKind "text".')
    }
    const sections = parseCbIepText(body.text)
    const { student } = await r.school(studentsGet, { studentId })
    const { iep, goals } = await r.student(studentId, iepImport, { sections, sourceFileKey: body.file?.fileKey ?? null })

    // AI runs outside any room transaction, on de-identified input; the imported names are added to the roster.
    const { firstName, lastName, preferredName } = sections.student
    const ai = await r.ai([{ token: student.displayToken, firstName, lastName, preferredName }])
    const objectiveProposals = []
    for (const g of goals) {
      objectiveProposals.push(await ai.proposeObjectives({ studentToken: student.displayToken, goalId: g.id, area: g.area, goalText: g.text }))
    }
    await r.student(studentId, objectivesPropose, { proposals: objectiveProposals })
    return r.json(IepImportResponse, { iep, goals, objectiveProposals })
  })

  app.post('/students/:id/iep/:version/confirm', signedIn, mw.requireCapability('iep.write'), async (c) => {
    const r = req(c)
    const version = Number(r.param('version'))
    if (!Number.isInteger(version) || version < 1) throw new HttpError('bad_request', 'version must be a positive integer')
    const body = await r.body(IepConfirmBody)
    return r.json(IepConfirmResponse, await r.student(r.param('id'), iepConfirm, { version, ...body }))
  })

  // Reading objectives follows the iep.view row; confirming and flagging need objective.confirm.
  app.get('/students/:id/objectives', signedIn, mw.requireCapability('iep.view'), async (c) => {
    const r = req(c)
    return r.json(ObjectivesResponse, await r.student(r.param('id'), objectivesList))
  })

  app.post('/objectives/:oid/confirm', signedIn, studentRef, mw.requireCapability('objective.confirm'), async (c) => {
    const r = req(c)
    const body = await r.body(ObjectiveConfirmBody)
    return r.json(ObjectiveResponse, await r.student(r.studentRef(), objectivesConfirm, { objectiveId: r.param('oid'), ...body }))
  })

  app.post('/objectives/:oid/flag', signedIn, studentRef, mw.requireCapability('objective.confirm'), async (c) => {
    const r = req(c)
    const body = await r.body(ObjectiveFlagBody)
    return r.json(ObjectiveResponse, await r.student(r.studentRef(), objectivesFlagUnmeasurable, { objectiveId: r.param('oid'), ...body }))
  })

  /** PRD: teachers propose IEP or objective changes with evidence; the case manager resolves them. */
  app.post('/students/:id/proposals', signedIn, async (c) => {
    const r = req(c)
    const studentId = r.param('id')
    const body = await r.body(ProposalCreateBody)
    r.allow(body.target === 'objective' ? 'objective.propose' : 'iep.propose', studentId)
    return r.json(ProposalResponse, await r.student(studentId, proposalsCreate, body))
  })

  app.post('/proposals/:pid/resolve', signedIn, studentRef, mw.requireCapability('iep.write'), async (c) => {
    const r = req(c)
    const body = await r.body(ProposalResolveBody)
    return r.json(ProposalResponse, await r.student(r.studentRef(), proposalsResolve, { proposalId: r.param('pid'), ...body }))
  })
}
