import { describe, expect, it } from "vitest";
import { toActionResult } from "@/lib/action-result";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "@/lib/errors";

describe("toActionResult", () => {
  it("maps a typed error to its code", () => {
    expect(toActionResult(new ForbiddenError("X"))).toEqual({
      ok: false,
      code: "X",
    });
  });

  it("maps every typed error class to its code", () => {
    expect(toActionResult(new UnauthenticatedError())).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(toActionResult(new NotFoundError("GONE"))).toEqual({
      ok: false,
      code: "GONE",
    });
    expect(toActionResult(new ValidationError("bad"))).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
    });
    expect(toActionResult(new ConflictError("dup"))).toEqual({
      ok: false,
      code: "CONFLICT",
    });
  });

  it("hides untyped errors behind INTERNAL and never leaks the message", () => {
    const result = toActionResult(new Error("db password hunter2"));
    expect(result).toEqual({ ok: false, code: "INTERNAL" });
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("maps non-error throwables to INTERNAL", () => {
    expect(toActionResult("boom")).toEqual({ ok: false, code: "INTERNAL" });
  });
});
