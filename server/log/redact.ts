const SECRET_KEY =
  /pass(word|wd)?|secret|token|authorization|cookie|set-cookie|api[_-]?key|private[_-]?key|credential|database_url|connectionstring|mfa[_-]?encryption|phi[_-]?encryption|session_secret|recovery/i;

const PHI_KEY = /email|phone|dob|date[_-]?of[_-]?birth|ssn|mrn|patient[_-]?name|^name$/i;

const REDACTED = "[redacted]";

function keyLooksSensitive(key: string): boolean {
  return SECRET_KEY.test(key) || PHI_KEY.test(key);
}

function redactString(value: string): string {
  if (value.length <= 4) return REDACTED;
  return REDACTED;
}

export function redactValue(value: unknown, key = ""): unknown {
  if (value == null) return value;
  if (keyLooksSensitive(key)) {
    return REDACTED;
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key));
  }
  if (typeof value === "object") {
    return redactRecord(value as Record<string, unknown>);
  }
  return value;
}

export function redactRecord(
  input: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!input) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = redactValue(v, k);
  }
  return out;
}

/**
 * Structured logger that never prints secrets or PHI values.
 * Prefer IDs (`userId`, `orgId`, `practiceId`, `resourceId`) in `meta`.
 */
export function logInfo(message: string, meta?: Record<string, unknown>): void {
  if (meta) {
    console.log(message, redactRecord(meta));
  } else {
    console.log(message);
  }
}

export function logWarn(message: string, meta?: Record<string, unknown>): void {
  if (meta) {
    console.warn(message, redactRecord(meta));
  } else {
    console.warn(message);
  }
}

export function logError(message: string, meta?: Record<string, unknown>): void {
  if (meta) {
    console.error(message, redactRecord(meta));
  } else {
    console.error(message);
  }
}

/** Test helper — exported so tests can assert redaction without going through console. */
export { REDACTED, redactString };
