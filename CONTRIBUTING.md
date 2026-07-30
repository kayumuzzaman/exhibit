# Contributing to Exhibit

Exhibit is a Chrome DevTools panel that turns browser-visible network traffic
into sanitized, evidence-backed explanations. It is MIT licensed, and
contributions are welcome.

Before opening a pull request, read [what Exhibit refuses to do](#what-exhibit-refuses-to-do).
Several tempting features are deliberately absent, and a PR that adds one will
be declined however well it is written.

## Branch and review rules

`main` is protected:

- changes reach `main` through a pull request; there is no direct push;
- each pull request needs at least one approving review;
- a new push to the branch dismisses stale approvals;
- review conversations must be resolved before merge;
- force pushes and branch deletion are blocked.

The repository owner can bypass these rules, which is how solo maintenance
proceeds — GitHub does not allow anyone to approve their own pull request.

## Getting set up

```bash
pnpm install
pnpm build          # production Chrome MV3 build into .output/chrome-mv3
```

Load the unpacked extension from `.output/chrome-mv3` at `chrome://extensions`
with Developer mode enabled, then open DevTools on any regular web page and pick
the **Exhibit** panel.

Node 22.13+ within the 22.x line or Node 24+, pnpm 10+, Chrome 120+.

## Before you open a pull request

```bash
pnpm verify
```

That is the whole gate: format, lint, strict types, production build, tests with
a 90% four-metric coverage threshold, package and dependency audits, and the
Playwright end-to-end suite. It must exit 0. A PR that fails it will not be
reviewed until it passes.

Useful subsets while working:

| Command              | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `pnpm test`          | Unit and integration tests                         |
| `pnpm test:e2e`      | End-to-end suite — run `pnpm build` first          |
| `pnpm typecheck`     | `tsc --noEmit` in strict mode                      |
| `pnpm audit:package` | Static audit of the built package                  |
| `pnpm screenshots`   | Regenerate the store screenshots after a UI change |
| `pnpm promo-tile`    | Regenerate the store promo tile                    |

## The rules that are not style preferences

These are enforced by the gate, and a change that breaks one is a defect rather
than a disagreement.

**Redaction happens before a record becomes displayable.** Known credential
names and shapes are removed before evidence reaches storage, the screen, the
clipboard, cURL, HAR, or a report. There is no setting that turns this off, and
none may be added. Detection is deliberately finite and documented; widening it
is welcome, weakening the boundary is not.

**Nothing leaves the machine.** The extension has no backend, no telemetry, and
no network client. `pnpm audit:package` fails the build on an unapproved
network destination, a remote script, or an inline script.

**Captured evidence is never written to disk.** The published panel holds
evidence in browser-session memory only. The package audit fails the release if
an evidence-capable persistent storage API appears in the shipped bytes.
`chrome.storage.local` holds the theme and custom redaction field names, never
evidence.

**Evidence before inference.** Every explanation names the protocol facts behind
it and states its confidence. Unknown stays unknown — Exhibit never guesses a
server function name from an opaque identifier. If a claim cannot be traced to
something the browser observed, it does not belong in the panel.

**No required host permissions.** Origin access is optional and requested only
when recording starts.

## What Exhibit refuses to do

Out of scope by design, not by omission:

- modifying, mocking, replaying, redirecting, or throttling traffic;
- proxying, TLS interception, or capture outside the inspected browser tab;
- screen or video recording, console capture, or ticket routing;
- accounts, cloud sync, share links, or any collaboration surface;
- unattended production monitoring or behavioural analytics.

Chrome's own Network panel is better for most debugging. Exhibit earns its place
when request evidence has to leave the browser safely, and when the application
is Next.js. See [the competitive landscape](./docs/COMPETITIVE_LANDSCAPE.md) for
the honest comparison.

## Reporting problems

- **Bugs and questions:** [open an issue](https://github.com/kayumuzzaman/exhibit/issues).
- **Security vulnerabilities:** do not open a public issue. Follow
  [SECURITY.md](./SECURITY.md), which routes to a private advisory. Never attach
  a real credential, captured session, or customer URL — use a canary value.

## Where to read next

| Document                                   | Covers                            |
| ------------------------------------------ | --------------------------------- |
| [Architecture](./docs/ARCHITECTURE.md)     | Layers, data flow, adapters       |
| [Capture limits](./docs/CAPTURE_LIMITS.md) | What a browser observer can prove |
| [Product brief](./docs/PRODUCT.md)         | Who it is for and why             |
| [Verification](./docs/VERIFICATION.md)     | The release gate and its evidence |
