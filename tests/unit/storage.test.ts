import { beforeEach, describe, expect, it, vi } from "vitest";

const presign = vi.hoisted(() => ({ getSignedUrl: vi.fn() }));

vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: presign.getSignedUrl }));

type StorageModule = typeof import("@/lib/storage");

const s3Config = {
  appEnv: "staging" as const,
  nodeEnv: "production",
  endpoint: "https://example.r2.invalid",
  bucket: "bucket",
  accessKeyId: "key-id",
  secretAccessKey: "key-secret",
  region: "auto",
};

const params = (key: string[]) => ({ params: Promise.resolve({ key }) });

describe("storage adapter", () => {
  let storage: StorageModule;

  beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    presign.getSignedUrl.mockReset();
    storage = await import("@/lib/storage");
    storage.fakeStorage.clear();
  });

  it("round-trips body and content type through the fake", async () => {
    await storage.putPrivate("coops/1/doc.pdf", Buffer.from("hello"), "application/pdf");
    const stored = storage.fakeStorage.objects.get("coops/1/doc.pdf");
    expect(stored?.body.toString()).toBe("hello");
    expect(stored?.contentType).toBe("application/pdf");
  });

  it("selectStorage: fake for local or test, s3 when configured, throws otherwise", () => {
    const missing = {
      appEnv: "staging" as const,
      nodeEnv: "production",
      endpoint: undefined,
      bucket: undefined,
      accessKeyId: undefined,
      secretAccessKey: undefined,
      region: "auto",
    };
    expect(() => storage.selectStorage(missing)).toThrow("STORAGE_NOT_CONFIGURED");
    expect(() => storage.selectStorage({ ...s3Config, bucket: undefined })).toThrow(
      "STORAGE_NOT_CONFIGURED",
    );
    expect(storage.selectStorage({ ...missing, appEnv: "local" })).toBe("fake");
    expect(storage.selectStorage({ ...missing, nodeEnv: "test" })).toBe("fake");
    expect(storage.selectStorage(s3Config)).toBe("s3");
  });

  it("passes expiresIn to the S3 presigner", async () => {
    presign.getSignedUrl.mockResolvedValue("https://signed.invalid/x");
    const url = await storage.signedUrlWith(s3Config, "coops/1/doc.pdf", 300);
    expect(url).toBe("https://signed.invalid/x");
    expect(presign.getSignedUrl).toHaveBeenCalledTimes(1);
    expect(presign.getSignedUrl.mock.calls[0][2]).toEqual({ expiresIn: 300 });
  });

  it.each([0, -1, 3601, 1.5, Number.NaN])("rejects ttl %s", async (ttl) => {
    await expect(storage.signedUrl("k", ttl)).rejects.toMatchObject({ name: "ValidationError" });
  });

  it("local signedUrl points at the dev route with exp and sig", async () => {
    const url = await storage.signedUrl("coops/1/doc.pdf", 60);
    expect(url).toMatch(/^\/api\/dev-storage\/coops\/1\/doc\.pdf\?exp=\d+&sig=[0-9a-f]{64}$/);
  });
});

describe("dev-storage route", () => {
  let storage: StorageModule;
  let GET: (req: Request, ctx: ReturnType<typeof params>) => Promise<Response>;
  const future = () => Math.floor(Date.now() / 1000) + 60;

  const request = (key: string, exp: number, sig: string) =>
    new Request(`http://localhost:3000/api/dev-storage/${key}?exp=${exp}&sig=${sig}`);

  beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    storage = await import("@/lib/storage");
    ({ GET } = await import("@/app/api/dev-storage/[...key]/route"));
    storage.fakeStorage.clear();
    await storage.putPrivate("coops/1/doc.pdf", Buffer.from("hello"), "application/pdf");
  });

  it("serves a validly signed link with content type and no-store", async () => {
    const exp = future();
    const res = await GET(
      request("coops/1/doc.pdf", exp, storage.signDevStorage("coops/1/doc.pdf", exp)),
      params(["coops", "1", "doc.pdf"]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("hello");
  });

  it("rejects an expired link with 403", async () => {
    const exp = Math.floor(Date.now() / 1000) - 5;
    const res = await GET(
      request("coops/1/doc.pdf", exp, storage.signDevStorage("coops/1/doc.pdf", exp)),
      params(["coops", "1", "doc.pdf"]),
    );
    expect(res.status).toBe(403);
  });

  it("rejects an altered, short or missing signature with 403", async () => {
    const exp = future();
    const good = storage.signDevStorage("coops/1/doc.pdf", exp);
    const bad = (good[0] === "a" ? "b" : "a") + good.slice(1);
    for (const sig of [bad, "abc", ""]) {
      const res = await GET(request("coops/1/doc.pdf", exp, sig), params(["coops", "1", "doc.pdf"]));
      expect(res.status).toBe(403);
    }
  });

  it("rejects path traversal and absolute keys with 400", async () => {
    const exp = future();
    for (const key of [["..", "secret"], ["a", "..", "b"], ["", "etc"]]) {
      const res = await GET(request("x", exp, "00"), params(key));
      expect(res.status).toBe(400);
    }
  });

  it("returns 404 for a validly signed but unknown key", async () => {
    const exp = future();
    const res = await GET(request("nope", exp, storage.signDevStorage("nope", exp)), params(["nope"]));
    expect(res.status).toBe(404);
  });

  it("returns 404 when NODE_ENV is production even with APP_ENV local", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const exp = future();
    const res = await GET(
      request("coops/1/doc.pdf", exp, storage.signDevStorage("coops/1/doc.pdf", exp)),
      params(["coops", "1", "doc.pdf"]),
    );
    expect(res.status).toBe(404);
  });
});
