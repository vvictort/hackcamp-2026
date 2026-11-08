import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../../../../worker'
import type { CounterIncrement } from '../contract/insights'
import type { OpResult, SqlExecutor } from '../contract/ops'
import type { Actor } from '../contract/permissions'
import { createDoSqlExecutor } from '../db/do-sqlite'
import { migrateInsights } from '../db/schema/insights'
import { insightsOps } from '../services/registry'
import { runRoomOp } from './core'
import { applyCounterIncrements } from './insights-core'
import type { InsightsRoomRpc } from './rpc'

/** One per district ("district:<uuid>"): de-identified counters only, no audit_log. */
export class AltamyraInsightsRoom extends DurableObject<Env> implements InsightsRoomRpc {
  private readonly sql: SqlExecutor

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = createDoSqlExecutor(ctx.storage)
    void ctx.blockConcurrencyWhile(async () => {
      migrateInsights(this.sql)
    })
  }

  async run(opName: string, args: unknown, actor: Actor): Promise<OpResult> {
    return runRoomOp(this.sql, insightsOps, opName, args, actor, { room: 'insights', requireAudit: false })
  }

  /** Called by student rooms after a confirmed data point. */
  async increment(districtId: string, increments: CounterIncrement[]): Promise<number> {
    return applyCounterIncrements(this.sql, districtId, increments)
  }
}
