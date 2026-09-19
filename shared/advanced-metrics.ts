/**
 * Advanced Metrics — GET / SELL / KEEP & EARN.
 *
 * Manual fields are stored on `advanced_metrics_inputs`. Automatic fields are
 * derived at read time from `daily_stats` and `patients`. Derived ratios that
 * depend on manual inputs are also computed at read time (not stored).
 *
 * Money on this surface is **dollars** (not cents) so clinic owners can type
 * the figures they already have from a P&L. Daily Log storage remains cents.
 *
 * No patient names appear in computed output or the AI analysis prompt.
 * See docs/WEEK13-METRICS-IMPORT.md.
 */

import {
  centsToDollars,
  officeVisitAverage,
  periodEmptyState,
  roundPercent,
  type EmptyState,
} from "./kpis";
import { monthRange, periodFunnel } from "./patients";

export const ADVANCED_METRIC_SECTIONS = ["get", "sell", "keep"] as const;
export type AdvancedMetricSection = (typeof ADVANCED_METRIC_SECTIONS)[number];

export const ADVANCED_METRIC_SOURCES = ["manual", "automatic"] as const;
export type AdvancedMetricSource = (typeof ADVANCED_METRIC_SOURCES)[number];

export type AdvancedMetricUnit = "count" | "usd" | "percent" | "ratio";

export const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

export function isAdvancedMetricSection(
  value: string,
): value is AdvancedMetricSection {
  return (ADVANCED_METRIC_SECTIONS as readonly string[]).includes(value);
}

export function isMonthKey(value: string): boolean {
  if (!MONTH_KEY_RE.test(value)) return false;
  const [y, m] = value.split("-").map(Number);
  return m >= 1 && m <= 12 && y >= 2000 && y <= 2100;
}

/** Canonical first-of-month date for `period_month`. */
export function monthToPeriodDate(yyyyMm: string): string {
  if (!isMonthKey(yyyyMm)) throw new Error("invalid_month");
  return `${yyyyMm}-01`;
}

export function periodDateToMonth(periodMonth: string): string {
  return periodMonth.slice(0, 7);
}

export type AdvancedMetricFieldDef = {
  key: string;
  section: AdvancedMetricSection;
  label: string;
  unit: AdvancedMetricUnit;
  source: AdvancedMetricSource;
  formula: string;
  helpText: string;
  /** Catalog keys this field needs before it can compute. */
  dependencies: string[];
  lockedMessage: string | null;
  /** Manual fields that the UI may PUT. */
  writable: boolean;
};

