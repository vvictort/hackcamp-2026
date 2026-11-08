/**
 * Languages the interface can be shown in. `en` is the source language; every
 * other entry is machine-translated on first use (see src/server/i18n-routes.ts)
 * and cached. The server only translates codes listed here, which bounds cost.
 * Add a language by adding one line.
 */

export interface Language {
  code: string
  /** Name in English, used in the translation prompt. */
  name: string
  /** Name in the language itself, shown in the picker. */
  native: string
  rtl?: boolean
}

export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'pa', name: 'Punjabi (Gurmukhi)', native: 'ਪੰਜਾਬੀ' },
  { code: 'zh-Hans', name: 'Chinese (Simplified)', native: '简体中文' },
  { code: 'zh-Hant', name: 'Chinese (Traditional)', native: '繁體中文' },
  { code: 'tl', name: 'Tagalog', native: 'Tagalog' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'ar', name: 'Arabic', native: 'العربية', rtl: true },
  { code: 'fa', name: 'Persian', native: 'فارسی', rtl: true },
  { code: 'ur', name: 'Urdu', native: 'اردو', rtl: true },
  { code: 'he', name: 'Hebrew', native: 'עברית', rtl: true },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська' },
  { code: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'th', name: 'Thai', native: 'ไทย' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili' },
  { code: 'so', name: 'Somali', native: 'Soomaali' },
  { code: 'am', name: 'Amharic', native: 'አማርኛ' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά' },
  { code: 'ro', name: 'Romanian', native: 'Română' },
  { code: 'sv', name: 'Swedish', native: 'Svenska' },
  { code: 'cs', name: 'Czech', native: 'Čeština' },
  { code: 'hu', name: 'Hungarian', native: 'Magyar' },
]

export const DEFAULT_LANG = 'en'

export const findLanguage = (code: string | null | undefined) => LANGUAGES.find((l) => l.code === code)
