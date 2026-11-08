import { describe, expect, it } from 'vitest'
import { AltamiraError } from '../contract/errors'
import { userActor } from '../contract/permissions'
import { authorize, authorizeEventRecord, authorizeObjectivesRead } from './authz'

const ea = userActor('ea-1', { studentRoles: { s1: ['ea'] } })

describe('EA authorisation', () => {
  it('reads objectives and records events for an assigned student', () => {
    expect(authorizeObjectivesRead(ea, 's1').role).toBe('ea')
    expect(authorizeEventRecord(ea, 's1').role).toBe('ea')
  })
  it('cannot import the IEP or confirm objectives', () => {
    expect(() => authorize(ea, 'iep.import', 's1')).toThrow(AltamiraError)
    expect(() => authorize(ea, 'objective.confirm', 's1')).toThrow(AltamiraError)
  })
  it('is refused for a student they are not assigned to', () => {
    expect(() => authorizeObjectivesRead(ea, 's2')).toThrow(AltamiraError)
    expect(() => authorizeEventRecord(ea, 's2')).toThrow(AltamiraError)
  })
})
