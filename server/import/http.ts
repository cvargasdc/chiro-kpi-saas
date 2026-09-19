import { createHash } from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import {
  IMPORT_MAX_ROWS,
  IMPORT_PREVIEW_SAMPLE,
  IMPORT_TARGET_FIELDS,
  SKIP_COLUMN,
  detectFileType,
  inferImportTarget,
  importRawExpiresAt,
  isImportTargetField,
  maskPhiCell,
  maskRowSample,
  normalizeImportRow,
  parseCsv,
  parseFlexibleDate,
  parseIntegerCount,
  parseMoneyDollars,
  type ColumnMapping,
  type NormalizedImportRow,
} from "@shared/import";
import { isRevenueWithoutVisits } from "@shared/kpis";
import { ORG_ADMIN_ROLES } from "@shared/roles";
import { logAudit } from "../audit/logAudit";
import {
  authenticate,
  getClientIp,
  requirePracticeMembership,
  requireRole,
} from "../auth/middleware";
import { requireActiveSubscription } from "../billing/entitlement";
import { DuplicateDailyLogError } from "../daily-log/errors";
import type { HttpContext } from "../http-context";
import { IMPORT_OUT_OF_SCOPE } from "./csv-excel-stub";
import { parseXlsxBuffer } from "./parse-xlsx";
import type { StoredImportBatch } from "../storage/types";

const uploadSchema = z.object({
  fileName: z.string().min(1).max(240),
  csv: z.string().max(2_000_000).optional(),
  content: z.string().max(2_000_000).optional(),
  xlsxBase64: z.string().max(2_000_000).optional(),
});

const mapSchema = z.object({
  mappings: z
    .array(
      z.object({
        sourceColumn: z.string().min(1).max(120),
        targetField: z.string().min(1).max(80),
      }),
    )
    .min(1)
    .max(40),
});

function publicBatch(row: StoredImportBatch) {
  return {
    id: row.id,
    fileName: row.fileName,
    fileType: row.fileType,
    status: row.status,
    totalRows: row.totalRows,
    successRows: row.successRows,
    errorRows: row.errorRows,
    skippedRows: row.skippedRows,
    importType: row.importType,
    headers: row.headers,
    mappings: row.columnMapping,
    createdBy: row.createdBy,
    committedAt: row.committedAt?.toISOString() ?? null,
    rawExpiresAt: row.rawExpiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseCells(rawData: string): string[] {
  try {
    const parsed = JSON.parse(rawData) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((cell) => String(cell ?? ""));
  } catch {
    return [];
  }
}

function hashRow(cells: string[]): string {
  return createHash("sha256").update(JSON.stringify(cells)).digest("hex");
}

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\]/g, "_").slice(0, 240);
}

function maskUploadCell(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.includes("@")) return maskPhiCell(trimmed, "email");
  if (/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(trimmed)) {
    return maskPhiCell(trimmed, "phone");
  }
  if (parseFlexibleDate(trimmed)) return trimmed;
  if (/^[$0-9.,\s]+$/.test(trimmed) && parseMoneyDollars(trimmed) != null) {
    return trimmed;
  }
  if (parseIntegerCount(trimmed) != null) return trimmed;
  return maskPhiCell(trimmed, "name");
}

