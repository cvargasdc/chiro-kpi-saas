/**
 * Generic CSV / Excel import helpers.
 *
 * No ChiroTouch parsers. No SimplePractice-specific formats. No OpenAI
 * column mapping. Operators map columns by hand.
 *
 * Raw spreadsheet rows are PHI. They are encrypted at rest and expire
 * after IMPORT_RAW_TTL_DAYS. See docs/WEEK13-METRICS-IMPORT.md.
 */

import { dollarsToCents, isValidYmd, MAX_NOTES_LENGTH } from "./kpis";
import {
  isCareStatus,
  isPatientType,
  MAX_CONDITION_LENGTH,
  MAX_PATIENT_NAME,
  MAX_PHONE,
  MAX_PLAN_TYPE,
} from "./patients";

export const IMPORT_RAW_TTL_DAYS = 30;
export const IMPORT_MAX_ROWS = 5_000;
export const IMPORT_MAX_COLUMNS = 40;
export const IMPORT_MAX_CELL = 2_000;
export const IMPORT_PREVIEW_SAMPLE = 8;

export const IMPORT_FILE_TYPES = ["csv", "xlsx"] as const;
export type ImportFileType = (typeof IMPORT_FILE_TYPES)[number];

export const IMPORT_BATCH_STATUSES = [
  "uploaded",
  "mapped",
  "previewed",
  "committed",
  "failed",
] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

export const IMPORT_ROW_STATUSES = [
  "pending",
  "valid",
  "error",
  "skipped",
  "committed",
] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

export const IMPORT_TARGETS = ["daily_log", "patients", "mixed"] as const;
export type ImportTarget = (typeof IMPORT_TARGETS)[number];

export type ImportTargetField = {
  value: string;
  label: string;
  entity: "daily_log" | "patients";
  phi: boolean;
};

export const IMPORT_TARGET_FIELDS: ImportTargetField[] = [
  { value: "date", label: "Date", entity: "daily_log", phi: false },
  { value: "visits", label: "Patient Visits", entity: "daily_log", phi: false },
  { value: "revenue", label: "Revenue Amount", entity: "daily_log", phi: false },
  { value: "daily_notes", label: "Daily Log Notes", entity: "daily_log", phi: true },
  { value: "name", label: "Patient Name", entity: "patients", phi: true },
  { value: "first_name", label: "First Name", entity: "patients", phi: true },
  { value: "last_name", label: "Last Name", entity: "patients", phi: true },
  { value: "email", label: "Email", entity: "patients", phi: true },
  { value: "phone", label: "Phone", entity: "patients", phi: true },
  { value: "date_of_birth", label: "Date of Birth", entity: "patients", phi: true },
  { value: "condition", label: "Condition", entity: "patients", phi: true },
  { value: "patient_type", label: "Patient Type (new/wellness)", entity: "patients", phi: false },
  { value: "day1_date", label: "Day 1 Date", entity: "patients", phi: false },
  { value: "day2_date", label: "Day 2 Date", entity: "patients", phi: false },
  { value: "care_status", label: "Care Status", entity: "patients", phi: false },
  { value: "converted", label: "Converted (yes/no)", entity: "patients", phi: false },
  { value: "conversion_date", label: "Conversion Date", entity: "patients", phi: false },
  { value: "plan_type", label: "Plan Type", entity: "patients", phi: false },
  { value: "referral_source", label: "Referral Source", entity: "patients", phi: false },
  { value: "patient_notes", label: "Patient Notes", entity: "patients", phi: true },
];

export const SKIP_COLUMN = "__skip__";

export type ColumnMapping = {
  sourceColumn: string;
  targetField: string;
};

export function isImportTargetField(value: string): boolean {
  return IMPORT_TARGET_FIELDS.some((f) => f.value === value);
}

