# Chrome Web Store listing

This is the prepared listing copy. Payloadra is currently `UNLICENSED` and
private; publishing requires the owner to choose a licence first.

## Item details

- **Name:** Payloadra
- **Summary (132 characters max):** Privacy-first browser request evidence for
  DevTools. Record, explain, and inspect what your page actually sent.
- **Category:** Developer Tools
- **Language:** English

## Detailed description

> Payloadra is a DevTools panel that turns browser network activity into
> evidence you can read.
>
> Start recording, use your page, and Payloadra explains each request in one
> sentence: what triggered it, what kind of request it was, what came back, how
> long it took, and how confident that reading is. Every claim links back to the
> protocol facts behind it.
>
> Inspect gives you the developer view — headers, bodies, timing phases,
> initiator, and an evidence ledger — with Structured, Text, and Raw protocol
> body modes, including partial React Flight decoding with a raw fallback.
>
> Built for privacy:
> • No server, no account, no analytics, no outbound requests.
> • Authorization and cookie headers, credential-shaped fields, and token-like
> values are redacted before anything is stored, shown, or exported.
> • No required host permissions. Interaction access is optional, per tab, and
> requested only when you start recording.
> • Evidence stays on your machine and can be cleared at any time.
>
> Also included: API-first filtering, failure/slow/cache quick filters, full-text
> search, repeated-call comparison, safe cURL copy, sanitized HAR 1.2 export, and
> a Markdown QA report.
>
> Payloadra reports only what the browser can prove. It cannot see
> server-to-server traffic, and it never guesses a server function name.

## Permission justifications

- **storage** — Keeps the current recording session on the user's machine so the
  DevTools panel can be closed and reopened without losing evidence.
- **scripting** — Injects a small collector into the inspected tab to record
  trusted click, submit, and navigation events so requests can be grouped under
  the interaction that caused them.
- **Optional host access (`http://*/*`, `https://*/*`)** — Requested only when
  the user presses Start, only for the tab being inspected, and only to observe
  interactions on that page. No content is read or transmitted.
- **Remote code** — None. The package contains no remote scripts, no inline
  scripts, and no remote URLs; this is enforced by `pnpm audit:package`.

## Data usage disclosures

- Does this item collect personally identifiable information? **No.**
- Health, financial, authentication, personal communications, location, web
  history, user activity, website content? **No** — data is processed locally,
  never transmitted, and credential material is redacted before storage.
- Is data sold to third parties? **No.**
- Is data used for purposes unrelated to the item's core functionality? **No.**
- Is data used to determine creditworthiness or for lending? **No.**

## Screenshot requirements

Provide five 1280 × 800 PNG screenshots, captured on the wide layout in dark
theme unless noted:

1. **Recording ledger** — command bar recording, session rail, populated ledger.
2. **Explain workspace** — outcome sentence, action identifier, submitted
   shape, and the "Why Payloadra says this" disclosure expanded.
3. **Inspect overview and timing** — evidence tabs with the timing waterfall
   showing text labels and patterns.
4. **Raw protocol fallback** — a partially decoded React Flight body beside its
   raw protocol tab.
5. **Privacy** — a request whose authorization header, query token, and body
   field all display `[REDACTED]`.

Also supply a 128 × 128 store icon (`public/icon/128.png`) and, optionally, a
1400 × 560 marquee tile. Screenshots must contain no real credentials, no real
customer data, and no third-party branding.

## Release checklist

1. `pnpm release:artifact`
2. Confirm `.output/payloadra-0.1.0-chrome.zip` exists.
3. Confirm the package audit reported zero remote URLs and exactly
   `["scripting","storage"]`.
4. Record the browser smoke result in [VERIFICATION.md](./VERIFICATION.md).
5. Choose and add a licence before uploading.
