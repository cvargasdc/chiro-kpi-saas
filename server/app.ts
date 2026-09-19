import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { MfaChallengeStore } from "./auth/mfa-challenges";
import { SlidingWindowLimiter } from "./auth/rate-limit";
import { applySession, type SessionConfig } from "./auth/session";
import { defaultBillingContext, type BillingContext } from "./billing/stripe";
import { handleStripeWebhook } from "./billing/webhook";
import type { HttpContext } from "./http-context";
import { applySecurity } from "./http/security";
import { logError } from "./log/redact";
import { LoggingMailer } from "./mailer/log";
import type { Mailer } from "./mailer/types";
import { registerRoutes } from "./routes";
import type { AppStorage } from "./storage/types";
import "./types";

const FORGOT_PASSWORD_LIMIT = 5;
const FORGOT_PASSWORD_WINDOW_MS = 15 * 60 * 1000;

export type CreateAppOptions = {
  storage: AppStorage;
  session: SessionConfig;
  mailer?: Mailer;
  mfaEncryptionKey?: string;
  publicBaseUrl?: string;
  now?: () => Date;
  forceHttps?: boolean;
  isProduction?: boolean;
  billing?: Partial<BillingContext>;
};

export function createApp(options: CreateAppOptions): Express {
  const app = express();
  const isProduction = options.isProduction ?? process.env.NODE_ENV === "production";

  applySecurity(app, {
    isProduction,
    forceHttps: options.forceHttps ?? false,
    trustProxy: options.session.trustProxy,
  });

  const ctx: HttpContext = {
    storage: options.storage,
    mailer: options.mailer ?? new LoggingMailer(),
    mfaEncryptionKey:
      options.mfaEncryptionKey ?? process.env.MFA_ENCRYPTION_KEY ?? "",
    publicBaseUrl:
      options.publicBaseUrl ?? process.env.APP_BASE_URL ?? "http://localhost:5000",
    now: options.now ?? (() => new Date()),
    mfaChallenges: new MfaChallengeStore(),
    forgotPasswordLimiter: new SlidingWindowLimiter(
      FORGOT_PASSWORD_LIMIT,
      FORGOT_PASSWORD_WINDOW_MS,
    ),
    billing: defaultBillingContext(options.billing),
  };

  // Stripe signature verification requires the raw body. Register before json().
  app.post(
    "/api/billing/webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
    (req, res, next) => {
      handleStripeWebhook(req, res, ctx).catch(next);
    },
  );

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false }));

  applySession(app, options.session);

  registerRoutes(app, ctx);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "internal_error";
    logError("[http] unhandled error", { error: message });
    if (res.headersSent) return;
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
