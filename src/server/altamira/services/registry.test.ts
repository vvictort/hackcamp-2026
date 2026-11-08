import { describe, expect, it } from 'vitest'
import { insightsOps, schoolOps, studentOps } from './registry'

/** Op names the Integrator and Platform call by string. */
const REQUIRED = {
  school: [
    'memberships.assign', 'lessons.create', 'lessons.saveAnalysis', 'lessons.getAnalysis', 'sheetCodes.issue', 'sheetCodes.resolve',
    'shareTokens.create', 'shareTokens.resolve', 'shareTokens.expire', 'me.overview', 'dev.seed',
  ],
  student: [
    'lens.saveRun', 'suggestions.approve', 'suggestions.edit', 'suggestions.regenerate', 'suggestions.reject', 'suggestions.bulkApprove', 'checks.list',
    'iep.import', 'iep.confirm', 'objectives.propose', 'objectives.confirm', 'objectives.flagUnmeasurable', 'proposals.create', 'proposals.resolve',
    'dataPoints.addPending', 'events.record', 'dataPoints.correct', 'review.list', 'review.confirm', 'timeline.get', 'goal.status', 'dataPoint.source',
    'sessions.start', 'sessions.next', 'sessions.respond', 'sessions.progress', 'probes.schedule', 'aimline.get', 'whatWorks.get', 'digest.weekly',
    'dataNeeded.scan', 'proficiency.set', 'drafts.save', 'drafts.update', 'drafts.markUsed', 'consents.set', 'consents.list', 'parentInput.create',
    'family.progress', 'familySummaries.save', 'familySummaries.approve', 'todayView.get', 'handoffs.create', 'voiceNote.process',
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
})
