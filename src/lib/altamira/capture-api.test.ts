import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('deepspace', () => ({ getAuthToken: vi.fn(async () => 'tok') }))

import {
  ApiError,
  captureErrorKind,
  confirmReview,
  correctDataPoint,
  fileKeyOfSourceRef,
  normalizeSheetCode,
  photoFileKey,
  photoMedia,
  pollBatch,
  recordEvent,
  sendNote,
  sendVideo,
  videoFileKey,
  sendVoiceNote,
  uploadPhotos,
} from './capture-api'

const fetchMock = vi.fn()
const reply = (body: unknown, status = 200) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }))
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url, init, body: init.body ? JSON.parse(init.body as string) : undefined }
}

beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

describe('sheet codes and files', () => {
  it('validates and names the photo so the server reads the code', () => {
    expect(normalizeSheetCode(' al-k7q4l1 ')).toBe('AL-K7Q4L1')
    expect(normalizeSheetCode('hello')).toBeNull()
    expect(photoFileKey('AL-K7Q4L1', 5)).toBe('captures/5/sheet-code-AL-K7Q4L1.jpg')
    expect(fileKeyOfSourceRef('photo:captures/5/a.jpg#q3')).toBe('captures/5/a.jpg')
    expect(fileKeyOfSourceRef('ea_event:timer:1')).toBeNull()
  })
  it('encodes the photo as base64', async () => {
    const m = await photoMedia(new Blob(['hi'], { type: 'image/png' }), 'AL-ABC123', 1)
    expect(m).toEqual({ fileKey: 'captures/1/sheet-code-AL-ABC123.png', contentType: 'image/png', bytesBase64: btoa('hi') })
  })
})

describe('photo capture', () => {
  it('uploads pages with credentials and polls until the batch is done', async () => {
    reply({ batch: { id: 'b1', status: 'processing', pages: [] } }, 201)
    await uploadPhotos([{ fileKey: 'k', contentType: 'image/jpeg' }])
    let c = lastCall()
    expect(c.url).toBe('/api/v1/captures/photos')
    expect(c.init.method).toBe('POST')
    expect(c.init.credentials).toBe('include')
    expect((c.init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    expect(c.body).toEqual({ pages: [{ fileKey: 'k', contentType: 'image/jpeg' }] })

    reply({ batch: { id: 'b1', status: 'processing', pages: [] } })
    reply({ batch: { id: 'b1', status: 'done', pages: [] } })
    const sleep = vi.fn().mockResolvedValue(undefined)
    const done = await pollBatch('b1', { sleep })
    expect(done.batch.status).toBe('done')
    expect(sleep).toHaveBeenCalledTimes(1)
    c = lastCall()
    expect(c.url).toBe('/api/v1/captures/b1')
    expect(c.init.method).toBe('GET')
  })
})

describe('review', () => {
  it('confirms and corrects with the student id and versions', async () => {
    reply({ dataPoint: {} })
    await confirmReview('s1', 'r1', { expectedVersion: 2 })
    let c = lastCall()
    expect(c.url).toBe('/api/v1/review-queue/r1/confirm?studentId=s1')
    expect(c.body).toEqual({ expectedVersion: 2 })

    reply({ dataPoint: {} })
    await correctDataPoint('s1', 'd1', { expectedVersion: 3, value: 80, reason: 'misread' })
    c = lastCall()
    expect(c.url).toBe('/api/v1/data-points/d1/correct?studentId=s1')
    expect(c.body).toEqual({ expectedVersion: 3, value: 80, reason: 'misread' })
  })
  it('throws ApiError with status and code', async () => {
    reply({ error: { code: 'conflict', message: 'stale' } }, 409)
    await expect(confirmReview('s1', 'r1', { expectedVersion: 1 })).rejects.toMatchObject({ status: 409, code: 'conflict', message: 'stale' })
    reply('x', 500)
    await expect(confirmReview('s1', 'r1', { expectedVersion: 1 })).rejects.toBeInstanceOf(ApiError)
  })
})

describe('EA events', () => {
  it('posts prompt level, counter and timer events', async () => {
    const base = { objectiveId: 'o1', classId: null, lessonId: null }
    for (const event of [
      { ...base, kind: 'prompt_level' as const, promptLevel: 'verbal' as const },
      { ...base, kind: 'counter' as const, count: 4 },
      { ...base, kind: 'timer' as const, durationSeconds: 90 },
    ]) {
      reply({ dataPoint: {} }, 201)
      await recordEvent('s 1', event)
      const c = lastCall()
      expect(c.url).toBe('/api/v1/students/s%201/events')
      expect(c.body).toEqual(event)
    }
  })
  it('sends a voice note as base64 audio, and typed text as text/plain', async () => {
    reply({ dataPoints: [], audioDeleted: true }, 201)
    await sendVoiceNote('s1', new Blob(['aa'], { type: 'audio/webm' }), null, 7)
    let c = lastCall()
    expect(c.url).toBe('/api/v1/students/s1/voice-notes')
    expect(c.body).toEqual({ audio: { fileKey: 'voice/7.webm', contentType: 'audio/webm', bytesBase64: btoa('aa') }, classId: null })
    reply({ dataPoints: [], audioDeleted: true }, 201)
    await sendVoiceNote('s1', new Blob(['note'], { type: 'text/plain' }), null, 8)
    c = lastCall()
    expect(c.body.audio.fileKey).toBe('voice/8.txt')
  })
})

describe('typed notes and videos', () => {
  it('posts a trimmed note, objective optional', async () => {
    reply({ note: { id: 'n1' } }, 201)
    await sendNote('s1', '  Did well  ')
    expect(lastCall().url).toBe('/api/v1/students/s1/notes')
    expect(lastCall().body).toEqual({ text: 'Did well' })
    reply({ note: { id: 'n2' } }, 201)
    await sendNote('s1', 'x', 'o1')
    expect(lastCall().body).toEqual({ text: 'x', objectiveId: 'o1' })
  })
  it('sends a video with its type and size', async () => {
    reply({ video: { id: 'v1' } }, 201)
    await sendVideo('s1', new Blob(['abc'], { type: 'video/webm' }), 'o1', 7)
    const { url, body } = lastCall()
    expect(url).toBe('/api/v1/students/s1/videos')
    expect(body).toMatchObject({ contentType: 'video/webm', sizeBytes: 3, objectiveId: 'o1' })
    expect(body.video.fileKey).toBe('videos/7.webm')
    expect(videoFileKey(1, 'video/quicktime')).toBe('videos/1.mov')
  })
  it('spots the consent refusal', async () => {
    reply({ error: { code: 'consent_required', message: 'no' } }, 403)
    const err = await sendVideo('s1', new Blob(['a'], { type: 'video/mp4' })).catch((e) => e)
    expect(captureErrorKind(err)).toBe('consent')
    expect(captureErrorKind(new Error('x'))).toBe('other')
  })
})
