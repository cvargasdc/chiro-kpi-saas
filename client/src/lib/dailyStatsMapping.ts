/**
 * Helpers for the Enter Daily Stats wizard.
 * Maps Replit-style yes/no/followup answers onto Path B CARE_STATUSES.
 */
import type { CareStatus, PatientType } from "@shared/patients";

export type ReplitCareAnswer = "yes" | "no" | "followup";

export type DayAppointment = "day1" | "day2";

export type WizardPatientDraft = {
  name: string;
  patientType: PatientType;
  appointmentType: DayAppointment;
  referralSource: string;
  careAnswer: ReplitCareAnswer | null;
  priorPatientId: string | null;
};

export type MappedCare = {
  careStatus: CareStatus;
  converted: boolean;
};

/** Replit yes→in_care+converted, no→lost, followup→new (pending decision). */
export function mapReplitCareAnswer(answer: ReplitCareAnswer): MappedCare {
  switch (answer) {
    case "yes":
      return { careStatus: "in_care", converted: true };
    case "no":
      return { careStatus: "lost", converted: false };
    case "followup":
      return { careStatus: "new", converted: false };
  }
}

export type PatientWritePayload = {
  name: string;
  patientType: PatientType;
  referralSource: string | null;
  day1Date: string | null;
  day2Date: string | null;
  careStatus: CareStatus;
  converted: boolean;
  conversionDate?: string | null;
};

/**
 * Build POST /api/patients body for a day1 / wellness create
 * (Day 2 linked updates use PATCH separately).
 */
export function buildPatientCreatePayload(
  entry: WizardPatientDraft,
  dateStr: string,
): PatientWritePayload {
  const referral = entry.referralSource.trim() || null;

  if (entry.patientType === "wellness") {
    const care = entry.careAnswer
      ? mapReplitCareAnswer(entry.careAnswer)
      : { careStatus: "wellness" as CareStatus, converted: false };
    return {
      name: entry.name.trim(),
      patientType: "wellness",
      referralSource: referral,
      day1Date: dateStr,
      day2Date: null,
      careStatus: care.careStatus === "in_care" ? "wellness" : care.careStatus,
      converted: care.converted,
      conversionDate: care.converted ? dateStr : null,
    };
  }

  // Day 1 new patient — care decision typically happens on Day 2
  if (entry.appointmentType === "day1") {
    return {
      name: entry.name.trim(),
      patientType: "new",
      referralSource: referral,
      day1Date: dateStr,
      day2Date: null,
      careStatus: "new",
      converted: false,
      conversionDate: null,
    };
  }

  // Day 2 without prior link — create with day2Date only
  const care = entry.careAnswer
    ? mapReplitCareAnswer(entry.careAnswer)
    : { careStatus: "new" as CareStatus, converted: false };
  return {
    name: entry.name.trim(),
    patientType: "new",
    referralSource: referral,
    day1Date: null,
    day2Date: dateStr,
    careStatus: care.careStatus,
    converted: care.converted,
    conversionDate: care.converted ? dateStr : null,
  };
}

export type PatientPatchPayload = {
  day2Date: string;
  careStatus: CareStatus;
  converted: boolean;
  conversionDate: string | null;
};

export function buildDay2PatchPayload(
  careAnswer: ReplitCareAnswer,
  dateStr: string,
): PatientPatchPayload {
  const care = mapReplitCareAnswer(careAnswer);
  return {
    day2Date: dateStr,
    careStatus: care.careStatus,
    converted: care.converted,
    conversionDate: care.converted ? dateStr : null,
  };
}

export function emptyPatientDraft(): WizardPatientDraft {
  return {
    name: "",
    patientType: "new",
    appointmentType: "day1",
    referralSource: "",
    careAnswer: null,
    priorPatientId: null,
  };
}

export function localTodayYmd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
