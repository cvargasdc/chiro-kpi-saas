import { AwsSecretsManagerProvider, type SecretsManagerClientLike } from "./aws";
import { EnvSecretsProvider } from "./env";
import { NoopSecretsProvider } from "./noop";
import type { SecretsProvider } from "./types";

export {
  AwsSecretsManagerProvider,
  awsCredentialsPresent,
  type SecretsManagerClientLike,
} from "./aws";
export { EnvSecretsProvider } from "./env";
export { NoopSecretsProvider } from "./noop";
export {
  SECRET_MANAGER_NAMES,
  type SecretEnvName,
  type SecretsProvider,
} from "./types";

export class CompositeSecretsProvider implements SecretsProvider {
  constructor(private readonly providers: SecretsProvider[]) {}

  async get(envVarName: string): Promise<string | undefined> {
    for (const provider of this.providers) {
      const value = await provider.get(envVarName);
      if (value) return value;
    }
    return undefined;
  }
}

/**
 * Default provider chain: env first (including App Runner-injected
 * secrets), then AWS only if a client is injected. Never calls AWS APIs
 * without credentials + client.
 */
export function createSecretsProvider(opts?: {
  awsClient?: SecretsManagerClientLike;
}): SecretsProvider {
  return new CompositeSecretsProvider([
    new EnvSecretsProvider(),
    opts?.awsClient
      ? new AwsSecretsManagerProvider({ client: opts.awsClient })
      : new NoopSecretsProvider(),
  ]);
}
