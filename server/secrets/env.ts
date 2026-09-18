import type { SecretsProvider } from "./types";

/** Local / App Runner adapter: values already present on process.env. */
export class EnvSecretsProvider implements SecretsProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async get(envVarName: string): Promise<string | undefined> {
    const value = this.env[envVarName]?.trim();
    return value ? value : undefined;
  }
}
