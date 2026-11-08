import { ROOM_PREFIXES } from '../contract/common'

/**
 * Design doc "Architecture": Altamira rooms are reached only through the
 * /api/v1 router, so the generic /ws/:roomId route refuses their prefixes.
 */
export function isAltamiraRoomId(roomId: string): boolean {
  return Object.values(ROOM_PREFIXES).some((prefix) => roomId.startsWith(prefix))
}
