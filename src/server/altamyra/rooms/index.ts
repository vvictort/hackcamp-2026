// Worker-side entry for the Altamyra rooms. Tests import the *-core modules directly.
export { AltamyraStudentRoom } from './student-room'
export { AltamyraSchoolRoom } from './school-room'
export { AltamyraInsightsRoom } from './insights-room'
export type { InsightsRoomRpc, SchoolRoomRpc, StudentRoomRpc } from './rpc'
export {
  altamyraDistrictId,
  altamyraSchoolId,
  insightsRoom,
  openStudentLive,
  schoolRoom,
  studentRoom,
  type AltamyraBindings,
} from './stubs'
