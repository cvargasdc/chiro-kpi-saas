import { createRequire } from "node:module";
import type { ReportPreview } from "./preview";

const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit") as typeof import("pdfkit");

type PdfDoc = InstanceType<typeof PDFDocument>;

function money(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function changeLabel(value: number | null | undefined): string {
  if (value == null) return "No baseline";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}%`;
}

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

function kpiLine(
  doc: PdfDoc,
  label: string,
  value: string,
  extra?: string,
): void {
  ensureSpace(doc, 18);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827").text(label, {
    continued: true,
  });
  doc.font("Helvetica").text(`  ${value}${extra ? `  ·  ${extra}` : ""}`);
}

export function renderReportPdf(opts: {
  practiceName: string;
  preview: ReportPreview;
}): Promise<Buffer> {
  const { practiceName, preview } = opts;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 50,
      info: {
        Title: `Chiro-KPI report ${preview.period.from} to ${preview.period.to}`,
        Author: "Chiro-KPI",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(16).fillColor("#163a5c").text("Practice report");
    doc.font("Helvetica").fontSize(11).fillColor("#334155").text(practiceName);
    doc.moveDown(0.3);
    line(doc, `${preview.period.label}  (${preview.period.from} – ${preview.period.to})`);
    line(
      doc,
      `Compared with ${preview.comparisonLabel.toLowerCase()} (${preview.previousFrom} – ${preview.previousTo}).`,
    );
    line(doc, preview.comparisonDefinition);
    if (preview.emptyStateCopy) {
      line(doc, preview.emptyStateCopy);
    }

    heading(doc, "KPIs");
    kpiLine(
      doc,
      "Patient visits",
      String(preview.kpis.visits.value),
      changeLabel(preview.kpis.visits.percentChange),
    );
    kpiLine(
      doc,
      "Revenue",
      money(preview.kpis.revenue.value),
      changeLabel(preview.kpis.revenue.percentChange),
    );
    kpiLine(
      doc,
      "Office visit average",
      preview.kpis.officeVisitAverage.value == null
        ? "—"
        : money(preview.kpis.officeVisitAverage.value),
      preview.kpis.officeVisitAverage.value == null
        ? preview.kpis.officeVisitAverage.explanation
        : changeLabel(preview.kpis.officeVisitAverage.percentChange),
    );
    if (preview.kpis.newPatients.available) {
      kpiLine(
        doc,
        "New patients",
        String(preview.kpis.newPatients.value),
        changeLabel(preview.kpis.newPatients.percentChange),
      );
    } else {
      kpiLine(doc, "New patients", "Not available", preview.kpis.newPatients.reason);
    }
    if (preview.kpis.conversion.available) {
      const rate =
        preview.kpis.conversion.value == null
          ? "—"
          : `${preview.kpis.conversion.value}%`;
      kpiLine(
        doc,
        "New conversion",
        rate,
        preview.kpis.conversion.newCount === 0
          ? "No new patients in this period"
          : `${preview.kpis.conversion.convertedCount} of ${preview.kpis.conversion.newCount} new`,
      );
    } else {
      kpiLine(doc, "New conversion", "Not available", preview.kpis.conversion.reason);
    }

    if (preview.anomalies.revenueWithoutVisits.length > 0) {
      heading(doc, "Anomalies");
      line(
        doc,
        `${preview.anomalies.revenueWithoutVisits.length} day(s) with revenue and zero visits.`,
      );
      for (const row of preview.anomalies.revenueWithoutVisits) {
        line(doc, `${row.date}: ${money(row.revenue)} revenue, 0 visits`);
      }
    }

    heading(doc, "Goals overlapping this period");
    if (preview.goals.emptyState === "no_goals") {
      line(doc, "No goals overlap this report window.");
    } else {
      line(
        doc,
        `${preview.goals.counts.total} goal(s): ${preview.goals.counts.achieved} achieved, ${preview.goals.counts.onPace} on pace, ${preview.goals.counts.behindPace} behind pace, ${preview.goals.counts.belowTarget} below target, ${preview.goals.counts.expired} expired.`,
      );
      for (const goal of preview.goals.items) {
        line(
          doc,
          `${goal.name} — ${goal.statusLabel} · ${goal.currentDisplay} of ${goal.targetDisplay} (${goal.progressPercent}%) · ${goal.startDate}–${goal.endDate}`,
        );
      }
    }

    heading(doc, "Referral sources");
    if (preview.referrals.emptyState === "no_entries") {
      line(doc, "No new or wellness patients in this period.");
    } else {
      line(doc, preview.referrals.formula);
      for (const row of preview.referrals.rows) {
        const rate =
          row.conversionPercent == null ? "—" : `${row.conversionPercent}%`;
        line(
          doc,
          `${row.referralSource}: ${row.newCount} new, ${row.convertedCount} converted (${rate}), ${row.wellnessCount} wellness`,
        );
      }
    }

    heading(doc, `Trend (${preview.trend.grain})`);
    line(doc, preview.trend.grainReason);
    if (preview.trend.emptyState === "no_entries") {
      line(doc, "No daily-log rows in this period.");
    } else if (preview.trend.emptyState === "zeros_recorded") {
      line(doc, "Days were logged, but visits and revenue are all zero.");
    }
    const points = preview.trend.points;
    const maxRows = 40;
    const shown = points.slice(0, maxRows);
    for (const point of shown) {
      line(
        doc,
        `${point.label}: ${point.visits} visits, ${money(point.revenue)}${
          point.partial ? " (partial week)" : ""
        }`,
      );
    }
    if (points.length > maxRows) {
      line(doc, `… ${points.length - maxRows} additional ${preview.trend.grain} rows omitted.`);
    }

    doc.moveDown(1);
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#64748b")
      .text(
        "Generated by Chiro-KPI. Aggregates only — no patient names. Not emailed in this release.",
      );

    doc.end();
  });
}
