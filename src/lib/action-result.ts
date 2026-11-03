import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  UnavailableError,
  ValidationError,
} from "@/lib/errors";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: string };

// Maps a thrown error to a client-safe result: typed errors expose their code,
// anything else becomes INTERNAL. The message is never included in the result; an
// untyped error is logged server-side by name and message so it can be diagnosed.
export function toActionResult(error: unknown): { ok: false; code: string } {
  if (
    error instanceof ValidationError ||
    error instanceof ConflictError ||
    error instanceof ForbiddenError ||
    error instanceof UnauthenticatedError ||
    error instanceof NotFoundError ||
    error instanceof UnavailableError
  ) {
    return { ok: false, code: error.code };
  }
  console.error("server action failed", {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message.slice(0, 500) : undefined,
  });
  return { ok: false, code: "INTERNAL" };
}
