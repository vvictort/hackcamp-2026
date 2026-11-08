import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../../../../worker'
import type { ConsentKind } from '../contract/enums'
import type { CounterIncrement } from '../contract/insights'
import type { OpResult, SqlExecutor } from '../contract/ops'
import type { Actor } from '../contract/permissions'
import { createDoSqlExecutor } from '../db/do-sqlite'
import { migrateStudent } from '../db/schema/student'
import { sha256Hex } from '../middleware/tokens'
import { studentOps } from '../services/registry'
import { auditMark, runRoomOp } from './core'
import type { StudentRoomRpc } from './rpc'
import { confirmedDataPointsSince, hasActiveConsent, insightIncrements, liveMessage } from './student-core'
import { altamyraDistrictId, altamyraSchoolId, insightsRoom } from './stubs'

const LIVE_TAG = 'live'

/** One per student ("student:<uuid>"). Reached only through the /api/v1 router. */
export class AltamyraStudentRoom extends DurableObject<Env> implements StudentRoomRpc {
  private readonly sql: SqlExecutor

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = createDoSqlExecutor(ctx.storage)
    void ctx.blockConcurrencyWhile(async () => {
      migrateStudent(this.sql)
    })
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async run(opName: string, args: unknown, actor: Actor): Promise<OpResult> {
    const mark = auditMark(this.sql)
    const result = runRoomOp(this.sql, studentOps, opName, args, actor, { room: 'student', requireAudit: true })
    if (!result.ok) return result
    const confirmed = confirmedDataPointsSince(this.sql, mark)
    if (confirmed.length > 0) this.broadcast(confirmed)
    await this.pushCounters(insightIncrements(this.sql, mark, confirmed))
    return result
  }

  async hasConsent(kind: ConsentKind): Promise<boolean> {
    return hasActiveConsent(this.sql, kind)
  }

  /** Live timeline socket (hibernation API). The router forwards here after its scope check. */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname !== '/live' || request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Not found', { status: 404 })
    }
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.ctx.acceptWebSocket(server, [LIVE_TAG])
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(): Promise<void> {
    // Clients only listen; "ping" is answered by the auto-response.
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason)
  }

  private broadcast(dataPointIds: string[]): void {
    const message = JSON.stringify(liveMessage(dataPointIds))
    for (const ws of this.ctx.getWebSockets(LIVE_TAG)) {
      try {
        ws.send(message)
      } catch {
        // A socket closing mid-send is not an error for the op.
      }
    }
  }

  /**
   * Pushes de-identified counters to the district insights room after the op
   * committed (design doc "Request flow"). The student key is a one-way hash of
   * this room's Durable Object id; no names and no student ids leave the room.
   */
  private async pushCounters(increments: Omit<CounterIncrement, 'schoolId' | 'studentKey'>[]): Promise<void> {
    if (increments.length === 0) return
    try {
      const districtId = altamyraDistrictId(this.env)
      const studentKey = await sha256Hex(`${districtId}:${this.ctx.id.toString()}`)
      const schoolId = altamyraSchoolId(this.env)
      await insightsRoom(this.env).increment(districtId, increments.map((i) => ({ ...i, schoolId, studentKey })))
    } catch {
      // Counters are best effort; the op is already committed. No details: logs stay scrubbed.
      console.error('altamyra: insights counter push failed')
    }
  }
}
