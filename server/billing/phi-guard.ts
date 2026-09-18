/**
 * Stripe must never receive patient PHI. Billing identity is the organization
 * name plus the owner/admin workforce email only.
 */
const FORBIDDEN_KEY =
  /patient|dob|date[_-]?of[_-]?birth|ssn|mrn|condition|intake|phi/i;

export function assertNoPhiInStripePayload(value: unknown, path = "payload"): void {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoPhiInStripePayload(item, `${path}[${i}]`));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) {
      throw new Error(`Refusing to send PHI-like key to Stripe: ${path}.${key}`);
    }
    assertNoPhiInStripePayload(nested, `${path}.${key}`);
  }
}

export function orgBillingCustomerParams(input: {
  orgId: string;
  orgName: string;
  ownerEmail: string;
}): { name: string; email: string; metadata: Record<string, string> } {
  return {
    name: input.orgName,
    email: input.ownerEmail,
    metadata: { orgId: input.orgId },
  };
}
