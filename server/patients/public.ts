import {
  UNOBSERVED_ONBOARDING,
  type PatientOnboardingState,
} from "@shared/onboarding";
import type { StoredPatient, StoredReferralSource } from "../storage/types";

export type PublicPatient = {
  id: string;
  orgId: string;
  practiceId: string;
  name: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  condition: string | null;
  status: string;
  patientType: string;
  typeName: string | null;
  referralSourceId: string | null;
  referralSource: string | null;
  day1Date: string | null;
  day2Date: string | null;
  careStatus: string;
  converted: boolean;
  conversionDate: string | null;
  planType: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  onboarding: PatientOnboardingState;
};

export function publicPatient(
  row: StoredPatient,
  onboarding: PatientOnboardingState = UNOBSERVED_ONBOARDING,
): PublicPatient {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    dateOfBirth: row.dateOfBirth,
    condition: row.condition,
    status: row.status,
    patientType: row.patientType,
    typeName: row.typeName,
    referralSourceId: row.referralSourceId,
    referralSource: row.referralSource,
    day1Date: row.day1Date,
    day2Date: row.day2Date,
    careStatus: row.careStatus,
    converted: row.converted,
    conversionDate: row.conversionDate,
    planType: row.planType,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    onboarding,
  };
}

export function publicReferralSource(row: StoredReferralSource) {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