export function registerImportRoutes(app: Express, ctx: HttpContext): void {
  const storage = ctx.storage;
  const auth = authenticate(storage);
  const practiceGate = requirePracticeMembership(storage);
  const billingGate = requireActiveSubscription(ctx);
  const adminGate = requireRole(...ORG_ADMIN_ROLES);

  app.post(
    "/api/import/upload",
    auth,
    practiceGate,
    adminGate,
    billingGate,
    async (req, res) => {
      const parsed = uploadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_input" });
      }
      const fileName = sanitizeFileName(parsed.data.fileName);
      const csvText = parsed.data.csv ?? parsed.data.content;
      const fileType = detectFileType(fileName) ?? (csvText ? "csv" : parsed.data.xlsxBase64 ? "xlsx" : null);
      if (!fileType) {
        return res.status(400).json({ error: "unsupported_file_type" });
      }
      let sheet;
      try {
        if (fileType === "xlsx") {
          if (!parsed.data.xlsxBase64) {
            return res.status(400).json({ error: "xlsx_required" });
          }
          const buffer = Buffer.from(parsed.data.xlsxBase64, "base64");
          sheet = parseXlsxBuffer(buffer);
        } else {
          if (!csvText) {
            return res.status(400).json({ error: "csv_required" });
          }
          sheet = parseCsv(csvText);
        }
      } catch {
        return res.status(400).json({ error: "parse_failed" });
      }
      if (sheet.headers.length === 0) {
        return res.status(400).json({ error: "empty_file" });
      }
      if (sheet.rows.length > IMPORT_MAX_ROWS) {
        return res.status(400).json({ error: "too_many_rows", max: IMPORT_MAX_ROWS });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const now = ctx.now();
      const batch = await storage.createImportBatch(scope, {
        fileName,
        fileType,
        status: "uploaded",
        totalRows: sheet.rows.length,
        headers: sheet.headers,
        createdBy: req.currentUser!.id,
        rawExpiresAt: importRawExpiresAt(now),
      });
      for (let i = 0; i < sheet.rows.length; i += 1) {
        const cells = sheet.rows[i];
        await storage.createImportRow(scope, {
          batchId: batch.id,
          rowNumber: i + 1,
          rawData: JSON.stringify(cells),
          contentHash: hashRow(cells),
          status: "pending",
        });
      }
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "create",
        resourceType: "import_batch",
        resourceId: batch.id,
        metadata: {
          fileType,
          rowCount: sheet.rows.length,
          headerCount: sheet.headers.length,
          ...IMPORT_OUT_OF_SCOPE,
        },
        ipAddress: getClientIp(req),
      });
      res.status(201).json({
        batch: publicBatch(batch),
        headers: sheet.headers,
        sampleRows: sheet.rows.slice(0, IMPORT_PREVIEW_SAMPLE).map((cells) =>
          cells.map((cell) => maskUploadCell(cell)),
        ),
        targetFields: IMPORT_TARGET_FIELDS,
        ttlDays: 30,
        ...IMPORT_OUT_OF_SCOPE,
      });
    },
  );

  app.get(
    "/api/import/batches",
    auth,
    practiceGate,
    adminGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const batches = await storage.listImportBatches(scope);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "list",
        resourceType: "import_batch",
        metadata: { count: batches.length, ...IMPORT_OUT_OF_SCOPE },
        ipAddress: getClientIp(req),
      });
      res.json({
        batches: batches.map(publicBatch),
        emptyState: batches.length === 0 ? "no_batches" : "has_data",
        ttlDays: 30,
        ...IMPORT_OUT_OF_SCOPE,
      });
    },
  );

  app.get(
    "/api/import/batches/:id",
    auth,
    practiceGate,
    adminGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const batch = await storage.getImportBatch(scope, req.params.id);
      if (!batch) return res.status(404).json({ error: "not_found" });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "read",
        resourceType: "import_batch",
        resourceId: batch.id,
        ipAddress: getClientIp(req),
      });
      res.json({
        batch: publicBatch(batch),
        targetFields: IMPORT_TARGET_FIELDS,
        ...IMPORT_OUT_OF_SCOPE,
      });
    },
  );

  app.post(
    "/api/import/batches/:id/map",
    auth,
    practiceGate,
    adminGate,
    billingGate,
    async (req, res) => {
      const parsed = mapSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_input" });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const batch = await storage.getImportBatch(scope, req.params.id);
      if (!batch) return res.status(404).json({ error: "not_found" });
      if (batch.status === "committed") {
        return res.status(409).json({ error: "already_committed" });
      }
      const headers = new Set(batch.headers ?? []);
      const mappings: ColumnMapping[] = [];
      for (const item of parsed.data.mappings) {
        if (headers.size > 0 && !headers.has(item.sourceColumn)) {
          return res.status(400).json({ error: "unknown_column", column: item.sourceColumn });
        }
        if (item.targetField !== SKIP_COLUMN && !isImportTargetField(item.targetField)) {
          return res.status(400).json({ error: "unknown_target", field: item.targetField });
        }
        mappings.push({
          sourceColumn: item.sourceColumn,
          targetField: item.targetField,
        });
      }
      const active = mappings.filter((m) => m.targetField !== SKIP_COLUMN);
      if (active.length === 0) {
        return res.status(400).json({ error: "no_mapped_fields" });
      }
      const importType = inferImportTarget(active);
      const updated = await storage.updateImportBatch(scope, batch.id, {
        columnMapping: mappings,
        importType,
        status: "mapped",
      });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "import_batch",
        resourceId: batch.id,
        metadata: {
          mappedFields: active.map((m) => m.targetField),
          importType,
        },
        ipAddress: getClientIp(req),
      });
      res.json({
        batch: publicBatch(updated!),
        ...IMPORT_OUT_OF_SCOPE,
      });
    },
  );

  app.post(
    "/api/import/batches/:id/preview",
    auth,
    practiceGate,
    adminGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const batch = await storage.getImportBatch(scope, req.params.id);
      if (!batch) return res.status(404).json({ error: "not_found" });
      const mappings = batch.columnMapping ?? [];
      const active = mappings.filter((m) => m.targetField !== SKIP_COLUMN);
      if (active.length === 0) {
        return res.status(400).json({ error: "not_mapped" });
      }
      const headers = batch.headers ?? [];
      const rows = await storage.listImportRows(scope, batch.id);
      let validCount = 0;
      let errorCount = 0;
      let skippedCount = 0;
      let dailyLogCreates = 0;
      let patientCreates = 0;
      let anomalyWarnings = 0;
      const sample: Array<{
        rowNumber: number;
        cells: string[];
        errors: string[];
        writesDailyLog: boolean;
        writesPatient: boolean;
        warnings: string[];
      }> = [];

      for (const row of rows) {
        const cells = parseCells(row.rawData);
        if (cells.every((c) => !c.trim())) {
          skippedCount += 1;
          continue;
        }
        const normalized = normalizeImportRow(headers, cells, active);
        if (normalized.errors.length > 0) {
          errorCount += 1;
        } else {
          validCount += 1;
          if (normalized.writesDailyLog) dailyLogCreates += 1;
          if (normalized.writesPatient) patientCreates += 1;
          if (
            normalized.writesDailyLog &&
            isRevenueWithoutVisits(
              normalized.visits ?? 0,
              normalized.revenueCents ?? 0,
            )
          ) {
            anomalyWarnings += 1;
          }
        }
        if (sample.length < IMPORT_PREVIEW_SAMPLE) {
          sample.push({
            rowNumber: row.rowNumber,
            cells: maskRowSample(headers, cells, active),
            errors: normalized.errors,
            writesDailyLog: normalized.writesDailyLog,
            writesPatient: normalized.writesPatient,
            warnings:
              normalized.writesDailyLog &&
              isRevenueWithoutVisits(
                normalized.visits ?? 0,
                normalized.revenueCents ?? 0,
              )
                ? ["revenue_without_visits"]
                : [],
          });
        }
      }

      await storage.updateImportBatch(scope, batch.id, { status: "previewed" });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "read",
        resourceType: "import_preview",
        resourceId: batch.id,
        metadata: {
          validCount,
          errorCount,
          skippedCount,
          dailyLogCreates,
          patientCreates,
          anomalyWarnings,
          committed: false,
        },
        ipAddress: getClientIp(req),
      });
      res.json({
        batchId: batch.id,
        committed: false,
        counts: {
          totalRows: rows.length,
          validCount,
          errorCount,
          skippedCount,
          dailyLogCreates,
          patientCreates,
          anomalyWarnings,
        },
        headers,
        sample,
        note: "Dry run. Nothing was written to Daily Log or Patients.",
        ...IMPORT_OUT_OF_SCOPE,
      });
    },
  );

  app.post(
    "/api/import/batches/:id/commit",
    auth,
    practiceGate,
    adminGate,
    billingGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const batch = await storage.getImportBatch(scope, req.params.id);
      if (!batch) return res.status(404).json({ error: "not_found" });
      if (batch.status === "committed") {
        return res.status(409).json({ error: "already_committed" });
      }
      const mappings = (batch.columnMapping ?? []).filter(
        (m) => m.targetField !== SKIP_COLUMN,
      );
      if (mappings.length === 0) {
        return res.status(400).json({ error: "not_mapped" });
      }
      const headers = batch.headers ?? [];
      const rows = await storage.listImportRows(scope, batch.id);
      let successRows = 0;
      let errorRows = 0;
      let skippedRows = 0;
      let dailyLogCreates = 0;
      let dailyLogUpdates = 0;
      let patientCreates = 0;
      const warnings: Array<{ date: string; code: string }> = [];

      for (const row of rows) {
        const cells = parseCells(row.rawData);
        if (cells.every((c) => !c.trim())) {
          skippedRows += 1;
          await storage.updateImportRow(scope, row.id, {
            status: "skipped",
            errorMessage: "empty_row",
          });
          continue;
        }
        const normalized = normalizeImportRow(headers, cells, mappings);
        if (normalized.errors.length > 0) {
          errorRows += 1;
          await storage.updateImportRow(scope, row.id, {
            status: "error",
            errorMessage: normalized.errors.join(","),
            normalizedData: JSON.stringify(safeNormalized(normalized)),
          });
          continue;
        }

        const targetIds: string[] = [];
        let targetType: string | null = null;
        try {
          if (normalized.writesDailyLog && normalized.date) {
            const visits = normalized.visits ?? 0;
            const revenueCents = normalized.revenueCents ?? 0;
            const existing = await storage.getDailyStatByDate(
              scope,
              normalized.date,
            );
            if (existing) {
              const updated = await storage.updateDailyStatByDate(
                scope,
                normalized.date,
                {
                  visits,
                  revenueCents,
                  notes:
                    normalized.dailyNotes === undefined
                      ? undefined
                      : normalized.dailyNotes,
                },
              );
              if (updated) {
                dailyLogUpdates += 1;
                targetIds.push(updated.id);
                targetType = "daily_log";
              }
            } else {
              try {
                const created = await storage.createDailyStat(scope, {
                  date: normalized.date,
                  visits,
                  revenueCents,
                  notes: normalized.dailyNotes ?? null,
                  createdBy: req.currentUser!.id,
                });
                dailyLogCreates += 1;
                targetIds.push(created.id);
                targetType = "daily_log";
              } catch (err) {
                if (err instanceof DuplicateDailyLogError) {
                  skippedRows += 1;
                  await storage.updateImportRow(scope, row.id, {
                    status: "skipped",
                    errorMessage: "date_exists",
                  });
                  continue;
                }
                throw err;
              }
            }
            if (isRevenueWithoutVisits(visits, revenueCents)) {
              warnings.push({
                date: normalized.date,
                code: "revenue_without_visits",
              });
            }
          }
          if (normalized.writesPatient && normalized.name) {
            const created = await storage.createPatient(scope, {
              name: normalized.name,
              email: normalized.email ?? null,
              phone: normalized.phone ?? null,
              dateOfBirth: normalized.dateOfBirth ?? null,
              condition: normalized.condition ?? null,
              patientType: normalized.patientType,
              day1Date: normalized.day1Date ?? null,
              day2Date: normalized.day2Date ?? null,
              careStatus: normalized.careStatus,
              converted: normalized.converted,
              conversionDate: normalized.conversionDate ?? null,
              planType: normalized.planType ?? null,
              referralSource: normalized.referralSource ?? null,
              notes: normalized.patientNotes ?? null,
              createdBy: req.currentUser!.id,
            });
            patientCreates += 1;
            targetIds.push(created.id);
            targetType = targetType ? "mixed" : "patients";
          }
        } catch {
          errorRows += 1;
          await storage.updateImportRow(scope, row.id, {
            status: "error",
            errorMessage: "write_failed",
          });
          continue;
        }

        successRows += 1;
        await storage.updateImportRow(scope, row.id, {
          status: "committed",
          normalizedData: JSON.stringify(safeNormalized(normalized)),
          targetEntityType: targetType,
          targetEntityId: targetIds[0] ?? null,
        });
      }

      const updated = await storage.updateImportBatch(scope, batch.id, {
        status: "committed",
        successRows,
        errorRows,
        skippedRows,
        committedAt: ctx.now(),
      });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "import_batch",
        resourceId: batch.id,
        metadata: {
          committed: true,
          successRows,
          errorRows,
          skippedRows,
          dailyLogCreates,
          dailyLogUpdates,
          patientCreates,
          warningCodes: warnings.map((w) => w.code),
        },
        ipAddress: getClientIp(req),
      });
      res.json({
        batch: publicBatch(updated!),
        counts: {
          successRows,
          errorRows,
          skippedRows,
          dailyLogCreates,
          dailyLogUpdates,
          patientCreates,
        },
        warnings,
        ...IMPORT_OUT_OF_SCOPE,
      });
    },
  );
}

function safeNormalized(row: NormalizedImportRow): Record<string, unknown> {
  return {
    date: row.date ?? null,
    visits: row.visits ?? null,
    revenueCents: row.revenueCents ?? null,
    writesDailyLog: row.writesDailyLog,
    writesPatient: row.writesPatient,
    patientType: row.patientType ?? null,
    converted: row.converted ?? null,
    errors: row.errors,
  };
}
