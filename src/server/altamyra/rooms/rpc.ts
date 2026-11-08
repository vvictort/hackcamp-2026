import type { ConsentKind } from '../contract/enums'
import type { CounterIncrement } from '../contract/insights'
import type { AltamyraRoomRpc } from '../contract/ops'
import type { Actor } from '../contract/permissions'

/**
 * RPC surface of each Altamyra room, as seen from the router. Kept free of
 * runtime imports so middleware and jobs can be tested with fakes.
 */

export interface StudentRoomRpc extends AltamyraRoomRpc {
  /** Voice-note and video capture require an active consents row. */
  hasConsent(kind: ConsentKind): Promise<boolean>
}

export interface SchoolRoomRpc extends AltamyraRoomRpc {
  loadActor(userId: string, schoolId: string): Promise<Actor>
  listStudentIds(): Promise<string[]>
}

export interface InsightsRoomRpc extends AltamyraRoomRpc {
  increment(districtId: string, increments: CounterIncrement[]): Promise<number>
}
