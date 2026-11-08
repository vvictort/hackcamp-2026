import { describe, expect, it } from 'vitest'
import { en } from './en'
import { DEFAULT_LANG, LANGUAGES } from './languages'
import { translate } from './index'

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
})
