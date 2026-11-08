/** "Download PDF" for one student's sheet. Loaded on demand: @react-pdf/renderer is large. */
import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer'
import type { StudentAnalysis } from '@/lib/lessonLens'
import { lensText } from '@/lib/lessonLens'

const css = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: 'Helvetica' },
  h1: { fontSize: 18, marginBottom: 4 },
  h2: { fontSize: 13, marginTop: 16, marginBottom: 6 },
  row: { flexDirection: 'row', marginBottom: 6 },
  box: { width: 12, height: 12, borderWidth: 1, borderColor: '#000', marginRight: 8, marginTop: 1 },
  code: { width: 44, fontFamily: 'Helvetica-Bold' },
  text: { flex: 1 },
})

function SheetDoc({ student, subject }: { student: StudentAnalysis; subject: string }) {
  return (
    <Document title={lensText('lens.sheetTitle', { name: student.name })}>
      <Page size="LETTER" style={css.page}>
        <Text style={css.h1}>{lensText('lens.sheetTitle', { name: student.name })}</Text>
        <Text>{lensText('lens.sheetLesson', { subject })}</Text>
        <Text style={css.h2}>{lensText('lens.sheetAdaptations')}</Text>
        {student.suggestions
          .filter((s) => s.state !== 'rejected')
          .map((s, i) => (
            <View key={i} style={css.row}>
              <Text style={css.code}>{lensText(s.label === 'modify' ? 'lens.modify' : 'lens.adapt')}</Text>
              <Text style={css.text}>{s.text}</Text>
            </View>
          ))}
        <Text style={css.h2}>{lensText('lens.sheetChecks')}</Text>
        {student.checks.map((c) => (
          <View key={c.code} style={css.row}>
            <View style={css.box} />
            <Text style={css.code}>{c.code}</Text>
            <Text style={css.text}>{c.text}</Text>
          </View>
        ))}
      </Page>
    </Document>
  )
}

export async function downloadSheetPdf(student: StudentAnalysis, subject: string): Promise<void> {
  const blob = await pdf(<SheetDoc student={student} subject={subject} />).toBlob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `lens-sheet-${student.studentId}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
