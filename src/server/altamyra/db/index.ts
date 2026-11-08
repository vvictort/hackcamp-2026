// Worker-safe exports only. The node:sqlite test adapter is imported directly
// from './node-sqlite' by tests, never through this barrel.
export type { SqlExecutor, SqlParam, SqlRow } from './sql'
export { createDoSqlExecutor } from './do-sqlite'
export { appendAudit, type AuditInput } from './audit'
export { fromRow, insertRow, sqlList, toCamel, toRow, toSnake } from './mapping'
export { runMigrations, schemaVersion, type Migration } from './migrate'
export { STUDENT_DDL, migrateStudent } from './schema/student'
export { SCHOOL_DDL, migrateSchool } from './schema/school'
export { INSIGHTS_DDL, migrateInsights } from './schema/insights'
