import type { MailMessage, Mailer } from './mailer.js';

/**
 * Development and test adapter: it "sends" by writing ONE line of JSON to the standard output of the `api`, where
 * `docker compose logs api` shows it. The format is fixed and documented because the end-to-end support reads it (`e2e/support/stack.ts`):
 *
 *     {"event":"mail","kind":"password-reset","to":"ana@example.org","locale":"es","link":"http://localhost:8080/reset-password#token=..."}
 *
 * Exactly these five fields, in this order, and nothing else. The link holds a live token, so this adapter never runs in
 * production (see `config.ts`).
 */
export class ConsoleMailer implements Mailer {
  constructor(private readonly write: (line: string) => void = (line) => console.log(line)) {}

  async send({ to, kind, locale, link }: MailMessage): Promise<void> {
    this.write(JSON.stringify({ event: 'mail', kind, to, locale, link }));
  }
}
