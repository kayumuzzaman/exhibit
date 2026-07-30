# Exhibit privacy policy

**Status:** Draft for an unreleased internal preview

**Last reviewed:** 2026-07-29

**Effective date:** Not effective until public distribution

Exhibit is a local developer tool. It has no server, no account, and no
analytics.

## What Exhibit processes locally

While you are recording, Exhibit reads the network evidence Chrome DevTools
already shows for the inspected tab: request and response metadata, headers,
timings, and response bodies when DevTools can provide them. It also records
trusted interaction events (click, submit, navigation) on the inspected page so
requests can be grouped with a recent action. This is a time-bounded
correlation, not proof that the action caused a request.

This can include website content, authentication-related material, browsing
activity within the inspected tab, and personal data present in requests or
responses. Exhibit attempts to redact known credential names and shapes before
trusted storage or display. Local processing and redaction reduce exposure; they
do not make all captured evidence non-sensitive.

## Where the data goes

Exhibit has no backend and does not transmit captured evidence to Exhibit.
Processing and the user-controlled destinations are:

- captured evidence is redacted before it is stored or displayed;
- the session lives in `chrome.storage.session` (memory retention) or IndexedDB
  (local retention), both on your machine;
- theme and custom sensitive-field settings live in `chrome.storage.local`;
- **Copy safe cURL** writes sanitized text to the operating-system clipboard
  only when you press it;
- exports are written by the browser's download flow to a location you choose.

Memory retention lasts until the browser session, extension reload, or explicit
Clear. Local retention lasts until explicit Clear or extension removal. Exported
files remain until the user deletes them. Clipboard contents can outlive the
panel and may be readable by other local applications. Clear cannot retract a
download, clipboard content, or any copy made from either.

Exhibit makes no outbound network request of its own. The packaged extension
is audited on every release for remote code, inline scripts, and unapproved
network-destination URLs (`pnpm audit:package`).

## What is redacted, always

Redaction happens at a trusted boundary before evidence reaches storage, the
user interface, or an export. It cannot be turned off.

- `Authorization`, `Proxy-Authorization`, `Cookie`, and `Set-Cookie` headers.
- Fields whose names indicate a secret: password, passphrase, token, secret,
  credential, csrf, xsrf, api key, session id, and related forms — in URLs,
  query strings, form bodies, JSON bodies, and multipart part values.
- Values that look like credentials regardless of their field name: bearer
  tokens, `sk_`/`pk_` keys, AWS access key ids, Google API keys, GitHub tokens,
  JWTs, and `key=value` pairs naming a secret.
- Raw request identifiers, which are replaced by opaque ids so URLs and
  identifiers cannot be reconstructed from them.

Redaction covers URL path segments as well as query strings, and it applies
structural redaction to a body that parses as JSON even when the page declared a
different content type.

Redaction fails closed: if a record cannot be safely redacted, the record is
dropped or replaced with a redacted placeholder and a warning is recorded.

You may add custom sensitive field names in Settings. Custom names can
only add protection; mandatory header, credential-name, and token-pattern rules
remain enabled. Changing those names requires a stopped, cleared session so one
evidence set never mixes redaction policies.

### What redaction cannot detect

A value is redacted when its **name** indicates a secret or its **shape** matches
a known credential format. A secret that has neither is indistinguishable from an
ordinary identifier, and redacting every opaque value would remove the routes and
payloads the product exists to show. Specifically:

- an opaque token embedded in a path with no recognizable format, such as a bare
  webhook path segment;
- an OAuth `code` or `state` query parameter, because those names are also
  extremely common for non-secret values;
- a secret written into free-form prose inside an otherwise ordinary field.

Treat exported evidence from an authenticated session as sensitive, and review it
before sharing it outside your machine.

## Permissions and why they are needed

| Permission                             | Why                                                                                                                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `storage`                              | Keeps the memory-retained session in `chrome.storage.session` and theme/custom redaction settings in `chrome.storage.local`.                                                                                                                                       |
| `scripting`                            | Injects the interaction collector into the inspected tab so requests can be correlated with recent click, submit, and navigation events.                                                                                                                           |
| `http://*/*`, `https://*/*` (optional) | Requested for the inspected page's origin when recording starts so interaction metadata can be observed. Chrome's grant covers that origin across tabs and persists until the user revokes it or uninstalls; Exhibit's collector use remains inspected-tab scoped. |

See Chrome's official
[optional-permissions documentation](https://developer.chrome.com/docs/extensions/reference/api/permissions/)
for the browser grant and revocation model.

Exhibit declares no required host permissions, no `externally_connectable`
surface, and no background network access.

## Your control

- Recording only happens while you press Start and lasts until you press Stop.
- Clear removes the session from every local store.
- Clear does not clear theme or custom redaction settings, downloaded exports,
  or the operating-system clipboard.
- Clear does not remove an optional origin permission. You can revoke that
  grant through Chrome's extension permissions/site-access controls; network
  recording still works without interaction access.
- Uninstalling the extension removes its storage with it.

## Contact

Exhibit is an unreleased internal project. Use the existing private project
channel for privacy questions. Public distribution is blocked until the legal
owner publishes a monitored privacy contact and applicable jurisdictional
details.
