import type { EmailMessage, Mailer } from "./types";

/**
 * Resend adapter — **not wired in Week 3**.
 *
 * To plug in later:
 * 1. Keep PHI out of email (workforce address + link only). Execute a Resend
 *    BAA before any message that could include ePHI; our templates must not.
 * 2. Set `RESEND_API_KEY` and `RESEND_FROM` in the environment. Never commit them.
 * 3. In `server/index.ts`, swap `LoggingMailer` for:
 *      new ResendMailer(config.resendApiKey, config.resendFrom)
 * 4. Tests should keep using `InMemoryMailer` so they do not need network or keys.
 *
 * This class is a compile-ready stub. Constructing it without a key throws so
 * it cannot silently no-op in production.
 */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {
    if (!apiKey?.trim()) {
      throw new Error("RESEND_API_KEY is required to construct ResendMailer");
    }
    if (!from?.trim()) {
      throw new Error("RESEND_FROM is required to construct ResendMailer");
    }
  }

  async send(message: EmailMessage): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Resend send failed (${res.status})${detail ? `: ${detail}` : ""}`);
    }
  }
}
