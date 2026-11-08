export const fmtDate = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '')
export const lines = (v: string): string[] => v.split('\n').map((x) => x.trim()).filter(Boolean)
