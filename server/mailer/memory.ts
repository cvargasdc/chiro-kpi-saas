import type { EmailMessage, Mailer } from "./types";

export class InMemoryMailer implements Mailer {
  readonly outbox: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.outbox.push(message);
  }
}