export const ADVANCED_METRIC_FIELDS: AdvancedMetricFieldDef[] = [
  {
    key: "monthly_leads",
    section: "get",
    label: "New Leads / Month",
    unit: "count",
    source: "manual",
    formula: "Total unique inquiries with contact info this month",
    helpText:
      "Count unique people who contacted the office this month (phone, web form, DM, walk-in with contact info). Exclude existing patients and spam. Find it in the front-desk log, CRM, or web-form inbox.",
    dependencies: [],
    lockedMessage: null,
    writable: true,
  },
  {
    key: "consults_booked",
    section: "get",
    label: "Consults Booked",
    unit: "count",
    source: "manual",
    formula: "# of new patient appointments booked in the period",
    helpText:
      "Count every new-patient exam/consult scheduled this month, including later cancellations and no-shows. Exclude existing-patient follow-ups. Find it in the EHR schedule filtered to New Patient.",
    dependencies: [],
    lockedMessage: null,
    writable: true,
  },
  {
    key: "patients_showed",
    section: "get",
    label: "Patients Showed",
    unit: "count",
    source: "manual",
    formula: "# of booked new-patient consults who arrived",
    helpText:
      "Count booked-consult patients who arrived (including late). Do not count walk-ins — they never had a booked slot. Should be ≤ Consults Booked. Find it in the EHR kept-appointment report.",
    dependencies: [],
    lockedMessage: null,
    writable: true,
  },
  {
    key: "show_rate",
    section: "get",
    label: "Show Rate",
    unit: "percent",
    source: "automatic",
    formula: "(Patients Showed ÷ Consults Booked) × 100",
    helpText:
      "Unlocks when Consults Booked and Patients Showed are entered. Benchmark: 80–90%. Below 70% usually means a reminder or follow-up problem.",
    dependencies: ["consults_booked", "patients_showed"],
    lockedMessage: "Enter Consults Booked and Patients Showed to unlock.",
    writable: false,
  },
  {
    key: "new_patients",
    section: "sell",
    label: "New Patients",
    unit: "count",
    source: "automatic",
    formula:
      "count of patientType=new with activity date (day1Date, else createdAt UTC) in the month",
    helpText:
      "Pulled from the Patients list. Activity date is Day 1 if set, otherwise the day the row was created (UTC).",
    dependencies: [],
    lockedMessage: null,
    writable: false,
  },
  {
    key: "converted_count",
    section: "sell",
    label: "Converted to Care Plan",
    unit: "count",
    source: "automatic",
    formula: "count of new patients in the month with converted = true",
    helpText:
      "Pulled from Patients. Wellness rows are excluded from this count.",
    dependencies: [],
    lockedMessage: null,
    writable: false,
  },
  {
    key: "close_rate",
    section: "sell",
    label: "Close Rate to Care Plan",
    unit: "percent",
    source: "automatic",
    formula: "(Converted new patients ÷ New patients in month) × 100",
    helpText:
      "Requires at least one new patient in the month. Wellness is excluded from the denominator. Benchmark: above 75% is strong.",
    dependencies: ["new_patients"],
    lockedMessage: "Needs at least one new patient in this month.",
    writable: false,
  },
  {
    key: "case_average",
    section: "sell",
    label: "Case Average",
    unit: "usd",
    source: "automatic",
    formula: "Month revenue (Daily Log) ÷ New patients in month",
    helpText:
      "Requires Daily Log data and at least one new patient. This is collections per new patient for the month, not a care-plan face value.",
    dependencies: ["new_patients"],
    lockedMessage:
      "Needs Daily Log entries and at least one new patient in this month.",
    writable: false,
  },
  {
    key: "thirty_day_cash_per_np",
    section: "sell",
    label: "30-Day Cash / New Patient",
    unit: "usd",
    source: "manual",
    formula: "Cash collected in first 30 days ÷ # new patients",
    helpText:
      "From billing: for the cohort of new patients who started this month, sum payments received within 30 days of each first visit, then divide by the number of new patients. Count cash actually received, not plan face value. Exclude insurance AR and existing patients.",
    dependencies: [],
    lockedMessage: null,
    writable: true,
  },
  {
    key: "pva",
    section: "keep",
    label: "Patient Visit Average (PVA)",
    unit: "count",
    source: "automatic",
    formula: "Total visits (Daily Log) ÷ New patients in month",
    helpText:
      "How many visits each new patient generated this month on average. Requires Daily Log visits and at least one new patient.",
    dependencies: ["new_patients"],
    lockedMessage:
      "Needs Daily Log visits and at least one new patient in this month.",
    writable: false,
  },
  {
    key: "rpv",
    section: "keep",
    label: "Revenue per Visit (RPV)",
    unit: "usd",
    source: "automatic",
    formula: "Total revenue ÷ Total visits (same as office visit average)",
    helpText:
      "Average collections per visit from the Daily Log. Undefined when visits = 0. Benchmark: $80–$150 for many chiropractic practices.",
    dependencies: [],
    lockedMessage: "Needs Daily Log visits greater than zero.",
    writable: false,
  },
  {
    key: "careplan_completions",
    section: "keep",
    label: "Care Plan Completions",
    unit: "count",
    source: "manual",
    formula: "# of patients who reached their prescribed visit count this month",
    helpText:
      "Count patients whose plan end fell this month and who hit the target visit count. Do not count patients still attending. Track in the EHR or a plan spreadsheet.",
    dependencies: [],
    lockedMessage: null,
    writable: true,
  },
  {
    key: "careplan_starts",
    section: "keep",
    label: "Care Plan Starts",
    unit: "count",
    source: "manual",
    formula: "# of patients who signed a care plan and made a first payment",
    helpText:
      "Count new care-plan agreements signed this month. Exclude Day-2 consults that have not committed yet.",
    dependencies: [],
    lockedMessage: null,
    writable: true,
  },
  {
    key: "cpr",
    section: "keep",
    label: "Care Plan Completion Rate",
    unit: "percent",
    source: "automatic",
    formula: "(Completions ÷ Starts) × 100",
    helpText:
      "Unlocks when Completions and Starts are entered. A rate below 60% means significant drop-off before plans finish.",
    dependencies: ["careplan_completions", "careplan_starts"],
    lockedMessage: "Enter Completions and Starts to unlock.",
    writable: false,
  },
  {
    key: "direct_costs",
    section: "keep",
    label: "Direct Costs",
    unit: "usd",
    source: "manual",
    formula: "Clinical delivery cost for the month (not overhead)",
    helpText:
      "From the P&L: associate DC wages for care delivery, chiropractic supplies, treatment-equipment depreciation. Exclude rent, owner's draw, front-desk wages, marketing, and software. Ask the bookkeeper for Cost of Services / clinical labor.",
    dependencies: [],
    lockedMessage: null,
    writable: true,
  },
  {
    key: "gpm",
    section: "keep",
    label: "Gross Profit Margin (GPM)",
    unit: "percent",
    source: "automatic",
    formula: "(Revenue − Direct costs) ÷ Revenue × 100",
    helpText:
      "Unlocks when Direct Costs are entered and the month has Daily Log revenue greater than zero.",
    dependencies: ["direct_costs"],
    lockedMessage: "Enter Direct Costs and log revenue this month to unlock.",
    writable: false,
  },
  {
    key: "marketing_spend",
    section: "keep",
    label: "Marketing Spend",
    unit: "usd",
    source: "manual",
    formula: "Total acquisition spend for the month",
    helpText:
      "Include paid ads, sponsored posts, screening/health-fair booths, and referral incentives. Exclude general branding that is not meant to acquire patients.",
    dependencies: [],
    lockedMessage: null,
    writable: true,
  },
  {
    key: "cac",
    section: "keep",
    label: "Customer Acquisition Cost (CAC)",
    unit: "usd",
    source: "automatic",
    formula: "Marketing spend ÷ New patients",
    helpText:
      "Unlocks when Marketing Spend is entered and the month has at least one new patient.",
    dependencies: ["marketing_spend", "new_patients"],
    lockedMessage: "Enter Marketing Spend and record at least one new patient.",
    writable: false,
  },
  {
    key: "ltgp",
    section: "keep",
    label: "Lifetime Gross Profit / Patient (LTGP)",
    unit: "usd",
    source: "automatic",
    formula: "RPV × GPM% × PVA",
    helpText:
      "Estimated lifetime gross profit per patient. Requires RPV, GPM, and PVA to all be available.",
    dependencies: ["rpv", "gpm", "pva"],
    lockedMessage: "Requires RPV, GPM, and PVA.",
    writable: false,
  },
  {
    key: "ltgp_cac",
    section: "keep",
    label: "LTGP : CAC Ratio",
    unit: "ratio",
    source: "automatic",
    formula: "LTGP ÷ CAC",
    helpText:
      "Dollars of lifetime gross profit per dollar spent acquiring a patient. Benchmark: 3:1 or higher.",
    dependencies: ["ltgp", "cac"],
    lockedMessage: "Requires LTGP and CAC.",
    writable: false,
  },
];

