import type { SecretsProvider } from "./types";

/** Always empty. Used in tests and when no backend is configured. */
export class NoopSecretsProvider implements SecretsProvider {
  async get(_envVarName: string): Promise<string | undefined> {
    return undefined;
  }
}
