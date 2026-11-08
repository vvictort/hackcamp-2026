import { z } from 'zod'
import { defineOp } from '../contract/ops'
import { ACTOR_ROLES, type ActorRole } from '../contract/permissions'
import type { SqlExecutor } from '../db/sql'
import { DEMO_PARENT } from '../fixtures/demo-iep-sd23'
import { MEMBERSHIPS, PARENT_LINKS, USERS, USER_IDS } from '../fixtures/school'
import { audit, insertEntity, newId, nowIso } from '../repos/base'
import { membershipsOf, parentLinksOf } from '../repos/school'

/**
 * Fixture users whose access each demo role copies. The parent role also copies the fictional parent of the
 * "Run full demo day" student, who exists only after that button ran.
 */
const DEV_ROLE_USERS: Record<ActorRole, string[]> = {
  case_manager: [USER_IDS.caseManager],
  teacher: [USER_IDS.teacher],
  ea: [USER_IDS.ea],
  parent: [USER_IDS.parentKai, DEMO_PARENT.id],
  district_lead: [USER_IDS.districtLead],
  school_admin: [USER_IDS.schoolAdmin],
}

const ROLE_TABLE = 'CREATE TABLE IF NOT EXISTS dev_role (user_id TEXT PRIMARY KEY, role TEXT NOT NULL)'

/** The role a caller last switched to, or null when never switched. */
function devRoleOf(sql: SqlExecutor, userId: string): ActorRole | null {
  sql.run(ROLE_TABLE)
  const row = sql.get<{ role: string }>('SELECT role FROM dev_role WHERE user_id = ?', userId)
  return ACTOR_ROLES.find((r) => r === row?.role) ?? null
}

/**
 * Dev only (the route gates on ALTAMYRA_DEV_SEED). Replaces the caller's
 * memberships and parent_links with copies of the fixture user's rows for the role.
 */
export const devRoleSwitch = defineOp({
  name: 'dev.role',
  room: 'school',
  args: z.object({ role: z.enum(ACTOR_ROLES).optional() }),
  run(sql, args, actor) {
    const uid = actor.userId
    if (args.role) {
      const sources = DEV_ROLE_USERS[args.role]
      const source = sources[0]
      const at = nowIso()
      if (!sql.get('SELECT 1 FROM users WHERE id = ?', uid)) {
        insertEntity(sql, 'users', { id: uid, displayName: USERS.find((u) => u.id === source)?.displayName ?? 'Demo user', createdAt: at })
      }
      // Copy the live rows of the fixture users (they include students added by the demo day); the constants cover a room that was never seeded.
      const liveMemberships = sources.flatMap((s) => membershipsOf(sql, s))
      const liveLinks = sources.flatMap((s) => parentLinksOf(sql, s))
      const memberships = liveMemberships.length ? liveMemberships : MEMBERSHIPS.filter((x) => x.userId === source)
      const links = liveLinks.length || liveMemberships.length ? liveLinks : PARENT_LINKS.filter((x) => x.parentUserId === source)
      sql.run('DELETE FROM memberships WHERE user_id = ?', uid)
      sql.run('DELETE FROM parent_links WHERE parent_user_id = ?', uid)
      for (const m of memberships) insertEntity(sql, 'memberships', { ...m, id: newId(), userId: uid, createdAt: at })
      for (const p of links) insertEntity(sql, 'parent_links', { ...p, id: newId(), parentUserId: uid, createdAt: at })
      sql.run(ROLE_TABLE)
      sql.run('INSERT INTO dev_role (user_id, role) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET role = excluded.role', uid, args.role)
      audit(sql, actor, 'dev.role', 'memberships', uid, undefined, { role: args.role }, at)
    }
    return { roles: [...ACTOR_ROLES], active: devRoleOf(sql, uid) }
  },
})
