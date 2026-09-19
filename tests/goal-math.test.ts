import { describe, expect, it } from "vitest";
import {
  computeGoalProgress,
  deriveGoalStatus,
  elapsedGoalDays,
  expectedProgress,
  formatCount,
  formatUsdCompact,
  formatUsdFull,
  isBehindPace,
  isBelowTargetPace,
  progressPercent,
  remainingGoalDays,
  sumGoalCurrentFromStats,
} from "../shared/goals";

describe("linear expected progress", () => {
  it("uses target * (elapsedDays / totalDays)", () => {
    expect(expectedProgress(300, 16, 30)).toBe(160);
    expect(expectedProgress(100, 0, 10)).toBe(0);
    expect(expectedProgress(100, 10, 10)).toBe(100);
    expect(expectedProgress(100, 1, 10)).toBe(10);
  });

  it("counts elapsed days inclusively and clamps to the window", () => {
    expect(elapsedGoalDays("2026-09-01", "2026-09-30", "2026-09-16")).toBe(16);
    expect(elapsedGoalDays("2026-09-01", "2026-09-30", "2026-08-31")).toBe(0);
    expect(elapsedGoalDays("2026-09-01", "2026-09-30", "2026-10-01")).toBe(30);
    expect(remainingGoalDays("2026-09-30", "2026-09-16")).toBe(15);
    expect(remainingGoalDays("2026-09-15", "2026-09-16")).toBe(0);
  });
});

describe("progress percent", () => {
  it("rounds (current / target) * 100 and may exceed 100", () => {
    expect(progressPercent(50, 100)).toBe(50);
    expect(progressPercent(0, 100)).toBe(0);
    expect(progressPercent(150, 100)).toBe(150);
    expect(progressPercent(1, 3)).toBe(33);
  });
});

describe("status derivation", () => {
  const window = {
    startDate: "2026-09-10",
    endDate: "2026-09-19",
    today: "2026-09-16",
    targetValue: 100,
  };
  // totalDays = 10, elapsedDays = 7, midpoint passed
  // behind: current < 60; below: current < 52.5

  it("marks Achieved when current >= target, even after endDate", () => {
    expect(
      deriveGoalStatus({ ...window, currentValue: 100 }),
    ).toBe("achieved");
    expect(
      deriveGoalStatus({
        ...window,
        today: "2026-09-30",
        currentValue: 100,
      }),
    ).toBe("achieved");
  });

  it("marks Expired when the window ended without hitting the target", () => {
    expect(
      deriveGoalStatus({
        ...window,
        today: "2026-09-20",
        currentValue: 80,
      }),
    ).toBe("expired");
  });

  it("marks Below Target past midpoint when current < 75% of expected", () => {
    expect(isBelowTargetPace(50, 100, 7, 10)).toBe(true);
    expect(
      deriveGoalStatus({ ...window, currentValue: 50 }),
    ).toBe("below_target");
  });

  it("marks Behind Pace when more than one day behind linear expected", () => {
    expect(isBehindPace(55, 100, 7, 10)).toBe(true);
    expect(isBelowTargetPace(55, 100, 7, 10)).toBe(false);
    expect(
      deriveGoalStatus({ ...window, currentValue: 55 }),
    ).toBe("behind_pace");
  });

  it("marks On Pace when current is within a day of expected (or ahead, not yet achieved)", () => {
    expect(
      deriveGoalStatus({ ...window, currentValue: 70 }),
    ).toBe("on_pace");
    expect(
      deriveGoalStatus({ ...window, currentValue: 90 }),
    ).toBe("on_pace");
  });

  it("is On Pace on day 1 even with zero current (one-day grace)", () => {
    expect(
      deriveGoalStatus({
        startDate: "2026-09-16",
        endDate: "2026-09-30",
        today: "2026-09-16",
        targetValue: 100,
        currentValue: 0,
      }),
    ).toBe("on_pace");
    expect(isBehindPace(0, 100, 1, 15)).toBe(false);
  });

  it("is On Pace before the start date", () => {
    expect(
      deriveGoalStatus({
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        today: "2026-09-16",
        targetValue: 100,
        currentValue: 0,
      }),
    ).toBe("on_pace");
  });

  it("returns labels and expected from computeGoalProgress", () => {
    const progress = computeGoalProgress({
      ...window,
      currentValue: 70,
    });
    expect(progress.status).toBe("on_pace");
    expect(progress.statusLabel).toBe("On Pace");
    expect(progress.totalDays).toBe(10);
    expect(progress.elapsedDays).toBe(7);
    expect(progress.expectedValue).toBe(70);
    expect(progress.progressPercent).toBe(70);
    expect(progress.daysRemaining).toBe(4);
    expect(progress.pastMidpoint).toBe(true);
  });
});

describe("money display", () => {
  it("uses $70K compact style at $10k+ and never emits $180000", () => {
    expect(formatUsdCompact(7_000_000)).toBe("$70K");
    expect(formatUsdCompact(18_000_000)).toBe("$180K");
    expect(formatUsdCompact(150_000_000)).toBe("$1.5M");
    expect(formatUsdCompact(1_000_000)).toBe("$10K");
    expect(formatUsdCompact(180_000)).toBe("$1,800.00");
    expect(formatUsdCompact(7_000_000)).not.toBe("$70000");
    expect(formatUsdFull(18_000_000)).toBe("$180,000.00");
    expect(formatUsdFull(18_000_000)).not.toBe("$180000");
    expect(formatCount(1200)).toBe("1,200");
  });
});

describe("daily_stats current", () => {
  it("sums inclusive start..min(today, end) and ignores other days", () => {
    const rows = [
      { date: "2026-08-31", visits: 9, revenueCents: 900 },
      { date: "2026-09-01", visits: 2, revenueCents: 200 },
      { date: "2026-09-16", visits: 3, revenueCents: 300 },
      { date: "2026-09-17", visits: 4, revenueCents: 400 },
      { date: "2026-10-01", visits: 8, revenueCents: 800 },
    ];
    expect(
      sumGoalCurrentFromStats("visits", "2026-09-01", "2026-09-30", "2026-09-16", rows),
    ).toBe(5);
    expect(
      sumGoalCurrentFromStats("revenue", "2026-09-01", "2026-09-30", "2026-09-16", rows),
    ).toBe(500);
    expect(
      sumGoalCurrentFromStats("custom", "2026-09-01", "2026-09-30", "2026-09-16", rows),
    ).toBe(0);
  });
});
