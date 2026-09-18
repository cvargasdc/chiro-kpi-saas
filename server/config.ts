export type AppConfig = {
  nodeEnv: string;
  isProduction: boolean;
  isTest: boolean;
  port: number;
  sessionSecret: string;
  cookieSecure: boolean;
  cookieSameSite: "lax" | "strict";
  databaseUrl: string | undefined;
  mfaEncryptionKey: string;
  phiEncryptionKey: string;
  publicBaseUrl: string;
  resendApiKey: string | undefined;
  resendFrom: string | undefined;
  forceHttps: boolean;
  trustProxy: boolean;
  stripeSecretKey: string | undefined;
  stripeWebhookSecret: string | undefined;
  stripePriceId: string | undefined;
  stripePublishableKey: string | undefined;
  billingRequireStripe: boolean;
  billingEnforce: boolean;
  billingTrialDays: number;
};

const PLACEHOLDER_SECRET = /^(replace-with|changeme|change-me|your-|todo|placeholder|test-|secret$)/i;

function isWeakSecret(value: string): boolean {
  if (value.length < 32) return true;
  return PLACEHOLDER_SECRET.test(value);
}

/**
 * Fail fast in production if required secrets are missing or weak.
 * Development still requires SESSION_SECRET (no hardcoded fallback) and
 * 32+ char encryption keys; DATABASE_URL is checked when the process boots.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production";
  const isTest = nodeEnv === "test";
  const sessionSecret = env.SESSION_SECRET?.trim();

  if (!sessionSecret) {
    throw new Error(
      "SESSION_SECRET is required. Generate one with `openssl rand -hex 32` and put it in .env — there is no hardcoded fallback.",
    );
  }
  if (sessionSecret.length < 16) {
    throw new Error("SESSION_SECRET must be at least 16 characters.");
  }
  if (isProduction && isWeakSecret(sessionSecret)) {
    throw new Error(
      "SESSION_SECRET is missing or too weak for production (32+ random characters, not a placeholder).",
    );
  }

  const mfaEncryptionKey = env.MFA_ENCRYPTION_KEY?.trim() ?? "";
  if (!isTest && mfaEncryptionKey.length < 32) {
    throw new Error(
      "MFA_ENCRYPTION_KEY is required (32+ characters). Generate one with `openssl rand -hex 32`. TOTP secrets are encrypted with this key at rest.",
    );
  }
  if (isProduction && isWeakSecret(mfaEncryptionKey)) {
    throw new Error("MFA_ENCRYPTION_KEY is missing or too weak for production.");
  }

  const phiEncryptionKey = env.PHI_ENCRYPTION_KEY?.trim() ?? "";
  if (!isTest && phiEncryptionKey.length < 32) {
    throw new Error(
      "PHI_ENCRYPTION_KEY is required (32+ characters). Generate one with `openssl rand -hex 32`. Patient email/phone/DOB are encrypted with this key. Do not reuse MFA_ENCRYPTION_KEY.",
    );
  }
  if (isProduction && isWeakSecret(phiEncryptionKey)) {
    throw new Error("PHI_ENCRYPTION_KEY is missing or too weak for production.");
  }
  if (
    isProduction &&
    phiEncryptionKey &&
    mfaEncryptionKey &&
    phiEncryptionKey === mfaEncryptionKey
  ) {
    throw new Error(
      "PHI_ENCRYPTION_KEY must be distinct from MFA_ENCRYPTION_KEY.",
    );
  }

  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  if (isProduction && !databaseUrl) {
    throw new Error("DATABASE_URL is required in production.");
  }
  if (isProduction && databaseUrl?.includes("chirokpi_local")) {
    throw new Error(
      "DATABASE_URL looks like the local docker-compose default; refusing to start in production.",
    );
  }

  const forceHttps = env.FORCE_HTTPS === "true";
  const trustProxy =
    isProduction || forceHttps || env.TRUST_PROXY === "true";

  const cookieSecure = isProduction || env.COOKIE_SECURE === "true";

  const billingRequireStripe = env.BILLING_REQUIRE_STRIPE === "true";
  const billingEnforce =
    env.BILLING_ENFORCE === "true" ||
    (isProduction && env.BILLING_ENFORCE !== "false");
  const trialRaw = Number(env.BILLING_TRIAL_DAYS ?? 14);
  const billingTrialDays =
    Number.isFinite(trialRaw) && trialRaw > 0 ? Math.floor(trialRaw) : 14;

  const stripeSecretKey = env.STRIPE_SECRET_KEY?.trim() || undefined;
  const stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() || undefined;
  const stripePriceId = env.STRIPE_PRICE_ID?.trim() || undefined;
  const stripePublishableKey = env.STRIPE_PUBLISHABLE_KEY?.trim() || undefined;

  if (isProduction && billingRequireStripe) {
    if (!stripeSecretKey) {
      throw new Error(
        "STRIPE_SECRET_KEY is required when BILLING_REQUIRE_STRIPE=true in production.",
      );
    }
    if (!stripeWebhookSecret) {
      throw new Error(
        "STRIPE_WEBHOOK_SECRET is required when BILLING_REQUIRE_STRIPE=true in production.",
      );
    }
    if (!stripePriceId) {
      throw new Error(
        "STRIPE_PRICE_ID is required when BILLING_REQUIRE_STRIPE=true in production.",
      );
    }
  }

  return {
    nodeEnv,
    isProduction,
    isTest,
    port: Number(env.PORT ?? 5000),
    sessionSecret,
    cookieSecure,
    cookieSameSite: isProduction ? "strict" : "lax",
    databaseUrl,
    mfaEncryptionKey,
    phiEncryptionKey,
    publicBaseUrl: env.APP_BASE_URL?.trim() || "http://localhost:5000",
    resendApiKey: env.RESEND_API_KEY?.trim() || undefined,
    resendFrom: env.RESEND_FROM?.trim() || undefined,
    forceHttps,
    trustProxy,
    stripeSecretKey,
    stripeWebhookSecret,
    stripePriceId,
    stripePublishableKey,
    billingRequireStripe,
    billingEnforce,
    billingTrialDays,
  };
}
