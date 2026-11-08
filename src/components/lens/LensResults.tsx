import { useState } from 'react'
import { Check, CircleDashed, FileText, History, Pencil, RefreshCw, Trash2, X } from 'lucide-react'
import { Badge, Button, Card, StatusBadge, Textarea } from '@/components/ui'
import { lensText, type LensSuggestionView, type StudentAnalysis } from '@/lib/lessonLens'
import type { LensKey } from '@/i18n/en/lens'

export interface ResultActions {
  busy: string | null
  decide: (id: string, d: 'approved' | 'rejected') => void
  edit: (id: string, text: string) => Promise<boolean | undefined>
  regenerate: (id: string) => void
  approveAll: (s: StudentAnalysis) => void
  dropCheck: (studentId: string, code: string) => void
  openSheet: (studentId: string) => void
}

function StateBadge({ state }: { state: LensSuggestionView['state'] }) {
  if (state === 'approved') return <StatusBadge tone="success">{lensText('lens.state.approved')}</StatusBadge>
  if (state === 'rejected') return <StatusBadge tone="destructive">{lensText('lens.state.rejected')}</StatusBadge>
  return (
    <Badge variant="warning">
      <CircleDashed aria-hidden />
      {lensText('lens.state.pending')}
    </Badge>
  )
}

function Suggestion({ s, a }: { s: LensSuggestionView; a: ResultActions }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(s.text)
  const disabled = a.busy === s.id || !s.id
  return (
    <li className="flex flex-col gap-2 rounded-md bg-secondary p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={s.label === 'modify' ? 'info' : 'success'} title={lensText(s.label === 'modify' ? 'lens.modifyHint' : 'lens.adaptHint')}>
          {lensText(s.label === 'modify' ? 'lens.modify' : 'lens.adapt')}
        </Badge>
        <StateBadge state={s.state} />
        {s.workedBefore && (
          <Badge variant="info" title={lensText('lens.workedBeforeHint')}>
            <History aria-hidden />
            {lensText('lens.workedBefore')}
          </Badge>
        )}
      </div>
      {editing ? (
        <>
          <label className="text-small font-semibold" htmlFor={`edit-${s.id}`}>
            {lensText('lens.editLabel')}
          </label>
          <Textarea id={`edit-${s.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={disabled || !draft.trim()}
              onClick={async () => {
                if (await a.edit(s.id, draft)) setEditing(false)
              }}
            >
              {lensText('lens.save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (setDraft(s.text), setEditing(false))}>
              {lensText('lens.cancel')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-body">{s.text}</p>
          <p className="text-small text-muted-foreground">{s.why}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={disabled || s.state === 'approved'} onClick={() => a.decide(s.id, 'approved')}>
              <Check aria-hidden />
              {lensText('lens.approve')}
            </Button>
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => (setDraft(s.text), setEditing(true))}>
              <Pencil aria-hidden />
              {lensText('lens.edit')}
            </Button>
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => a.regenerate(s.id)}>
              <RefreshCw aria-hidden />
              {lensText('lens.regenerate')}
            </Button>
            <Button size="sm" variant="outline" disabled={disabled || s.state === 'rejected'} onClick={() => a.decide(s.id, 'rejected')}>
              <X aria-hidden />
              {lensText('lens.reject')}
            </Button>
          </div>
        </>
      )}
    </li>
  )
}

export function LensStudentCard({ st, a }: { st: StudentAnalysis; a: ResultActions }) {
  const pending = st.suggestions.filter((s) => s.id && s.state === 'pending').length
  return (
    <Card title={st.name}>
      <section aria-label={lensText('lens.gaps')} className="flex flex-col gap-2">
        <h3 className="text-label font-bold">{lensText('lens.gaps')}</h3>
        {st.gaps.length ? (
          <ul className="flex flex-col gap-2">
            {st.gaps.map((g, i) => (
              <li key={i} className="flex flex-col gap-1 text-body">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{lensText(`lens.gap.${g.type}` as LensKey)}</Badge>
                  <span>{g.text}</span>
                </span>
                <span className="text-small text-muted-foreground">{lensText('lens.goalLink', { text: `${g.goalArea}: ${g.goalText}` })}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-muted-foreground">{lensText('lens.noGaps')}</p>
        )}
      </section>
      <section aria-label={lensText('lens.suggestions')} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-label font-bold">{lensText('lens.suggestions')}</h3>
          <Button size="sm" disabled={!pending} onClick={() => a.approveAll(st)}>
            <Check aria-hidden />
            {lensText('lens.approveAll', { name: st.firstName || st.name })}
          </Button>
        </div>
        {st.suggestions.length ? (
          <ul className="flex flex-col gap-2">
            {st.suggestions.map((s, i) => (
              <Suggestion key={s.id || i} s={s} a={a} />
            ))}
          </ul>
        ) : (
          <p className="text-body text-muted-foreground">{lensText('lens.noSuggestions')}</p>
        )}
      </section>
      <section aria-label={lensText('lens.checks')} className="flex flex-col gap-2">
        <h3 className="text-label font-bold">{lensText('lens.checks')}</h3>
        {st.checks.length ? (
          <ul className="flex flex-col gap-1">
            {st.checks.map((c) => (
              <li key={c.code} className="flex items-center gap-2 text-body">
                <Badge variant="outline">{c.code}</Badge>
                <span className="min-w-0 flex-1">{c.text}</span>
                <Button size="icon" variant="ghost" aria-label={lensText('lens.removeCheck', { code: c.code })} onClick={() => a.dropCheck(st.studentId, c.code)}>
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-muted-foreground">{lensText('lens.noChecks')}</p>
        )}
      </section>
      <div>
        <Button variant="outline" onClick={() => a.openSheet(st.studentId)}>
          <FileText aria-hidden />
          {lensText('lens.sheet')}
        </Button>
      </div>
    </Card>
  )
}
