import { apiPost } from './api'
import type { AltamiraRole } from './role'

/** One line of the "Run full demo day" result (POST /dev/demo-day). `page` is the app path to look at. */
export type DemoStep = { role: AltamiraRole | 'system'; action: string; ok: boolean; detail: string; page: string }
export type DemoDayResult = { studentId: string; steps: DemoStep[] }

/** Dev only: runs a whole fictional school day for one new student, acting as every role. */
export const runDemoDay = () => apiPost<DemoDayResult>('/dev/demo-day')
