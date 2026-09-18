import type { Express, NextFunction, Request, Response } from "express";
import helmet from "helmet";

export type SecurityOptions = {
  isProduction: boolean;
  forceHttps: boolean;
  trustProxy: boolean;
};

/**
 * TLS terminates at the load balancer (App Runner / ALB). The app assumes
 * HTTPS in production (`secure` cookies). `trust proxy` is required so
 * `req.secure` and `X-Forwarded-Proto` reflect the client protocol.
 *
 * Do not set FORCE_HTTPS=true on App Runner health checks that hit the
 * container over HTTP without the forwarded proto header — leave it off
 * and let the load balancer serve HTTPS.
 */
export function applySecurity(app: Express, opts: SecurityOptions): void {
  if (opts.trustProxy) {
    app.set("trust proxy", 1);
  }
  app.disable("x-powered-by");

  app.use(
    helmet({
      contentSecurityPolicy: opts.isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
              fontSrc: ["'self'", "https://fonts.gstatic.com"],
              imgSrc: ["'self'", "data:"],
              connectSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
            },
          }
        : false,
      hsts: opts.isProduction
        ? { maxAge: 15552000, includeSubDomains: true }
        : false,
      referrerPolicy: { policy: "no-referrer" },
    }),
  );

  if (opts.forceHttps) {
    app.use(redirectHttpToHttps);
  }
}

function redirectHttpToHttps(req: Request, res: Response, next: NextFunction): void {
  if (req.secure) return next();
  const host = req.headers.host;
  if (!host) {
    res.status(400).json({ error: "https_required" });
    return;
  }
  res.redirect(301, `https://${host}${req.originalUrl}`);
}
