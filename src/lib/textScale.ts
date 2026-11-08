/**
 * In-app text size. One percentage applied as the root font-size, so every
 * rem (text, spacing, touch targets) scales together — the same geometry as
 * browser zoom, which the layout is built to survive at 200%.
 *
 * Applied pre-paint by the inline script in index.html so there is no flash,
 * re-applied by settings when the signed-in person's saved choice arrives,
 * and kept in localStorage between visits.
 */

export const TEXT_SCALES = [100, 110, 125, 150] as const
export type TextScale = (typeof TEXT_SCALES)[number]

export const TEXT_SCALE_KEY = 'altamyra.textScale'

export function isTextScale(n: number): n is TextScale {
  return (TEXT_SCALES as readonly number[]).includes(n)
}

/** The saved scale, or 100 when unset, unreadable or unrecognized. */
export function readTextScale(): TextScale {
  try {
    const n = Number(localStorage.getItem(TEXT_SCALE_KEY))
    return isTextScale(n) ? n : 100
  } catch {
    return 100
  }
}

/** Apply a scale to the document. 100 clears the inline style back to the default. */
export function applyTextScale(scale: number): void {
  document.documentElement.style.fontSize = scale === 100 ? '' : `${scale}%`
}

/** Apply now and remember on this device. */
export function saveTextScale(scale: TextScale): void {
  applyTextScale(scale)
  try {
    if (scale === 100) localStorage.removeItem(TEXT_SCALE_KEY)
    else localStorage.setItem(TEXT_SCALE_KEY, String(scale))
  } catch {
    /* storage unavailable: the choice still applies for this session */
  }
}