export function addUtcDaysYmd(from: Date, days: number): Date {
  const out = new Date(from.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export function importRawExpiresAt(from: Date, ttlDays = IMPORT_RAW_TTL_DAYS): Date {
  return addUtcDaysYmd(from, ttlDays);
}

export type ParsedSheet = {
  headers: string[];
  rows: string[][];
};

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** RFC4180-ish CSV parser. Quoted fields may contain commas and newlines. */
export function parseCsv(text: string): ParsedSheet {
  const src = stripBom(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim().length > 0)) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  row.push(cell);
  if (row.some((c) => c.trim().length > 0)) rows.push(row);

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = rows[0].map((h, idx) => {
    const trimmed = h.trim();
    return trimmed.length > 0 ? trimmed : `Column ${idx + 1}`;
  });
  const body = rows.slice(1).map((r) => {
    const padded = [...r];
    while (padded.length < headers.length) padded.push("");
    return padded.slice(0, headers.length).map((c) => c.slice(0, IMPORT_MAX_CELL));
  });
  return { headers: headers.slice(0, IMPORT_MAX_COLUMNS), rows: body };
}

export function detectFileType(fileName: string): ImportFileType | null {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return "csv";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "xlsx";
  return null;
}

export function parseFlexibleDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (isValidYmd(trimmed)) return trimmed;
  const mdy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (mdy) {
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    let year = Number(mdy[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const ymd = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return isValidYmd(ymd) ? ymd : null;
  }
  const iso = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (iso) {
    const ymd = `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}-${String(Number(iso[3])).padStart(2, "0")}`;
    return isValidYmd(ymd) ? ymd : null;
  }
  return null;
}

export function parseMoneyDollars(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function parseIntegerCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

export function parseBooleanFlag(raw: string): boolean | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (["1", "true", "yes", "y", "converted"].includes(t)) return true;
  if (["0", "false", "no", "n"].includes(t)) return false;
  return null;
}

export type NormalizedImportRow = {
  date?: string;
  visits?: number;
  revenueCents?: number;
  dailyNotes?: string | null;
  name?: string;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  condition?: string | null;
  patientType?: string;
  day1Date?: string | null;
  day2Date?: string | null;
  careStatus?: string;
  converted?: boolean;
  conversionDate?: string | null;
  planType?: string | null;
  referralSource?: string | null;
  patientNotes?: string | null;
  writesDailyLog: boolean;
  writesPatient: boolean;
  errors: string[];
};

function mappedValue(
  cells: Record<string, string>,
  mappings: ColumnMapping[],
  target: string,
): string {
  const mapping = mappings.find((m) => m.targetField === target);
  if (!mapping) return "";
  return cells[mapping.sourceColumn] ?? "";
}

export function normalizeImportRow(
  headers: string[],
  cells: string[],
  mappings: ColumnMapping[],
): NormalizedImportRow {
  const record: Record<string, string> = {};
  headers.forEach((h, i) => {
    record[h] = cells[i] ?? "";
  });
  const errors: string[] = [];
  const dateRaw = mappedValue(record, mappings, "date");
  const visitsRaw = mappedValue(record, mappings, "visits");
  const revenueRaw = mappedValue(record, mappings, "revenue");
  const dailyNotesRaw = mappedValue(record, mappings, "daily_notes");
  const nameRaw = mappedValue(record, mappings, "name");
  const firstRaw = mappedValue(record, mappings, "first_name");
  const lastRaw = mappedValue(record, mappings, "last_name");
  const emailRaw = mappedValue(record, mappings, "email");
  const phoneRaw = mappedValue(record, mappings, "phone");
  const dobRaw = mappedValue(record, mappings, "date_of_birth");
  const conditionRaw = mappedValue(record, mappings, "condition");
  const typeRaw = mappedValue(record, mappings, "patient_type");
  const day1Raw = mappedValue(record, mappings, "day1_date");
  const day2Raw = mappedValue(record, mappings, "day2_date");
  const careRaw = mappedValue(record, mappings, "care_status");
  const convertedRaw = mappedValue(record, mappings, "converted");
  const conversionDateRaw = mappedValue(record, mappings, "conversion_date");
  const planRaw = mappedValue(record, mappings, "plan_type");
  const referralRaw = mappedValue(record, mappings, "referral_source");
  const patientNotesRaw = mappedValue(record, mappings, "patient_notes");

  const hasDailyMapping = mappings.some(
    (m) =>
      m.targetField === "date" ||
      m.targetField === "visits" ||
      m.targetField === "revenue" ||
      m.targetField === "daily_notes",
  );
  const hasPatientMapping = mappings.some((m) => {
    const field = IMPORT_TARGET_FIELDS.find((f) => f.value === m.targetField);
    return field?.entity === "patients";
  });

  const out: NormalizedImportRow = {
    writesDailyLog: false,
    writesPatient: false,
    errors,
  };

  const dailyTouched =
    dateRaw.trim() || visitsRaw.trim() || revenueRaw.trim() || dailyNotesRaw.trim();
  if (hasDailyMapping && dailyTouched) {
    out.writesDailyLog = true;
    const date = parseFlexibleDate(dateRaw);
    if (!date) errors.push("invalid_date");
    else out.date = date;
    if (visitsRaw.trim()) {
      const visits = parseIntegerCount(visitsRaw);
      if (visits == null) errors.push("invalid_visits");
      else out.visits = visits;
    } else {
      out.visits = 0;
    }
    if (revenueRaw.trim()) {
      const dollars = parseMoneyDollars(revenueRaw);
      if (dollars == null) errors.push("invalid_revenue");
      else out.revenueCents = dollarsToCents(dollars);
    } else {
      out.revenueCents = 0;
    }
    if (dailyNotesRaw.trim()) {
      out.dailyNotes = dailyNotesRaw.trim().slice(0, MAX_NOTES_LENGTH);
    }
  }

  const combinedName = nameRaw.trim()
    ? nameRaw.trim()
    : [firstRaw.trim(), lastRaw.trim()].filter(Boolean).join(" ").trim();
  const patientTouched =
    combinedName ||
    emailRaw.trim() ||
    phoneRaw.trim() ||
    dobRaw.trim() ||
    conditionRaw.trim() ||
    typeRaw.trim() ||
    day1Raw.trim();

  if (hasPatientMapping && patientTouched) {
    out.writesPatient = true;
    if (!combinedName) {
      errors.push("patient_name_required");
    } else if (combinedName.length > MAX_PATIENT_NAME) {
      errors.push("patient_name_too_long");
    } else {
      out.name = combinedName.slice(0, MAX_PATIENT_NAME);
    }
    if (emailRaw.trim()) out.email = emailRaw.trim().slice(0, 200);
    if (phoneRaw.trim()) out.phone = phoneRaw.trim().slice(0, MAX_PHONE);
    if (dobRaw.trim()) {
      const dob = parseFlexibleDate(dobRaw);
      out.dateOfBirth = dob ?? dobRaw.trim().slice(0, 40);
    }
    if (conditionRaw.trim()) {
      out.condition = conditionRaw.trim().slice(0, MAX_CONDITION_LENGTH);
    }
    if (typeRaw.trim()) {
      const t = typeRaw.trim().toLowerCase();
      if (isPatientType(t)) out.patientType = t;
      else errors.push("invalid_patient_type");
    }
    if (day1Raw.trim()) {
      const d = parseFlexibleDate(day1Raw);
      if (!d) errors.push("invalid_day1_date");
      else out.day1Date = d;
    }
    if (day2Raw.trim()) {
      const d = parseFlexibleDate(day2Raw);
      if (!d) errors.push("invalid_day2_date");
      else out.day2Date = d;
    }
    if (careRaw.trim()) {
      const c = careRaw.trim().toLowerCase().replace(/\s+/g, "_");
      if (isCareStatus(c)) out.careStatus = c;
      else errors.push("invalid_care_status");
    }
    if (convertedRaw.trim()) {
      const flag = parseBooleanFlag(convertedRaw);
      if (flag == null) errors.push("invalid_converted");
      else out.converted = flag;
    }
    if (conversionDateRaw.trim()) {
      const d = parseFlexibleDate(conversionDateRaw);
      if (!d) errors.push("invalid_conversion_date");
      else out.conversionDate = d;
    }
    if (planRaw.trim()) out.planType = planRaw.trim().slice(0, MAX_PLAN_TYPE);
    if (referralRaw.trim()) out.referralSource = referralRaw.trim().slice(0, 120);
    if (patientNotesRaw.trim()) {
      out.patientNotes = patientNotesRaw.trim().slice(0, MAX_NOTES_LENGTH);
    }
  }

  if (!out.writesDailyLog && !out.writesPatient) {
    errors.push("empty_row");
  }

  return out;
}

const PHI_TARGETS = new Set(
  IMPORT_TARGET_FIELDS.filter((f) => f.phi).map((f) => f.value),
);

export function maskPhiCell(value: string, targetField: string | null): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!targetField || targetField === SKIP_COLUMN || !PHI_TARGETS.has(targetField)) {
    return trimmed;
  }
  if (targetField === "email") {
    const at = trimmed.indexOf("@");
    if (at > 0) return `***@${trimmed.slice(at + 1)}`;
    return "***";
  }
  if (targetField === "phone") {
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length >= 4) return `***-***-${digits.slice(-4)}`;
    return "***";
  }
  if (targetField === "date_of_birth") return "****-**-**";
  if (
    targetField === "daily_notes" ||
    targetField === "patient_notes" ||
    targetField === "condition"
  ) {
    return "[redacted]";
  }
  // Names: keep first letter of each token.
  return trimmed
    .split(/\s+/)
    .map((part) => (part.length === 0 ? "" : `${part[0]}***`))
    .join(" ");
}

