import type { EmailMessage, Mailer } from "./types";

/**
 * Default Week 3 mailer. Logs template + recipient only — never the raw
 * token or action URL (those would be reusable secrets).
 */
export class LoggingMailer implements Mailer {
  async send(message: EmailMessage): Promise<void> {
    console.log("[mailer] queued", {
      template: message.template,
      to: message.to,
      subject: message.subject,
    });
  }
}
