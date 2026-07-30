# Chrome Web Store listing

This is draft listing copy, not an approved publisher submission. Exhibit is
currently `UNLICENSED` and private. Publishing requires the owner to choose a
licence, close the release blockers in [TRACEABILITY.md](./TRACEABILITY.md), and
review the final disclosure form against current Chrome Web Store policy.

## Item details

- **Name:** Exhibit
- **Summary (132 characters max):** Privacy-first browser request evidence for
  DevTools. Record, explain, and inspect what your page actually sent.
- **Category:** Developer Tools
- **Language:** English

## Detailed description

> Exhibit is a DevTools panel that turns browser network activity into
> evidence you can read.
>
> Start recording, use your page, and Exhibit explains each request in one
> sentence: which recent interaction it followed, what kind of request it was,
> what came back, how long it took, and how confident that reading is. Every
> claim links back to the protocol facts behind it.
>
> Inspect gives you the developer view — headers, bodies, timing phases,
> initiator, and an evidence ledger — with Structured, Text, and Raw protocol
> body modes, including partial React Flight decoding with a raw fallback.
>
> Built for privacy:
> • No server, no account, no analytics, no outbound requests.
> • Authorization and cookie headers, credential-shaped fields, and token-like
> values are redacted before anything is stored, shown, or exported.
> • No required host permissions. Interaction access is optional and requested
> for the inspected page's origin only when you start recording. Chrome keeps
> the origin grant until you revoke it or uninstall.
> • Evidence stays on your machine and can be cleared at any time.
>
> Also included: API-first filtering, method/domain/protocol/outcome/cache
> facets, failure/slow/cache quick filters, full-text search, custom additive
> redaction names, repeated-call comparison, safe cURL copy, sanitized HAR 1.2
> export, and a Markdown QA report.
>
> Exhibit reports only what the browser can prove. It cannot see
> server-to-server traffic, and it never guesses a server function name.

## Single purpose

The dashboard requires one narrow purpose. Exhibit's:

> Exhibit records the network requests a page makes while the user is
> recording in DevTools, and presents them as redacted, explained evidence that
> the user can inspect and export locally.

Every permission below serves that purpose. The extension has no second
function: it does not modify traffic, does not sync, and does not communicate
with any server.

## Permission justifications

- **storage** — Keeps the memory-retained session plus theme and custom
  redaction settings on the user's machine.
- **scripting** — Injects a small collector into the inspected tab to record
  trusted click, submit, and navigation events so requests can be correlated
  with the recent interaction observed before them.
- **Optional host access (`http://*/*`, `https://*/*`)** — Requested only when
  the user presses Start, for the inspected page's origin, and only to observe
  safe click, submit, and navigation metadata. Chrome's permission grant covers
  that origin across tabs and persists until revoked or uninstalled; Exhibit
  activates its collector only in the inspected tab. Field values are not read,
  and no captured content is transmitted by Exhibit.
- **Remote code** — None. The package contains no remote scripts, no inline
  scripts, and no unapproved network-destination URLs; this is enforced by
  `pnpm audit:package`.

## Data usage disclosure preparation

Do not answer every “collect or use” category **No** merely because processing
is local. During an active recording, Exhibit processes website content, user
activity, browsing/network history for the inspected tab,
authentication-related material, and any personal data present in request or
response evidence.

Accurate product behavior:

- captured data is used only for the user-requested debugging workflow;
- data is processed locally and is not transmitted to Exhibit or a third
  party by the extension;
- user-initiated safe cURL copy writes sanitized text to the operating-system
  clipboard, where it can outlive the panel;
- data is not sold, used for advertising, creditworthiness, or unrelated
  purposes;
- known credential material is redacted before trusted storage, display, copy,
  or export, subject to the documented detection limits;
- optional persistent evidence is stored in IndexedDB without application-level
  encryption; this must be resolved against the final policy review before
  submission;
- the user chooses whether to retain locally, export, clear, or uninstall.

The publisher must map these facts to the current form wording and obtain any
required privacy/legal review before submission.

## Screenshots

Regenerate the tracked set with `pnpm screenshots`. It uses the lockfile-pinned
local runner, drives the real panel against the real fixtures, hides the harness
controls, and writes exactly 1280 x 800 light-theme PNGs to
`docs/screenshots/`.

The capture profile fixes locale, timezone, motion, fixture display origin,
clock, network timing, and HTTP Date values. The requests still execute against
the real local fixtures, while repeated runs produce byte-identical PNGs.

The generated set is:

| File                           | Shows                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `01-recording-ledger.png`      | Command bar recording, session rail, populated ledger with a failure and a slow call.                        |
| `02-explain-server-action.png` | Explain for a real Next.js Server Action: confirmed confidence, opaque action identifier, expanded evidence. |
| `03-inspect-timing.png`        | Inspect timing waterfall with text labels and patterns beside the bars.                                      |
| `04-flight-raw-fallback.png`   | Partially decoded React Flight body, its decode reason, and the Raw protocol tab.                            |
| `05-redaction.png`             | Redacted URL query token, authorization and API-key headers, and body fields.                                |

Also supply the existing 128 x 128 store icon (`public/icon/128.png`) and create
the required 440 x 280 small promo tile plus a YouTube product video. The
1400 x 560 marquee tile is optional. See Chrome's current
[listing requirements](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/).
The generated screenshots contain only fixture data: no real credentials, no
customer data, and no third-party branding.

## Privacy policy URL

The form requires a reachable URL, not a repository file.
[PRIVACY.md](./PRIVACY.md) holds publishable text but needs an effective date, a
monitored contact, an approved Limited Use disclosure, and somewhere to be
hosted for as long as the item is listed. Chrome's current
[user-data guidance](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
requires disclosures even when processing and storage remain local.

## Release checklist

The ordered, current version lives in
[RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md), together with the compatibility
position from [COMPATIBILITY.md](./COMPATIBILITY.md) and everything still
awaiting an owner decision.
