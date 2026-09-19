import type { Express } from "express";
import { z } from "zod";
import {
  DATE_RE,
  MAX_PERIOD_DAYS,
  inclusiveDayCount,
  isValidYmd,
  toYmd,
} from "@shared/kpis";
import {
  CARE_STATUSES,
  CONVERSION_FORMULA,
  MAX_CONDITION_LENGTH,
  MAX_PATIENT_NAME,
  MAX_PATIENT_NOTES,
  MAX_PHONE,
  MAX_PLAN_TYPE,
  MAX_REFERRAL_NAME,
  MAX_TYPE_NAME,
  PATIENT_LIST_DEFAULT,
  PATIENT_LIST_MAX,
  PATIENT_RECORD_STATUSES,
  PATIENT_TYPES,
  buildReferralLeaderboard,
  defaultLeaderboardRange,
  filterPatients,
  isMonthKey,
  isPatientType,
  normalizeReferralSource,
  sortPatients,
  type PatientListFilters,
  type PatientType,
} from "@shared/patients";
import {
  PHI_DELETE_ROLES,
  PHI_READ_ROLES,
  PHI_WRITE_ROLES,
} from "@shared/roles";
import { logAudit } from "../audit/logAudit";
import {
  authenticate,
  getClientIp,
  requirePracticeMembership,
  requireRole,
} from "../auth/middleware";
import { requireActiveSubscription } from "../billing/entitlement";
import type { HttpContext } from "../http-context";
import type { AppStorage, PatientWrite } from "../storage/types";
import { patientOnboardingState } from "@shared/onboarding";
import { patientChecklistSummary } from "../onboarding/public";
import { publicPatient, publicReferralSource } from "./public";

const dateSchema = z
  .string()
  .regex(DATE_RE)
  .refine(isValidYmd, { message: "invalid_date" });

const nullableDate = z.union([dateSchema, z.null()]);
const nullableString = (max: number) =>
  z.union([z.string().max(max), z.null()]);

const patientTypeSchema = z.enum(PATIENT_TYPES);
const careStatusSchema = z.enum(CARE_STATUSES);
const recordStatusSchema = z.enum(PATIENT_RECORD_STATUSES);

const patientWriteSchema = z.object({
  name: z.string().min(1).max(MAX_PATIENT_NAME),
  email: z.union([z.string().email().max(320), z.null()]).optional(),
  phone: nullableString(MAX_PHONE).optional(),
  dateOfBirth: z.union([z.string().max(10), z.null()]).optional(),
  condition: nullableString(MAX_CONDITION_LENGTH).optional(),
  status: recordStatusSchema.optional(),
  patientType: patientTypeSchema.optional(),
  type: patientTypeSchema.optional(),
  category: patientTypeSchema.optional(),
  typeName: nullableString(MAX_TYPE_NAME).optional(),
  referralSourceId: z.union([z.string().min(1), z.null()]).optional(),
  referralSource: nullableString(MAX_REFERRAL_NAME).optional(),
  day1Date: nullableDate.optional(),
  day2Date: nullableDate.optional(),
  careStatus: careStatusSchema.optional(),
  converted: z.boolean().optional(),
  conversionDate: nullableDate.optional(),
  planType: nullableString(MAX_PLAN_TYPE).optional(),
  notes: nullableString(MAX_PATIENT_NOTES).optional(),
});

const patientPatchSchema = patientWriteSchema.partial().extend({
  name: z.string().min(1).max(MAX_PATIENT_NAME).optional(),
});

const conversionSchema = z.object({
  converted: z.boolean(),
  conversionDate: nullableDate.optional(),
});

const referralCreateSchema = z.object({
  name: z.string().min(1).max(MAX_REFERRAL_NAME),
});

type WriteBody = z.infer<typeof patientWriteSchema>;

function resolvePatientType(input: {
  patientType?: PatientType;
  type?: PatientType;
  category?: PatientType;
}): PatientType | undefined {
  return input.patientType ?? input.type ?? input.category;
}

function validateDates(input: {
  day1Date?: string | null;
  day2Date?: string | null;
}): string | null {
  if (
    input.day1Date &&
    input.day2Date &&
    input.day1Date > input.day2Date
  ) {
    return "day2_before_day1";
  }
  return null;
}

