import { z } from 'zod'
import { Id } from '../contract/common'
import { defineOp } from '../contract/ops'
import type { SqlExecutor } from '../db/sql'

/**
 * Roster data for de-identification (design doc "AI module": deidentify()
 * before any call; PRD NFR Privacy). The route builds the roster for each AI
 * call from these two ops, so real names are stripped and caught by the leak
 * scan, not only fixture names. Internal: no /api/v1 route returns them.
 */

export type StudentIdentity = { firstName: string; lastName: string; preferredName: string | null }

/** Every name this student's IEP versions carry (drafts included, since an import is analysed before it is confirmed). */
export const deidStudentNames = defineOp({
  name: 'deid.studentNames',
  room: 'student',
  args: z.object({ studentId: Id }),
  run(sql: SqlExecutor, _args): { names: StudentIdentity[] } {
    const rows = sql.all<{ first: string | null; last: string | null; preferred: string | null }>(
      `SELECT DISTINCT json_extract(sections_json, '$.student.firstName') AS first,
              json_extract(sections_json, '$.student.lastName') AS last,
              json_extract(sections_json, '$.student.preferredName') AS preferred
         FROM iep_versions ORDER BY version`,
    )
    return {
      names: rows
        .filter((r) => r.first && r.last)
        .map((r) => ({ firstName: String(r.first), lastName: String(r.last), preferredName: r.preferred ? String(r.preferred) : null })),
    }
  },
})

/** Staff and family display names, and the display token of each requested student. */
export const deidSchoolRoster = defineOp({
  name: 'deid.schoolRoster',
  room: 'school',
  args: z.object({ studentIds: z.array(Id).default([]) }),
  run(sql: SqlExecutor, args): { people: string[]; tokens: Record<string, string> } {
    const people = sql.all<{ display_name: string }>('SELECT display_name FROM users ORDER BY rowid').map((r) => r.display_name)
    const tokens: Record<string, string> = {}
    for (const id of args.studentIds) {
      const row = sql.get<{ display_token: string }>('SELECT display_token FROM students WHERE id = ?', id)
      if (row) tokens[id] = row.display_token
    }
    return { people, tokens }
  },
})
