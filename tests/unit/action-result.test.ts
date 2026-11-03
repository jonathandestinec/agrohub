import { describe, expect, it, vi } from "vitest";
import { toActionResult } from "@/lib/action-result";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  UnavailableError,
  ValidationError,
} from "@/lib/errors";

describe("toActionResult", () => {
  it("maps a typed error to its code", () => {
    expect(toActionResult(new ForbiddenError("X"))).toEqual({
      ok: false,
      code: "X",
    });
  });

  it("maps an unavailable outside service to its code", () => {
    expect(toActionResult(new UnavailableError("PAYSTACK_UNAVAILABLE"))).toEqual({
      ok: false,
      code: "PAYSTACK_UNAVAILABLE",
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

  it("logs an untyped error server-side by name and message only", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("Unsupported header"), { name: "InvalidRequest" });
    toActionResult(error);
    expect(spy).toHaveBeenCalledWith("server action failed", {
      name: "InvalidRequest",
      message: "Unsupported header",
    });
    spy.mockRestore();
  });

  it("does not log typed errors", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    toActionResult(new ValidationError("bad"));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
