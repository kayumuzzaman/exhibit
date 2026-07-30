# Chrome Web Store listing

This is draft listing copy, not an approved publisher submission. Exhibit is
currently `UNLICENSED` and private. Publishing requires the owner to choose a
licence, close the release blockers in [TRACEABILITY.md](./TRACEABILITY.md), and
review the final disclosure form against current Chrome Web Store policy.

## Item details

- **Name:** Exhibit — Next.js Server Action & RSC network explainer
- **Summary (132 characters max):** Explains Next.js Server Actions, RSC, and
  Flight payloads in DevTools. Redacted before display, so screenshots are safe.
- **Category:** Developer Tools
- **Language:** English

The listing name is set in the dashboard's Store listing tab and is deliberately
longer than the manifest `name`. The DevTools tab label is a separate literal in
`src/devtools/boot.ts`, so it stays the short **Exhibit**.

## Detailed description

> In the Network panel, a Next.js Server Action is an opaque POST and an RSC
> navigation is a byte stream. Exhibit reads them.
>
> It classifies Server Actions, RSC navigations, SSR documents, and Next.js API
> routes, and partially decodes React Flight payloads with an explicit decode
> reason and a raw protocol fallback. It never guesses a server function name
> from an opaque action identifier — if the browser cannot prove it, Exhibit
> says so.
>
> Screenshots of this panel are safe to paste into a ticket. Authorization and
> cookie headers, credential-shaped fields, and token-like values are redacted
> before anything is stored, shown, copied, or exported. There is no setting
> that turns that off.
>
> It works on any site, not only Next.js. Start recording, use your page, and
> Exhibit explains each REST, GraphQL, form, or fetch request in one sentence:
> which recent interaction it followed, what kind of request it was, what came
> back, how long it took, and how confident that reading is. Every claim links
> back to the protocol facts behind it.
>
> Inspect gives you the developer view — headers, bodies, timing phases,
> initiator, and an evidence ledger — with Structured, Text, and Raw protocol
> body modes.
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

- **storage** — Keeps the browser-session-memory recording plus theme and custom
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
- captured evidence is held in browser-session memory only and is never written
  to disk, so there is no evidence at rest to encrypt or to disclose; the
  package audit enforces this against the shipped bytes;
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
| `01-explain-server-action.png` | Explain for a real Next.js Server Action: confirmed confidence, opaque action identifier, expanded evidence. |
| `02-recording-ledger.png`      | Command bar recording, session rail, populated ledger with a failure and a slow call.                        |
| `03-inspect-timing.png`        | Inspect timing waterfall with text labels and patterns beside the bars.                                      |
| `04-flight-raw-fallback.png`   | Partially decoded React Flight body, its decode reason, and the Raw protocol tab.                            |
| `05-redaction.png`             | Redacted URL query token, authorization and API-key headers, and body fields.                                |

The 440 x 280 small promo tile is generated by `pnpm promo-tile` into
`docs/promo/small-tile-440x280.png`. It is drawn from the panel's own tokens in
`src/styles/tokens.css` and the icon's pulse mark, so the listing artwork cannot
drift from the product, and it renders byte-identically on every run. It is
graphic rather than a screenshot because Chrome shows it small in search and
category listings, where panel detail is unreadable.

Upload them in filename order. The Server Action frame leads deliberately: the
store shows the first screenshot as the hero, and it carries the positioning.
`scripts/screenshots.mjs` still captures the ledger frame first, because the
later frames depend on the panel state it leaves behind; only the output
filenames are ordered for the listing.

Also supply the existing 128 x 128 store icon (`public/icon/128.png`) and the
generated 440 x 280 small promo tile. A YouTube product video is still
outstanding and cannot be produced from this repository. The 1400 x 560 marquee
tile is optional. See Chrome's current
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
