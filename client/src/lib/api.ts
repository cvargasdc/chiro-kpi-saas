export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(
      typeof body === "object" && body && "error" in body
        ? String((body as { error: string }).error)
        : `Request failed (${status})`,
    );
    this.status = status;
    this.body = body;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data as T;
}

export type MeResponse = {
  user: {
    id: string;
    email: string;
    username: string;
    displayName: string;
    mfa: { enabled: boolean; methods: string[]; status: string; note?: string };
  };
  organizations: Array<{ id: string; name: string; role: string }>;
  practices: Array<{ id: string; name: string; orgId: string; role: string }>;
  active: {
    orgId: string;
    orgName: string;
    practiceId: string;
    practiceName: string;
    role: string;
  } | null;
};

export type Patient = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  condition: string | null;
  status: string;
  patientType: "new" | "wellness" | string;
  typeName: string | null;
  referralSourceId: string | null;
  referralSource: string | null;
  day1Date: string | null;
  day2Date: string | null;
  careStatus: string;
  converted: boolean;
  conversionDate: string | null;
  planType: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  onboarding: { available: false; reason: string };
};

export type PatientsListResponse = {
  patients: Patient[];
  page: { limit: number; offset: number; total: number };
  filters: {
    q: string | null;
    type: string;
    month: string | null;
    referralSource: string | null;
  };
  emptyState: "no_patients" | "no_matches" | "has_data";
};

export type ReferralLeaderboardRow = {
  referralSource: string;
  newCount: number;
  convertedCount: number;
  wellnessCount: number;
  conversionPercent: number | null;
};

export type ReferralLeaderboardResponse = {
  today: string;
  from: string;
  to: string;
  formula: string;
  emptyState: "no_entries" | "has_data";
  rows: ReferralLeaderboardRow[];
};

export type ReferralSource = {
  id: string;
  name: string;
  active: boolean;
};

export type BillingStatus = {
  plan: string | null;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  stripeCustomerId: string | null;
  hasStripeCustomer: boolean;
  entitled: boolean;
  enforce: boolean;
};

export type DailyLogEntry = {
  id: string;
  date: string;
  visits: number;
  revenueCents: number;
  revenue: number;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DailyLogWarning = {
  code: string;
  message: string;
  date?: string;
};

export type DailyLogListResponse = {
  today: string;
  from: string;
  to: string;
  entries: DailyLogEntry[];
  emptyState: "no_entries" | "zeros_recorded" | "has_data";
  warnings: DailyLogWarning[];
};

export type DailyLogMutationResponse = {
  today: string;
  entry: DailyLogEntry;
  warnings: DailyLogWarning[];
};

export type UnavailableKpi = {
  available: false;
  reason: string;
};

export type CountKpi = {
  available: true;
  value: number;
  previousValue: number;
  percentChange: number | null;
  emptyState: string;
  unit: "count";
  formula: string;
};

export type ConversionKpi = {
  available: true;
  value: number | null;
  previousValue: number | null;
  percentChange: number | null;
  convertedCount: number;
  newCount: number;
  previousConvertedCount: number;
  previousNewCount: number;
  emptyState: string;
  unit: "percent";
  formula: string;
};

export type DashboardResponse = {
  today: string;
  period: {
    key: string;
    from: string;
    to: string;
    label: string;
    dayCount: number;
  };
  comparisonLabel: string;
  previousFrom: string;
  previousTo: string;
  emptyState: "no_entries" | "zeros_recorded" | "has_data";
  emptyStateCopy: string | null;
  kpis: {
    visits: {
      value: number;
      previousValue: number;
      percentChange: number | null;
      emptyState: string;
      unit: string;
    };
    revenue: {
      value: number;
      previousValue: number;
      valueCents: number;
      previousValueCents: number;
      percentChange: number | null;
      emptyState: string;
      unit: string;
    };
    officeVisitAverage: {
      value: number | null;
      previousValue: number | null;
      percentChange: number | null;
      explanation: string;
      unit: string;
    };
    newPatients: UnavailableKpi | CountKpi;
    wellnessPatients: UnavailableKpi | CountKpi;
    conversion: UnavailableKpi | ConversionKpi;
  };
  anomalies: {
    revenueWithoutVisits: Array<{
      date: string;
      visits: number;
      revenue: number;
      revenueCents: number;
    }>;
  };
};

export type GoalStatus =
  | "achieved"
  | "expired"
  | "below_target"
  | "behind_pace"
  | "on_pace";

export type PublicGoal = {
  id: string;
  name: string;
  title: string;
  metricType: "revenue" | "visits" | "custom";
  timePeriod: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  unit: "usd_cents" | "count";
  currentSource: "daily_stats" | "manual";
  targetValue: number;
  currentValue: number;
  expectedValue: number;
  target: number;
  current: number;
  expected: number;
  targetDisplay: string;
  currentDisplay: string;
  expectedDisplay: string;
  progressPercent: number;
  elapsedDays: number;
  totalDays: number;
  daysRemaining: number;
  status: GoalStatus;
  statusLabel: string;
  expectedFormula: string;
};

export type GoalsListResponse = {
  today: string;
  includeExpired: boolean;
  expiredCount: number;
  emptyState: "no_goals" | "has_data";
  goals: PublicGoal[];
};

export type GoalMutationResponse = {
  today: string;
  goal: PublicGoal;
};

export type Treatment = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  priceCents: number;
  price: number;
  priceDisplay: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type TreatmentsListResponse = {
  emptyState: "no_treatments" | "no_matches" | "has_data";
  treatments: Treatment[];
  grouped: Array<{ category: string; items: Treatment[] }>;
  carePlanGenerator: { available: false; reason: string };
};

export type TreatmentMutationResponse = {
  treatment: Treatment;
};

export type ReportPeriodKey =
  | "weekly"
  | "monthly"
  | "quarterly"
  | "annual"
  | "custom";

export type ReportTrendPoint = {
  key: string;
  label: string;
  from: string;
  to: string;
  visits: number;
  revenueCents: number;
  revenue: number;
  partial: boolean;
};

export type ReportPreviewResponse = DashboardResponse & {
  comparisonDefinition: string;
  goals: {
    emptyState: "no_goals" | "has_data";
    overlappingCount: number;
    counts: {
      total: number;
      achieved: number;
      onPace: number;
      behindPace: number;
      belowTarget: number;
      expired: number;
    };
    items: Array<{
      id: string;
      name: string;
      metricType: string;
      status: string;
      statusLabel: string;
      progressPercent: number;
      currentDisplay: string;
      targetDisplay: string;
      startDate: string;
      endDate: string;
    }>;
  };
  referrals: {
    emptyState: "no_entries" | "has_data";
    formula: string;
    rows: ReferralLeaderboardRow[];
  };
  trend: {
    grain: "day" | "week";
    grainReason: string;
    emptyState: "no_entries" | "zeros_recorded" | "has_data";
    points: ReportTrendPoint[];
  };
};
