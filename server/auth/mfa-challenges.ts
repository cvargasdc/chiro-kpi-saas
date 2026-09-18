import { generateUrlToken, hashToken } from "./tokens";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

type Challenge = {
  userId: string;
  expiresAt: Date;
  attempts: number;
};

export class MfaChallengeStore {
  private readonly items = new Map<string, Challenge>();

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  issue(userId: string, now: Date): string {
    const raw = generateUrlToken();
    this.items.set(hashToken(raw), {
      userId,
      expiresAt: new Date(now.getTime() + this.ttlMs),
      attempts: 0,
    });
    return raw;
  }

  peek(raw: string, now: Date): Challenge | undefined {
    const item = this.items.get(hashToken(raw));
    if (!item) return undefined;
    if (item.expiresAt.getTime() <= now.getTime()) {
      this.items.delete(hashToken(raw));
      return undefined;
    }
    return item;
  }

  recordFailure(raw: string): void {
    const key = hashToken(raw);
    const item = this.items.get(key);
    if (!item) return;
    item.attempts += 1;
    if (item.attempts >= MAX_ATTEMPTS) {
      this.items.delete(key);
    }
  }

  consume(raw: string): void {
    this.items.delete(hashToken(raw));
  }
}
