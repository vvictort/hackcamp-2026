/** District Insights page. Keys are `insights.<name>`; registered in en.ts next round. */
export const insights = {
  'insights.title': 'District insights',
  'insights.description': 'De-identified trends across schools. Groups with too few students are hidden.',
  'insights.loading': 'Loading insights...',
  'insights.failed': 'Could not load insights.',
  'insights.forbidden': 'Only district leads can see insights.',
  'insights.retry': 'Try again',
  'insights.emptyTitle': 'No trends yet',
  'insights.emptyBody': 'Trends appear once students have confirmed progress data.',
  'insights.school': 'School {id}',
  'insights.noSchool': 'All schools',
  'insights.noArea': 'No goal area',
  'insights.students': '{n} students',
  'insights.events': '{n} data points',
  'insights.suppressed': 'Too few students',
  'insights.suppressedHelp': 'Hidden when fewer than {n} students, to protect privacy.',
} as const
