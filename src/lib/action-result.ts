import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "@/lib/errors";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: string };

// Maps a thrown error to a client-safe result: typed errors expose their code,
// anything else becomes INTERNAL. The message is never included.
export function toActionResult(error: unknown): { ok: false; code: string } {
  if (
    error instanceof ValidationError ||
    error instanceof ConflictError ||
    error instanceof ForbiddenError ||
    error instanceof UnauthenticatedError ||
    error instanceof NotFoundError
  ) {
    return { ok: false, code: error.code };
  }
  return { ok: false, code: "INTERNAL" };
}
