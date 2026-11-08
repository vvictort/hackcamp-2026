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
import { aiFailureResponse, parseCbIepText } from './cbiep'
import { extractPdfText } from './pdf-text'
import type { Kit } from './context'

/**
 * The CB-IEP text: pasted, or read from the PDF's text layer here, in the
 * Worker. The PDF itself never goes to a model, because names can only be
 * removed from text (PRD NFR Privacy).
 */
async function importText(body: IepImportBody): Promise<string> {
  if (body.sourceKind === 'text') return body.text ?? ''
  const b64 = body.file?.bytesBase64
  if (!b64) throw new HttpError('bad_request', 'Send the CB-IEP PDF bytes inline (file.bytesBase64).')
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
  } catch {
    throw new HttpError('bad_request', 'file.bytesBase64 is not valid base64.')
  }
  const text = await extractPdfText(bytes)
  if (!text) throw new HttpError('bad_request', 'This PDF has no readable text layer; paste the CB-IEP text with sourceKind "text".')
  return text
}

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
    const sections = parseCbIepText(await importText(body))
    const { student } = await r.school(studentsGet, { studentId })
    const { iep, goals } = await r.student(studentId, iepImport, { sections, sourceFileKey: body.file?.fileKey ?? null })

    // AI runs outside any room transaction, on de-identified input. The roster reads this student's IEP versions,
    // so the names in the import just stored are stripped and scanned for.
    const objectiveProposals = []
    try {
      const ai = await r.ai([studentId])
      // In parallel: every call has its own chain budget (35 s), so the whole import stays under one budget, not one per goal.
      objectiveProposals.push(
        ...(await Promise.all(goals.map((g) => ai.proposeObjectives({ studentToken: student.displayToken, goalId: g.id, area: g.area, goalText: g.text })))),
      )
    } catch (err) {
      const res = aiFailureResponse(err)
      if (res) return res
      throw err
    }
    await r.student(studentId, objectivesPropose, { proposals: objectiveProposals })
    return r.json(IepImportResponse, { iep, goals, objectiveProposals })
  })

  /** Source text of a CB-IEP PDF (its text layer), so the case manager can read it beside the parsed result. */
  app.post('/students/:id/iep/source-text', signedIn, mw.requireCapability('iep.write'), async (c) => {
    const r = req(c)
    const body = await r.body(IepImportBody)
    return c.json({ text: await importText(body) })
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
