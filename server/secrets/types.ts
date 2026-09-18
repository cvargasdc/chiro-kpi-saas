/**
 * Thin secrets interface. Production wiring maps AWS Secrets Manager
 * names onto env vars at deploy time (App Runner / ECS). In-process
 * AWS API calls are optional and must not run unless credentials exist.
 *
 * See docs/SECRETS.md for the env var → Secrets Manager name map.
 */
export interface SecretsProvider {
  /** Resolve a process-env style key (e.g. SESSION_SECRET). */
  get(envVarName: string): Promise<string | undefined>;
}

/** Suggested Secrets Manager secret ids (JSON string or SecretString). */
export const SECRET_MANAGER_NAMES = {
  SESSION_SECRET: "chirokpi/prod/SESSION_SECRET",
  MFA_ENCRYPTION_KEY: "chirokpi/prod/MFA_ENCRYPTION_KEY",
  PHI_ENCRYPTION_KEY: "chirokpi/prod/PHI_ENCRYPTION_KEY",
  DATABASE_URL: "chirokpi/prod/DATABASE_URL",
  RESEND_API_KEY: "chirokpi/prod/RESEND_API_KEY",
} as const;

export type SecretEnvName = keyof typeof SECRET_MANAGER_NAMES;