function applyConversionDefaults(
  input: { converted?: boolean; conversionDate?: string | null },
  today: string,
  existing?: { converted: boolean; conversionDate: string | null },
): { converted?: boolean; conversionDate?: string | null } {
  const out: { converted?: boolean; conversionDate?: string | null } = {};
  if (input.converted !== undefined) out.converted = input.converted;
  if (input.conversionDate !== undefined) {
    out.conversionDate = input.conversionDate;
  }
  const converted = input.converted ?? existing?.converted;
  if (input.converted === true && input.conversionDate === undefined) {
    out.conversionDate = existing?.conversionDate ?? today;
  }
  if (input.converted === false && input.conversionDate === undefined) {
    out.conversionDate = null;
  }
  if (converted === true && out.conversionDate === null) {
    out.conversionDate = today;
  }
  return out;
}

async function resolveReferral(
  storage: AppStorage,
  scope: { orgId: string; practiceId: string },
  input: {
    referralSource?: string | null;
    referralSourceId?: string | null;
  },
): Promise<
  | { ok: true; referralSource: string | null; referralSourceId: string | null }
  | { ok: false; error: string }
> {
  const hasName = input.referralSource !== undefined;
  const hasId = input.referralSourceId !== undefined;
  if (!hasName && !hasId) {
    return { ok: true, referralSource: undefined as unknown as null, referralSourceId: undefined as unknown as null };
  }

  if (hasName) {
    const name = normalizeReferralSource(input.referralSource);
    if (!name) {
      return { ok: true, referralSource: null, referralSourceId: null };
    }
    const row = await storage.ensureReferralSource(scope, name);
    return { ok: true, referralSource: row.name, referralSourceId: row.id };
  }

  if (input.referralSourceId === null) {
    return { ok: true, referralSource: null, referralSourceId: null };
  }
  const row = await storage.getReferralSource(scope, input.referralSourceId!);
  if (!row) return { ok: false, error: "referral_not_found" };
  return { ok: true, referralSource: row.name, referralSourceId: row.id };
}

