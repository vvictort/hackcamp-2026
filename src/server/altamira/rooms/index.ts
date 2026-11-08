// Worker-side entry for the Altamira rooms. Tests import the *-core modules directly.
export { AltamiraStudentRoom } from './student-room'
export { AltamiraSchoolRoom } from './school-room'
export { AltamiraInsightsRoom } from './insights-room'
export type { InsightsRoomRpc, SchoolRoomRpc, StudentRoomRpc } from './rpc'
export {
  altamiraDistrictId,
  altamiraSchoolId,
  insightsRoom,
  openStudentLive,
  schoolRoom,
  studentRoom,
  type AltamiraBindings,
} from './stubs'
