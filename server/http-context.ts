import type { AppStorage } from "./storage/types";
import type { Mailer } from "./mailer/types";
import type { MfaChallengeStore } from "./auth/mfa-challenges";
import type { SlidingWindowLimiter } from "./auth/rate-limit";

export type HttpContext = {
  storage: AppStorage;
  mailer: Mailer;
  mfaEncryptionKey: string;
  publicBaseUrl: string;
  now: () => Date;
  mfaChallenges: MfaChallengeStore;
  forgotPasswordLimiter: SlidingWindowLimiter;
};
