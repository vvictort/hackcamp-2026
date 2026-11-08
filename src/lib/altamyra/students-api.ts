import type { z } from 'zod'
import type {
  AimlineResponse,
  DataPointSourceResponse,
  GoalStatusResponse,
  IepConfirmBody,
  IepConfirmResponse,
  ObjectiveConfirmBody,
  ObjectivesResponse,
  StudentProfileResponse,
  TimelineResponse,
  WhatWorksResponse,
} from '@/server/altamyra/contract/api'
import type { AdaptationType } from '@/server/altamyra/contract/enums'
import type { Objective } from '@/server/altamyra/contract/student'
import { apiFetch, enc } from './api'

type R<T extends z.ZodType> = z.infer<T>

export const getProfile = (id: string) => apiFetch<StudentProfileResponse>(`/students/${enc(id)}`)

export const confirmIep = (id: string, version: number, body: IepConfirmBody) =>
  apiFetch<R<typeof IepConfirmResponse>>(`/students/${enc(id)}/iep/${version}/confirm`, { body })

export const getObjectives = (id: string) => apiFetch<R<typeof ObjectivesResponse>>(`/students/${enc(id)}/objectives`)
export const confirmObjective = (oid: string, studentId: string, body: ObjectiveConfirmBody) =>
  apiFetch<{ objective: Objective }>(`/objectives/${enc(oid)}/confirm`, { body, query: { studentId } })
export const flagObjective = (oid: string, studentId: string, expectedVersion: number, reason: string) =>
  apiFetch<{ objective: Objective }>(`/objectives/${enc(oid)}/flag`, { body: { expectedVersion, reason }, query: { studentId } })

export const getTimeline = (id: string, objectiveId?: string) =>
  apiFetch<R<typeof TimelineResponse>>(`/students/${enc(id)}/timeline`, { query: { objectiveId } })
export const getGoalStatus = (id: string, gid: string) => apiFetch<GoalStatusResponse>(`/students/${enc(id)}/goals/${enc(gid)}/status`)
export const getDataPointSource = (studentId: string, dataPointId: string) =>
  apiFetch<R<typeof DataPointSourceResponse>>(`/data-points/${enc(dataPointId)}/source`, { query: { studentId } })
export const getAimline = (id: string, gid: string) => apiFetch<R<typeof AimlineResponse>>(`/students/${enc(id)}/goals/${enc(gid)}/aimline`)
export const getWhatWorks = (id: string) => apiFetch<R<typeof WhatWorksResponse>>(`/students/${enc(id)}/what-works`)

export type LensUsage = {
  events: { suggestionId: string; at: string; label: 'adaptation' | 'modification' | null; adaptationType: AdaptationType | null; title: string; text: string; goalIds: string[] }[]
  used: { adaptationType: AdaptationType; n: number }[]
}

export const getLensUsage = (studentId: string) => apiFetch<LensUsage>(`/students/${enc(studentId)}/lens-usage`)
