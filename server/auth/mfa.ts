/**
 * MFA stubs for Week 2. Schema has mfa_* columns on users; enrollment and
 * challenge verification are not implemented. Do not treat mfaEnabled as live.
 */

export const MFA_STUB_STATUS = "stubbed_not_enabled" as const;

export type MfaStatus = {
  enabled: false;
  methods: [];
  status: typeof MFA_STUB_STATUS;
  note: string;
};

export function getMfaStatus(): MfaStatus {
  return {
    enabled: false,
    methods: [],
    status: MFA_STUB_STATUS,
    note: "MFA enrollment is stubbed in Week 2. TOTP/WebAuthn will land later.",
  };
}

export async function beginMfaEnrollment(): Promise<never> {
  throw new Error("MFA enrollment is not implemented (Week 2 stub).");
}

export async function verifyMfaChallenge(): Promise<never> {
  throw new Error("MFA verification is not implemented (Week 2 stub).");
}

export async function disableMfa(): Promise<never> {
  throw new Error("MFA disable is not implemented (Week 2 stub).");
}
