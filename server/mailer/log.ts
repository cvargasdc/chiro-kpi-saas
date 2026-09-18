import { logInfo } from "../log/redact";
import type { EmailMessage, Mailer } from "./types";

/**
 * Default mailer. Logs template + subject only — never the recipient,
 * raw token, or action URL (those would be reusable secrets / identifiers).
 */
export class LoggingMailer implements Mailer {
  async send(message: EmailMessage): Promise<void> {
    logInfo("[mailer] queued", {
      template: message.template,
      subject: message.subject,
    });
  }
}
