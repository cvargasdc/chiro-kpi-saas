import { centsToDollars } from "@shared/kpis";
import {
  CARE_PLAN_GENERATOR_UNAVAILABLE,
  formatPriceCents,
} from "@shared/treatments";
import type { StoredTreatment } from "../storage/types";

export type PublicTreatment = {
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

export function publicTreatment(row: StoredTreatment): PublicTreatment {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    priceCents: row.priceCents,
    price: centsToDollars(row.priceCents),
    priceDisplay: formatPriceCents(row.priceCents),
    active: row.active,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export { CARE_PLAN_GENERATOR_UNAVAILABLE };
