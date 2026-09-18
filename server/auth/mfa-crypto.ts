import { decryptAesGcm, deriveAes256Key, encryptAesGcm } from "../crypto/aes-gcm";

export function deriveMfaKey(secret: string): Buffer {
  const trimmed = secret.trim();
  if (trimmed.length < 32) {
    throw new Error("MFA_ENCRYPTION_KEY must be at least 32 characters");
  }
  return deriveAes256Key(trimmed);
}

export function encryptMfaSecret(plaintext: string, keyMaterial: string): string {
  deriveMfaKey(keyMaterial);
  return encryptAesGcm(plaintext, keyMaterial);
}

export function decryptMfaSecret(payload: string, keyMaterial: string): string {
  deriveMfaKey(keyMaterial);
  try {
    return decryptAesGcm(payload, keyMaterial);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "unsupported_ciphertext_version") {
      throw new Error("unsupported_mfa_secret_version");
    }
    if (message === "invalid_ciphertext") {
      throw new Error("invalid_mfa_secret");
    }
    throw err;
  }
}
