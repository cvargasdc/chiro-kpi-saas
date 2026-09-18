import { decryptMfaSecret, encryptMfaSecret } from "./mfa-crypto";
import {
  consumeRecoveryHash,
  generateRecoveryCodes,
  serializeRecoveryHashes,
  hashRecoveryCode,
} from "./recovery-codes";
import { generateTotpSecret, totpKeyUri, verifyTotpCode } from "./totp";

export type MfaMethod = "totp";

export type MfaStatus = {
  enabled: boolean;
  methods: MfaMethod[];
  status: "enabled" | "not_enrolled" | "pending_enrollment";
};

export function getMfaStatus(user?: {
  mfaEnabled?: boolean;
  mfaPendingSecretEnc?: string | null;
}): MfaStatus {
  if (user?.mfaEnabled) {
    return { enabled: true, methods: ["totp"], status: "enabled" };
  }
  if (user?.mfaPendingSecretEnc) {
    return { enabled: false, methods: [], status: "pending_enrollment" };
  }
  return { enabled: false, methods: [], status: "not_enrolled" };
}

export function beginMfaEnrollment(opts: {
  accountName: string;
  encryptionKey: string;
}): { secret: string; otpauthUri: string; secretEnc: string } {
  const secret = generateTotpSecret();
  const otpauthUri = totpKeyUri({ accountName: opts.accountName, secret });
  const secretEnc = encryptMfaSecret(secret, opts.encryptionKey);
  return { secret, otpauthUri, secretEnc };
}

export function confirmMfaEnrollment(opts: {
  pendingSecretEnc: string;
  code: string;
  encryptionKey: string;
  now: Date;
}): { secretEnc: string; recoveryCodes: string[]; recoveryHashesJson: string } | null {
  let secret: string;
  try {
    secret = decryptMfaSecret(opts.pendingSecretEnc, opts.encryptionKey);
  } catch {
    return null;
  }
  if (!verifyTotpCode(secret, opts.code, opts.now)) {
    return null;
  }
  const recoveryCodes = generateRecoveryCodes();
  const recoveryHashesJson = serializeRecoveryHashes(recoveryCodes.map(hashRecoveryCode));
  return {
    secretEnc: encryptMfaSecret(secret, opts.encryptionKey),
    recoveryCodes,
    recoveryHashesJson,
  };
}

export function verifyMfaChallenge(opts: {
  secretEnc: string;
  code: string;
  encryptionKey: string;
  now: Date;
  recoveryHashesJson?: string | null;
}): { ok: true; remainingRecoveryHashes?: string } | { ok: false } {
  let secret: string;
  try {
    secret = decryptMfaSecret(opts.secretEnc, opts.encryptionKey);
  } catch {
    return { ok: false };
  }
  if (verifyTotpCode(secret, opts.code, opts.now)) {
    return { ok: true };
  }
  const remaining = consumeRecoveryHash(opts.recoveryHashesJson, opts.code);
  if (!remaining) {
    return { ok: false };
  }
  return { ok: true, remainingRecoveryHashes: serializeRecoveryHashes(remaining) };
}

export function disableMfa(): {
  mfaEnabled: false;
  mfaMethod: null;
  mfaSecretEnc: null;
  mfaPendingSecretEnc: null;
  mfaRecoveryCodesHash: null;
  mfaEnrolledAt: null;
} {
  return {
    mfaEnabled: false,
    mfaMethod: null,
    mfaSecretEnc: null,
    mfaPendingSecretEnc: null,
    mfaRecoveryCodesHash: null,
    mfaEnrolledAt: null,
  };
}
