/** Any AI function name, including the summary functions in summaries.ts. */
type AiFunctionName = string

/** The provider returned something that does not parse with the contract output schema. */
export class AiOutputError extends Error {
  readonly fn: AiFunctionName
  readonly issues: string[]
  constructor(fn: AiFunctionName, issues: string[]) {
    super(`AI output for ${fn} failed schema validation: ${issues.join('; ')}`)
    this.name = 'AiOutputError'
    this.fn = fn
    this.issues = issues
  }
}

/** A name or identifier survived de-identification; the call was refused before reaching the provider. */
export class AiDeidentificationError extends Error {
  readonly fn: AiFunctionName
  /** Kinds only (never the matched text), so the error itself cannot leak an identifier into logs. */
  readonly kinds: string[]
  constructor(fn: AiFunctionName, kinds: string[]) {
    super(`Refused ${fn}: identifiers remain after de-identification (${kinds.join(', ')})`)
    this.name = 'AiDeidentificationError'
    this.fn = fn
    this.kinds = kinds
  }
}

export const VERTEX_NOT_CONFIGURED =
  'Vertex AI not configured: needs GCP service account and @ai-sdk/google-vertex (pending owner approval)'

export class AiNotConfiguredError extends Error {
  constructor(message = VERTEX_NOT_CONFIGURED) {
    super(message)
    this.name = 'AiNotConfiguredError'
  }
}
