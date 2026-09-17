export const PASSWORD_MIN_LENGTH = 12;

export type PasswordValidation =
  | { ok: true }
  | { ok: false; errors: string[] };

/**
 * Basic complexity: length ≥ 12, mixed case, digit, special character.
 * Week 2 foundation — not a substitute for later breach-password checks / MFA.
 */
export function validatePassword(password: string): PasswordValidation {
  const errors: string[] = [];

  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password must include a lowercase letter");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must include an uppercase letter");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Password must include a number");
  }
  if (!/[^A-Za-z0-9\s]/.test(password)) {
    errors.push("Password must include a special character");
  }
  if (/\s/.test(password)) {
    errors.push("Password must not contain spaces");
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,64}$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}
