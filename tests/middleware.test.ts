import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { requireRole } from "../server/auth/middleware";
import type { TenantContext } from "../server/types";

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe("requireRole", () => {
  it("allows listed roles and rejects others", () => {
    const mw = requireRole("owner", "admin");
    const okReq = {
      tenant: { role: "owner" } as TenantContext,
    } as Request;
    let nextCalled = false;
    mw(okReq, mockRes(), () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);

    const deniedReq = {
      tenant: { role: "readonly" } as TenantContext,
    } as Request;
    const res = mockRes();
    mw(deniedReq, res, () => {
      throw new Error("should not continue");
    });
    expect(res.statusCode).toBe(403);
  });
});
