import { config as loadDotenv, type DotenvConfigOptions } from "dotenv";

export type EnvLoader = (opts?: DotenvConfigOptions) => unknown;

/**
 * Load `.env` into `process.env` without overriding values already set.
 * Production (App Runner / Secrets Manager) injects env itself — skip the
 * file there so a leftover `.env` cannot mask missing secrets.
 */
export function loadEnvFile(
  env: NodeJS.ProcessEnv = process.env,
  load: EnvLoader = loadDotenv,
): void {
  if (env.NODE_ENV === "production") return;
  load({ override: false });
}
