import { describe, expect, it } from 'vitest'
import { FIXTURE_NAMES } from '../e2e/testing'
import { collectStrings, deidentify, findIdentifiers, reidentify } from './deidentify'
import { fixtureRoster } from './fixture-data'

const roster = fixtureRoster()

describe('deidentify', () => {
  it('replaces student, staff and school names with stable tokens and restores them', () => {
    const text = 'Kai Nakamura and Sofía worked with Ms. Ahmadi at Salmonberry Creek Elementary (fictional). Kai smiled.'
    const { value, map } = deidentify({ note: text }, roster)
    expect(value.note).toMatch(/^S-K7Q4 and S-F5H3 worked with Ms\. \[NAME-\d+\] at \[SCHOOL-1\]\. S-K7Q4 smiled\.$/)
    expect(findIdentifiers(value.note, roster)).toEqual([])
    expect(reidentify(value, map).note).toBe('Kai and Sofía worked with Ms. Ahmadi at Salmonberry Creek Elementary (fictional). Kai smiled.')
  })

  it('matches names with or without accents and in any case', () => {
    const { value } = deidentify(['SOFIA', 'sofia', 'Sofía', "Sofia's"], roster)
    expect(value).toEqual(['S-F5H3', 'S-F5H3', 'S-F5H3', "S-F5H3's"])
  })

  it('does not touch words that only contain a name', () => {
    const { value } = deidentify('Trains, transit and kaizen', roster)
    expect(value).toBe('Trains, transit and kaizen')
  })

  it('replaces emails, student numbers and dates of birth, labelled or from the roster', () => {
    const text = 'Contact hana.nakamura@sd99.fictional.example or someone@else.example. PEN: 123456789. Student number 990000101. DOB 2016-04-12. Date of birth: March 2, 2016.'
    const { value, map } = deidentify(text, roster)
    for (const raw of ['hana.nakamura', 'someone@', '123456789', '990000101', '2016-04-12', 'March 2']) expect(value).not.toContain(raw)
    expect(findIdentifiers(value, roster)).toEqual([])
    expect(reidentify(value, map)).toBe(text)
  })

  it('leaves ordinary words like "pen" and plain numbers alone', () => {
    const text = 'Use a pen and pencils. Solve 46 + 38 on 2026-10-06.'
    expect(deidentify(text, roster).value).toBe(text)
  })

  it('drops identifying fields and keeps media fields unchanged', () => {
    const input = {
      student: { firstName: 'Kai', lastName: 'Nakamura', preferredName: null, grade: '4' },
      email: 'x@y.example',
      image: { fileKey: 'uploads/abc123.jpg', contentType: 'image/jpeg', bytesBase64: 'S2FpIE5ha2FtdXJh' },
    }
    const { value } = deidentify(input, roster)
    expect(value).toEqual({ student: { grade: '4' }, image: input.image })
  })

  it('gives the same tokens for the same input', () => {
    const a = deidentify({ t: 'Marcus Tran met Priya Sandhu' }, roster)
    const b = deidentify({ t: 'Marcus Tran met Priya Sandhu' }, roster)
    expect(a).toEqual(b)
  })

  it('findIdentifiers reports every fixture name in raw text', () => {
    for (const name of FIXTURE_NAMES) {
      expect(findIdentifiers(`Note about ${name}.`, roster).length, name).toBeGreaterThan(0)
    }
  })

  it('collectStrings skips binary data', () => {
    expect(collectStrings({ a: 'x', b: [{ c: 'y' }], bytesBase64: 'zzz', fileKey: 'k', n: 1 })).toEqual(['x', 'y', 'k'])
  })
})
