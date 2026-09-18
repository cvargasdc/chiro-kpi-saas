import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Versioned envelope: v1:<base64(iv || authTag || ciphertext)> */
export const AES_GCM_PREFIX = "v1:";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export function deriveAes256Key(secret: string, minLength = 32): Buffer {
  const trimmed = secret.trim();
  if (trimmed.length < minLength) {
    throw new Error(`Encryption key must be at least ${minLength} characters`);
  }
  return createHash("sha256").update(trimmed, "utf8").digest();
}

export function isAesGcmCiphertext(value: string): boolean {
  return value.startsWith(AES_GCM_PREFIX);
}

export function encryptAesGcm(plaintext: string, keyMaterial: string): string {
  const key = deriveAes256Key(keyMaterial);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return AES_GCM_PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptAesGcm(payload: string, keyMaterial: string): string {
  if (!payload.startsWith(AES_GCM_PREFIX)) {
    throw new Error("unsupported_ciphertext_version");
  }
  const key = deriveAes256Key(keyMaterial);
  const raw = Buffer.from(payload.slice(AES_GCM_PREFIX.length), "base64");
  if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("invalid_ciphertext");
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