export function maskRowSample(
  headers: string[],
  cells: string[],
  mappings: ColumnMapping[],
): string[] {
  return headers.map((header, i) => {
    const mapping = mappings.find((m) => m.sourceColumn === header);
    const target = mapping?.targetField ?? SKIP_COLUMN;
    return maskPhiCell(cells[i] ?? "", target);
  });
}

export function inferImportTarget(mappings: ColumnMapping[]): ImportTarget {
  const mapped = mappings.filter(
    (m) => m.targetField && m.targetField !== SKIP_COLUMN,
  );
  const hasDaily = mapped.some((m) => {
    const field = IMPORT_TARGET_FIELDS.find((f) => f.value === m.targetField);
    return field?.entity === "daily_log";
  });
  const hasPatient = mapped.some((m) => {
    const field = IMPORT_TARGET_FIELDS.find((f) => f.value === m.targetField);
    return field?.entity === "patients";
  });
  if (hasDaily && hasPatient) return "mixed";
  if (hasPatient) return "patients";
  return "daily_log";
}

export type DryRunCounts = {
  totalRows: number;
  validCount: number;
  errorCount: number;
  skippedCount: number;
  dailyLogCreates: number;
  dailyLogUpdates: number;
  patientCreates: number;
  anomalyWarnings: number;
};
