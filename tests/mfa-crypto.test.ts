import { describe, expect, it } from "vitest";
import { decryptMfaSecret, encryptMfaSecret } from "../server/auth/mfa-crypto";
import { consumeRecoveryHash, generateRecoveryCodes, hashRecoveryCode, serializeRecoveryHashes } from "../server/auth/recovery-codes";
import { generateTotpCode, generateTotpSecret, totpKeyUri, verifyTotpCode } from "../server/auth/totp";

const KEY = "test-mfa-encryption-key-min-32-chars!!";

describe("TOTP", () => {
  it("round-trips a code at the same clock and rejects far-future codes", () => {
    const secret = generateTotpSecret();
    const at = new Date("2026-01-01T00:00:00Z");
    const code = generateTotpCode(secret, at);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotpCode(secret, code, at)).toBe(true);
    expect(verifyTotpCode(secret, code, new Date(at.getTime() + 31_000))).toBe(true);
    expect(verifyTotpCode(secret, code, new Date(at.getTime() + 120_000))).toBe(false);
    expect(verifyTotpCode(secret, "000000", at)).toBe(false);
  });

  it("builds an otpauth URI with issuer and secret", () => {
    const uri = totpKeyUri({ accountName: "doc@clinic.test", secret: "MFRGGZDF" });
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("secret=MFRGGZDF");
    expect(uri).toContain("issuer=Chiro-KPI");
  });
});

describe("MFA secret encryption", () => {
  it("encrypts and decrypts with MFA_ENCRYPTION_KEY", () => {
    const secret = generateTotpSecret();
    const enc = encryptMfaSecret(secret, KEY);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain(secret);
    expect(decryptMfaSecret(enc, KEY)).toBe(secret);
  });

  it("rejects a short key", () => {
    expect(() => encryptMfaSecret("abc", "too-short")).toThrow(/32/);
  });
});

describe("recovery codes", () => {
  it("consumes a matching code once", () => {
    const codes = generateRecoveryCodes(3);
    const stored = serializeRecoveryHashes(codes.map(hashRecoveryCode));
    const remaining = consumeRecoveryHash(stored, codes[1]);
    expect(remaining).toHaveLength(2);
    expect(consumeRecoveryHash(serializeRecoveryHashes(remaining!), codes[1])).toBeNull();
    expect(consumeRecoveryHash(stored, "nope-nope")).toBeNull();
  });
});
