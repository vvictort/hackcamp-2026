import { describe, expect, it } from 'vitest'
import { AltamyraError } from '../contract/errors'
import { userActor } from '../contract/permissions'
import { authorize, authorizeStaff } from './authz'

const ea = userActor('ea-1', { studentRoles: { s1: ['ea'] } })

describe('EA authorisation', () => {
  it('reads objectives and records events for an assigned student', () => {
    expect(authorize(ea, 'iep.view', 's1').role).toBe('ea')
    expect(authorizeStaff(ea, 'evidence.capture', 's1').role).toBe('ea')
  })
  it('cannot import the IEP or confirm objectives', () => {
    expect(() => authorize(ea, 'iep.import', 's1')).toThrow(AltamyraError)
    expect(() => authorize(ea, 'objective.confirm', 's1')).toThrow(AltamyraError)
  })
  it('is refused for a student they are not assigned to', () => {
    expect(() => authorize(ea, 'iep.view', 's2')).toThrow(AltamyraError)
    expect(() => authorizeStaff(ea, 'evidence.capture', 's2')).toThrow(AltamyraError)
  })
})