export const MANUAL_METRIC_KEYS = ADVANCED_METRIC_FIELDS.filter(
  (f) => f.writable,
).map((f) => f.key);

export const SECTION_META: Record<
  AdvancedMetricSection,
  { id: AdvancedMetricSection; label: string; blurb: string }
> = {
  get: {
    id: "get",
    label: "GET — Lead & Appointment Metrics",
    blurb:
      "Lead capture and appointment booking. Enter leads, consults booked, and shows; Show Rate is calculated.",
  },
  sell: {
    id: "sell",
    label: "SELL — Conversion & Case Value",
    blurb:
      "How well new patients convert into care plans and collections. Close Rate, Case Average, and new-patient counts come from Patients + Daily Log.",
  },
  keep: {
    id: "keep",
    label: "KEEP & EARN — Retention, Capacity & Profit",
    blurb:
      "Retention, capacity, and profit. Enter direct costs and marketing spend to unlock GPM, LTGP, and LTGP:CAC.",
  },
};

export function fieldByKey(key: string): AdvancedMetricFieldDef | undefined {
  return ADVANCED_METRIC_FIELDS.find((f) => f.key === key);
}

export type StoredMetricInput = {
  section: string;
  key: string;
  valueNumeric: number | null;
  valueText: string | null;
  source: string;
};

