import type { DeidentifiedProfile } from '../contract/ai'
import type { Goal, IepVersion, Objective } from '../contract/student'

/**
 * Builds the lensForStudent profile from a student's IEP. Identifying
 * fields (IepSections.student names) are left out; deidentify() still runs
 * over the result because free text can mention names.
 */
export function toAiProfile(input: {
  token: string
  grade: string
  iep: Pick<IepVersion, 'sections' | 'modificationSubjects'>
  goals: Pick<Goal, 'id' | 'area' | 'text' | 'status'>[]
  objectiveFor: (goalId: string) => Pick<Objective, 'id' | 'metricType' | 'unit' | 'target'> | undefined
}): DeidentifiedProfile {
  const { sections } = input.iep
  return {
    studentToken: input.token,
    grade: input.grade,
    strengths: sections.profile.strengths,
    interests: sections.profile.interests,
    goals: input.goals
      .filter((g) => g.status === 'active')
      .map((g) => {
        const o = input.objectiveFor(g.id)
        return {
          goalId: g.id,
          area: g.area,
          text: g.text,
          objective: o ? { objectiveId: o.id, metricType: o.metricType, unit: o.unit, target: o.target } : null,
        }
      }),
    accommodations: sections.accommodations,
    supports: sections.supports,
    modificationSubjects: input.iep.modificationSubjects,
  }
}
