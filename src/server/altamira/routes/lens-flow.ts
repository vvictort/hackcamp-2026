import { studentsGet } from '../services/school'
import type { Req } from './context'

/** The student's de-identified display token and grade, shared by the capture, family and progress routes. */
export async function studentToken(r: Req, studentId: string): Promise<{ token: string; grade: string }> {
  const { student } = await r.school(studentsGet, { studentId })
  return { token: student.displayToken, grade: student.grade }
}
