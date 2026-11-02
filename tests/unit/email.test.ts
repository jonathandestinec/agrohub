import { beforeEach, describe, expect, it, vi } from "vitest";

const resendMocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  send: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendMocks.send };
    constructor(apiKey: string) {
      resendMocks.constructor(apiKey);
    }
  },
}));

type EmailModule = typeof import("@/lib/email");

const msg = { to: "a@b.com", subject: "Hi", html: "<p>x</p>" };

describe("email adapter", () => {
  let fakeOutbox: EmailModule["fakeOutbox"];
  let selectTransport: EmailModule["selectTransport"];
  let sendEmail: EmailModule["sendEmail"];
  let sendEmailWith: EmailModule["sendEmailWith"];

  beforeEach(async () => {
    // Fresh module per test so the lazily cached Resend client never leaks between tests.
    vi.resetModules();
    ({ fakeOutbox, selectTransport, sendEmail, sendEmailWith } = await import("@/lib/email"));
    fakeOutbox.clear();
    resendMocks.constructor.mockClear();
    resendMocks.send.mockReset();
  });

  it("under test, sendEmail appends one entry to the outbox and makes no network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await sendEmail(msg);
    expect(fakeOutbox.sent).toEqual([msg]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(resendMocks.constructor).not.toHaveBeenCalled();
    expect(resendMocks.send).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("clear empties the outbox", async () => {
    await sendEmail(msg);
    fakeOutbox.clear();
    expect(fakeOutbox.sent).toEqual([]);
  });

  describe("selectTransport", () => {
    it("local uses the fake outbox, even with a key", () => {
      expect(selectTransport({ appEnv: "local", nodeEnv: "development", resendApiKey: "k" })).toBe("fake");
    });
    it("test runs use the fake outbox even in staging", () => {
      expect(selectTransport({ appEnv: "staging", nodeEnv: "test", resendApiKey: "k" })).toBe("fake");
    });
    it("staging with a key uses resend", () => {
      expect(selectTransport({ appEnv: "staging", nodeEnv: "production", resendApiKey: "k" })).toBe("resend");
    });
    it("production without a key is an error", () => {
      expect(() => selectTransport({ appEnv: "production", nodeEnv: "production", resendApiKey: undefined })).toThrow(
        /RESEND_API_KEY/,
      );
    });
  });

  describe("sendEmailWith", () => {
    it("sends through Resend with the key, building the client only on first send", async () => {
      resendMocks.send.mockResolvedValue({ data: { id: "1" }, error: null });
      const config = { appEnv: "staging" as const, nodeEnv: "production", resendApiKey: "test-key" };
      expect(resendMocks.constructor).not.toHaveBeenCalled();
      await sendEmailWith(config, msg);
      expect(resendMocks.constructor).toHaveBeenCalledWith("test-key");
      expect(resendMocks.send).toHaveBeenCalledWith(expect.objectContaining(msg));
      expect(fakeOutbox.sent).toEqual([]);
    });

    it("sends from the configured sender address", async () => {
      resendMocks.send.mockResolvedValue({ data: { id: "1" }, error: null });
      const config = {
        appEnv: "staging" as const,
        nodeEnv: "production",
        resendApiKey: "test-key",
        from: "AgroHub <hello@agrohub.ng>",
      };
      await sendEmailWith(config, msg);
      expect(resendMocks.send).toHaveBeenCalledWith(expect.objectContaining({ from: "AgroHub <hello@agrohub.ng>" }));
    });

    it("throws when Resend returns an error, without leaking the body", async () => {
      resendMocks.send.mockResolvedValue({ data: null, error: { message: "bad", name: "validation_error" } });
      const config = { appEnv: "staging" as const, nodeEnv: "production", resendApiKey: "test-key" };
      await expect(sendEmailWith(config, msg)).rejects.toThrow(/Resend/);
    });

    it("throws in production without a key and does not drop mail", async () => {
      const config = { appEnv: "production" as const, nodeEnv: "production", resendApiKey: undefined };
      await expect(sendEmailWith(config, msg)).rejects.toThrow(/RESEND_API_KEY/);
      expect(fakeOutbox.sent).toEqual([]);
    });
  });
});
