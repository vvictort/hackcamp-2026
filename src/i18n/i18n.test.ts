import { describe, expect, it } from 'vitest'
import { app } from './en/app'
import { auth } from './en/auth'
import { capture } from './en/capture'
import { common } from './en/common'
import { drafts } from './en/drafts'
import { insights } from './en/insights'
import { landing } from './en/landing'
import { lens } from './en/lens'
import { students } from './en/students'
import { en } from './en'
import { DEFAULT_LANG, LANGUAGES } from './languages'
import { translate } from './index'
import { rich } from './rich'
import { KEEP, freshMessages, hashText } from './version'

describe('i18n', () => {
  it('has unique language codes and English as the source', () => {
    const codes = LANGUAGES.map((l) => l.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes).toContain(DEFAULT_LANG)
  })

  it('falls back to English and fills placeholders', () => {
    expect(translate({}, 'common.signIn')).toBe(en['common.signIn'])
    expect(translate({ 'common.signIn': 'Se connecter' }, 'common.signIn')).toBe('Se connecter')
    expect(translate({}, 'dashboard.greeting', { name: 'Ana' })).toBe('Good morning, Ana.')
    expect(translate({ 'dashboard.greeting': 'Bonjour {name}.' }, 'dashboard.greeting', { name: 'Ana' })).toBe('Bonjour Ana.')
  })

  it('splits inline tags into nodes and leaves plain text alone', () => {
    expect(rich('Make the <hl>IEP</hl> part of every lesson.')).toHaveLength(3)
    expect(rich('No tags here.')).toEqual(['No tags here.'])
  })

  it('registers every module and defines no key in two modules', () => {
    const mods = { app, auth, capture, common, drafts, insights, landing, lens, students }
    const seen = new Map<string, string>()
    const dupes: string[] = []
    for (const [name, m] of Object.entries(mods)) {
      for (const k of Object.keys(m)) {
        if (seen.has(k)) dupes.push(`${k} (${seen.get(k)}, ${name})`)
        seen.set(k, name)
      }
    }
    expect(dupes).toEqual([])
    expect(Object.keys(en).length).toBe(seen.size)
  })

  it('keeps only translations whose English did not change', () => {
    const file = {
      v: 'old',
      keep: hashText(KEEP),
      src: { 'common.signIn': hashText(en['common.signIn']), 'common.signOut': 'changed-since', 'gone.key': 'x' },
      messages: { 'common.signIn': 'Entrar', 'common.signOut': 'Salir', 'gone.key': 'Adiós' },
    }
    expect(freshMessages(file)).toEqual({ 'common.signIn': 'Entrar' })
    // A different do-not-translate list invalidates everything; a file with no hashes is kept whole.
    expect(freshMessages({ ...file, keep: 'other' })).toEqual({})
    expect(freshMessages({ v: 'old', messages: { 'common.signIn': 'Entrar' } })).toEqual({ 'common.signIn': 'Entrar' })
  })
})
