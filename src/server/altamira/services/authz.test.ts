import { describe, expect, it } from 'vitest'
import { AltamiraError } from '../contract/errors'
import { sessionActor, userActor } from '../contract/permissions'
import { authorize, authorizeEventRecord, authorizeObjectivesRead } from './authz'

const ea = userActor('ea-1', { studentRoles: { s1: ['ea'] } })
const session = sessionActor({ kind: 'student_session', studentId: 's1', tokenId: 't', expiresAt: '2999-01-01T00:00:00.000Z', startedBy: 'ea-1' })

describe('EA authorisation', () => {
  it('reads objectives and records events for an assigned student', () => {
    expect(authorizeObjectivesRead(ea, 's1').role).toBe('ea')
    expect(authorizeEventRecord(ea, 's1').role).toBe('ea')
  })
  it('cannot edit the IEP or confirm objectives', () => {
    expect(() => authorize(ea, 'iep.write', 's1')).toThrow(AltamiraError)
    expect(() => authorize(ea, 'objective.confirm', 's1')).toThrow(AltamiraError)
  })
  it('is refused for a student they are not assigned to', () => {
    expect(() => authorizeObjectivesRead(ea, 's2')).toThrow(AltamiraError)
    expect(() => authorizeEventRecord(ea, 's2')).toThrow(AltamiraError)
  })
  it('student sessions never read objectives', () => {
    expect(() => authorizeObjectivesRead(session, 's1')).toThrow(AltamiraError)
  })
})
