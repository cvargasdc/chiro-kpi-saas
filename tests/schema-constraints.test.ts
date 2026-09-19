import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  patients,
  patientIntakes,
  referralSources,
  dailyStats,
  goals,
  treatments,
  practiceChecklists,
  practiceChecklistItems,
  practiceChecklistCompletions,
  checklistTemplates,
  checklistTemplateTasks,
  patientChecklists,
  patientChecklistTasks,
  auditLogs,
  practices,
  passwordResetTokens,
  teamInvitations,
} from "../shared/schema";

const SCHEMA = readFileSync("shared/schema.ts", "utf8");
const PKG = JSON.parse(readFileSync("package.json", "utf8"));

describe("Path B schema constraints", () => {
  it("does not default practiceId to \"default\"", () => {
    expect(SCHEMA).not.toMatch(/practiceId[^\n]*default\(["']default["']\)/);
    expect(SCHEMA).not.toMatch(/practice_id[^\n]*default\(["']default["']\)/);
  });

  it("PHI tables require orgId and practiceId", () => {
    for (const table of [
      patients,
      patientIntakes,
      referralSources,
      dailyStats,
      goals,
      treatments,
      practiceChecklists,
      practiceChecklistItems,
      practiceChecklistCompletions,
      checklistTemplates,
      checklistTemplateTasks,
      patientChecklists,
      patientChecklistTasks,
      auditLogs,
    ]) {
      expect(table.orgId).toBeDefined();
      expect(table.practiceId).toBeDefined();
      expect(table.orgId.notNull).toBe(true);
      expect(table.practiceId.notNull).toBe(true);
    }
    expect(practices.orgId.notNull).toBe(true);
  });

  it("does not depend on OpenAI", () => {
    expect(PKG.dependencies?.openai).toBeUndefined();
    expect(PKG.devDependencies?.openai).toBeUndefined();
  });

  it("stores org-level Stripe billing fields (no PHI columns)", () => {
    expect(SCHEMA).toMatch(/stripeCustomerId:\s*text\("stripe_customer_id"\)/);
    expect(SCHEMA).toMatch(/stripeSubscriptionId:\s*text\("stripe_subscription_id"\)/);
    expect(SCHEMA).toMatch(/subscriptionStatusEnum/);
    expect(SCHEMA).not.toMatch(/patient_email/);
    expect(PKG.dependencies?.stripe).toBeDefined();
    expect(PKG.dependencies?.dotenv).toBeDefined();
  });

  it("stores encrypted DOB as text (ciphertext envelope, not a date type)", () => {
    expect(SCHEMA).toMatch(/dateOfBirth:\s*text\("date_of_birth"\)/);
    expect(SCHEMA).toMatch(/PHI_ENCRYPTION_KEY/);
    expect(PKG.dependencies?.helmet).toBeDefined();
  });

  it("stores hashed password-reset tokens and tenant-scoped invites", () => {
    expect(passwordResetTokens.tokenHash).toBeDefined();
    expect(passwordResetTokens.userId.notNull).toBe(true);
    expect(passwordResetTokens.expiresAt.notNull).toBe(true);
    expect(teamInvitations.orgId.notNull).toBe(true);
    expect(teamInvitations.practiceId.notNull).toBe(true);
    expect(teamInvitations.tokenHash).toBeDefined();
    expect(SCHEMA).toMatch(/mfa_secret_enc/);
    expect(SCHEMA).toMatch(/mfaPendingSecretEnc|mfa_pending_secret_enc/);
  });

  it("stores daily log visits + integer cents with a unique practice date", () => {
    expect(SCHEMA).toMatch(/visits:\s*integer\("visits"\)/);
    expect(SCHEMA).toMatch(/revenueCents:\s*integer\("revenue_cents"\)/);
    expect(SCHEMA).toMatch(/daily_stats_practice_date_unique/);
    expect(SCHEMA).not.toMatch(/totalAppointments/);
    expect(dailyStats.visits.notNull).toBe(true);
    expect(dailyStats.revenueCents.notNull).toBe(true);
  });

  it("unifies conversion funnel fields on patients (encrypted notes)", () => {
    expect(SCHEMA).toMatch(/patientType:\s*text\("patient_type"\)/);
    expect(SCHEMA).toMatch(/converted:\s*boolean\("converted"\)/);
    expect(SCHEMA).toMatch(/careStatus:\s*text\("care_status"\)/);
    expect(SCHEMA).toMatch(/referral_sources/);
    expect(patients.orgId.notNull).toBe(true);
    expect(patients.practiceId.notNull).toBe(true);
    expect(referralSources.orgId.notNull).toBe(true);
    expect(referralSources.practiceId.notNull).toBe(true);
    expect(SCHEMA).toMatch(/Reserved for future onboarding/);
  });

  it("stores goals with integer targets, optional manual current, and createdBy", () => {
    expect(SCHEMA).toMatch(/targetValue:\s*integer\("target_value"\)/);
    expect(SCHEMA).toMatch(/currentValue:\s*integer\("current_value"\)/);
    expect(SCHEMA).toMatch(/createdBy:\s*varchar\("created_by"\)/);
    expect(SCHEMA).toMatch(/USD cents when metric_type = "revenue"/);
    expect(goals.targetValue.notNull).toBe(true);
    expect(goals.orgId.notNull).toBe(true);
    expect(goals.practiceId.notNull).toBe(true);
    const goalsTable = SCHEMA.slice(SCHEMA.indexOf("export const goals = pgTable"));
    expect(goalsTable).not.toMatch(/active:\s*integer\("active"\)/);
  });

  it("stores treatments catalog with integer cents and required tenant keys", () => {
    expect(SCHEMA).toMatch(/priceCents:\s*integer\("price_cents"\)/);
    expect(SCHEMA).toMatch(/sortOrder:\s*integer\("sort_order"\)/);
    expect(SCHEMA).toMatch(/export const treatments = pgTable/);
    expect(treatments.orgId.notNull).toBe(true);
    expect(treatments.practiceId.notNull).toBe(true);
    expect(treatments.priceCents.notNull).toBe(true);
    expect(treatments.active.notNull).toBe(true);
    expect(PKG.dependencies?.pdfkit).toBeDefined();
  });

  it("stores practice checklists and patient onboarding as separate tables", () => {
    expect(SCHEMA).toMatch(/export const practiceChecklists = pgTable/);
    expect(SCHEMA).toMatch(/export const checklistTemplates = pgTable/);
    expect(SCHEMA).toMatch(/export const patientChecklists = pgTable/);
    expect(SCHEMA).toMatch(/practice_checklist_completions_item_date_unique/);
    expect(practiceChecklists.orgId.notNull).toBe(true);
    expect(practiceChecklists.practiceId.notNull).toBe(true);
    expect(patientChecklists.orgId.notNull).toBe(true);
    expect(patientChecklists.practiceId.notNull).toBe(true);
    expect(patientChecklistTasks.orgId.notNull).toBe(true);
    expect(patientChecklistTasks.practiceId.notNull).toBe(true);
    expect(SCHEMA).toMatch(/Not patient onboarding/);
    expect(SCHEMA).toMatch(/Distinct from Practice Checklists/);
  });

  it("does not ship ChiroTouch parsers", () => {
    expect(existsSync("server/chirotouch-parser.ts")).toBe(false);
    expect(existsSync("server/spaa-parser.ts")).toBe(false);
    expect(existsSync("server/spat-parser.ts")).toBe(false);
    expect(existsSync("server/import-ai-service.ts")).toBe(false);
  });
});
