import { describe, expect, it } from "vitest";
import {
  addDays,
  centsToDollars,
  dollarsToCents,
  inclusiveDayCount,
  isRevenueWithoutVisits,
  isValidYmd,
  officeVisitAverage,
  percentChange,
  periodEmptyState,
  resolvePeriod,
  roundPercent,
  startOfIsoWeekMonday,
  toYmd,
} from "../shared/kpis";

describe("date helpers", () => {
  it("accepts real calendar days and rejects 2026-02-29", () => {
    expect(isValidYmd("2026-09-16")).toBe(true);
    expect(isValidYmd("2026-02-29")).toBe(false);
    expect(isValidYmd("2026-13-01")).toBe(false);
    expect(isValidYmd("today")).toBe(false);
  });

  it("uses UTC calendar dates", () => {
    expect(toYmd(new Date("2026-09-16T12:00:00.000Z"))).toBe("2026-09-16");
    expect(toYmd(new Date("2026-09-16T00:00:00.000Z"))).toBe("2026-09-16");
  });

  it("starts the week on Monday", () => {
    expect(startOfIsoWeekMonday("2026-09-16")).toBe("2026-09-14"); // Wednesday
    expect(startOfIsoWeekMonday("2026-09-13")).toBe("2026-09-07"); // Sunday
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
    expect(inclusiveDayCount("2026-09-14", "2026-09-16")).toBe(3);
  });
});

describe("money + OVA", () => {
  it("rounds dollars to integer cents", () => {
    expect(dollarsToCents(19.99)).toBe(1999);
    expect(dollarsToCents(10.005)).toBe(1001);
    expect(centsToDollars(15050)).toBe(150.5);
  });

  it("OVA is revenue/visits when visits > 0, else null", () => {
    expect(officeVisitAverage(10_000, 4)).toBe(25);
    expect(officeVisitAverage(15050, 10)).toBe(15.05);
    expect(officeVisitAverage(5000, 0)).toBeNull();
    expect(officeVisitAverage(0, 0)).toBeNull();
    expect(officeVisitAverage(0, 5)).toBe(0);
  });
});

describe("percent change", () => {
  it("uses ((current - previous) / previous) * 100", () => {
    expect(percentChange(20, 10)).toBe(100);
    expect(percentChange(8, 10)).toBe(-20);
    expect(roundPercent(percentChange(11, 10))).toBe(10);
  });

  it("returns null when previous is 0 (no invented +100%)", () => {
    expect(percentChange(0, 0)).toBeNull();
    expect(percentChange(25, 0)).toBeNull();
  });
});

describe("empty states", () => {
  it("distinguishes no rows from zeros recorded", () => {
    expect(periodEmptyState([])).toBe("no_entries");
    expect(periodEmptyState([{ visits: 0, revenueCents: 0 }])).toBe("zeros_recorded");
    expect(
      periodEmptyState([
        { visits: 0, revenueCents: 0 },
        { visits: 3, revenueCents: 0 },
      ]),
    ).toBe("has_data");
  });
});

describe("period windows", () => {
  it("this_week is Monday through today, previous is the equal-length window before", () => {
    const window = resolvePeriod({
      period: "this_week",
      today: "2026-09-16",
    });
    expect(window.from).toBe("2026-09-14");
    expect(window.to).toBe("2026-09-16");
    expect(window.dayCount).toBe(3);
    expect(window.previousFrom).toBe("2026-09-11");
    expect(window.previousTo).toBe("2026-09-13");
    expect(window.comparisonLabel).toBe("Previous 3-day period");
  });

  it("this_month is the 1st through today", () => {
    const window = resolvePeriod({
      period: "this_month",
      today: "2026-09-16",
    });
    expect(window.from).toBe("2026-09-01");
    expect(window.to).toBe("2026-09-16");
    expect(window.dayCount).toBe(16);
    expect(window.previousFrom).toBe("2026-08-16");
    expect(window.previousTo).toBe("2026-08-31");
  });

  it("custom uses the equal-length previous window", () => {
    const window = resolvePeriod({
      period: "custom",
      today: "2026-09-16",
      from: "2026-09-01",
      to: "2026-09-07",
    });
    expect(window.previousFrom).toBe("2026-08-25");
    expect(window.previousTo).toBe("2026-08-31");
  });
});

describe("anomaly", () => {
  it("flags revenue without visits", () => {
    expect(isRevenueWithoutVisits(0, 100)).toBe(true);
    expect(isRevenueWithoutVisits(1, 100)).toBe(false);
    expect(isRevenueWithoutVisits(0, 0)).toBe(false);
  });
});
