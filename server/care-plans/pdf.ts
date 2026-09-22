import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
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
type Rgb = [number, number, number];

const DEFAULT_PRIMARY = "#1e40af";
const LEFT = 40;
const RIGHT = 40;
const HEADER_BAND = 100;
const PAGE_W = 612; // LETTER
const PAGE_H = 792;
const CONTENT_W = PAGE_W - LEFT - RIGHT;

function hexToRgb(hex: string | null | undefined): Rgb {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(
    hex?.trim() || DEFAULT_PRIMARY,
  );
  if (!result) return [30, 64, 175];
  return [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
  ];
}

function lighten(rgb: Rgb, percent: number): Rgb {
  return [
    Math.min(255, Math.round(rgb[0] + (255 - rgb[0]) * percent)),
    Math.min(255, Math.round(rgb[1] + (255 - rgb[1]) * percent)),
    Math.min(255, Math.round(rgb[2] + (255 - rgb[2]) * percent)),
  ];
}

function rgbToHex(rgb: Rgb): string {
  return (
    "#" +
    rgb.map((c) => c.toString(16).padStart(2, "0")).join("")
  );
}

async function tryLoadLogo(
  logoUrl: string | null | undefined,
): Promise<Buffer | null> {
  if (!logoUrl || typeof logoUrl !== "string") return null;
  const url = logoUrl.trim();
  if (!url) return null;
  try {
    if (/^https?:\/\//i.test(url)) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 24 || buf.length > 2_000_000) return null;
        return buf;
      } finally {
        clearTimeout(timer);
      }
    }
    if (url.startsWith("/") && !url.startsWith("//")) {
      return await readFile(url);
    }
  } catch {
    return null;
  }
  return null;
}

function drawGradientHeader(doc: PdfDoc, primary: Rgb, primaryLight: Rgb): void {
  const steps = 40;
  const stepW = PAGE_W / steps;
  for (let i = 0; i < steps; i++) {
    const ratio = i / steps;
    const r = Math.round(
      primary[0] + (primaryLight[0] - primary[0]) * ratio * 0.6,
    );
    const g = Math.round(
      primary[1] + (primaryLight[1] - primary[1]) * ratio * 0.6,
    );
    const b = Math.round(
      primary[2] + (primaryLight[2] - primary[2]) * ratio * 0.6,
    );
    doc.rect(i * stepW, 0, stepW + 1, HEADER_BAND).fill(rgbToHex([r, g, b]));
  }
}

function contactLine(opts: {
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
}): string {
  let line = "";
  if (opts.phone?.trim()) line += opts.phone.trim();
  if (opts.address?.trim()) {
    if (line) line += "  |  ";
    line += opts.address.trim();
    if (opts.city?.trim()) line += `, ${opts.city.trim()}`;
    if (opts.state?.trim()) line += `, ${opts.state.trim()}`;
  }
  return line;
}

function ensureY(doc: PdfDoc, y: number, needed: number, bottom = 60): number {
  if (y + needed > PAGE_H - bottom) {
    doc.addPage();
    return 50;
  }
  return y;
}

export type CarePlanPdfOpts = {
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
  /** Branding (optional) */
  primaryColor?: string | null;
  logoUrl?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
};

