import type { OpRegistry } from '../contract/ops'

/**
 * Room op registries, one per room kind. Each room's run(opName, args, actor)
 * looks the op up here and runs it inside one transaction.
 * Owned by the Domain engineer, who adds ops; keys must equal each op's name.
 */
export const studentOps: OpRegistry = {}

export const schoolOps: OpRegistry = {}

export const insightsOps: OpRegistry = {}
