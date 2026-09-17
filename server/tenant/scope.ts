export type TenantScope = {
  orgId: string;
  practiceId: string;
};

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

function isPresent(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * PHI helpers MUST call this. Missing orgId or practiceId is a programming
 * error — never silently fall back (the legacy `"default"` practiceId is banned).
 */
export function requireTenantScope(
  scope: Partial<TenantScope> | null | undefined,
): TenantScope {
  if (!scope || !isPresent(scope.orgId) || !isPresent(scope.practiceId)) {
    throw new TenantScopeError(
      "PHI access requires orgId and practiceId; no default tenant is allowed",
    );
  }
  if (scope.practiceId === "default") {
    throw new TenantScopeError(
      'practiceId "default" is not a valid tenant key',
    );
  }
  return { orgId: scope.orgId.trim(), practiceId: scope.practiceId.trim() };
}

export function requireOrgId(orgId: unknown): string {
  if (!isPresent(orgId)) {
    throw new TenantScopeError("Organization access requires orgId");
  }
  return orgId.trim();
}
