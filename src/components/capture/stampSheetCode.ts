/** Box where the bundled sample sheet leaves room for its code (pixels in the 800 x 1000 image). */
const CODE_BOX = { x: 490, y: 64, w: 258, h: 54 }

/**
 * Prints the issued sheet code into the sample sheet's code box so the photo
 * carries the code that matches the seeded student and goal. Falls back to the
 * unstamped image if the browser cannot draw it.
 */
export async function stampSheetCode(image: Blob, code: string): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(image)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return image
    ctx.drawImage(bitmap, 0, 0)
    const scale = bitmap.width / 800
    ctx.fillStyle = '#111'
    ctx.font = `bold ${Math.round(34 * scale)}px ui-monospace, Menlo, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(code, (CODE_BOX.x + CODE_BOX.w / 2) * scale, (CODE_BOX.y + CODE_BOX.h / 2) * scale)
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? image), 'image/png'))
  } catch {
    return image
  }
}

/** Rows of the sample sheet, as [top, height] in the 800 x 1000 image, for review thumbnails. */
export const SAMPLE_ITEM_ROWS: Record<string, [number, number]> = { q1: [185, 120], q2: [315, 120], q3: [445, 120] }
export const SAMPLE_SHEET_URL = '/samples/coded-sheet-sample.png'
