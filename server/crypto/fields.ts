import { decryptAesGcm, encryptAesGcm, isAesGcmCiphertext } from "./aes-gcm";
import type {
  PatientWrite,
  StoredCarePlan,
  StoredDailyStat,
  StoredGoal,
  StoredImportRow,
  StoredPatient,
  StoredPatientChecklist,
  StoredPatientChecklistTask,
  StoredProjectTask,
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
  if (input.notes !== undefined) {
    out.notes = encryptPhiString(input.notes, key);
  }
  return out;
}

export function decryptStoredPatient(row: StoredPatient, key: string): StoredPatient {
  return {
    ...row,
    email: decryptPhiString(row.email, key),
    phone: decryptPhiString(row.phone, key),
    dateOfBirth: decryptPhiString(row.dateOfBirth, key),
    notes: decryptPhiString(row.notes, key),
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

export function decryptStoredPatientChecklist(
  row: StoredPatientChecklist,
  key: string,
): StoredPatientChecklist {
  return {
    ...row,
    notes: decryptPhiString(row.notes, key),
  };
}

export function decryptStoredPatientChecklistTask(
  row: StoredPatientChecklistTask,
  key: string,
): StoredPatientChecklistTask {
  return {
    ...row,
    notes: decryptPhiString(row.notes, key),
  };
}

/**
 * When PHI_ENCRYPTION_KEY is unset (tests), store plaintext. decryptPhiString
 * already accepts legacy plaintext (no `v1:` prefix).
 */
export function encryptPhiStringIfKeyed(
  plaintext: string | null | undefined,
  key: string,
): string | null {
  if (plaintext == null || plaintext === "") return null;
  if (!key || key.length < 32) return plaintext;
  return encryptPhiString(plaintext, key);
}

export function encryptCarePlanSensitiveFields(
  input: Partial<{ firstName: string; lastName: string; notes: string | null }>,
  key: string,
): Partial<{ firstName: string; lastName: string; notes: string | null }> {
  const out: Partial<{ firstName: string; lastName: string; notes: string | null }> =
    { ...input };
  if (input.firstName !== undefined) {
    out.firstName = encryptPhiStringIfKeyed(input.firstName, key) ?? "";
  }
  if (input.lastName !== undefined) {
    out.lastName = encryptPhiStringIfKeyed(input.lastName, key) ?? "";
  }
  if (input.notes !== undefined) {
    out.notes = encryptPhiStringIfKeyed(input.notes, key);
  }
  return out;
}

export function decryptStoredCarePlan(row: StoredCarePlan, key: string): StoredCarePlan {
  return {
    ...row,
    firstName: decryptPhiString(row.firstName, key) ?? "",
    lastName: decryptPhiString(row.lastName, key) ?? "",
    notes: decryptPhiString(row.notes, key),
  };
}

export function decryptStoredProjectTask(
  row: StoredProjectTask,
  key: string,
): StoredProjectTask {
  return {
    ...row,
    notes: decryptPhiString(row.notes, key),
  };
}

export function decryptStoredImportRow(
  row: StoredImportRow,
  key: string,
): StoredImportRow {
  return {
    ...row,
    rawData: decryptPhiString(row.rawData, key) ?? "",
    normalizedData: decryptPhiString(row.normalizedData, key),
  };
}
