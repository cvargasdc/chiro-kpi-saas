import { describe, expect, it } from "vitest";
import {
  buildDay2PatchPayload,
  buildPatientCreatePayload,
  mapReplitCareAnswer,
  type WizardPatientDraft,
} from "../client/src/lib/dailyStatsMapping";

describe("mapReplitCareAnswer", () => {
  it("maps yes → in_care + converted", () => {
    expect(mapReplitCareAnswer("yes")).toEqual({
      careStatus: "in_care",
      converted: true,
    });
  });

  it("maps no → lost", () => {
    expect(mapReplitCareAnswer("no")).toEqual({
      careStatus: "lost",
      converted: false,
    });
  });

  it("maps followup → new (pending)", () => {
    expect(mapReplitCareAnswer("followup")).toEqual({
      careStatus: "new",
      converted: false,
    });
  });
});

describe("buildPatientCreatePayload", () => {
  const base: WizardPatientDraft = {
    name: "Alex Example",
    patientType: "new",
    appointmentType: "day1",
    referralSource: "Google",
    careAnswer: null,
    priorPatientId: null,
  };

  it("creates day1 new patient with careStatus=new", () => {
    expect(buildPatientCreatePayload(base, "2026-09-22")).toEqual({
      name: "Alex Example",
      patientType: "new",
      referralSource: "Google",
      day1Date: "2026-09-22",
      day2Date: null,
      careStatus: "new",
      converted: false,
      conversionDate: null,
    });
  });

  it("creates wellness with yes → wellness + converted", () => {
    const entry: WizardPatientDraft = {
      ...base,
      patientType: "wellness",
      careAnswer: "yes",
    };
    expect(buildPatientCreatePayload(entry, "2026-09-22")).toMatchObject({
      patientType: "wellness",
      day1Date: "2026-09-22",
      careStatus: "wellness",
      converted: true,
      conversionDate: "2026-09-22",
    });
  });

  it("creates unlinked day2 with care answer", () => {
    const entry: WizardPatientDraft = {
      ...base,
      appointmentType: "day2",
      careAnswer: "yes",
    };
    expect(buildPatientCreatePayload(entry, "2026-09-22")).toMatchObject({
      day1Date: null,
      day2Date: "2026-09-22",
      careStatus: "in_care",
      converted: true,
    });
  });
});

describe("buildDay2PatchPayload", () => {
  it("patches linked day2 with lost on no", () => {
    expect(buildDay2PatchPayload("no", "2026-09-22")).toEqual({
      day2Date: "2026-09-22",
      careStatus: "lost",
      converted: false,
      conversionDate: null,
    });
  });
});
