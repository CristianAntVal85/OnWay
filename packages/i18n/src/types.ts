import type { ErrorCode } from '@onway/contracts';

/** Forma común de es y fr: si falta una clave en cualquiera de las dos, no compila. */
export interface Messages {
  app: { name: string };
  login: { title: string; email: string; password: string; submit: string; submitting: string; demoNotice: string };
  waiting: { title: string; body: string; logout: string };
  nav: {
    label: string;
    skipToContent: string;
    home: string;
    missions: string;
    createMission: string;
    routes: string;
    teams: string;
    administration: string;
    myProfile: string;
    account: string;
  };
  state: { loading: string; emptyTitle: string; emptyBody: string; errorTitle: string; retry: string };
  forbidden: { title: string; body: string; goHome: string };
  notFound: { title: string; body: string };
  later: { title: string; body: string };
  profile: { completeTitle: string; completeBody: string };
  home: { title: string; organization: string };
  account: {
    title: string;
    language: string;
    languageEs: string;
    languageFr: string;
    logout: string;
    signedInAs: string;
    roleAdmin: string;
    roleCoordinator: string;
    roleRescuer: string;
  };
  session: { expired: string };
  /** Un texto por cada código de ERROR_HTTP (doc 06 AC-05: el cliente elige el texto por `code`). */
  errors: Record<ErrorCode, string>;
}
