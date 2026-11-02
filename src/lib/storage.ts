import { createHmac, timingSafeEqual } from "node:crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, type Env } from "@/lib/env";
import { ValidationError } from "@/lib/errors";

export type StorageConfig = {
  appEnv: Env["APP_ENV"];
  nodeEnv: string | undefined;
  endpoint: string | undefined;
  bucket: string | undefined;
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
  region: string;
};

type FakeObject = { body: Buffer; contentType: string };
type FakeStorage = { objects: Map<string, FakeObject>; clear(): void };

// Kept on globalThis so the Next server and route handlers share one store even when
// `next dev` loads separate copies of this module.
const globalForStorage = globalThis as unknown as { agrohubFakeStorage?: FakeStorage };

export const fakeStorage: FakeStorage = (globalForStorage.agrohubFakeStorage ??= {
  objects: new Map(),
  clear() {
    this.objects.clear();
  },
});

export function selectStorage(config: StorageConfig): "fake" | "s3" {
  if (config.appEnv === "local" || config.nodeEnv === "test") return "fake";
  if (config.endpoint && config.bucket && config.accessKeyId && config.secretAccessKey) {
    return "s3";
  }
  throw new Error("STORAGE_NOT_CONFIGURED");
}

let s3Client: S3Client | undefined;

export function s3ClientOptions(config: StorageConfig): S3ClientConfig {
  return {
    forcePathStyle: true,
    region: config.region,
    endpoint: config.endpoint,
    // The SDK's default CRC32 checksum headers are rejected by Backblaze B2.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: config.accessKeyId as string,
      secretAccessKey: config.secretAccessKey as string,
    },
  };
}

function client(config: StorageConfig): S3Client {
  // Built lazily on first real use, never at import.
  s3Client ??= new S3Client(s3ClientOptions(config));
  return s3Client;
}

export function signDevStorage(key: string, exp: number): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(`${key}\n${exp}`).digest("hex");
}

export function verifyDevStorage(key: string, exp: number, sig: string): boolean {
  const expected = Buffer.from(signDevStorage(key, exp), "hex");
  const given = Buffer.from(sig, "hex");
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

export async function putPrivateWith(
  config: StorageConfig,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  if (selectStorage(config) === "fake") {
    fakeStorage.objects.set(key, { body: Buffer.from(body), contentType });
    return;
  }
  await client(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function signedUrlWith(
  config: StorageConfig,
  key: string,
  ttlSeconds: number,
): Promise<string> {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600) {
    throw new ValidationError("ttlSeconds must be an integer from 1 to 3600");
  }
  if (selectStorage(config) === "fake") {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const path = key.split("/").map(encodeURIComponent).join("/");
    return `/api/dev-storage/${path}?exp=${exp}&sig=${signDevStorage(key, exp)}`;
  }
  return getSignedUrl(
    client(config),
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn: ttlSeconds },
  );
}

function currentConfig(): StorageConfig {
  return {
    appEnv: env.APP_ENV,
    nodeEnv: process.env.NODE_ENV,
    endpoint: env.STORAGE_ENDPOINT,
    bucket: env.STORAGE_BUCKET,
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    region: env.STORAGE_REGION,
  };
}

export function putPrivate(key: string, body: Buffer, contentType: string): Promise<void> {
  return putPrivateWith(currentConfig(), key, body, contentType);
}

export function signedUrl(key: string, ttlSeconds: number): Promise<string> {
  return signedUrlWith(currentConfig(), key, ttlSeconds);
}