export type DailyStatLike = {
  date: string;
  visits: number;
  revenueCents: number;
};

export type PatientLike = {
  patientType: string;
  converted: boolean;
  day1Date: string | null;
  createdAt: Date | string;
  referralSource?: string | null;
};

export type ComputedMetricField = {
  key: string;
  label: string;
  section: AdvancedMetricSection;
  unit: AdvancedMetricUnit;
  source: AdvancedMetricSource;
  value: number | null;
  available: boolean;
  reason: string | null;
  formula: string;
  helpText: string;
  dependencies: string[];
  locked: boolean;
  lockedMessage: string | null;
  writable: boolean;
};

export type ComputedMetricsSnapshot = {
  month: string;
  from: string;
  to: string;
  emptyState: EmptyState;
  emptyStateCopy: string | null;
  dailyLogAvailable: boolean;
  patientDataAvailable: boolean;
  totals: {
    visits: number;
    revenueCents: number;
    revenue: number;
    newPatients: number;
    convertedCount: number;
  };
  sections: Array<{
    id: AdvancedMetricSection;
    label: string;
    blurb: string;
    fields: ComputedMetricField[];
  }>;
};

function ratioPercent(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  if (
    numerator == null ||
    denominator == null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return null;
  }
  return roundPercent((numerator / denominator) * 100);
}

function manualNumber(
  inputs: StoredMetricInput[],
  key: string,
): number | null {
  const row = inputs.find((item) => item.key === key);
  if (!row || row.valueNumeric == null || !Number.isFinite(row.valueNumeric)) {
    return null;
  }
  return row.valueNumeric;
}

