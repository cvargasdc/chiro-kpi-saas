/**
 * Services / treatments catalog helpers.
 *
 * Storage is integer USD cents (same as daily_stats). The HTTP API also
 * exposes `price` in dollars. See docs/WEEK9-SERVICES-REPORTS.md.
 *
 * Not patient PHI. Still practice-scoped (org_id + practice_id, no "default").
 */

import { centsToDollars, dollarsToCents } from "./kpis";

export const TREATMENT_CATEGORIES = [
  "Adjustment",
  "Therapy",
  "Exam",
  "X-ray",
  "Massage",
  "Other",
] as const;

export type TreatmentCategory = (typeof TREATMENT_CATEGORIES)[number];

export const MAX_TREATMENT_NAME = 200;
export const MAX_TREATMENT_DESCRIPTION = 2_000;
export const MAX_TREATMENT_CATEGORY = 80;
export const MAX_PRICE_CENTS = 1_000_000_000; // $10,000,000.00
export const MAX_SORT_ORDER = 10_000;
export const MIN_SORT_ORDER = -10_000;

export { CARE_PLAN_GENERATOR } from "./care-plans";

/** @deprecated Use CARE_PLAN_GENERATOR. Kept so older imports keep compiling. */
export const CARE_PLAN_GENERATOR_UNAVAILABLE = {
  available: true as const,
  reason:
    "Care Plan Generator is available after the practitioner acknowledges the compliance notice.",
};

export function isKnownTreatmentCategory(
  value: string,
): value is TreatmentCategory {
  return (TREATMENT_CATEGORIES as readonly string[]).includes(value);
}

export function normalizeCategory(value: string): string | null {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return null;
  const known = TREATMENT_CATEGORIES.find(
    (item) => item.toLowerCase() === trimmed.toLowerCase(),
  );
  return known ?? trimmed;
}

export function formatPriceCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(centsToDollars(cents));
}

export function resolvePriceCents(input: {
  priceCents?: number;
  price?: number;
}): { ok: true; cents: number } | { ok: false; error: string } {
  if (input.priceCents !== undefined && input.price !== undefined) {
    if (dollarsToCents(input.price) !== input.priceCents) {
      return { ok: false, error: "price_mismatch" };
    }
    return { ok: true, cents: input.priceCents };
  }
  if (input.priceCents !== undefined) return { ok: true, cents: input.priceCents };
  if (input.price !== undefined) return { ok: true, cents: dollarsToCents(input.price) };
  return { ok: false, error: "price_required" };
}

export type TreatmentLike = {
  category: string;
  sortOrder: number;
  name: string;
};

export function compareTreatments(a: TreatmentLike, b: TreatmentLike): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  const cat = a.category.localeCompare(b.category);
  if (cat !== 0) return cat;
  return a.name.localeCompare(b.name);
}

export function groupByCategory<T extends { category: string }>(
  rows: T[],
): Array<{ category: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.category);
    if (list) list.push(row);
    else map.set(row.category, [row]);
  }
  const known = TREATMENT_CATEGORIES.filter((category) => map.has(category));
  const rest = [...map.keys()]
    .filter((category) => !isKnownTreatmentCategory(category))
    .sort((a, b) => a.localeCompare(b));
  return [...known, ...rest].map((category) => ({
    category,
    items: map.get(category) ?? [],
  }));
}
