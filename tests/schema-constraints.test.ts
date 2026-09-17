import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  patients,
  patientIntakes,
  dailyStats,
  goals,
  auditLogs,
  practices,
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

  it("does not ship ChiroTouch parsers", () => {
    expect(existsSync("server/chirotouch-parser.ts")).toBe(false);
    expect(existsSync("server/spaa-parser.ts")).toBe(false);
    expect(existsSync("server/spat-parser.ts")).toBe(false);
    expect(existsSync("server/import-ai-service.ts")).toBe(false);
  });
});
