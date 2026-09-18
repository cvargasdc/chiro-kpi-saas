import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "v1:";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export function deriveMfaKey(secret: string): Buffer {
  const trimmed = secret.trim();
  if (trimmed.length < 32) {
    throw new Error("MFA_ENCRYPTION_KEY must be at least 32 characters");
  }
  return createHash("sha256").update(trimmed, "utf8").digest();
}

export function encryptMfaSecret(plaintext: string, keyMaterial: string): string {
  const key = deriveMfaKey(keyMaterial);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptMfaSecret(payload: string, keyMaterial: string): string {
  if (!payload.startsWith(PREFIX)) {
    throw new Error("unsupported_mfa_secret_version");
  }
  const key = deriveMfaKey(keyMaterial);
  const raw = Buffer.from(payload.slice(PREFIX.length), "base64");
  if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("invalid_mfa_secret");
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
