/**
 * Transactional email interface for Week 3.
 *
 * Password-reset and invite mail carry a workforce address and a link.
 * Never put patient names, DOB, conditions, or other ePHI in these messages.
 *
 * Week 3 implementations:
 *   - InMemoryMailer  — tests inspect `.outbox`
 *   - LoggingMailer   — logs template + recipient, not the token URL
 *
 * Resend (later): see `server/mailer/resend.ts` and docs/WEEK3-AUTH.md.
 */

export type EmailTemplate = "password_reset" | "practice_invite";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  template: EmailTemplate;
  /** Present for tests; LoggingMailer must not print this. */
  actionUrl?: string;
};

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}