export function computeAdvancedMetrics(opts: {
  month: string;
  dailyStats: DailyStatLike[];
  patients: PatientLike[];
  inputs: StoredMetricInput[];
}): ComputedMetricsSnapshot {
  const { month, dailyStats, patients, inputs } = opts;
  const { from, to } = monthRange(month);
  const visits = dailyStats.reduce((sum, row) => sum + row.visits, 0);
  const revenueCents = dailyStats.reduce(
    (sum, row) => sum + row.revenueCents,
    0,
  );
  const revenue = centsToDollars(revenueCents);
  const funnel = periodFunnel(
    patients.map((p) => ({
      ...p,
      referralSource: p.referralSource ?? null,
    })),
    from,
    to,
  );
  const dailyLogAvailable = dailyStats.length > 0;
  const patientDataAvailable = patients.length > 0;
  const emptyState = periodEmptyState(dailyStats);

  let emptyStateCopy: string | null = null;
  if (!dailyLogAvailable && !patientDataAvailable) {
    emptyStateCopy =
      "No Daily Log entries or patients in this month yet. Automatic metrics appear once those exist; you can still enter manual figures.";
  } else if (!dailyLogAvailable) {
    emptyStateCopy =
      "No Daily Log entries in this month. Case average, RPV, and PVA stay locked until visits and revenue are logged.";
  } else if (emptyState === "zeros_recorded") {
    emptyStateCopy =
      "Days were logged, but visits and revenue are all zero. Automatic money metrics stay undefined until non-zero data exists.";
  }

  const monthlyLeads = manualNumber(inputs, "monthly_leads");
  const consultsBooked = manualNumber(inputs, "consults_booked");
  const patientsShowed = manualNumber(inputs, "patients_showed");
  const thirtyDayCash = manualNumber(inputs, "thirty_day_cash_per_np");
  const completions = manualNumber(inputs, "careplan_completions");
  const starts = manualNumber(inputs, "careplan_starts");
  const directCosts = manualNumber(inputs, "direct_costs");
  const marketingSpend = manualNumber(inputs, "marketing_spend");

  const showRate = ratioPercent(patientsShowed, consultsBooked);
  const closeRate =
    funnel.newCount > 0 ? funnel.conversionPercent : null;
  const caseAverage =
    dailyLogAvailable && funnel.newCount > 0
      ? centsToDollars(Math.round(revenueCents / funnel.newCount))
      : null;
  const pva =
    dailyLogAvailable && visits > 0 && funnel.newCount > 0
      ? roundPercent(visits / funnel.newCount, 1)
      : null;
  const rpv = officeVisitAverage(revenueCents, visits);
  const cpr = ratioPercent(completions, starts);
  const gpm =
    directCosts != null && revenue > 0
      ? roundPercent(((revenue - directCosts) / revenue) * 100)
      : null;
  const cac =
    marketingSpend != null && funnel.newCount > 0
      ? roundPercent(marketingSpend / funnel.newCount, 2)
      : null;
  const ltgp =
    rpv != null && gpm != null && pva != null
      ? roundPercent(rpv * (gpm / 100) * pva, 2)
      : null;
  const ltgpCac =
    ltgp != null && cac != null && cac > 0
      ? roundPercent(ltgp / cac, 1)
      : null;

  const values: Record<string, number | null> = {
    monthly_leads: monthlyLeads,
    consults_booked: consultsBooked,
    patients_showed: patientsShowed,
    show_rate: showRate,
    new_patients: patientDataAvailable ? funnel.newCount : null,
    converted_count: patientDataAvailable ? funnel.convertedCount : null,
    close_rate: closeRate,
    case_average: caseAverage,
    thirty_day_cash_per_np: thirtyDayCash,
    pva,
    rpv,
    careplan_completions: completions,
    careplan_starts: starts,
    cpr,
    direct_costs: directCosts,
    gpm,
    marketing_spend: marketingSpend,
    cac,
    ltgp,
    ltgp_cac: ltgpCac,
  };

  function availability(def: AdvancedMetricFieldDef): {
    available: boolean;
    reason: string | null;
    locked: boolean;
    lockedMessage: string | null;
  } {
    const value = values[def.key] ?? null;
    if (def.writable) {
      if (value == null) {
        return {
          available: false,
          reason: "Not entered for this month.",
          locked: false,
          lockedMessage: null,
        };
      }
      return {
        available: true,
        reason: null,
        locked: false,
        lockedMessage: null,
      };
    }

    if (def.key === "new_patients" || def.key === "converted_count") {
      if (!patientDataAvailable) {
        return {
          available: false,
          reason:
            "No patients in this practice yet. New-patient counts appear once the first patient is recorded.",
          locked: true,
          lockedMessage: def.lockedMessage,
        };
      }
      return {
        available: true,
        reason: null,
        locked: false,
        lockedMessage: null,
      };
    }

    if (def.key === "close_rate") {
      if (!patientDataAvailable) {
        return {
          available: false,
          reason:
            "No patients in this practice yet. Close rate appears once new patients are recorded.",
          locked: true,
          lockedMessage: def.lockedMessage,
        };
      }
      if (funnel.newCount === 0) {
        return {
          available: false,
          reason: "No new patients in this month (wellness is excluded).",
          locked: true,
          lockedMessage: def.lockedMessage,
        };
      }
      return {
        available: true,
        reason: null,
        locked: false,
        lockedMessage: null,
      };
    }

    if (def.key === "case_average") {
      if (!dailyLogAvailable) {
        return {
          available: false,
          reason: "No Daily Log entries in this month.",
          locked: true,
          lockedMessage: def.lockedMessage,
        };
      }
      if (!patientDataAvailable || funnel.newCount === 0) {
        return {
          available: false,
          reason: "Needs at least one new patient in this month.",
          locked: true,
          lockedMessage: def.lockedMessage,
        };
      }
      return {
        available: true,
        reason: null,
        locked: false,
        lockedMessage: null,
      };
    }

    if (def.key === "pva") {
      if (!dailyLogAvailable) {
        return {
          available: false,
          reason: "No Daily Log entries in this month.",
          locked: true,
          lockedMessage: def.lockedMessage,
        };
      }
      if (visits === 0) {
        return {
          available: false,
          reason: "PVA is visits ÷ new patients and is undefined when visits = 0.",
          locked: true,
          lockedMessage: def.lockedMessage,
        };
      }
      if (!patientDataAvailable || funnel.newCount === 0) {
        return {
          available: false,
          reason: "Needs at least one new patient in this month.",
          locked: true,
          lockedMessage: def.lockedMessage,
        };
      }
      return {
        available: true,
        reason: null,
        locked: false,
        lockedMessage: null,
      };
    }

    if (def.key === "rpv") {
      if (!dailyLogAvailable) {
        return {
          available: false,
          reason: "No Daily Log entries in this month.",
          locked: true,
          lockedMessage: def.lockedMessage,
        };
      }
      if (visits === 0) {
        return {
          available: false,
          reason: "RPV is revenue ÷ visits and is undefined when visits = 0.",
          locked: true,
          lockedMessage: def.lockedMessage,
        };
      }
      return {
        available: true,
        reason: null,
        locked: false,
        lockedMessage: null,
      };
    }

    if (value == null) {
      return {
        available: false,
        reason: def.lockedMessage,
        locked: true,
        lockedMessage: def.lockedMessage,
      };
    }
    return {
      available: true,
      reason: null,
      locked: false,
      lockedMessage: null,
    };
  }

  const fields: ComputedMetricField[] = ADVANCED_METRIC_FIELDS.map((def) => {
    const avail = availability(def);
    return {
      key: def.key,
      label: def.label,
      section: def.section,
      unit: def.unit,
      source: def.source,
      value: avail.available ? (values[def.key] ?? null) : null,
      available: avail.available,
      reason: avail.reason,
      formula: def.formula,
      helpText: def.helpText,
      dependencies: def.dependencies,
      locked: avail.locked,
      lockedMessage: avail.lockedMessage,
      writable: def.writable,
    };
  });

  return {
    month,
    from,
    to,
    emptyState,
    emptyStateCopy,
    dailyLogAvailable,
    patientDataAvailable,
    totals: {
      visits,
      revenueCents,
      revenue,
      newPatients: funnel.newCount,
      convertedCount: funnel.convertedCount,
    },
    sections: (["get", "sell", "keep"] as AdvancedMetricSection[]).map(
      (id) => ({
        id,
        label: SECTION_META[id].label,
        blurb: SECTION_META[id].blurb,
        fields: fields.filter((f) => f.section === id),
      }),
    ),
  };
}

