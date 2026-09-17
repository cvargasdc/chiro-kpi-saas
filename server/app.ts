import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { applySession, type SessionConfig } from "./auth/session";
import { registerRoutes } from "./routes";
import type { AppStorage } from "./storage/types";
import "./types";

export type CreateAppOptions = {
  storage: AppStorage;
  session: SessionConfig;
};

export function createApp(options: CreateAppOptions): Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));

  applySession(app, options.session);
  registerRoutes(app, options.storage);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "internal_error";
    console.error("[http] unhandled error", message);
    if (res.headersSent) return;
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
