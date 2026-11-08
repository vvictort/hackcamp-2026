import { AltamyraError } from '../contract/errors'
import { IepSections } from '../contract/student'

/**
 * Reads the text of a MyEd CB-IEP export into IepSections. The case manager
 * reviews the result side by side before confirming it (PRD "CB-IEP import":
 * "case manager confirms every import"), so this parser only extracts fields;
 * it never fills in missing ones with defaults beyond empty lists.
 */

const HEADINGS = {
  'STUDENT INFORMATION': 'info',
  'STUDENT PROFILE': 'profile',
  'CORE COMPETENCIES': 'competencies',
  GOALS: 'goals',
  'ADAPTATIONS / ACCOMMODATIONS': 'accommodations',
  ACCOMMODATIONS: 'accommodations',
  'SUPPORTS AND SERVICES': 'supports',
  MODIFICATIONS: 'modifications',
} as const

type Section = (typeof HEADINGS)[keyof typeof HEADINGS] | 'preamble'

const field = (line: string, label: string): string | undefined => {
  const m = line.match(new RegExp(`^${label}\\s*:\\s*(.*)$`, 'i'))
  return m ? m[1].trim() : undefined
}
const bullet = (line: string): string | undefined => line.match(/^[-•*]\s+(.+)$/)?.[1].trim()
const orNull = (s: string | undefined): string | null => (s && !/^none$/i.test(s) ? s : null)

export function parseCbIepText(text: string): IepSections {
  let section: Section = 'preamble'
  type ListKey = 'strengths' | 'interests' | 'stretches'
  let list = null as ListKey | null
  const info: Record<string, string> = {}
  const profile = { strengths: [] as string[], interests: [] as string[], stretches: [] as string[] }
  const competencies = { communication: '', thinking: '', personalSocial: '' }
  const goals: { area: string; text: string }[] = []
  const accommodations: string[] = []
  const supports: string[] = []
  const modifications: { subject: string; description: string }[] = []

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const heading = HEADINGS[line.toUpperCase() as keyof typeof HEADINGS]
    if (heading && line === line.toUpperCase()) {
      section = heading
      list = null
      continue
    }
    switch (section) {
      case 'info':
        for (const [key, label] of [
          ['legalName', 'Legal Name'],
          ['preferredName', 'Preferred Name'],
          ['grade', 'Grade'],
          ['designation', 'Designation'],
          ['reviewDate', 'IEP Review Date'],
        ] as const) {
          const v = field(line, label)
          if (v !== undefined) info[key] = v
        }
        break
      case 'profile': {
        const label = (['Strengths', 'Interests', 'Stretches'] as const).find((l) => field(line, l) !== undefined)
        if (label) list = label.toLowerCase() as ListKey
        else if (list && bullet(line)) profile[list].push(bullet(line) as string)
        break
      }
      case 'competencies':
        competencies.communication = field(line, 'Communication') ?? competencies.communication
        competencies.thinking = field(line, 'Thinking') ?? competencies.thinking
        competencies.personalSocial = field(line, 'Personal and Social') ?? competencies.personalSocial
        break
      case 'goals': {
        const area = line.match(/^Goal\s+\d+\s*[-–:]\s*Area\s*:\s*(.+)$/i)?.[1].trim()
        if (area) goals.push({ area, text: '' })
        else if (goals.length > 0) {
          const last = goals[goals.length - 1]
          last.text = last.text ? `${last.text} ${line}` : line
        }
        break
      }
      case 'accommodations':
        if (bullet(line)) accommodations.push(bullet(line) as string)
        break
      case 'supports':
        if (bullet(line)) supports.push(bullet(line) as string)
        break
      case 'modifications': {
        const b = bullet(line)
        const m = b?.match(/^([^:]+):\s*(.*)$/)
        if (m) modifications.push({ subject: m[1].trim(), description: m[2].trim() })
        break
      }
      case 'preamble':
        break
    }
  }

  const [firstName, ...rest] = (info.legalName ?? '').split(/\s+/).filter(Boolean)
  const parsed = IepSections.safeParse({
    student: { firstName, lastName: rest.join(' '), preferredName: orNull(info.preferredName), grade: info.grade },
    profile: { designation: orNull(info.designation), ...profile },
    coreCompetencies: competencies,
    goals,
    accommodations,
    supports,
    modifications,
    reviewDate: orNull(info.reviewDate),
  })
  if (!parsed.success) {
    throw new AltamyraError('bad_request', 'Could not read the CB-IEP text: student name, grade and goal wording are required.')
  }
  return parsed.data
}

/**
 * Clean 502 body for a failed model call during import. The import itself is
 * stored as a pending version; the case manager can retry. No provider detail
 * (keys, URLs, raw responses) goes to the client.
 */
export function aiFailureResponse(err: unknown): Response | null {
  if (err instanceof AltamyraError) return null
  return new Response(
    JSON.stringify({ error: { code: 'ai_unavailable', message: 'The AI service did not answer. Try again in a moment.' } }),
    { status: 502, headers: { 'Content-Type': 'application/json' } },
  )
}
