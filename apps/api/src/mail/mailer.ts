/** Port `Mailer` (doc 04 §5.2). Transactional mail only; v1 sends just the password-recovery link. */
export type MailKind = 'password-reset';
export type MailLocale = 'es' | 'fr';

export interface MailMessage {
  to: string;
  kind: MailKind;
  /** Language of the person (`users.locale`): the adapter that sends a real mail writes it in this language. */
  locale: MailLocale;
  /** The absolute link the mail carries (see `links.ts`). */
  link: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export const MAILER = Symbol('MAILER');
