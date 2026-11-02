// Typed errors thrown by services; route handlers translate them to responses.

export class ValidationError extends Error {
  readonly code: string;

  constructor(message: string, code = "VALIDATION_ERROR") {
    super(message);
    this.name = "ValidationError";
    this.code = code;
  }
}

export class ConflictError extends Error {
  readonly code: string;

  constructor(message: string, code = "CONFLICT") {
    super(message);
    this.name = "ConflictError";
    this.code = code;
  }
}

export class ForbiddenError extends Error {
  readonly code: string;

  constructor(code = "FORBIDDEN", message = code) {
    super(message);
    this.name = "ForbiddenError";
    this.code = code;
  }
}

export class UnauthenticatedError extends Error {
  readonly code: string;

  constructor(code = "UNAUTHENTICATED", message = code) {
    super(message);
    this.name = "UnauthenticatedError";
    this.code = code;
  }
}

export class NotFoundError extends Error {
  readonly code: string;

  constructor(code = "NOT_FOUND", message = code) {
    super(message);
    this.name = "NotFoundError";
    this.code = code;
  }
}
