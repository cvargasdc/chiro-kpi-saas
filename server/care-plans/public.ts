import {
  buildLineItems,
  computePaymentQuotes,
  type CarePlanLineItem,
  type CarePlanPaymentQuotes,
  type CarePlanPaymentSettings,
  type CarePlanStatus,
  type CarePlanTemplateSelections,
  type TreatmentPriceLookup,
} from "@shared/care-plans";
import { centsToDollars } from "@shared/kpis";
import { formatPriceCents } from "@shared/treatments";
import type { StoredCarePlan, StoredCarePlanTemplate } from "../storage/types";

export type PublicCarePlan = {
  id: string;
  patientId: string | null;
  firstName: string;
  lastName: string;
  notes: string | null;
  treatmentSelections: StoredCarePlan["treatmentSelections"];
  paymentSettings: CarePlanPaymentSettings;
  lineItems: CarePlanLineItem[];
  subtotalCents: number;
  subtotal: number;
  subtotalDisplay: string;
  paymentQuotes: CarePlanPaymentQuotes;
  status: CarePlanStatus;
  complianceAcknowledgedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicCarePlanTemplate = {
  id: string;
  name: string;
  defaultSelections: CarePlanTemplateSelections;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export function publicCarePlan(
  row: StoredCarePlan,
  catalog: TreatmentPriceLookup[],
): PublicCarePlan {
  const { items } = buildLineItems(row.treatmentSelections, catalog);
  const quotes = computePaymentQuotes(row.subtotalCents, row.paymentSettings);
  return {
    id: row.id,
    patientId: row.patientId,
    firstName: row.firstName,
    lastName: row.lastName,
    notes: row.notes,
    treatmentSelections: row.treatmentSelections,
    paymentSettings: row.paymentSettings,
    lineItems: items,
    subtotalCents: row.subtotalCents,
    subtotal: centsToDollars(row.subtotalCents),
    subtotalDisplay: formatPriceCents(row.subtotalCents),
    paymentQuotes: quotes,
    status: row.status,
    complianceAcknowledgedAt: row.complianceAcknowledgedAt
      ? row.complianceAcknowledgedAt.toISOString()
      : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function publicCarePlanTemplate(
  row: StoredCarePlanTemplate,
): PublicCarePlanTemplate {
  return {
    id: row.id,
    name: row.name,
    defaultSelections: row.defaultSelections,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
