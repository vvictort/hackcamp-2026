import { afterEach, describe, expect, it } from 'vitest'
import { closeAll } from '../services/testing'
import { sofia, U } from './flows'
import { createHarness } from './harness'
import photoUrl from '../../../../tests/fixtures/coded-sheet-photo.png?inline'
import { MAX_PHOTO_BYTES, normalizePhotoPage } from '../routes/capture'

afterEach(closeAll)

const PHOTO = photoUrl.split(',')[1] ?? ''

const photoPage = (code: string, extra: Record<string, unknown> = {}) => ({
  fileKey: `captures/photo-sheet-code-${code}.png`,
  contentType: 'image/png',
  bytesBase64: PHOTO,
  ...extra,
})
const pointsOf = (h: ReturnType<typeof createHarness>) =>
  h.studentSql(sofia).get<{ n: number }>("SELECT COUNT(*) AS n FROM data_points WHERE source_ref LIKE 'photo:captures/photo-sheet-code-%'")!.n

describe('real photo of a coded sheet', () => {
  it('scores into a data point and sends the low-confidence item to review; the model gets the photo bytes', async () => {
    let seen: { contentType?: string; bytes?: number; itemIds?: string[] } = {}
    const h = createHarness({
      devSeed: true,
      ai: {
        scorePhotoPage: async (i) => {
          seen = { contentType: i.image.contentType, bytes: i.image.bytesBase64?.length, itemIds: i.check.items.map((x) => x.id) }
          return {
            sheetCode: null,
            items: i.check.items.map((x, n) => ({ itemId: x.id, value: 1, confidence: n === 0 ? 0.4 : 0.97 })),
          }
        },
      },
    })
    const sample = await h.post(U.teacher, '/captures/sample-sheet', { studentId: sofia })
    const res = await h.post(U.teacher, '/captures/photos', { pages: [photoPage(sample.body.code, { bytesBase64: `data:image/png;base64,${PHOTO}`, contentType: 'IMAGE/PNG; charset=binary' })] })
    expect(res.status).toBe(201)
    expect(res.body.batch.pages[0]).toMatchObject({ status: 'scored', studentId: sofia })
    expect(seen.contentType).toBe('image/png')
    expect(seen.bytes).toBe(PHOTO.length)
    expect(seen.itemIds!.length).toBeGreaterThan(0)
    expect(pointsOf(h)).toBe(1)
    const queue = await h.get(U.teacher, '/review-queue')
    expect(queue.body.items.some((i: { studentId: string; reviewKind?: string }) => i.studentId === sofia)).toBe(true)
  })

  it('works on the fixture path (no key) and an unreadable code is reported, not scored', async () => {
    const h = createHarness({ devSeed: true })
    const sample = await h.post(U.teacher, '/captures/sample-sheet', { studentId: sofia })
    const ok = await h.post(U.teacher, '/captures/photos', { pages: [photoPage(sample.body.code)] })
    expect(ok.body.batch.pages[0].status).toBe('scored')
    expect(pointsOf(h)).toBe(1)
    const bad = await h.post(U.teacher, '/captures/photos', { pages: [{ ...photoPage('x'), fileKey: 'captures/IMG_0001.png' }] })
    expect(bad.body.batch.pages[0].status).toBe('unreadable_code')
  })

  it('rejects non-image types and oversize photos with a 400', async () => {
    const h = createHarness({ devSeed: true })
    const pdf = await h.post(U.teacher, '/captures/photos', { pages: [photoPage('AL-X', { contentType: 'application/pdf' })] })
    expect(pdf.status).toBe(400)
    const big = 'A'.repeat(Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 8)
    expect((await h.post(U.teacher, '/captures/photos', { pages: [photoPage('AL-X', { bytesBase64: big })] })).status).toBe(400)
    expect((await h.post(U.teacher, '/captures/photos', { pages: [photoPage('AL-X', { bytesBase64: '***' })] })).status).toBe(400)
  })

  it('normalizePhotoPage maps jpg and trims whitespace', () => {
    expect(normalizePhotoPage({ fileKey: 'a', contentType: 'image/jpg', bytesBase64: 'QUJD\nRA==' })).toMatchObject({ contentType: 'image/jpeg', bytesBase64: 'QUJDRA==' })
  })
})
