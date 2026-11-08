import { describe, expect, it } from 'vitest'
import { assignBody } from './roles-admin'

describe('assignBody', () => {
  it('builds a membership and trims input', () => {
    expect(assignBody({ userId: ' u1 ', displayName: ' Ana ', role: 'ea', studentId: ' s1 ' })).toEqual({
      kind: 'membership', userId: 'u1', displayName: 'Ana', role: 'ea', studentId: 's1', classId: null, districtId: null,
    })
  })
  it('sends a null student when blank', () => {
    expect(assignBody({ userId: 'u', displayName: 'T', role: 'teacher', studentId: '' })).toMatchObject({ kind: 'membership', studentId: null })
  })
  it('turns a parent into a parent link', () => {
    expect(assignBody({ userId: 'u', displayName: 'P', role: 'parent', studentId: 's1' })).toEqual({ kind: 'parent_link', userId: 'u', displayName: 'P', studentId: 's1' })
  })
})
