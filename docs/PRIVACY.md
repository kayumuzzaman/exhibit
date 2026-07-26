# Payloadra privacy policy

Payloadra is a local developer tool. It has no server, no account, and no
analytics.

## What Payloadra collects

While you are recording, Payloadra reads the network evidence Chrome DevTools
already shows for the inspected tab: request and response metadata, headers,
timings, and response bodies when DevTools can provide them. It also records
trusted interaction events (click, submit, navigation) on the inspected page so
requests can be grouped under the action that caused them.

## Where the data goes

Nowhere. All processing happens inside the extension:

- captured evidence is redacted before it is stored or displayed;
- the session lives in `chrome.storage.session` (memory retention) or IndexedDB
  (local retention), both on your machine;
- exports are written by the browser's download flow to a location you choose.

Payloadra makes no outbound network request of its own. The packaged extension
is audited on every release for remote code, inline scripts, and remote URLs
(`pnpm audit:package`).

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

Redaction fails closed: if a record cannot be safely redacted, the record is
dropped or replaced with a redacted placeholder and a warning is recorded.

## Permissions and why they are needed

| Permission                             | Why                                                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                              | Keeps the recording session in `chrome.storage.session` so the panel can be closed and reopened.                                             |
| `scripting`                            | Injects the interaction collector into the inspected tab so requests can be grouped under the click or submit that caused them.              |
| `http://*/*`, `https://*/*` (optional) | Requested only when you start recording, only for the tab you are inspecting, and only to observe interactions. Chrome asks before granting. |

Payloadra declares no required host permissions, no `externally_connectable`
surface, and no background network access.

## Your control

- Recording only happens while you press Start and lasts until you press Stop.
- Clear removes the session from every local store.
- Uninstalling the extension removes its storage with it.

## Contact

Payloadra is an unreleased internal project. Direct privacy questions to the
repository owner.
