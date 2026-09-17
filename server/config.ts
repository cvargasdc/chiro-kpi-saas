export type AppConfig = {
  nodeEnv: string;
  isProduction: boolean;
  isTest: boolean;
  port: number;
  sessionSecret: string;
  cookieSecure: boolean;
  cookieSameSite: "lax" | "strict";
  databaseUrl: string | undefined;
};

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

  const cookieSecure =
    isProduction || env.COOKIE_SECURE === "true";

  return {
    nodeEnv,
    isProduction,
    isTest,
    port: Number(env.PORT ?? 5000),
    sessionSecret,
    cookieSecure,
    cookieSameSite: isProduction ? "strict" : "lax",
    databaseUrl: env.DATABASE_URL,
  };
}
