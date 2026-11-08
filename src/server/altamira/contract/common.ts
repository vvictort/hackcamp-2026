import { z } from 'zod'

/** Opaque ids. Rooms are addressed as "student:<uuid>", "school:<uuid>", "district:<uuid>". */
export const Id = z.string().min(1)
export type Id = z.infer<typeof Id>

/** ISO 8601 timestamp, stored as TEXT. */
export const Timestamp = z.string().min(1)
export type Timestamp = z.infer<typeof Timestamp>

/** Calendar date YYYY-MM-DD. */
export const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Wall-clock time HH:MM (24 h). */
export const TimeOfDay = z.string().regex(/^\d{2}:\d{2}$/)

/** Optimistic-locking version carried by every mutable row. */
export const RowVersion = z.number().int().min(1)

/** Required on every correction or state change; mismatch answers 409. */
export const ExpectedVersion = z.object({ expectedVersion: RowVersion })

export const ROOM_PREFIXES = { student: 'student:', school: 'school:', insights: 'district:' } as const
export const studentRoomId = (studentId: string) => `${ROOM_PREFIXES.student}${studentId}`
export const schoolRoomId = (schoolId: string) => `${ROOM_PREFIXES.school}${schoolId}`
export const insightsRoomId = (districtId: string) => `${ROOM_PREFIXES.insights}${districtId}`

/** A file held in DeepSpace app-scoped storage. bytesBase64 is set only when the bytes travel inline. */
export const MediaRef = z.object({
  fileKey: z.string().min(1),
  contentType: z.string().min(1),
  bytesBase64: z.string().optional(),
})
export type MediaRef = z.infer<typeof MediaRef>
