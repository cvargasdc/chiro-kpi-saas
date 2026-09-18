import { SECRET_MANAGER_NAMES, type SecretsProvider } from "./types";

/**
 * Minimal shape of an AWS Secrets Manager client. We do not depend on
 * `@aws-sdk/client-secrets-manager` in this repo; inject a client at
 * deploy time if you want in-process fetches. App Runner can also map
 * secrets onto env vars and skip this adapter entirely.
 */
export type SecretsManagerClientLike = {
  send: (input: { secretId: string }) => Promise<{ SecretString?: string }>;
};

export function awsCredentialsPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  const region = env.AWS_REGION || env.AWS_DEFAULT_REGION;
  if (!region) return false;
  return Boolean(
    env.AWS_ACCESS_KEY_ID ||
      env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
      env.AWS_WEB_IDENTITY_TOKEN_FILE ||
      env.AWS_PROFILE,
  );
}

export class AwsSecretsManagerProvider implements SecretsProvider {
  constructor(
    private readonly opts: {
      client?: SecretsManagerClientLike;
      nameMap?: Record<string, string>;
      env?: NodeJS.ProcessEnv;
    } = {},
  ) {}

  async get(envVarName: string): Promise<string | undefined> {
    const env = this.opts.env ?? process.env;
    if (!this.opts.client) return undefined;
    if (!awsCredentialsPresent(env)) return undefined;
    const secretId =
      this.opts.nameMap?.[envVarName] ??
      SECRET_MANAGER_NAMES[envVarName as keyof typeof SECRET_MANAGER_NAMES];
    if (!secretId) return undefined;
    const result = await this.opts.client.send({ secretId });
    const value = result.SecretString?.trim();
    return value ? value : undefined;
  }
}
