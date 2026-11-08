import { AltamyraError, ERROR_STATUS, type ErrorBody, type ErrorCode } from '../contract/errors'
import type { OpResult } from '../contract/ops'
import type { CanResult } from '../contract/permissions'

/**
 * The one error type the Altamyra middleware and routes throw. It carries the
 * contract error code; status comes from ERROR_STATUS (409 version conflict,
 * 410 expired link). The Hono error handler turns it into { error: { code, message } }.
 */
export class HttpError extends AltamyraError {
  constructor(code: ErrorCode, message: string) {
    super(code, message)
    this.name = 'HttpError'
  }
}

/** Maps a can() refusal to an HttpError: always 403. */
export function httpErrorFromDeny(result: Extract<CanResult, { allowed: false }>): HttpError {
  return new HttpError('forbidden', `Not allowed (${result.reason}).`)
}

/** Unwraps a room RPC result, or throws the op's error with its contract status. */
export function unwrapOp<R>(result: OpResult<R>): R {
  if (result.ok) return result.value
  throw new HttpError(result.error.code, result.error.message)
}

export const jsonResponse = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** JSON response for an Altamyra error, or null when the error is not ours. */
export function errorResponse(err: unknown): Response | null {
  if (!(err instanceof AltamyraError)) return null
  const body: ErrorBody = err.toBody()
  return jsonResponse(body, ERROR_STATUS[err.code])
}

/**
 * Clean 502 body for a failed model call. No provider detail (keys, URLs, raw
 * responses) goes to the client; contract errors are left to the normal handler.
 */
export function aiFailureResponse(err: unknown): Response | null {
  if (err instanceof AltamyraError) return null
  return jsonResponse({ error: { code: 'ai_unavailable', message: 'The AI service did not answer. Try again in a moment.' } }, 502)
}
