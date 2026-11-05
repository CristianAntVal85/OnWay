import type { MailMessage, Mailer } from '../../src/mail/mailer.js';

/** The `Mailer` of the tests: keeps what was sent so a test can read the link a person would have received. */
export class RecordingMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push({ ...message });
  }

  /** The most recent message sent to an address, if any. */
  lastTo(to: string): MailMessage | undefined {
    return [...this.sent].reverse().find((message) => message.to === to);
  }

  clear(): void {
    this.sent.length = 0;
  }
}
