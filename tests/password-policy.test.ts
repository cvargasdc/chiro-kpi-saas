import { describe, expect, it } from "vitest";
import { validatePassword } from "../shared/password-policy";
import { hashPassword, verifyPassword } from "../server/auth/password";

describe("password policy", () => {
  it("rejects short or simple passwords", () => {
    expect(validatePassword("short").ok).toBe(false);
    expect(validatePassword("alllowercase1!").ok).toBe(false);
    expect(validatePassword("ALLUPPERCASE1!").ok).toBe(false);
    expect(validatePassword("NoDigitsHere!!").ok).toBe(false);
    expect(validatePassword("NoSpecialChar1").ok).toBe(false);
    expect(validatePassword("Has spaces 1!").ok).toBe(false);
  });

  it("accepts a ≥12 character mixed password and hashes with bcrypt", async () => {
    const plain = "CorrectHorse-Battery9!";
    expect(validatePassword(plain).ok).toBe(true);
    const hash = await hashPassword(plain);
    expect(hash.startsWith("$2")).toBe(true);
    expect(await verifyPassword(plain, hash)).toBe(true);
    expect(await verifyPassword("wrong-password-1!", hash)).toBe(false);
  });
});
