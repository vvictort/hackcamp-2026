import { afterEach, describe, expect, it, vi } from 'vitest'
import { opErr, opOk, type SqlExecutor } from '../contract/ops'
import { STUDENT_IDS } from '../fixtures/school'
import { studentOps } from '../services/registry'
import { closeAll, studentRoom } from '../e2e/testing'
import { runRoomOp } from './core'
import { ALTAMYRA_CRON, runAltamyraCronTask, SYSTEM_ACTOR, type JobDeps } from './jobs-core'

afterEach(closeAll)

const students = Object.values(STUDENT_IDS)

function deps(overrides: Partial<JobDeps> = {}): JobDeps & { logs: string[] } {
  const logs: string[] = []
  return {
    logs,
    listStudentIds: async () => students,
    runStudentOp: vi.fn(async () => opOk(null)),
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
  const d: JobDeps & { logs: string[] } = {
    logs: [],
    listStudentIds: async () => [...rooms.keys()],
    runStudentOp: async (id, op, args) => runRoomOp(rooms.get(id)!, studentOps, op, args, SYSTEM_ACTOR, { room: 'student', requireAudit: true }),
    log: (m) => d.logs.push(m),
    now: () => new Date(now),
  }
  return { d, rooms }
}

describe('Altamyra cron tasks', () => {
  it('ignores tasks that are not Altamyra', async () => {
    expect(await runAltamyraCronTask('heartbeat', deps())).toEqual({ status: 'not_altamyra' })
  })

  it('passes each student room its own studentId and the job clock', async () => {
    const d = deps({ now: () => new Date('2026-11-09T14:00:00.000Z') })
    await runAltamyraCronTask(ALTAMYRA_CRON.dataNeeded, d)
    expect(d.runStudentOp).toHaveBeenCalledWith(STUDENT_IDS.kai, 'dataNeeded.scan', { studentId: STUDENT_IDS.kai, now: '2026-11-09T14:00:00.000Z' })
  })

  it('runs per-student ops in every student room and counts failures without logging ids', async () => {
    const d = deps({
      runStudentOp: vi.fn(async (id: string) => {
        if (id === STUDENT_IDS.amara) throw new Error('boom')
        if (id === STUDENT_IDS.sofia) return opErr('not_found', 'x')
        return opOk(null)
      }),
    })
    expect(await runAltamyraCronTask(ALTAMYRA_CRON.dataNeeded, d)).toEqual({ status: 'done', ran: 3, failed: 2 })
    expect(d.logs.join(' ')).not.toMatch(/57d0/)
  })

  it('uses a system actor with no roles', () => {
    expect(SYSTEM_ACTOR.studentRoles).toEqual({})
  })
})

describe('Altamyra cron tasks through the real op registries', () => {
  it('the data-needed scan runs in every student room', async () => {
    const { d, rooms } = realDeps('2026-11-20T14:00:00.000Z')
    expect(await runAltamyraCronTask(ALTAMYRA_CRON.dataNeeded, d)).toEqual({ status: 'done', ran: 3, failed: 0 })
    const attempts = rooms.get(STUDENT_IDS.kai)!.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'dataNeeded.schedule'")?.n
    expect(attempts).toBeGreaterThan(0)
  })

})

describe('removed jobs', () => {
  it('has no weekly digest or link expiry task', async () => {
    expect(await runAltamyraCronTask('altamyra.weekly-digest', deps())).toEqual({ status: 'not_altamyra' })
    expect(await runAltamyraCronTask('altamyra.today-link-expiry', deps())).toEqual({ status: 'not_altamyra' })
  })
})
