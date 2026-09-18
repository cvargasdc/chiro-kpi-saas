/**
 * RFC 6238 TOTP (HMAC-SHA1, 30s, 6 digits) — compatible with Google
 * Authenticator, Authy, and otplib defaults. Implemented here so tests can
 * inject a clock and we do not take an extra runtime dependency.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_ISSUER = "Chiro-KPI";

export function generateTotpSecret(byteLength = 20): string {
  return encodeBase32(randomBytes(byteLength));
}

export function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new Error("invalid_base32");
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = bin % 10 ** TOTP_DIGITS;
  return otp.toString().padStart(TOTP_DIGITS, "0");
}

export function generateTotpCode(
  secretBase32: string,
  at: Date = new Date(),
  period = TOTP_PERIOD_SECONDS,
): string {
  const counter = Math.floor(at.getTime() / 1000 / period);
  return hotp(decodeBase32(secretBase32), counter);
}

export function verifyTotpCode(
  secretBase32: string,
  code: string,
  at: Date = new Date(),
  window = 1,
  period = TOTP_PERIOD_SECONDS,
): boolean {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  let secret: Buffer;
  try {
    secret = decodeBase32(secretBase32);
  } catch {
    return false;
  }
  const counter = Math.floor(at.getTime() / 1000 / period);
  const expected = Buffer.from(normalized);
  for (let i = -window; i <= window; i++) {
    const candidate = Buffer.from(hotp(secret, counter + i));
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return true;
    }
  }
  return false;
}

export function totpKeyUri(opts: {
  accountName: string;
  issuer?: string;
  secret: string;
}): string {
  const issuer = opts.issuer ?? TOTP_ISSUER;
  const issuerEnc = encodeURIComponent(issuer);
  const accountEnc = encodeURIComponent(opts.accountName);
  return `otpauth://totp/${issuerEnc}:${accountEnc}?secret=${opts.secret}&issuer=${issuerEnc}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}
