/**
 * Optional prune for expired import raw rows.
 *
 * TTL: IMPORT_RAW_TTL_DAYS (30) from upload. After expiry, `rawData` and
 * `normalizedData` are cleared; batch history (counts, status, file name)
 * is kept. This function is **not scheduled**. Call it from a future job
 * runner — do not enable automated prune until retention is reviewed.
 *
 * ChiroTouch parsers and OpenAI mapping remain out.
 */
import { IMPORT_RAW_TTL_DAYS } from "@shared/import";
import type { AppStorage } from "../storage/types";

export { IMPORT_RAW_TTL_DAYS };

export async function pruneExpiredImportRawRows(
  storage: AppStorage,
  now: Date,
): Promise<{ cleared: number; ttlDays: number }> {
  const cleared = await storage.pruneExpiredImportRawRows(now);
  return { cleared, ttlDays: IMPORT_RAW_TTL_DAYS };
}