function fmtUsd(n: number | null): string {
  if (n == null) return "[not entered]";
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPct(n: number | null): string {
  if (n == null) return "[not entered]";
  return `${n.toFixed(1)}%`;
}

function fmtNum(n: number | null, digits = 0): string {
  if (n == null) return "[not entered]";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtRatio(n: number | null): string {
  if (n == null) return "[not entered]";
  return `${n.toFixed(1)} : 1`;
}

function fieldValue(
  snapshot: ComputedMetricsSnapshot,
  key: string,
): number | null {
  for (const section of snapshot.sections) {
    const field = section.fields.find((f) => f.key === key);
    if (field) return field.available ? field.value : null;
  }
  return null;
}

/**
 * Local string builder. Aggregates only — no patient names, emails, or notes.
 * Does not call OpenAI or any model provider.
 */
export function buildAnalysisPrompt(snapshot: ComputedMetricsSnapshot): string {
  const v = (key: string) => fieldValue(snapshot, key);
  const lines = [
    "You are a business growth advisor specializing in chiropractic practices. I am going to share my KPI data for a specific time period. Please analyze the numbers and give me clear, actionable recommendations.",
    "",
    `## Period: ${snapshot.month} (${snapshot.from} to ${snapshot.to})`,
    "",
    "These figures are practice-level aggregates only. No patient names or other identifiers are included.",
    "",
    "---",
    "",
    "### GET — Lead Acquisition & Show Rate",
    "These metrics measure how effectively the practice attracts and books new patients.",
    "",
    `Monthly Leads (unique inquiries this month): ${fmtNum(v("monthly_leads"))}`,
    `Consults Booked (new patient appointments scheduled): ${fmtNum(v("consults_booked"))}`,
    `Patients Showed (booked patients who kept their appointment): ${fmtNum(v("patients_showed"))}`,
    `Show Rate (Showed ÷ Booked): ${fmtPct(v("show_rate"))}`,
    "",
    "  Benchmark context: A healthy show rate is typically 80–90%. Below 70% suggests a follow-up or reminder problem.",
    "",
    "---",
    "",
    "### SELL — Conversion & Initial Case Value",
    "These metrics measure how well the practice converts new patients into committed care plans.",
    "",
    `New Patients (activity date in month): ${fmtNum(v("new_patients"))}`,
    `Converted to Care Plan: ${fmtNum(v("converted_count"))}`,
    `Close Rate (Converted ÷ New Patients): ${fmtPct(v("close_rate"))}`,
    `30-Day Cash per New Patient: ${fmtUsd(v("thirty_day_cash_per_np"))}`,
    `Case Average (month revenue ÷ new patients): ${fmtUsd(v("case_average"))}`,
    `Revenue per Visit (RPV): ${fmtUsd(v("rpv"))}`,
    "",
    "  Benchmark context: A close rate above 75% is strong. Low 30-day cash vs. case average suggests patients are not paying up front or not starting plans quickly.",
    "",
    "---",
    "",
    "### KEEP & EARN — Retention, Capacity & Profit",
    "These metrics measure how well the practice retains patients and converts revenue into profit.",
    "",
    `Patient Visit Average (PVA): ${fmtNum(v("pva"), 1)}`,
    `Care Plan Completion Rate (CPR): ${fmtPct(v("cpr"))}`,
    `  Care Plan Completions: ${fmtNum(v("careplan_completions"))}`,
    `  Care Plan Starts: ${fmtNum(v("careplan_starts"))}`,
    `Gross Profit Margin (GPM): ${fmtPct(v("gpm"))}`,
    `  Total Revenue: ${fmtUsd(snapshot.totals.revenue)}`,
    `  Direct Costs (clinical delivery): ${fmtUsd(v("direct_costs"))}`,
    `Lifetime Gross Profit per Patient (LTGP = RPV × GPM × PVA): ${fmtUsd(v("ltgp"))}`,
    `Customer Acquisition Cost (CAC = Marketing Spend ÷ New Patients): ${fmtUsd(v("cac"))}`,
    `  Marketing Spend: ${fmtUsd(v("marketing_spend"))}`,
    `LTGP:CAC Ratio (target: > 3:1): ${fmtRatio(v("ltgp_cac"))}`,
    "",
    "  Benchmark context: LTGP:CAC above 3:1 means the practice earns at least $3 in lifetime gross profit for every $1 spent on marketing. A CPR below 60% indicates significant drop-off before plans are completed.",
    "",
    "---",
    "",
    "### Raw Totals (aggregates)",
    `Total Visits this period: ${snapshot.totals.visits.toLocaleString()}`,
    `Total Revenue this period: ${fmtUsd(snapshot.totals.revenue)}`,
    `Daily log rows present: ${snapshot.dailyLogAvailable ? "yes" : "no"}`,
    "",
    "---",
    "",
    "## Please provide the following analysis:",
    "",
    "1. **Overall health score** — Rate the practice's performance across GET / SELL / KEEP & EARN on a scale of 1–10 with a brief explanation for each stage.",
    "2. **Top 3 opportunities** — Where is the biggest leverage? Which one metric, if improved by 20%, would have the largest downstream impact on revenue and profit?",
    "3. **Warning flags** — Are any metrics in dangerous territory? What is the risk if they are left unaddressed?",
    "4. **Concrete next steps** — Give 3–5 specific actions the practice owner or team can take this week to move the needle. Be direct and specific (e.g. \"Call every no-show from the last 30 days and offer a reschedule\" rather than \"improve follow-up\").",
    "5. **One question to ask my team** — What is the single most important question I should ask in my next team meeting based on these numbers?",
  ];
  return lines.join("\n");
}
