import { createRequire } from "node:module";
import {
  CARE_PLAN_PDF_COMPLIANCE_FOOTER,
  addMonthsYmd,
  applyPracticeName,
  type CarePlanLineItem,
  type CarePlanPaymentQuotes,
  type CarePlanPaymentSettings,
} from "@shared/care-plans";
import { formatPriceCents } from "@shared/treatments";

const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit") as typeof import("pdfkit");

type PdfDoc = InstanceType<typeof PDFDocument>;

function ensureSpace(doc: PdfDoc, needed = 72): void {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function heading(doc: PdfDoc, text: string): void {
  ensureSpace(doc, 36);
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#163a5c").text(text);
  doc.moveDown(0.2);
  doc.font("Helvetica").fontSize(9).fillColor("#111827");
}

function line(doc: PdfDoc, text: string): void {
  ensureSpace(doc, 16);
  doc.font("Helvetica").fontSize(9).fillColor("#111827").text(text, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
  });
}

export function renderCarePlanPdf(opts: {
  practiceName: string;
  firstName: string;
  lastName: string;
  notes: string | null;
  lineItems: CarePlanLineItem[];
  subtotalCents: number;
  subtotalDisplay: string;
  paymentSettings: CarePlanPaymentSettings;
  paymentQuotes: CarePlanPaymentQuotes;
  terms: string;
  status: string;
}): Promise<Buffer> {
  const {
    practiceName,
    firstName,
    lastName,
    notes,
    lineItems,
    subtotalDisplay,
    paymentQuotes,
    paymentSettings,
    terms,
    status,
  } = opts;

  const maxMonths = Math.max(
    paymentQuotes.monthlyPlan?.months ?? 0,
    paymentQuotes.downPaymentPlan?.months ?? 0,
  );
  const endDate =
    paymentSettings.planStartDate && maxMonths > 0
      ? addMonthsYmd(paymentSettings.planStartDate, maxMonths)
      : null;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 50,
      info: {
        Title: `Care plan — ${practiceName}`,
        Author: "Chiro-KPI",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(16).fillColor("#163a5c").text("Care Plan");
    doc.font("Helvetica").fontSize(11).fillColor("#334155").text(practiceName);
    doc.moveDown(0.3);
    line(doc, `Patient: ${firstName} ${lastName}`);
    line(doc, `Status: ${status}`);
    if (paymentSettings.planStartDate) {
      line(
        doc,
        `Plan dates: ${paymentSettings.planStartDate}${endDate ? ` – ${endDate}` : ""}`,
      );
    }

    heading(doc, "Recommended services");
    if (lineItems.length === 0) {
      line(doc, "No treatments selected.");
    } else {
      for (const item of lineItems) {
        line(
          doc,
          `${item.name}  × ${item.quantity}  @ ${item.unitPriceDisplay}  =  ${item.lineTotalDisplay}${
            item.missingFromCatalog ? "  (removed from catalog)" : ""
          }`,
        );
      }
    }
    doc.moveDown(0.2);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827").text(
      `Subtotal  ${subtotalDisplay}`,
    );

    heading(doc, "Payment options");
    if (paymentQuotes.payInFull) {
      const q = paymentQuotes.payInFull;
      line(
        doc,
        `Pay in full (Platinum): ${q.totalDisplay} after ${q.discountPercent}% discount (${formatPriceCents(q.discountCents)} off).`,
      );
    }
    if (paymentQuotes.monthlyPlan) {
      const q = paymentQuotes.monthlyPlan;
      line(
        doc,
        `Monthly (Silver): ${q.monthlyPaymentDisplay} × ${q.months} months. Total ${q.totalDisplay} after ${q.discountPercent}% discount.`,
      );
    }
    if (paymentQuotes.downPaymentPlan) {
      const q = paymentQuotes.downPaymentPlan;
      line(
        doc,
        `Down payment (Gold): ${q.downPaymentDisplay} down (${q.downPaymentPercent}%), then ${q.monthlyPaymentDisplay} × ${q.months} months. Total ${q.totalDisplay} after ${q.discountPercent}% discount.`,
      );
    }
    if (
      !paymentQuotes.payInFull &&
      !paymentQuotes.monthlyPlan &&
      !paymentQuotes.downPaymentPlan
    ) {
      line(doc, "No payment options enabled.");
    }

    if (notes && notes.trim()) {
      heading(doc, "Notes");
      line(doc, notes.trim());
    }

    heading(doc, "Terms of agreement");
    const termsText = applyPracticeName(terms, practiceName);
    for (const paragraph of termsText.split(/\n+/)) {
      const trimmed = paragraph.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("## ")) {
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#163a5c").text(
          trimmed.slice(3),
        );
      } else {
        line(doc, trimmed);
      }
      doc.moveDown(0.15);
    }

    doc.moveDown(1);
    ensureSpace(doc, 48);
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#64748b")
      .text(CARE_PLAN_PDF_COMPLIANCE_FOOTER, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      });

    doc.end();
  });
}
