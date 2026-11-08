import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { lessonLensActions } from './lesson-lens'

export const actions: Record<string, ActionHandler<Env>> = { ...lessonLensActions }
