import { z } from 'zod'

/** Error codes and the HTTP status each one answers with (design doc "API routes"). */
export const ERROR_STATUS = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  version_conflict: 409,
  gone: 410,
} as const

export type ErrorCode = keyof typeof ERROR_STATUS
export const ErrorCodeSchema = z.enum(Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]])

/** Every error response body: { error: { code, message } }. */
export const ErrorBody = z.object({
  error: z.object({ code: ErrorCodeSchema, message: z.string() }),
})
export type ErrorBody = z.infer<typeof ErrorBody>

/**
 * Thrown by room ops and services. Throwing inside a room op rolls back the
 * whole transaction, so nothing (including the audit row) is written.
 */
export class AltamyraError extends Error {
  readonly code: ErrorCode
  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'AltamyraError'
    this.code = code
  }
  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message } }
  }
}