function toWrite(
  parsed: WriteBody,
  referral: { referralSource: string | null; referralSourceId: string | null } | null,
  conversion: { converted?: boolean; conversionDate?: string | null },
  createdBy?: string,
): PatientWrite {
  const patientType = resolvePatientType(parsed);
  return {
    name: parsed.name.trim(),
    email: parsed.email,
    phone: parsed.phone,
    dateOfBirth: parsed.dateOfBirth,
    condition: parsed.condition,
    status: parsed.status,
    patientType,
    typeName: parsed.typeName,
    referralSourceId: referral?.referralSourceId,
    referralSource: referral?.referralSource,
    day1Date: parsed.day1Date,
    day2Date: parsed.day2Date,
    careStatus: parsed.careStatus,
    converted: conversion.converted,
    conversionDate: conversion.conversionDate,
    planType: parsed.planType,
    notes: parsed.notes,
    createdBy,
  };
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

export function registerPatientRoutes(app: Express, ctx: HttpContext): void {
  const storage = ctx.storage;
  const auth = authenticate(storage);
  const practiceGate = requirePracticeMembership(storage);
  const billingGate = requireActiveSubscription(ctx);

  app.get(
    "/api/referral-sources",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const rows = await storage.listReferralSources(scope);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "list",
        resourceType: "referral_source",
        metadata: { count: rows.length },
        ipAddress: getClientIp(req),
      });
      res.json({
        sources: rows.map(publicReferralSource),
      });
    },
  );

  app.post(
    "/api/referral-sources",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = referralCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_input" });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const name = normalizeReferralSource(parsed.data.name);
      if (!name) {
        return res.status(400).json({ error: "name_required" });
      }
      const row = await storage.ensureReferralSource(scope, name);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "create",
        resourceType: "referral_source",
        resourceId: row.id,
        metadata: { fields: ["name"] },
        ipAddress: getClientIp(req),
      });
      res.status(201).json({ source: publicReferralSource(row) });
    },
  );

  app.get(
    "/api/patients/referral-leaderboard",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const today = toYmd(ctx.now());
      const rawFrom = typeof req.query.from === "string" ? req.query.from : "";
      const rawTo = typeof req.query.to === "string" ? req.query.to : "";
      let from: string;
      let to: string;
      if (!rawFrom && !rawTo) {
        ({ from, to } = defaultLeaderboardRange(today));
      } else if (!rawFrom || !rawTo) {
        return res.status(400).json({ error: "range_required" });
      } else if (!isValidYmd(rawFrom) || !isValidYmd(rawTo)) {
        return res.status(400).json({ error: "invalid_range" });
      } else if (rawFrom > rawTo) {
        return res.status(400).json({ error: "from_after_to" });
      } else {
        from = rawFrom;
        to = rawTo;
      }
      const dayCount = inclusiveDayCount(from, to);
      if (dayCount > MAX_PERIOD_DAYS) {
        return res.status(400).json({ error: "range_too_long" });
      }

      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const rows = await storage.listPatients(scope);
      const leaderboard = buildReferralLeaderboard(rows, from, to);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "list",
        resourceType: "referral_leaderboard",
        metadata: { from, to, rowCount: leaderboard.length },
        ipAddress: getClientIp(req),
      });
      res.json({
        today,
        from,
        to,
        formula: CONVERSION_FORMULA,
        emptyState: leaderboard.length === 0 ? "no_entries" : "has_data",
        rows: leaderboard,
      });
    },
  );

  app.get(
    "/api/patients",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const qRaw =
        typeof req.query.q === "string"
          ? req.query.q
          : typeof req.query.search === "string"
            ? req.query.search
            : "";
      const typeRaw =
        typeof req.query.type === "string"
          ? req.query.type
          : typeof req.query.tab === "string"
            ? req.query.tab
            : "all";
      if (typeRaw !== "all" && !isPatientType(typeRaw)) {
        return res.status(400).json({ error: "invalid_type" });
      }
      const monthRaw =
        typeof req.query.month === "string" ? req.query.month : "";
      if (monthRaw && !isMonthKey(monthRaw)) {
        return res.status(400).json({ error: "invalid_month" });
      }
      const referralRaw =
        typeof req.query.referralSource === "string"
          ? req.query.referralSource
          : undefined;
      const limitRaw = Number(req.query.limit);
      const offsetRaw = Number(req.query.offset);
      const limit = Number.isFinite(limitRaw)
        ? Math.min(PATIENT_LIST_MAX, Math.max(1, Math.floor(limitRaw)))
        : PATIENT_LIST_DEFAULT;
      const offset = Number.isFinite(offsetRaw)
        ? Math.max(0, Math.floor(offsetRaw))
        : 0;

      const filters: PatientListFilters = {
        q: qRaw || undefined,
        type: typeRaw as PatientListFilters["type"],
        month: monthRaw || undefined,
        referralSource: referralRaw,
      };

      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const all = await storage.listPatients(scope);
      const filtered = sortPatients(filterPatients(all, filters));
      const pageRows = filtered.slice(offset, offset + limit);
      const [assigned, assignedTasks] = await Promise.all([
        storage.listPatientChecklists(scope),
        storage.listPatientChecklistTasks(scope),
      ]);
      const onboardingByPatient = new Map(
        pageRows.map((row) => {
          const mine = assigned.filter((item) => item.patientId === row.id);
          const summaries = mine.map((item) =>
            patientChecklistSummary(
              item,
              assignedTasks.filter((task) => task.patientChecklistId === item.id),
            ),
          );
          return [row.id, patientOnboardingState(summaries)] as const;
        }),
      );

      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "list",
        resourceType: "patient",
        metadata: {
          count: pageRows.length,
          total: filtered.length,
          type: typeRaw,
          month: monthRaw || null,
          hasQuery: Boolean(qRaw.trim()),
          hasReferralFilter: referralRaw !== undefined,
          limit,
          offset,
        },
        ipAddress: getClientIp(req),
      });

      const emptyState =
        all.length === 0
          ? "no_patients"
          : filtered.length === 0
            ? "no_matches"
            : "has_data";

      res.json({
        patients: pageRows.map((row) =>
          publicPatient(row, onboardingByPatient.get(row.id)),
        ),
        page: { limit, offset, total: filtered.length },
        filters: {
          q: qRaw || null,
          type: typeRaw,
          month: monthRaw || null,
          referralSource: referralRaw ?? null,
        },
        emptyState,
      });
    },
  );

  app.post(
    "/api/patients",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = patientWriteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const dateError = validateDates(parsed.data);
      if (dateError) return res.status(400).json({ error: dateError });

      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const today = toYmd(ctx.now());
      const referral = await resolveReferral(storage, scope, parsed.data);
      if (!referral.ok) {
        return res.status(400).json({ error: referral.error });
      }
      const conversion = applyConversionDefaults(parsed.data, today);
      const write = stripUndefined(
        toWrite(
          parsed.data,
          parsed.data.referralSource !== undefined ||
            parsed.data.referralSourceId !== undefined
            ? referral
            : null,
          conversion,
          req.currentUser!.id,
        ) as unknown as Record<string, unknown>,
      ) as unknown as PatientWrite;

      const patient = await storage.createPatient(scope, write);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "create",
        resourceType: "patient",
        resourceId: patient.id,
        metadata: { fields: Object.keys(parsed.data) },
        ipAddress: getClientIp(req),
      });
      res.status(201).json({ patient: publicPatient(patient) });
    },
  );

  app.get(
    "/api/patients/:id",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const patient = await storage.getPatient(scope, req.params.id);
      if (!patient) {
        return res.status(404).json({ error: "not_found" });
      }
      const assigned = await storage.listPatientChecklists(scope, patient.id);
      const assignedTasks = await storage.listPatientChecklistTasks(scope);
      const onboarding = patientOnboardingState(
        assigned.map((item) =>
          patientChecklistSummary(
            item,
            assignedTasks.filter((task) => task.patientChecklistId === item.id),
          ),
        ),
      );
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "read",
        resourceType: "patient",
        resourceId: patient.id,
        metadata: { onboardingAssigned: onboarding.assigned },
        ipAddress: getClientIp(req),
      });
      res.json({ patient: publicPatient(patient, onboarding) });
    },
  );

  app.patch(
    "/api/patients/:id",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = patientPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_input" });
      }
      if (Object.keys(parsed.data).length === 0) {
        return res.status(400).json({ error: "empty_patch" });
      }
      const dateError = validateDates(parsed.data);
      if (dateError) return res.status(400).json({ error: dateError });

      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getPatient(scope, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }
      const today = toYmd(ctx.now());
      const referralTouched =
        parsed.data.referralSource !== undefined ||
        parsed.data.referralSourceId !== undefined;
      const referral = referralTouched
        ? await resolveReferral(storage, scope, parsed.data)
        : null;
      if (referral && !referral.ok) {
        return res.status(400).json({ error: referral.error });
      }
      const conversion = applyConversionDefaults(parsed.data, today, existing);
      const patientType = resolvePatientType(parsed.data);

      const patch: Partial<PatientWrite> = stripUndefined({
        name: parsed.data.name?.trim(),
        email: parsed.data.email,
        phone: parsed.data.phone,
        dateOfBirth: parsed.data.dateOfBirth,
        condition: parsed.data.condition,
        status: parsed.data.status,
        patientType,
        typeName: parsed.data.typeName,
        referralSourceId: referral && referral.ok ? referral.referralSourceId : undefined,
        referralSource: referral && referral.ok ? referral.referralSource : undefined,
        day1Date: parsed.data.day1Date,
        day2Date: parsed.data.day2Date,
        careStatus: parsed.data.careStatus,
        converted: conversion.converted,
        conversionDate: conversion.conversionDate,
        planType: parsed.data.planType,
        notes: parsed.data.notes,
      } as Record<string, unknown>) as Partial<PatientWrite>;

      const patient = await storage.updatePatient(scope, req.params.id, patch);
      if (!patient) {
        return res.status(404).json({ error: "not_found" });
      }
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "patient",
        resourceId: patient.id,
        metadata: { fields: Object.keys(parsed.data) },
        ipAddress: getClientIp(req),
      });
      res.json({ patient: publicPatient(patient) });
    },
  );

  app.post(
    "/api/patients/:id/conversion",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = conversionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_input" });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getPatient(scope, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }
      const today = toYmd(ctx.now());
      const conversion = applyConversionDefaults(parsed.data, today, existing);
      const patient = await storage.updatePatient(scope, req.params.id, conversion);
      if (!patient) {
        return res.status(404).json({ error: "not_found" });
      }
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "patient",
        resourceId: patient.id,
        metadata: { fields: ["converted", "conversionDate"], conversion: true },
        ipAddress: getClientIp(req),
      });
      res.json({ patient: publicPatient(patient) });
    },
  );

  app.delete(
    "/api/patients/:id",
    auth,
    practiceGate,
    requireRole(...PHI_DELETE_ROLES),
    billingGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const existing = await storage.getPatient(
        { orgId: tenant.orgId, practiceId: tenant.practiceId },
        req.params.id,
      );
      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }
      await storage.deletePatient(
        { orgId: tenant.orgId, practiceId: tenant.practiceId },
        req.params.id,
      );
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "delete",
        resourceType: "patient",
        resourceId: req.params.id,
        ipAddress: getClientIp(req),
      });
      res.json({ ok: true });
    },
  );
}
