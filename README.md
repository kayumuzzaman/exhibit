# Payloadra

Privacy-first browser request evidence for Chrome DevTools.

> **Status:** internal preview, not released. Automated coverage is broad, but
> the approved version 0.1 contract still has installed-Chrome, licensing, and
> public-contact blockers. See [release traceability](./docs/TRACEABILITY.md).

Payloadra records the requests a page actually made, explains each one in a
sentence backed by protocol facts, and lets you inspect the sanitized evidence.
There is no server, no account, and no telemetry: everything is processed and
stored locally, and known credential names and shapes are redacted before
evidence is stored, shown, or exported. Captured evidence can still be
sensitive.

## Quick start

```bash
pnpm install
pnpm build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**,
and select `.output/chrome-mv3`. Open DevTools on any regular web page and pick
the **Payloadra** panel.

Requires Node 22.13+ within the 22.x line or Node 24+, pnpm 10+, and Chrome
120+.

## What it does

- **Record** browser-visible requests while DevTools is open, grouped by the
  recent trusted interaction observed before them.
- **Explain** each request: observed context, kind, outcome, duration, and
  classification confidence, with the evidence behind every claim.
- **Inspect** headers, bodies, timing phases, initiator, and an evidence ledger,
  with Structured, Text, and Raw protocol body modes.
- **Filter, search, and compare** repeated calls, failures, slow calls, and
  cache hits, including method, domain, protocol, outcome, and cache facets.
- **Export or copy** a sanitized HAR 1.2 file, deterministic Markdown QA report,
  or safe cURL command.

Payloadra reports only what a browser observer can prove. It cannot see
server-to-server traffic and never guesses a server function name. See
[capture limits](./docs/CAPTURE_LIMITS.md).

## Scripts

| Command                   | Purpose                                                |
| ------------------------- | ------------------------------------------------------ |
| `pnpm build`              | Production Chrome MV3 build into `.output/chrome-mv3`. |
| `pnpm test`               | Unit and integration tests.                            |
| `pnpm test:coverage`      | The same tests with the 90% four-metric gate.          |
| `pnpm test:e2e`           | Playwright end-to-end suite (run `pnpm build` first).  |
| `pnpm screenshots`        | Regenerate deterministic 1280×800 store screenshots.   |
| `pnpm audit:package`      | Static audit of the built package.                     |
| `pnpm audit:dependencies` | Reject known high/critical dependency vulnerabilities. |
| `pnpm check`              | Format, lint, types, coverage, build.                  |
| `pnpm verify`             | Full gate: checks, package/dependency audits, and E2E. |
| `pnpm release:artifact`   | `pnpm verify`, then `wxt zip`.                         |

## Documentation

- [User guide](./docs/README.md)
- [Product brief](./docs/PRODUCT.md)
- [Release traceability](./docs/TRACEABILITY.md)
- [Roadmap](./docs/ROADMAP.md)
- [Business model](./docs/BUSINESS_MODEL.md)
- [Competitive landscape](./docs/COMPETITIVE_LANDSCAPE.md)
- [Privacy policy](./docs/PRIVACY.md)
- [Security policy](./SECURITY.md)
- [Support](./SUPPORT.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Capture limits](./docs/CAPTURE_LIMITS.md)
- [Verification](./docs/VERIFICATION.md)
- [Chrome Web Store listing](./docs/CHROME_WEB_STORE.md)
- [Release checklist](./docs/RELEASE_CHECKLIST.md)
- [Compatibility floor](./docs/COMPATIBILITY.md)
- [Changelog](./CHANGELOG.md)

## Licence

All rights reserved. See [LICENSE](./LICENSE). This repository grants no
distribution rights; publishing requires the owner to choose a licence first.
