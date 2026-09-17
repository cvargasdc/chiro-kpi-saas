import bcrypt from "bcryptjs";
import { validatePassword } from "@shared/password-policy";

const PROD_ROUNDS = 12;
const TEST_ROUNDS = 4;

/** Valid bcrypt hash used only to keep login timing similar when the user is missing. */
const DUMMY_HASH = bcrypt.hashSync("not-a-real-user", TEST_ROUNDS);

export function bcryptRounds(): number {
  if (process.env.NODE_ENV === "test") return TEST_ROUNDS;
  return PROD_ROUNDS;
}

export async function hashPassword(plain: string): Promise<string> {
  const policy = validatePassword(plain);
  if (!policy.ok) {
    throw new Error(policy.errors.join("; "));
  }
  return bcrypt.hash(plain, bcryptRounds());
}

export async function verifyPassword(
  plain: string,
  passwordHash: string,
): Promise<boolean> {
  if (!plain || !passwordHash) return false;
  return bcrypt.compare(plain, passwordHash);
}

export async function verifyPasswordOrDummy(
  plain: string,
  passwordHash: string | undefined,
): Promise<boolean> {
  return verifyPassword(plain, passwordHash ?? DUMMY_HASH);
}
