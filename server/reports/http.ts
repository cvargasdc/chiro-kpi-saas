import type { Express, Request } from "express";
import { PeriodRangeError, toYmd } from "@shared/kpis";
import {
  isReportPeriodKey,
  resolveReportPeriod,
  type ReportPeriodKey,
} from "@shared/reports";
import { PHI_READ_ROLES } from "@shared/roles";
import { logAudit } from "../audit/logAudit";
import {
  authenticate,
  getClientIp,
  requirePracticeMembership,
  requireRole,
} from "../auth/middleware";
import type { HttpContext } from "../http-context";
import { renderReportPdf } from "./pdf";
import { buildReportPreview, statsRange } from "./preview";

async function loadPreview(opts: {
  ctx: HttpContext;
  orgId: string;
  practiceId: string;
  period: ReportPeriodKey;
  from?: string;
  to?: string;
}) {
  const today = toYmd(opts.ctx.now());
  const window = resolveReportPeriod({
    period: opts.period,
    today,
    from: opts.from,
    to: opts.to,
  });
  const scope = { orgId: opts.orgId, practiceId: opts.practiceId };
  const [current, previous, patients, goals] = await Promise.all([
    opts.ctx.storage.listDailyStats(scope, { from: window.from, to: window.to }),
    opts.ctx.storage.listDailyStats(scope, {
      from: window.previousFrom,
      to: window.previousTo,
    }),
    opts.ctx.storage.listPatients(scope),
    opts.ctx.storage.listGoals(scope),
  ]);
  const overlapping = goals.filter(
    (row) => row.startDate <= window.to && row.endDate >= window.from,
  );
  const range = statsRange(overlapping);
  const goalStats =
    overlapping.length === 0
      ? []
      : await opts.ctx.storage.listDailyStats(scope, range);
  const preview = buildReportPreview({
    today,
    window,
    current,
    previous,
    patients,
    goals,
    goalStats,
  });
  return { window, current, preview };
}

function parsePeriod(req: Request): {
  ok: true;
  period: ReportPeriodKey;
  from?: string;
  to?: string;
} | { ok: false; error: string } {
  const raw = typeof req.query.period === "string" ? req.query.period : "weekly";
  if (!isReportPeriodKey(raw)) {
    return { ok: false, error: "invalid_period" };
  }
  return {
    ok: true,
    period: raw,
    from: typeof req.query.from === "string" ? req.query.from : undefined,
    to: typeof req.query.to === "string" ? req.query.to : undefined,
  };
}

export function registerReportRoutes(app: Express, ctx: HttpContext): void {
  const storage = ctx.storage;
  const auth = authenticate(storage);
  const practiceGate = requirePracticeMembership(storage);

  app.get(
    "/api/reports/preview",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const parsed = parsePeriod(req);
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
      }
      let loaded;
      try {
        const tenant = req.tenant!;
        loaded = await loadPreview({
          ctx,
          orgId: tenant.orgId,
          practiceId: tenant.practiceId,
          period: parsed.period,
          from: parsed.from,
          to: parsed.to,
        });
      } catch (err) {
        if (err instanceof PeriodRangeError) {
          return res.status(400).json({ error: err.message });
        }
        throw err;
      }

      const tenant = req.tenant!;
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "list",
        resourceType: "report",
        metadata: {
          period: loaded.window.key,
          from: loaded.window.from,
          to: loaded.window.to,
          dailyLogCount: loaded.current.length,
        },
        ipAddress: getClientIp(req),
      });

      res.json(loaded.preview);
    },
  );

  app.get(
    "/api/reports/export.pdf",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const parsed = parsePeriod(req);
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
      }
      let loaded;
      try {
        const tenant = req.tenant!;
        loaded = await loadPreview({
          ctx,
          orgId: tenant.orgId,
          practiceId: tenant.practiceId,
          period: parsed.period,
          from: parsed.from,
          to: parsed.to,
        });
      } catch (err) {
        if (err instanceof PeriodRangeError) {
          return res.status(400).json({ error: err.message });
        }
        throw err;
      }

      const tenant = req.tenant!;
      const practice = await storage.getPractice(tenant.practiceId);
      const pdf = await renderReportPdf({
        practiceName: practice?.name ?? "Practice",
        preview: loaded.preview,
      });

      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "export",
        resourceType: "report",
        metadata: {
          period: loaded.window.key,
          from: loaded.window.from,
          to: loaded.window.to,
          format: "pdf",
          bytes: pdf.length,
        },
        ipAddress: getClientIp(req),
      });

      const filename = `chiro-kpi-report-${loaded.window.from}-to-${loaded.window.to}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", String(pdf.length));
      res.send(pdf);
    },
  );
}
