import { describe, expect, it } from 'vitest'
import { insightsOps, schoolOps, studentOps } from './registry'

/** Op names the Integrator and Platform call by string. */
const REQUIRED = {
  school: [
    'memberships.assign', 'lessons.create', 'lessons.saveAnalysis', 'lessons.getAnalysis', 'sheetCodes.issue', 'sheetCodes.resolve',
    'memberships.list', 'me.overview', 'dev.seed',
  ],
  student: [
    'lens.saveRun', 'suggestions.approve', 'suggestions.edit', 'suggestions.regenerate', 'suggestions.reject', 'suggestions.bulkApprove', 'checks.list',
    'iep.import', 'iep.confirm', 'objectives.propose', 'objectives.confirm', 'objectives.flagUnmeasurable',
    'dataPoints.addPending', 'events.record', 'dataPoints.correct', 'review.list', 'review.confirm', 'timeline.get', 'goal.status', 'dataPoint.source',
    'aimline.get', 'whatWorks.get',
    'dataNeeded.scan', 'proficiency.set', 'consents.set', 'consents.list',
    'familySummaries.save', 'familySummaries.approve', 'familySummaries.list', 'voiceNote.process',
  ],
  insights: ['counters.push', 'insights.get'],
}

describe('op registries', () => {
  it('register every required op under its own name and room', () => {
    const regs = { school: schoolOps, student: studentOps, insights: insightsOps }
    for (const [room, names] of Object.entries(REQUIRED) as [keyof typeof regs, string[]][]) {
      for (const name of names) expect(regs[room][name]?.name, `${room}:${name}`).toBe(name)
      for (const [key, op] of Object.entries(regs[room])) {
        expect(op.name).toBe(key)
        expect(op.room).toBe(room)
        expect(op.args, `${key} parses its args`).toBeDefined()
      }
    }
  })

  it('has no op of a removed feature', () => {
    const removed = [
      'shareTokens.create', 'shareTokens.resolve', 'shareTokens.expire', 'proposals.create', 'proposals.list', 'proposals.resolve',
      'sessions.start', 'sessions.next', 'sessions.respond', 'sessions.progress', 'probes.schedule', 'digest.weekly', 'decisions.evaluate',
      'drafts.context', 'drafts.save', 'drafts.get', 'drafts.update', 'drafts.markUsed', 'parentInput.create', 'parentInput.list',
      'todayView.get', 'handoffs.create', 'handoffs.get', 'family.progress',
    ]
    const all = new Set([...Object.keys(studentOps), ...Object.keys(schoolOps), ...Object.keys(insightsOps)])
    for (const name of removed) expect(all.has(name), name).toBe(false)
  })
})
