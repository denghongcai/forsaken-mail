/**
 * Unified API error model.
 *
 * Every outward-facing error response looks like:
 *   { "error": { "code": "<machine-readable code>", "message": "<human-readable text>" } }
 * Route handlers simply throw new ApiError(...); the unified error middleware
 * in app.ts catches everything.
 */
export class ApiError extends Error {
  /** HTTP status code */
  readonly status: number
  /** Machine-readable error code the frontend can branch on */
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }

  static badRequest(message: string): ApiError {
    return new ApiError(400, 'bad_request', message)
  }

  static unauthorized(message = 'Not authenticated or credentials expired'): ApiError {
    return new ApiError(401, 'unauthorized', message)
  }

  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError(404, 'not_found', message)
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, 'conflict', message)
  }

  static unprocessable(message: string): ApiError {
    return new ApiError(422, 'unprocessable', message)
  }
}
