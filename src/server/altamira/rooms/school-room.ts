import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../../../../worker'
import type { OpResult } from '../contract/ops'
import type { Actor } from '../contract/permissions'
import { createDoSqlExecutor } from '../db/do-sqlite'
import { migrateSchool } from '../db/schema/school'
import type { SqlExecutor } from '../db/sql'
import { listStudentIds, loadActor } from '../middleware/actor'
import { schoolOps } from '../services/registry'
import { runRoomOp } from './core'
import type { SchoolRoomRpc } from './rpc'

/** One per school ("school:<uuid>"): memberships, roster, lessons. */
export class AltamiraSchoolRoom extends DurableObject<Env> implements SchoolRoomRpc {
  private readonly sql: SqlExecutor

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = createDoSqlExecutor(ctx.storage)
    void ctx.blockConcurrencyWhile(async () => {
      migrateSchool(this.sql)
    })
  }

  async run(opName: string, args: unknown, actor: Actor): Promise<OpResult> {
    return runRoomOp(this.sql, schoolOps, opName, args, actor, { room: 'school', requireAudit: true })
  }

  async loadActor(userId: string, schoolId: string): Promise<Actor> {
    return loadActor(this.sql, userId, schoolId)
  }

  async listStudentIds(): Promise<string[]> {
    return listStudentIds(this.sql)
  }
}
