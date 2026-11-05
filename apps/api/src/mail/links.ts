/**
 * The password-recovery link. The token goes in the FRAGMENT (`#token=`), never in the query: the browser does not send the
 * fragment, so the token stays out of Caddy's log and of `Referer`. The token is base64url (letters, digits, `-`, `_`), which
 * needs no escaping.
 */
export const passwordResetLink = (publicBaseUrl: string, token: string): string => `${publicBaseUrl}/reset-password#token=${token}`;