export async function renderCarePlanPdf(opts: CarePlanPdfOpts): Promise<Buffer> {
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
  } = opts;

  const primary = hexToRgb(opts.primaryColor);
  const primaryHex = rgbToHex(primary);
  const primaryLight = lighten(primary, 0.85);
  const primaryLightHex = rgbToHex(primaryLight);
  const darkGray = "#333333";
  const mediumGray = "#787878";
  const lightGray = "#f5f7fa";

  const maxMonths = Math.max(
    paymentQuotes.monthlyPlan?.months ?? 0,
    paymentQuotes.downPaymentPlan?.months ?? 0,
  );
  const endDate =
    paymentSettings.planStartDate && maxMonths > 0
      ? addMonthsYmd(paymentSettings.planStartDate, maxMonths)
      : null;

  const logoBuf = await tryLoadLogo(opts.logoUrl);
  const contact = contactLine(opts);

  const enabledCards: Array<{
    name: string;
    mainAmount: string;
    amountLabel: string;
    details: { label: string; value: string }[];
  }> = [];

  if (paymentQuotes.monthlyPlan) {
    const q = paymentQuotes.monthlyPlan;
    enabledCards.push({
      name: "Silver Plan",
      mainAmount: q.monthlyPaymentDisplay,
      amountLabel: `per month for ${q.months} months`,
      details: [
        { label: "Total Investment", value: q.totalDisplay },
        {
          label: "You Save",
          value: `${formatPriceCents(q.discountCents)} (${q.discountPercent}%)`,
        },
      ],
    });
  }
  if (paymentQuotes.downPaymentPlan) {
    const q = paymentQuotes.downPaymentPlan;
    enabledCards.push({
      name: "Gold Plan",
      mainAmount: q.downPaymentDisplay,
      amountLabel: `down + ${q.monthlyPaymentDisplay}/mo`,
      details: [
        { label: "Total Investment", value: q.totalDisplay },
        {
          label: "You Save",
          value: `${formatPriceCents(q.discountCents)} (${q.discountPercent}%)`,
        },
      ],
    });
  }
  if (paymentQuotes.payInFull) {
    const q = paymentQuotes.payInFull;
    enabledCards.push({
      name: "Platinum Plan",
      mainAmount: q.totalDisplay,
      amountLabel: "one-time payment",
      details: [
        { label: "Total Investment", value: q.totalDisplay },
        {
          label: "You Save",
          value: `${formatPriceCents(q.discountCents)} (${q.discountPercent}%)`,
        },
      ],
    });
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 40,
      bufferPages: true,
      autoFirstPage: true,
      info: {
        Title: `Care plan — ${practiceName}`,
        Author: "Chiro-KPI",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // --- Page 1: branded care plan ---
    drawGradientHeader(doc, primary, primaryLight);

    if (logoBuf) {
      try {
        const maxLogoW = 80;
        const maxLogoH = 60;
        // pdfkit sizes from natural if we pass fit
        const logoX = PAGE_W - RIGHT - maxLogoW;
        const logoY = (HEADER_BAND - maxLogoH) / 2;
        doc.image(logoBuf, logoX, logoY, {
          fit: [maxLogoW, maxLogoH],
          align: "right",
          valign: "center",
        });
      } catch {
        // omit logo on decode failure
      }
    }

    doc
      .font("Helvetica-Bold")
      .fontSize(26)
      .fillColor("#ffffff")
      .text(practiceName, LEFT, 32, {
        width: CONTENT_W - (logoBuf ? 100 : 0),
        lineBreak: false,
      });

    if (contact) {
      doc
        .font("Helvetica")
        .fontSize(11)
        .fillColor("#ffffff")
        .text(contact, LEFT, 62, {
          width: CONTENT_W - (logoBuf ? 100 : 0),
          lineBreak: false,
        });
    }

    let y = HEADER_BAND + 30;

    doc
      .font("Helvetica-Bold")
      .fontSize(18)
      .fillColor(primaryHex)
      .text("Personalized Care Plan", LEFT, y);
    y += 28;

    doc
      .font("Helvetica-Bold")
      .fontSize(20)
      .fillColor(darkGray)
      .text(`${firstName} ${lastName}`.trim(), LEFT, y);
    y += 35;

    // --- Services table ---
    const tableX = LEFT;
    const tableW = CONTENT_W;
    const col1 = tableW * 0.5;
    const col2 = tableW * 0.15;
    const col3 = tableW * 0.17;
    const col4 = tableW * 0.18;
    const headerH = 36;
    const rowH = 28;
    const subtotalH = 32;

    const tableTop = y;
    doc.roundedRect(tableX, y, tableW, headerH, 4).fill(primaryHex);
    // square off bottom of rounded header so it meets rows cleanly
    doc.rect(tableX, y + headerH - 4, tableW, 4).fill(primaryHex);

    const headerTextY = y + headerH / 2 - 4;
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#ffffff");
    doc.text("Service Description", tableX + 12, headerTextY, {
      width: col1 - 16,
      lineBreak: false,
    });
    doc.text("Qty", tableX + col1, headerTextY, {
      width: col2,
      align: "center",
      lineBreak: false,
    });
    doc.text("Unit Fee", tableX + col1 + col2, headerTextY, {
      width: col3,
      align: "center",
      lineBreak: false,
    });
    doc.text("Amount", tableX + col1 + col2 + col3, headerTextY, {
      width: col4,
      align: "center",
      lineBreak: false,
    });
    y += headerH;

    if (lineItems.length === 0) {
      doc.rect(tableX, y, tableW, rowH).fill(lightGray);
      doc
        .font("Helvetica")
        .fontSize(11)
        .fillColor(darkGray)
        .text("No treatments selected.", tableX + 12, y + rowH / 2 - 4, {
          lineBreak: false,
        });
      y += rowH;
    } else {
      lineItems.forEach((item, index) => {
        if (index % 2 === 0) {
          doc.rect(tableX, y, tableW, rowH).fill(lightGray);
        }
        const textY = y + rowH / 2 - 4;
        const name =
          item.name + (item.missingFromCatalog ? " (removed from catalog)" : "");
        doc
          .font("Helvetica")
          .fontSize(11)
          .fillColor(darkGray)
          .text(name, tableX + 12, textY, {
            width: col1 - 16,
            lineBreak: false,
            ellipsis: true,
          });
        doc.text(String(item.quantity), tableX + col1, textY, {
          width: col2,
          align: "center",
          lineBreak: false,
        });
        doc.text(item.unitPriceDisplay, tableX + col1 + col2, textY, {
          width: col3,
          align: "center",
          lineBreak: false,
        });
        doc
          .font("Helvetica-Bold")
          .text(item.lineTotalDisplay, tableX + col1 + col2 + col3, textY, {
            width: col4,
            align: "center",
            lineBreak: false,
          });
        y += rowH;
      });
    }

    doc.rect(tableX, y, tableW, subtotalH).fill(primaryLightHex);
    const subY = y + subtotalH / 2 - 5;
    doc
      .font("Helvetica-Bold")
      .fontSize(13)
      .fillColor(primaryHex)
      .text("Total Investment", tableX + 12, subY, { lineBreak: false });
    doc
      .fontSize(14)
      .text(subtotalDisplay, tableX, subY, {
        width: tableW - 12,
        align: "right",
        lineBreak: false,
      });
    y += subtotalH;

    // outer rounded border around whole table
    const tableH = y - tableTop;
    doc
      .lineWidth(1)
      .strokeColor(primaryHex)
      .roundedRect(tableX, tableTop, tableW, tableH, 4)
      .stroke();

    y += 30;

    // --- Payment cards ---
    if (enabledCards.length > 0) {
      y = ensureY(doc, y, 180, 80);
      doc
        .font("Helvetica-Bold")
        .fontSize(14)
        .fillColor(primaryHex)
        .text("Flexible Payment Options", LEFT, y);
      y += 20;

      const boxGap = 12;
      const boxW =
        (CONTENT_W - (enabledCards.length - 1) * boxGap) / enabledCards.length;
      const boxH = 140;
      let boxX = LEFT;

      for (const card of enabledCards) {
        // soft shadow
        doc
          .roundedRect(boxX + 2, y + 2, boxW, boxH, 6)
          .fill("#c8c8c8");
        doc.roundedRect(boxX, y, boxW, boxH, 6).fill("#ffffff");

        const stripeH = 36;
        doc.roundedRect(boxX, y, boxW, stripeH + 6, 6).fill(primaryHex);
        doc.rect(boxX, y + stripeH, boxW, 6).fill(primaryHex);

        doc
          .font("Helvetica-Bold")
          .fontSize(14)
          .fillColor("#ffffff")
          .text(card.name, boxX, y + 12, {
            width: boxW,
            align: "center",
            lineBreak: false,
          });

        let textY = y + stripeH + 28;
        doc
          .font("Helvetica-Bold")
          .fontSize(22)
          .fillColor(primaryHex)
          .text(card.mainAmount, boxX, textY, {
            width: boxW,
            align: "center",
            lineBreak: false,
          });
        textY += 18;
        doc
          .font("Helvetica")
          .fontSize(9)
          .fillColor(mediumGray)
          .text(card.amountLabel, boxX, textY, {
            width: boxW,
            align: "center",
            lineBreak: false,
          });
        textY += 12;
        doc
          .moveTo(boxX + 15, textY)
          .lineTo(boxX + boxW - 15, textY)
          .lineWidth(0.5)
          .strokeColor("#e6e6e6")
          .stroke();
        textY += 10;
        for (const detail of card.details) {
          doc
            .font("Helvetica")
            .fontSize(9)
            .fillColor(mediumGray)
            .text(detail.label, boxX + 15, textY, { lineBreak: false });
          doc
            .font("Helvetica-Bold")
            .fillColor(darkGray)
            .text(detail.value, boxX + 15, textY, {
              width: boxW - 30,
              align: "right",
              lineBreak: false,
            });
          textY += 14;
        }

        doc
          .lineWidth(1.5)
          .strokeColor(primaryHex)
          .roundedRect(boxX, y, boxW, boxH, 6)
          .stroke();

        boxX += boxW + boxGap;
      }
      y += boxH + 30;
    }

    // --- Notes ---
    if (notes && notes.trim()) {
      y = ensureY(doc, y, 80, 80);
      doc
        .font("Helvetica-Bold")
        .fontSize(14)
        .fillColor(primaryHex)
        .text("Notes", LEFT, y);
      y += 18;
      doc.font("Helvetica").fontSize(10).fillColor(darkGray);
      const noteHeight = doc.heightOfString(notes.trim(), { width: CONTENT_W });
      y = ensureY(doc, y, noteHeight + 10, 60);
      doc.text(notes.trim(), LEFT, y, { width: CONTENT_W });
      y = doc.y + 15;
    }

    // --- Agreement ---
    y = ensureY(doc, y, 160, 80);
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor(primaryHex)
      .text("Agreement & Authorization", LEFT, y);
    y += 25;

    doc.font("Helvetica").fontSize(10).fillColor(darkGray);
    const lineW = 200;
    doc.text("I, ", LEFT, y, { continued: false, lineBreak: false });
    doc
      .moveTo(LEFT + 15, y + 2)
      .lineTo(LEFT + lineW, y + 2)
      .lineWidth(0.5)
      .strokeColor(mediumGray)
      .stroke();
    doc.text(
      ", have read and accepted the terms of this agreement",
      LEFT + lineW + 5,
      y,
      { lineBreak: false },
    );

    y += 25;
    doc.text("on this", LEFT, y, { lineBreak: false });
    doc
      .moveTo(LEFT + 40, y + 2)
      .lineTo(LEFT + 100, y + 2)
      .stroke();
    doc.text("day of", LEFT + 105, y, { lineBreak: false });
    doc
      .moveTo(LEFT + 135, y + 2)
      .lineTo(LEFT + 250, y + 2)
      .stroke();
    doc.text(", 20", LEFT + 255, y, { lineBreak: false });
    doc
      .moveTo(LEFT + 275, y + 2)
      .lineTo(LEFT + 310, y + 2)
      .stroke();
    doc.text(".", LEFT + 312, y, { lineBreak: false });

    y += 30;
    doc.text("My plan starts on:", LEFT, y, { lineBreak: false });
    if (paymentSettings.planStartDate) {
      doc
        .font("Helvetica-Bold")
        .text(paymentSettings.planStartDate, LEFT + 90, y, {
          lineBreak: false,
        });
      doc.font("Helvetica");
    }
    doc
      .moveTo(LEFT + 85, y + 2)
      .lineTo(LEFT + 200, y + 2)
      .stroke();
    doc.text("My plan ends on:", LEFT + 250, y, { lineBreak: false });
    if (endDate) {
      doc.font("Helvetica-Bold").text(endDate, LEFT + 340, y, {
        lineBreak: false,
      });
      doc.font("Helvetica");
    }
    doc
      .moveTo(LEFT + 335, y + 2)
      .lineTo(LEFT + 450, y + 2)
      .stroke();

    y += 35;
    doc.text("Client Signature:", LEFT, y, { lineBreak: false });
    doc
      .moveTo(LEFT + 85, y + 2)
      .lineTo(LEFT + 240, y + 2)
      .stroke();
    doc.text("Print Name:", LEFT + 280, y, { lineBreak: false });
    doc
      .moveTo(LEFT + 340, y + 2)
      .lineTo(LEFT + 490, y + 2)
      .stroke();

    y += 30;
    doc.text("Witness Signature:", LEFT, y, { lineBreak: false });
    doc
      .moveTo(LEFT + 95, y + 2)
      .lineTo(LEFT + 300, y + 2)
      .stroke();

    // Mark page 1 footer later; start terms page
    doc.addPage();

    // --- Terms page(s) ---
    const drawTermsTopBar = () => {
      doc.rect(0, 0, PAGE_W, 35).fill(primaryHex);
      doc
        .font("Helvetica-Bold")
        .fontSize(14)
        .fillColor("#ffffff")
        .text(practiceName, LEFT, 12, { lineBreak: false });
    };

    drawTermsTopBar();
    y = 50;

    doc
      .font("Helvetica-Bold")
      .fontSize(18)
      .fillColor(primaryHex)
      .text("Terms of Agreement", 0, y, {
        width: PAGE_W,
        align: "center",
        lineBreak: false,
      });
    const titleW = doc.widthOfString("Terms of Agreement");
    doc
      .moveTo((PAGE_W - titleW) / 2, y + 22)
      .lineTo((PAGE_W + titleW) / 2, y + 22)
      .lineWidth(2)
      .strokeColor(primaryHex)
      .stroke();
    y += 40;

    const termsText = applyPracticeName(terms, practiceName);
    const termsLines = termsText.split("\n");
    // Append initial line like Replit
    termsLines.push("");
    termsLines.push(
      "I agree and understand the conditions of this agreement: _______ (initial)",
    );

    for (const raw of termsLines) {
      const trimmed = raw.trim();
      if (!trimmed) {
        y += 8;
        continue;
      }
      const isHeading = trimmed.startsWith("## ");
      const text = isHeading ? trimmed.slice(3) : trimmed;

      if (isHeading) y += 8;

      doc
        .font(isHeading ? "Helvetica-Bold" : "Helvetica")
        .fontSize(9)
        .fillColor(isHeading ? primaryHex : darkGray);

      const h = doc.heightOfString(text, { width: CONTENT_W });
      if (y + h > PAGE_H - 55) {
        doc.addPage();
        drawTermsTopBar();
        y = 55;
        doc
          .font(isHeading ? "Helvetica-Bold" : "Helvetica")
          .fontSize(9)
          .fillColor(isHeading ? primaryHex : darkGray);
      }
      doc.text(text, LEFT, y, { width: CONTENT_W });
      y = doc.y + (isHeading ? 2 : 0);
    }

    // Compliance footer at end of terms
    y = Math.max(y + 16, doc.y + 16);
    if (y > PAGE_H - 70) {
      doc.addPage();
      drawTermsTopBar();
      y = 55;
    }
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#64748b")
      .text(CARE_PLAN_PDF_COMPLIANCE_FOOTER, LEFT, y, { width: CONTENT_W });

    // --- Footers on all pages (disable bottom margin so text does not spawn pages) ---
    const range = doc.bufferedPageRange();
    const pageCount = range.count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(range.start + i);
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const footerY = PAGE_H - 36;
      doc
        .moveTo(LEFT, footerY - 10)
        .lineTo(PAGE_W - RIGHT, footerY - 10)
        .lineWidth(1)
        .strokeColor(primaryHex)
        .stroke();
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(mediumGray)
        .text(practiceName, LEFT, footerY, {
          width: CONTENT_W / 2,
          lineBreak: false,
          ellipsis: true,
        });
      doc.text(`Page ${i + 1} of ${pageCount}`, LEFT, footerY, {
        width: CONTENT_W,
        align: "center",
        lineBreak: false,
      });
      doc.page.margins.bottom = savedBottom;
    }


    doc.end();
  });
}
