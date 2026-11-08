import type { Membership, ParentLink, RosterEntry, ScheduleBlock, SchoolClass, SchoolStudent, User } from '../contract/school'

/**
 * FICTIONAL school, staff and schedule. No real people or students.
 * The schedule mirrors CLASSES in src/components/altamyra/exampleData.ts so
 * backend and frontend demo data match (Dev is frontend-only; the backend
 * fixtures hold the three CB-IEP students from PRD M0).
 */

export const SEEDED_AT = '2026-09-08T16:00:00.000Z'

export const DISTRICT = { id: 'd1500000-0000-4000-8000-000000000099', name: 'Fictional School District 99' }
export const SCHOOL = { id: '5c400000-0000-4000-8000-000000000001', name: 'Salmonberry Creek Elementary (fictional)', districtId: DISTRICT.id }

export const STUDENT_IDS = {
  kai: '57d00000-0000-4000-8000-00000000000a',
  amara: '57d00000-0000-4000-8000-00000000000b',
  sofia: '57d00000-0000-4000-8000-00000000000c',
} as const
export type FixtureStudentKey = keyof typeof STUDENT_IDS

export const USER_IDS = {
  caseManager: 'u5e00000-0000-4000-8000-000000000001',
  teacher: 'u5e00000-0000-4000-8000-000000000002',
  ea: 'u5e00000-0000-4000-8000-000000000003',
  parentKai: 'u5e00000-0000-4000-8000-000000000004',
  parentAmara: 'u5e00000-0000-4000-8000-000000000005',
  parentSofia: 'u5e00000-0000-4000-8000-000000000006',
  schoolAdmin: 'u5e00000-0000-4000-8000-000000000007',
  districtLead: 'u5e00000-0000-4000-8000-000000000008',
} as const

export const CLASS_IDS = {
  morningCircle: 'c1a50000-0000-4000-8000-000000000001',
  literacy: 'c1a50000-0000-4000-8000-000000000002',
  numeracy: 'c1a50000-0000-4000-8000-000000000003',
  science: 'c1a50000-0000-4000-8000-000000000004',
  pe: 'c1a50000-0000-4000-8000-000000000005',
} as const

const user = (id: string, displayName: string): User => ({ id, displayName, createdAt: SEEDED_AT })

export const USERS: User[] = [
  user(USER_IDS.caseManager, 'Leila Ahmadi'),
  user(USER_IDS.teacher, 'Marcus Tran'),
  user(USER_IDS.ea, 'Priya Sandhu'),
  user(USER_IDS.parentKai, 'Hana Nakamura'),
  user(USER_IDS.parentAmara, 'Chidi Okonkwo'),
  user(USER_IDS.parentSofia, 'Rania Haddad'),
  user(USER_IDS.schoolAdmin, 'Gordon Lee'),
  user(USER_IDS.districtLead, 'Elena Ruiz'),
]

export const SCHOOL_STUDENTS: SchoolStudent[] = [
  { id: STUDENT_IDS.kai, displayToken: 'S-K7Q4', grade: '4', createdAt: SEEDED_AT, version: 1 },
  { id: STUDENT_IDS.amara, displayToken: 'S-A2M9', grade: '4', createdAt: SEEDED_AT, version: 1 },
  { id: STUDENT_IDS.sofia, displayToken: 'S-F5H3', grade: '4', createdAt: SEEDED_AT, version: 1 },
]

export const CLASSES: SchoolClass[] = [
  { id: CLASS_IDS.morningCircle, name: 'Morning circle', subject: 'morning_circle', grade: '4', version: 1 },
  { id: CLASS_IDS.literacy, name: 'Literacy', subject: 'literacy', grade: '4', version: 1 },
  { id: CLASS_IDS.numeracy, name: 'Numeracy', subject: 'math', grade: '4', version: 1 },
  { id: CLASS_IDS.science, name: 'Science', subject: 'science', grade: '4', version: 1 },
  { id: CLASS_IDS.pe, name: 'Physical education', subject: 'pe', grade: '4', version: 1 },
]

const { kai, amara, sofia } = STUDENT_IDS
const rosterOf = (classId: string, studentIds: string[]): RosterEntry[] => studentIds.map((studentId) => ({ classId, studentId }))

/** Same membership as exampleData CLASSES, without Dev. */
export const ROSTER: RosterEntry[] = [
  ...rosterOf(CLASS_IDS.morningCircle, [kai, amara, sofia]),
  ...rosterOf(CLASS_IDS.literacy, [kai, amara, sofia]),
  ...rosterOf(CLASS_IDS.numeracy, [sofia, kai]),
  ...rosterOf(CLASS_IDS.science, [amara]),
  ...rosterOf(CLASS_IDS.pe, [kai]),
]

/** Start times from exampleData CLASSES, Monday to Friday. */
const DAILY: { classId: string; startsAt: string; endsAt: string }[] = [
  { classId: CLASS_IDS.morningCircle, startsAt: '08:50', endsAt: '09:15' },
  { classId: CLASS_IDS.literacy, startsAt: '09:15', endsAt: '10:30' },
  { classId: CLASS_IDS.numeracy, startsAt: '10:45', endsAt: '11:45' },
  { classId: CLASS_IDS.science, startsAt: '12:50', endsAt: '13:50' },
  { classId: CLASS_IDS.pe, startsAt: '14:05', endsAt: '15:00' },
]

export const SCHEDULE_BLOCKS: ScheduleBlock[] = [1, 2, 3, 4, 5].flatMap((weekday) =>
  DAILY.map((b, i) => ({
    id: `5b000000-0000-4000-8000-0000000${weekday}${String(i).padStart(4, '0')}`,
    classId: b.classId,
    weekday,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    version: 1,
  })),
)

let membershipSeq = 0
const membership = (userId: string, role: Membership['role'], scope: Partial<Pick<Membership, 'studentId' | 'classId' | 'districtId'>>): Membership => ({
  id: `3e000000-0000-4000-8000-${String(++membershipSeq).padStart(12, '0')}`,
  userId,
  role,
  studentId: scope.studentId ?? null,
  classId: scope.classId ?? null,
  districtId: scope.districtId ?? null,
  createdAt: SEEDED_AT,
  version: 1,
})

export const MEMBERSHIPS: Membership[] = [
  // Case manager: caseload of all three students.
  ...[kai, amara, sofia].map((studentId) => membership(USER_IDS.caseManager, 'case_manager', { studentId })),
  // Teacher: every class; their students come from the roster.
  ...Object.values(CLASS_IDS).map((classId) => membership(USER_IDS.teacher, 'teacher', { classId })),
  // EA: assigned to Kai and Sofía only, so Amara is out of the EA's scope.
  ...[kai, sofia].map((studentId) => membership(USER_IDS.ea, 'ea', { studentId })),
  membership(USER_IDS.schoolAdmin, 'school_admin', {}),
  membership(USER_IDS.districtLead, 'district_lead', { districtId: DISTRICT.id }),
]

export const PARENT_LINKS: ParentLink[] = [
  { id: 'p1000000-0000-4000-8000-000000000001', parentUserId: USER_IDS.parentKai, studentId: kai, createdAt: SEEDED_AT },
  { id: 'p1000000-0000-4000-8000-000000000002', parentUserId: USER_IDS.parentAmara, studentId: amara, createdAt: SEEDED_AT },
  { id: 'p1000000-0000-4000-8000-000000000003', parentUserId: USER_IDS.parentSofia, studentId: sofia, createdAt: SEEDED_AT },
]
