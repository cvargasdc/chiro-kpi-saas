/**
 * One-off: render a synthetic care plan PDF for visual comparison.
 * Output: .aws-scratch/care-plan-pdf-sample.pdf (gitignored)
 *
 * Usage: npx tsx scripts/sample-care-plan-pdf.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CARE_PLAN_TERMS,
  DEFAULT_PAYMENT_SETTINGS,
  computePaymentQuotes,
  type CarePlanLineItem,
} from "../shared/care-plans";
import { formatPriceCents } from "../shared/treatments";
import { renderCarePlanPdf } from "../server/care-plans/pdf";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, ".aws-scratch", "care-plan-pdf-sample.pdf");

const lineItems: CarePlanLineItem[] = [
  {
    treatmentId: "t1",
    name: "Chiropractic Adjustment",
    category: "Adjustment",
    quantity: 12,
    unitPriceCents: 6500,
    unitPrice: 65,
    unitPriceDisplay: "$65.00",
    lineTotalCents: 78000,
    lineTotal: 780,
    lineTotalDisplay: "$780.00",
    missingFromCatalog: false,
  },
  {
    treatmentId: "t2",
    name: "Therapeutic Exercise",
    category: "Therapy",
    quantity: 8,
    unitPriceCents: 4500,
    unitPrice: 45,
    unitPriceDisplay: "$45.00",
    lineTotalCents: 36000,
    lineTotal: 360,
    lineTotalDisplay: "$360.00",
    missingFromCatalog: false,
  },
  {
    treatmentId: "t3",
    name: "Initial Exam",
    category: "Exam",
    quantity: 1,
    unitPriceCents: 12500,
    unitPrice: 125,
    unitPriceDisplay: "$125.00",
    lineTotalCents: 12500,
    lineTotal: 125,
    lineTotalDisplay: "$125.00",
    missingFromCatalog: false,
  },
];

const subtotalCents = lineItems.reduce((s, i) => s + i.lineTotalCents, 0);
const paymentSettings = {
  ...DEFAULT_PAYMENT_SETTINGS,
  planStartDate: "2026-10-01",
};
const paymentQuotes = computePaymentQuotes(subtotalCents, paymentSettings);

async function main() {
  const pdf = await renderCarePlanPdf({
    practiceName: "Innate Family Chiropractic (Sample)",
    firstName: "Jordan",
    lastName: "Example",
    notes: "Sample notes for visual layout comparison only. Not a real patient.",
    lineItems,
    subtotalCents,
    subtotalDisplay: formatPriceCents(subtotalCents),
    paymentSettings,
    paymentQuotes,
    terms: DEFAULT_CARE_PLAN_TERMS,
    status: "final",
    primaryColor: "#1e40af",
    logoUrl: null,
    phone: "(555) 010-2000",
    address: "100 Wellness Ave",
    city: "Austin",
    state: "TX",
  });

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, pdf);
  console.log(`Wrote ${outPath} (${pdf.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
