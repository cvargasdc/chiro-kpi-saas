import { describe, expect, it } from "vitest";
import {
  activityDate,
  buildReferralLeaderboard,
  conversionPercent,
  filterPatients,
  periodFunnel,
} from "@shared/patients";

function row(partial: {
  name?: string;
  patientType: "new" | "wellness";
  converted?: boolean;
  referralSource?: string | null;
  day1Date?: string | null;
  createdAt?: Date;
}) {
  return {
    name: partial.name ?? "P",
    email: null as string | null,
    phone: null as string | null,
    condition: null as string | null,
    patientType: partial.patientType,
    converted: partial.converted ?? false,
    referralSource: partial.referralSource ?? null,
    day1Date: partial.day1Date ?? null,
    createdAt: partial.createdAt ?? new Date("2026-09-01T00:00:00.000Z"),
  };
}

describe("conversion math", () => {
  it("is converted / new and null when the denominator is 0", () => {
    expect(conversionPercent(1, 2)).toBe(50);
    expect(conversionPercent(2, 3)).toBe(66.7);
    expect(conversionPercent(0, 4)).toBe(0);
    expect(conversionPercent(1, 0)).toBeNull();
  });

  it("uses day1Date when present, otherwise createdAt UTC date", () => {
    expect(
      activityDate({
        day1Date: "2026-09-10",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
      }),
    ).toBe("2026-09-10");
    expect(
      activityDate({
        day1Date: null,
        createdAt: new Date("2026-09-16T12:00:00.000Z"),
      }),
    ).toBe("2026-09-16");
  });

  it("period funnel excludes wellness from conversion and counts by activity date", () => {
    const rows = [
      row({ patientType: "new", converted: true, day1Date: "2026-09-15" }),
      row({ patientType: "new", converted: false, day1Date: "2026-09-16" }),
      row({ patientType: "new", converted: true, day1Date: "2026-08-01" }),
      row({ patientType: "wellness", converted: true, day1Date: "2026-09-16" }),
    ];
    const current = periodFunnel(rows, "2026-09-14", "2026-09-16");
    expect(current.newCount).toBe(2);
    expect(current.convertedCount).toBe(1);
    expect(current.wellnessCount).toBe(1);
    expect(current.conversionPercent).toBe(50);
    expect(current.emptyState).toBe("has_data");
  });

  it("leaderboard groups by referral source and ranks by new count", () => {
    const rows = [
      row({
        patientType: "new",
        converted: true,
        referralSource: "Google",
        day1Date: "2026-09-15",
      }),
      row({
        patientType: "new",
        converted: false,
        referralSource: "Google",
        day1Date: "2026-09-16",
      }),
      row({
        patientType: "new",
        converted: false,
        referralSource: "Facebook",
        day1Date: "2026-09-16",
      }),
      row({
        patientType: "wellness",
        referralSource: "Google",
        day1Date: "2026-09-16",
      }),
      row({
        patientType: "new",
        converted: true,
        referralSource: null,
        day1Date: "2026-09-14",
      }),
    ];
    const board = buildReferralLeaderboard(rows, "2026-09-14", "2026-09-16");
    expect(board.map((r) => r.referralSource)).toEqual([
      "Google",
      "Unspecified",
      "Facebook",
    ]);
    expect(board[0]).toMatchObject({
      referralSource: "Google",
      newCount: 2,
      convertedCount: 1,
      wellnessCount: 1,
      conversionPercent: 50,
    });
    expect(board[1]).toMatchObject({
      referralSource: "Unspecified",
      newCount: 1,
      convertedCount: 1,
      conversionPercent: 100,
    });
    expect(board[2]).toMatchObject({
      referralSource: "Facebook",
      newCount: 1,
      convertedCount: 0,
      conversionPercent: 0,
    });
  });

  it("filters by type, month, search, and unspecified referral", () => {
    const rows = [
      row({
        name: "Alice",
        patientType: "new",
        referralSource: "Google",
        day1Date: "2026-09-10",
      }),
      row({
        name: "Bob",
        patientType: "wellness",
        referralSource: null,
        day1Date: "2026-08-10",
      }),
    ];
    expect(filterPatients(rows, { type: "new" }).map((p) => p.name)).toEqual([
      "Alice",
    ]);
    expect(filterPatients(rows, { month: "2026-08" }).map((p) => p.name)).toEqual([
      "Bob",
    ]);
    expect(filterPatients(rows, { q: "ali" }).map((p) => p.name)).toEqual([
      "Alice",
    ]);
    expect(
      filterPatients(rows, { referralSource: "Unspecified" }).map((p) => p.name),
    ).toEqual(["Bob"]);
  });
});
