export type RedactionConfig = Readonly<{
  fieldNames: readonly string[];
  redactCookies: true;
  redactAuthorization: true;
  scanValuePatterns: boolean;
}>;

export const DEFAULT_REDACTION_FIELD_NAMES = Object.freeze([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'password',
  'passwd',
  'passphrase',
  'token',
  'access-token',
  'refresh-token',
  'id-token',
  'secret',
  'api-key',
  'x-api-key',
  'session',
  'session-id',
  'credential',
  'credentials',
  'csrf',
  'csrf-token',
  'xsrf',
  'xsrf-token',
]);

export const DEFAULT_REDACTION_CONFIG: RedactionConfig = Object.freeze({
  fieldNames: DEFAULT_REDACTION_FIELD_NAMES,
  redactCookies: true,
  redactAuthorization: true,
  scanValuePatterns: true,
});
