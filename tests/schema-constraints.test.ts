import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  patients,
  patientIntakes,
  dailyStats,
  goals,
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
    for (const table of [patients, patientIntakes, dailyStats, goals, auditLogs]) {
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

  it("does not ship ChiroTouch parsers", () => {
    expect(existsSync("server/chirotouch-parser.ts")).toBe(false);
    expect(existsSync("server/spaa-parser.ts")).toBe(false);
    expect(existsSync("server/spat-parser.ts")).toBe(false);
    expect(existsSync("server/import-ai-service.ts")).toBe(false);
  });
});
