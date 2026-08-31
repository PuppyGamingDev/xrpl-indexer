/** Base class for all errors we deliberately throw across package boundaries. */
export class AppError extends Error {
  /** HTTP status the API layer should map this to. */
  readonly status: number;
  /** Stable machine-readable code. */
  readonly code: string;
  override readonly cause?: unknown;

  constructor(message: string, opts: { status?: number; code?: string; cause?: unknown } = {}) {
    super(message);
    this.name = new.target.name;
    this.status = opts.status ?? 500;
    this.code = opts.code ?? "internal_error";
    this.cause = opts.cause;
  }
}

export class NotFoundError extends AppError {
  constructor(message = "not found") {
    super(message, { status: 404, code: "not_found" });
  }
}

export class InvalidParamError extends AppError {
  constructor(message = "invalid parameter") {
    super(message, { status: 400, code: "invalid_param" });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "missing or invalid credentials") {
    super(message, { status: 401, code: "unauthorized" });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "insufficient scope") {
    super(message, { status: 403, code: "forbidden" });
  }
}

export class RateLimitedError extends AppError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message = "rate limit exceeded") {
    super(message, { status: 429, code: "rate_limited" });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class UpstreamError extends AppError {
  constructor(message = "upstream request failed", cause?: unknown) {
    super(message, { status: 502, code: "upstream_error", cause });
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
