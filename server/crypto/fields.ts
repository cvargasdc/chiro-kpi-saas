import { decryptAesGcm, encryptAesGcm, isAesGcmCiphertext } from "./aes-gcm";
import type {
  PatientWrite,
  StoredDailyStat,
  StoredGoal,
  StoredPatient,
} from "../storage/types";

/**
 * App-layer AES-256-GCM for sensitive string fields.
 * Keyed by PHI_ENCRYPTION_KEY — never reuse MFA_ENCRYPTION_KEY.
 *
 * Ciphertext is stored in the DB; callers of the storage layer always see
 * plaintext. RDS encryption-at-rest is still required (defense in depth).
 *
 * Legacy plaintext (no `v1:` prefix) is returned as-is on read so existing
 * in-memory fixtures and pre-Week-4 rows keep working until rewritten.
 */

export function requirePhiEncryptionKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length < 32) {
    throw new Error(
      "PHI_ENCRYPTION_KEY must be at least 32 characters. Generate one with `openssl rand -hex 32`.",
    );
  }
  return trimmed;
}

export function encryptPhiString(
  plaintext: string | null | undefined,
  key: string,
): string | null {
  if (plaintext == null || plaintext === "") return null;
  requirePhiEncryptionKey(key);
  return encryptAesGcm(plaintext, key);
}

export function decryptPhiString(
  stored: string | null | undefined,
  key: string,
): string | null {
  if (stored == null || stored === "") return null;
  if (!isAesGcmCiphertext(stored)) {
    return stored;
  }
  requirePhiEncryptionKey(key);
  return decryptAesGcm(stored, key);
}

export function encryptPatientSensitiveFields(
  input: Partial<PatientWrite>,
  key: string,
): Partial<PatientWrite> {
  const out: Partial<PatientWrite> = { ...input };
  if (input.email !== undefined) {
    out.email = encryptPhiString(input.email, key);
  }
  if (input.phone !== undefined) {
    out.phone = encryptPhiString(input.phone, key);
  }
  if (input.dateOfBirth !== undefined) {
    out.dateOfBirth = encryptPhiString(input.dateOfBirth, key);
  }
  return out;
}

export function decryptStoredPatient(row: StoredPatient, key: string): StoredPatient {
  return {
    ...row,
    email: decryptPhiString(row.email, key),
    phone: decryptPhiString(row.phone, key),
    dateOfBirth: decryptPhiString(row.dateOfBirth, key),
  };
}

export function decryptStoredDailyStat(
  row: StoredDailyStat,
  key: string,
): StoredDailyStat {
  return {
    ...row,
    notes: decryptPhiString(row.notes, key),
  };
}

export function decryptStoredGoal(row: StoredGoal, key: string): StoredGoal {
  return {
    ...row,
    notes: decryptPhiString(row.notes, key),
  };
}
