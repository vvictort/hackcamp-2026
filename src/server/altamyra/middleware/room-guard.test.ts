import { describe, expect, it } from 'vitest'
import { insightsRoomId, schoolRoomId, studentRoomId } from '../contract/common'
import { DISTRICT, SCHOOL, STUDENT_IDS } from '../fixtures/school'
import { isAltamyraRoomId } from './room-guard'

describe('isAltamyraRoomId (generic /ws/:roomId guard)', () => {
  it('refuses student, school and district rooms', () => {
    expect(isAltamyraRoomId(studentRoomId(STUDENT_IDS.kai))).toBe(true)
    expect(isAltamyraRoomId(schoolRoomId(SCHOOL.id))).toBe(true)
    expect(isAltamyraRoomId(insightsRoomId(DISTRICT.id))).toBe(true)
  })

  it('leaves existing app rooms alone', () => {
    expect(isAltamyraRoomId('app:app_01M6W5E2JSMTVRXR1DSV6SPHGT')).toBe(false)
    expect(isAltamyraRoomId('my-student-notes')).toBe(false)
  })
})
