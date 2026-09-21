/**
 * Checklist forms, as the inspection panel reads them.
 *
 * Mirrors app/services/checklist.py, which is what actually decides: the
 * server refuses to record a pass the checklist does not allow. This copy
 * exists so the tally and the Passed button agree with the server while the
 * inspector is still filling it in, rather than after they press it.
 */
export type ChecklistAnswer = 'yes' | 'no' | 'na'

export interface ChecklistRequirement {
  code: string
  text: string
  /** Requirements sharing this are either-or: meeting one meets them all. */
  alternative?: string
}

export interface ChecklistSection {
  code: string
  title: string
  requirements: ChecklistRequirement[]
}

export interface ChecklistSchema {
  title?: string
  version?: number
  source: 'phealth_checklist'
  checklist: { sections: ChecklistSection[] }
}

export interface ChecklistResult {
  total: number
  answered: number
  met: number
  notMet: string[]
  notApplicable: number
  unanswered: string[]
  canPass: boolean
}

export const isChecklist = (schema: unknown): schema is ChecklistSchema => {
  const value = schema as Partial<ChecklistSchema> | null | undefined
  return Boolean(value && value.source === 'phealth_checklist' && value.checklist
    && Array.isArray(value.checklist.sections))
}

export const requirementsOf = (schema: ChecklistSchema): ChecklistRequirement[] =>
  schema.checklist.sections.flatMap((section) => section.requirements)

export function evaluateChecklist(
  schema: ChecklistSchema, answers: Record<string, string | undefined>,
): ChecklistResult {
  const rows = requirementsOf(schema)
  const valid = (value?: string): value is ChecklistAnswer => value === 'yes' || value === 'no' || value === 'na'
  const unanswered = rows.filter((row) => !valid(answers[row.code])).map((row) => row.code)

  const groups = new Map<string, ChecklistRequirement[]>()
  const singles: ChecklistRequirement[] = []
  for (const row of rows) {
    if (row.alternative) groups.set(row.alternative, [...(groups.get(row.alternative) ?? []), row])
    else singles.push(row)
  }

  let met = 0
  let notApplicable = 0
  const notMet: string[] = []
  for (const row of singles) {
    const value = answers[row.code]
    if (value === 'yes') met += 1
    else if (value === 'no') notMet.push(row.code)
    else if (value === 'na') notApplicable += 1
  }
  for (const members of groups.values()) {
    const values = members.map((row) => answers[row.code])
    if (values.includes('yes')) met += members.length
    else if (values.every((value) => value === 'na')) notApplicable += members.length
    else if (values.every(valid)) notMet.push(members.map((row) => row.code).join(' or '))
  }

  return {
    total: rows.length,
    answered: rows.length - unanswered.length,
    met,
    notMet,
    notApplicable,
    unanswered,
    canPass: unanswered.length === 0 && notMet.length === 0,
  }
}

export function checklistSummary(result: ChecklistResult): string {
  if (result.unanswered.length) {
    return `${result.unanswered.length} of ${result.total} requirements still to answer`
  }
  if (result.notMet.length) {
    return `${result.notMet.length} requirement${result.notMet.length === 1 ? '' : 's'} not met: ${result.notMet.join(', ')}`
  }
  return 'All requirements met'
}
