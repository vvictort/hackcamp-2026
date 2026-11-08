import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createNodeSqlExecutor } from '../db/node-sqlite'
import { migrateInsights } from '../db/schema/insights'
import { DISTRICT, SCHOOL } from '../fixtures/school'
import { applyCounterIncrements } from './insights-core'

type Sql = ReturnType<typeof createNodeSqlExecutor>

const inc = (studentKey: string, label: 'adaptation' | 'modification' | null = null) => ({
  schoolId: SCHOOL.id,
  period: '2026-10',
  studentKey,
  goalArea: 'Reading',
  proficiencyLevel: null,
  label,
  reviewTimeliness: null,
  by: 1,
})

describe('applyCounterIncrements', () => {
  let sql: Sql
  beforeEach(() => {
    sql = createNodeSqlExecutor()
    migrateInsights(sql)
  })
  afterEach(() => sql.close())

  it('adds to one row per student key and dimension combination', () => {
    applyCounterIncrements(sql, DISTRICT.id, [inc('k1'), inc('k1'), inc('k2'), inc('k1', 'adaptation')])
    const rows = sql.all<{ student_key: string; label: string | null; count: number }>(
      'SELECT student_key, label, count FROM counters ORDER BY student_key, label',
    )
    expect(rows).toEqual([
      { student_key: 'k1', label: null, count: 2 },
      { student_key: 'k1', label: 'adaptation', count: 1 },
      { student_key: 'k2', label: null, count: 1 },
    ])
  })

  it('rejects anything outside the de-identified contract and writes nothing', () => {
    expect(() => applyCounterIncrements(sql, DISTRICT.id, [inc('k1'), { ...inc('k2'), label: 'Kai' }])).toThrow()
    expect(sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM counters')?.n).toBe(0)
  })
})
