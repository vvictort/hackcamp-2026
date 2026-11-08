import { afterEach, describe, expect, it, vi } from 'vitest'
import { opErr, opOk } from '../contract/ops'
import type { SqlExecutor } from '../db/sql'
import { STUDENT_IDS } from '../fixtures/school'
import { schoolOps, studentOps } from '../services/registry'
import { closeAll, countRows, schoolRoom, studentRoom } from '../services/testing'
import { runRoomOp } from './core'
import { ALTAMIRA_CRON, runAltamiraCronTask, SYSTEM_ACTOR, type JobDeps } from './jobs-core'

afterEach(closeAll)

const students = Object.values(STUDENT_IDS)

function deps(registered: string[], overrides: Partial<JobDeps> = {}): JobDeps & { logs: string[] } {
  const logs: string[] = []
  return {
    logs,
    isRegistered: (_room, op) => registered.includes(op),
    listStudentIds: async () => students,
    runStudentOp: vi.fn(async () => opOk(null)),
    runSchoolOp: vi.fn(async () => opOk(null)),
    log: (m) => logs.push(m),
    ...overrides,
  }
}

/** The cron over the real op registries, on node:sqlite rooms seeded with the fixtures. */
function realDeps(now: string) {
  const rooms = new Map<string, SqlExecutor>([
    [STUDENT_IDS.kai, studentRoom('kai')],
    [STUDENT_IDS.amara, studentRoom('amara')],
    [STUDENT_IDS.sofia, studentRoom('sofia')],
  ])
  const school = schoolRoom()
  const d: JobDeps & { logs: string[] } = {
    logs: [],
    isRegistered: (room, op) => Object.hasOwn(room === 'student' ? studentOps : schoolOps, op),
    listStudentIds: async () => [...rooms.keys()],
    runStudentOp: async (id, op, args) => runRoomOp(rooms.get(id)!, studentOps, op, args, SYSTEM_ACTOR, { room: 'student', requireAudit: true }),
    runSchoolOp: async (op, args) => runRoomOp(school, schoolOps, op, args, SYSTEM_ACTOR, { room: 'school', requireAudit: true }),
    log: (m) => d.logs.push(m),
    now: () => new Date(now),
  }
  return { d, rooms }
}

describe('Altamira cron tasks', () => {
  it('ignores tasks that are not Altamira', async () => {
    expect(await runAltamiraCronTask('heartbeat', deps([]))).toEqual({ status: 'not_altamira' })
  })

  it('skips a task whose op is not registered, without calling any room', async () => {
    const d = deps([])
    expect(await runAltamiraCronTask(ALTAMIRA_CRON.weeklyDigest, d)).toEqual({ status: 'skipped', reason: 'op_missing', op: 'decisions.evaluate' })
    expect(d.runStudentOp).not.toHaveBeenCalled()
    expect(d.logs).toHaveLength(1)
  })

  it('passes each student room its own studentId and the job clock', async () => {
    const d = deps(['dataNeeded.scan'], { now: () => new Date('2026-11-09T14:00:00.000Z') })
    await runAltamiraCronTask(ALTAMIRA_CRON.dataNeeded, d)
    expect(d.runStudentOp).toHaveBeenCalledWith(STUDENT_IDS.kai, 'dataNeeded.scan', { studentId: STUDENT_IDS.kai, now: '2026-11-09T14:00:00.000Z' })
  })

  it('runs per-student ops in every student room and counts failures without logging ids', async () => {
    const d = deps(['dataNeeded.scan'], {
      runStudentOp: vi.fn(async (id: string) => {
        if (id === STUDENT_IDS.amara) throw new Error('boom')
        if (id === STUDENT_IDS.sofia) return opErr('not_found', 'x')
        return opOk(null)
      }),
    })
    expect(await runAltamiraCronTask(ALTAMIRA_CRON.dataNeeded, d)).toEqual({ status: 'done', op: 'dataNeeded.scan', ran: 3, failed: 2 })
    expect(d.logs.join(' ')).not.toMatch(/57d0/)
  })

  it('runs link expiry in the school room', async () => {
    const d = deps(['shareTokens.expire'])
    expect(await runAltamiraCronTask(ALTAMIRA_CRON.todayLinkExpiry, d)).toEqual({ status: 'done', op: 'shareTokens.expire', ran: 1, failed: 0 })
    expect(d.runSchoolOp).toHaveBeenCalledWith('shareTokens.expire', expect.any(Object))
  })

  it('uses a system actor with no roles', () => {
    expect(SYSTEM_ACTOR.studentRoles).toEqual({})
    expect(SYSTEM_ACTOR.session).toBeNull()
  })
})

describe('Altamira cron tasks through the real op registries', () => {
  it('weekly: evaluates decision rules in every student room with the system actor', async () => {
    const { d, rooms } = realDeps('2026-10-22T14:00:00.000Z')
    expect(await runAltamiraCronTask(ALTAMIRA_CRON.weeklyDigest, d)).toEqual({ status: 'done', op: 'decisions.evaluate', ran: 3, failed: 0 })
    // Kai's break-card series is above the aimline by then.
    expect(countRows(rooms.get(STUDENT_IDS.kai)!, 'decisions')).toBe(1)
  })

  it('daily: the data-needed scan runs in every student room', async () => {
    const { d, rooms } = realDeps('2026-11-20T14:00:00.000Z')
    expect(await runAltamiraCronTask(ALTAMIRA_CRON.dataNeeded, d)).toEqual({ status: 'done', op: 'dataNeeded.scan', ran: 3, failed: 0 })
    const attempts = rooms.get(STUDENT_IDS.kai)!.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'dataNeeded.schedule'")?.n
    expect(attempts).toBeGreaterThan(0)
  })

  it('daily: link expiry runs in the school room', async () => {
    const { d } = realDeps('2026-11-20T14:00:00.000Z')
    expect(await runAltamiraCronTask(ALTAMIRA_CRON.todayLinkExpiry, d)).toEqual({ status: 'done', op: 'shareTokens.expire', ran: 1, failed: 0 })
  })
})
