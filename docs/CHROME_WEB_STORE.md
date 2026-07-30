# Chrome Web Store listing

**Entered in the dashboard:** 2026-07-31 · **Package:** `exhibit-0.1.0-chrome.zip`
from commit `c4c96d6` · **Review outcome:** not yet recorded

This is the copy as submitted, not a draft. Every block below is verbatim what
the dashboard holds, so a resubmission can be reproduced without rewriting it.
Text intended for a form field is fenced, because the dashboard preserves line
breaks and reflowing it changes what users see.

If the product changes, change this file in the same pull request. A listing
that disagrees with the package is a policy problem, not a documentation lapse.

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

```
In the Network panel, a Next.js Server Action is an opaque POST and an RSC navigation is a byte stream. Exhibit reads them.

It classifies Server Actions, RSC navigations, SSR documents, and Next.js API routes, and partially decodes React Flight payloads with an explicit decode reason and a raw protocol fallback. It never guesses a server function name from an opaque action identifier — if the browser cannot prove it, Exhibit says so.

Screenshots of this panel are safe to paste into a ticket. Authorization and cookie headers, credential-shaped fields, and token-like values are redacted before anything is stored, shown, copied, or exported. There is no setting that turns that off.

It works on any site, not only Next.js. Start recording, use your page, and Exhibit explains each REST, GraphQL, form, or fetch request in one sentence: which recent interaction it followed, what kind of request it was, what came back, how long it took, and how confident that reading is. Every claim links back to the protocol facts behind it.

Inspect gives you the developer view — headers, bodies, timing phases, initiator, and an evidence ledger — with Structured, Text, and Raw protocol body modes.

Built for privacy:
• No server, no account, no analytics, no outbound requests.
• Authorization and cookie headers, credential-shaped fields, and token-like values are redacted before anything is stored, shown, or exported.
• No required host permissions. Interaction access is optional and requested for the inspected page's origin only when you start recording. Chrome keeps the origin grant until you revoke it or uninstall.
• Captured evidence is held in browser-session memory and is never written to disk. It clears when your browser session ends, or sooner if you press Clear. Export before closing the browser if you need to keep it.

Also included: API-first filtering, method/domain/protocol/outcome/cache facets, failure/slow/cache quick filters, full-text search, custom additive redaction names, repeated-call comparison, safe cURL copy, sanitized HAR 1.2 export, and a Markdown QA report.

Exhibit reports only what the browser can prove. It cannot see server-to-server traffic, and it never guesses a server function name.
```

The retention bullet is deliberately explicit that evidence disappears with the
browser session. Omitting it would earn one-star "it lost my data" reviews for
behaviour that is intentional.

## Privacy practices tab

Every field below is required before the dashboard will publish. All of them
live on the **Privacy practices** tab except the contact email, which is on
**Settings** and must also be verified through an email loop.

### Single purpose

```
Exhibit records the network requests a page makes while the user is recording in DevTools, and presents them as redacted, explained evidence that the user can inspect and export locally.
```

Every permission below serves that purpose. The extension has no second
function: it does not modify traffic, does not sync, and does not communicate
with any server.

### Permission justification — storage

```
Keeps the browser-session-memory recording plus the user's theme and custom redaction field names on the user's own machine. Captured evidence is held in chrome.storage.session and is never written to disk; chrome.storage.local holds only the theme and redaction settings. Nothing is transmitted anywhere.
```

### Permission justification — scripting

```
Injects a small collector into the inspected tab to observe trusted click, submit, and navigation events, so recorded requests can be grouped under the interaction that preceded them. The collector reads event metadata only. It does not read form field values, page content, or credentials, and it transmits nothing.
```

### Permission justification — optional host access

Applies to `http://*/*` and `https://*/*`, which are declared as
`optional_host_permissions` only.

```
Requested only when the user presses Start, and only for the origin of the page they are already inspecting in DevTools. It is used solely to observe safe click, submit, and navigation metadata for interaction grouping. Chrome's grant covers that origin across tabs and persists until revoked, but Exhibit activates its collector only in the inspected tab. Field values are not read and no captured content is transmitted.
```

### Remote code use

Answered **No, I am not using remote code.**

```
All code is contained in the extension package. There are no remote scripts, no inline scripts, no eval, and no externally hosted modules. This is enforced by an automated package audit that fails the release if any remote URL, remote script, or inline script appears in the built package.
```

That claim is verifiable rather than promotional: `pnpm audit:package` gates it
on every release.

### Data usage — categories declared

| Category                                             | Declared | Why                                                            |
| ---------------------------------------------------- | -------- | -------------------------------------------------------------- |
| Authentication information                           | Yes      | Authorization headers and tokens pass through before redaction |
| Website content                                      | Yes      | Request and response bodies                                    |
| Web history                                          | Yes      | Request URLs from the inspected tab                            |
| User activity                                        | Yes      | Click, submit, and navigation events                           |
| Personally identifiable information                  | Yes      | Whatever the inspected page happens to send                    |
| Health, financial, location, personal communications | No       | Not targeted; present only if the user's own page sends them   |

Do not answer every category **No** merely because processing is local. The
dashboard asks what the extension _handles_, not what it transmits.
Under-declaring is a takedown risk; over-declaring only makes the listing read
as more invasive than it is.

The last row is a publisher judgement rather than a fact about the code. Such
data could appear in captured traffic, but only because the user chose to record
their own authorized page.

### Certifications

All three are checked, and all three are true — there is no backend, no
telemetry, and no network client:

- data is not sold or transferred to third parties outside the approved use cases;
- data is not used or transferred for purposes unrelated to the single purpose;
- data is not used or transferred to determine creditworthiness or for lending.

### Accurate product behaviour behind those answers

- captured data is used only for the user-requested debugging workflow;
- data is processed locally and is not transmitted to Exhibit or a third party;
- user-initiated safe cURL copy writes sanitized text to the operating-system
  clipboard, where it can outlive the panel;
- known credential material is redacted before storage, display, copy, or
  export, subject to the documented detection limits;
- captured evidence is held in browser-session memory only and is never written
  to disk, so there is no evidence at rest to encrypt or disclose; the package
  audit enforces this against the shipped bytes;
- the user chooses whether to export, clear, or uninstall.

## Privacy policy URL

```
https://kayumuzzaman.github.io/exhibit/PRIVACY
```

Served by GitHub Pages from `main` under `/docs`, with HTTPS enforced. It must
stay reachable for as long as the item is listed.

## Publisher contact email

`i.kayumuzzaman@gmail.com`, set on the **Settings** page and verified through
Chrome's email loop. It matches the contact in
[PRIVACY.md](./PRIVACY.md) deliberately — a listing whose contact disagrees with
its own privacy policy is a review flag.

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

## Release checklist

The ordered, current version lives in
[RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md), together with the compatibility
position from [COMPATIBILITY.md](./COMPATIBILITY.md) and everything still
awaiting an owner decision.
