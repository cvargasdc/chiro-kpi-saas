import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const RECOVERY_CODE_COUNT = 10;

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const hex = randomBytes(4).toString("hex");
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4)}`);
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toLowerCase().replace(/\s+/g, "");
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code), "utf8").digest("hex");
}

export function parseRecoveryHashes(stored: string | null | undefined): string[] {
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function serializeRecoveryHashes(hashes: string[]): string {
  return JSON.stringify(hashes);
}

/**
 * Returns remaining hashes if `code` matched a stored hash, otherwise null.
 * Matching hash is removed (single-use).
 */
export function consumeRecoveryHash(
  stored: string | null | undefined,
  code: string,
): string[] | null {
  const hashes = parseRecoveryHashes(stored);
  const needle = Buffer.from(hashRecoveryCode(code));
  let matchIndex = -1;
  for (let i = 0; i < hashes.length; i++) {
    const candidate = Buffer.from(hashes[i]);
    if (candidate.length === needle.length && timingSafeEqual(candidate, needle)) {
      matchIndex = i;
      break;
    }
  }
  if (matchIndex === -1) return null;
  const remaining = hashes.slice();
  remaining.splice(matchIndex, 1);
  return remaining;
}
