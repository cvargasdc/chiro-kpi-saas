import type { Express } from "express";
import session from "express-session";
import MemoryStoreFactory from "memorystore";
import ConnectPgSimple from "connect-pg-simple";
import type { Pool } from "pg";

export type SessionConfig = {
  secret: string;
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
  trustProxy: boolean;
  pgPool?: Pool;
};

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

export function applySession(app: Express, config: SessionConfig): void {
  if (config.trustProxy) {
    app.set("trust proxy", 1);
  }

  const MemoryStore = MemoryStoreFactory(session);
  const store = config.pgPool
    ? new (ConnectPgSimple(session))({
        pool: config.pgPool,
        tableName: "sessions",
        createTableIfMissing: true,
      })
    : new MemoryStore({ checkPeriod: 24 * 60 * 60 * 1000 });

  app.use(
    session({
      name: "chirokpi.sid",
      secret: config.secret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store,
      cookie: {
        httpOnly: true,
        secure: config.secure,
        sameSite: config.sameSite,
        maxAge: EIGHT_HOURS_MS,
        path: "/",
      },
    }),
  );
}

export function productionCookieFlags(isProduction: boolean): {
  secure: boolean;
  sameSite: "lax" | "strict";
} {
  if (isProduction) {
    return { secure: true, sameSite: "strict" };
  }
  return { secure: false, sameSite: "lax" };
}
