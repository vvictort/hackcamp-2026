import { AltamiraError, ERROR_STATUS, type ErrorBody, type ErrorCode } from '../contract/errors'
import type { OpResult } from '../contract/ops'
import type { CanResult } from '../contract/permissions'

/**
 * The one error type the Altamira middleware and routes throw. It carries the
 * contract error code; status comes from ERROR_STATUS (409 version conflict,
 * 410 expired link). The Hono error handler turns it into { error: { code, message } }.
 */
export class HttpError extends AltamiraError {
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

/** JSON response for an Altamira error, or null when the error is not ours. */
export function errorResponse(err: unknown): Response | null {
  if (!(err instanceof AltamiraError)) return null
  const body: ErrorBody = err.toBody()
  return new Response(JSON.stringify(body), {
    status: ERROR_STATUS[err.code],
    headers: { 'Content-Type': 'application/json' },
  })
}
