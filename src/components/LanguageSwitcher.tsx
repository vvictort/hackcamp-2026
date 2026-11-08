import { Globe } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui'
import { useLang } from '@/i18n'

/** Language toggle. Shows each language in its own name so anyone can find theirs. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, languages, setLang, loading, t } = useLang()
  return (
    <Select value={lang} onValueChange={setLang}>
      <SelectTrigger aria-label={t('common.language')} aria-busy={loading || undefined} className={className ?? 'h-11 w-auto min-w-36 gap-2 rounded-full'}>
        <Globe className="size-4 shrink-0" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {languages.map((l) => (
          <SelectItem key={l.code} value={l.code} lang={l.code} dir={l.rtl ? 'rtl' : 'ltr'}>
            {l.native}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
