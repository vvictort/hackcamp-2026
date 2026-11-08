import { describe, expect, it } from 'vitest'
import { insightsRoomId, schoolRoomId, studentRoomId } from '../contract/common'
import { DISTRICT, SCHOOL, STUDENT_IDS } from '../fixtures/school'
import { isAltamiraRoomId } from './room-guard'

describe('isAltamiraRoomId (generic /ws/:roomId guard)', () => {
  it('refuses student, school and district rooms', () => {
    expect(isAltamiraRoomId(studentRoomId(STUDENT_IDS.kai))).toBe(true)
    expect(isAltamiraRoomId(schoolRoomId(SCHOOL.id))).toBe(true)
    expect(isAltamiraRoomId(insightsRoomId(DISTRICT.id))).toBe(true)
  })

  it('leaves existing app rooms alone', () => {
    expect(isAltamiraRoomId('app:app_01M6W5E2JSMTVRXR1DSV6SPHGT')).toBe(false)
    expect(isAltamiraRoomId('my-student-notes')).toBe(false)
  })
})
