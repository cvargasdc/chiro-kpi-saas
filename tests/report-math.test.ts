import { describe, expect, it } from "vitest";
import {
  buildTrendSeries,
  rangesOverlap,
  resolveReportPeriod,
  resolveTrendGrain,
  startOfQuarter,
  startOfYear,
} from "../shared/reports";

const TODAY = "2026-09-16";

describe("report period windows", () => {
  it("weekly matches dashboard this_week (Monday–today, equal-length prior)", () => {
    const window = resolveReportPeriod({ period: "weekly", today: TODAY });
    expect(window.from).toBe("2026-09-14");
    expect(window.to).toBe("2026-09-16");
    expect(window.dayCount).toBe(3);
    expect(window.previousFrom).toBe("2026-09-11");
    expect(window.previousTo).toBe("2026-09-13");
    expect(window.comparisonLabel).toContain("3-day");
  });

  it("monthly is 1st–today, not the previous calendar month", () => {
    const window = resolveReportPeriod({ period: "monthly", today: TODAY });
    expect(window.from).toBe("2026-09-01");
    expect(window.to).toBe("2026-09-16");
    expect(window.dayCount).toBe(16);
    expect(window.previousFrom).toBe("2026-08-16");
    expect(window.previousTo).toBe("2026-08-31");
  });

  it("quarterly and annual start at the UTC calendar boundary through today", () => {
    expect(startOfQuarter(TODAY)).toBe("2026-07-01");
    expect(startOfYear(TODAY)).toBe("2026-01-01");
    const q = resolveReportPeriod({ period: "quarterly", today: TODAY });
    expect(q.from).toBe("2026-07-01");
    expect(q.to).toBe(TODAY);
    expect(q.dayCount).toBe(78);
    expect(q.previousTo).toBe("2026-06-30");
    const year = resolveReportPeriod({ period: "annual", today: TODAY });
    expect(year.from).toBe("2026-01-01");
    expect(year.dayCount).toBe(259);
  });

  it("custom requires a valid inclusive range", () => {
    expect(() =>
      resolveReportPeriod({ period: "custom", today: TODAY }),
    ).toThrow(/custom_range_required/);
    expect(() =>
      resolveReportPeriod({
        period: "custom",
        today: TODAY,
        from: "2026-09-16",
        to: "2026-09-01",
      }),
    ).toThrow(/from_after_to/);
  });
});

describe("trend series", () => {
  it("fills missing days with zeros on a short window", () => {
    const points = buildTrendSeries(
      [
        { date: "2026-09-14", visits: 2, revenueCents: 2000 },
        { date: "2026-09-16", visits: 4, revenueCents: 4000 },
      ],
      "2026-09-14",
      "2026-09-16",
      "day",
    );
    expect(points.map((p) => p.key)).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
    ]);
    expect(points[1].visits).toBe(0);
    expect(points[2].revenue).toBe(40);
  });

  it("groups by ISO week and marks partial first/last weeks", () => {
    expect(resolveTrendGrain(16)).toBe("day");
    expect(resolveTrendGrain(46)).toBe("week");
    const points = buildTrendSeries(
      [
        { date: "2026-07-01", visits: 3, revenueCents: 300 },
        { date: "2026-07-06", visits: 1, revenueCents: 100 },
      ],
      "2026-07-01",
      "2026-07-12",
      "week",
    );
    expect(points[0].from).toBe("2026-07-01");
    expect(points[0].to).toBe("2026-07-05");
    expect(points[0].partial).toBe(true);
    expect(points[0].visits).toBe(3);
    expect(points[1].from).toBe("2026-07-06");
    expect(points[1].to).toBe("2026-07-12");
    expect(points[1].visits).toBe(1);
    expect(points[1].partial).toBe(false);
  });
});

describe("goal overlap", () => {
  it("treats inclusive date windows as overlapping", () => {
    expect(rangesOverlap("2026-09-01", "2026-09-30", "2026-09-14", "2026-09-16")).toBe(
      true,
    );
    expect(rangesOverlap("2026-08-01", "2026-08-31", "2026-09-14", "2026-09-16")).toBe(
      false,
    );
    expect(rangesOverlap("2026-09-16", "2026-09-20", "2026-09-14", "2026-09-16")).toBe(
      true,
    );
  });
});
