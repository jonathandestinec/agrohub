import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/errors";

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const getActor = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("@/modules/identity/session", () => ({ getActor: () => getActor() }));

const { requireActorForPage } = await import("@/app/(auth)/require-actor-page");

beforeEach(() => {
  redirect.mockClear();
  getActor.mockReset();
});

describe("requireActorForPage", () => {
  it("returns the actor when there is one", async () => {
    const actor = { userId: "u1", role: "BUYER", cooperativeId: null, twoFactorEnabled: false };
    getActor.mockResolvedValue(actor);
    await expect(requireActorForPage()).resolves.toBe(actor);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to /sign-in when there is no actor", async () => {
    getActor.mockResolvedValue(null);
    await expect(requireActorForPage()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(redirect).toHaveBeenCalledWith("/sign-in");
  });

  it("redirects to /two-factor when getActor throws 2FA_REQUIRED", async () => {
    getActor.mockRejectedValue(new ForbiddenError("2FA_REQUIRED"));
    await expect(requireActorForPage()).rejects.toThrow("NEXT_REDIRECT:/two-factor");
    expect(redirect).toHaveBeenCalledWith("/two-factor");
  });

  it("rethrows any other error", async () => {
    const error = new ForbiddenError("SOMETHING_ELSE");
    getActor.mockRejectedValue(error);
    await expect(requireActorForPage()).rejects.toBe(error);
    expect(redirect).not.toHaveBeenCalled();
  });
});
