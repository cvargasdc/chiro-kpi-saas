export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const ENTITLED_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  "trialing",
  "active",
];

export const DEFAULT_BILLING_PLAN = "starter";
export const DEFAULT_TRIAL_DAYS = 14;

export function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

export function isEntitledSubscriptionStatus(
  status: SubscriptionStatus,
): boolean {
  return ENTITLED_SUBSCRIPTION_STATUSES.includes(status);
}
