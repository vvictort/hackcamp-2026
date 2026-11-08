import { describe, expect, it } from 'vitest'
import { fictionalPdf } from '@/server/altamyra/e2e/flows'
import { CBIEP_SAMPLE_TEXT } from '@/server/altamyra/fixtures'
import { parseCbIepText } from '@/server/altamyra/routes/cbiep'
import { extractPdfText, textFromContent } from './pdfText'

const sampleLines = CBIEP_SAMPLE_TEXT.split('\n').filter((l) => l.trim())

describe('PDF text layer (CB-IEP import)', () => {
  it('reads an uncompressed content stream line by line', async () => {
    const text = await extractPdfText(await fictionalPdf(sampleLines))
    expect(text.split('\n')).toEqual(sampleLines.map((l) => l.replace(/\s+/g, ' ').trim()))
    expect(parseCbIepText(text)).toEqual(parseCbIepText(CBIEP_SAMPLE_TEXT))
  })

  it('reads a FlateDecode stream', async () => {
    const text = await extractPdfText(await fictionalPdf(sampleLines, true))
    expect(parseCbIepText(text).goals).toHaveLength(2)
  })

  it('handles TJ arrays, escapes, hex strings and same-line moves', () => {
    expect(textFromContent('BT [(Legal)-300(Name:)] TJ 0 -12 Td (A \\(b\\)) Tj 40 0 Td <4869> Tj ET')).toBe('Legal Name:\nA (b) Hi\n')
  })

  it('returns no text for a file without a text layer', async () => {
    expect(await extractPdfText(new TextEncoder().encode('%PDF-1.4\n%%EOF'))).toBe('')
  })
})
