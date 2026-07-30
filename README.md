# Exhibit

The Chrome DevTools panel that explains Next.js network traffic — and redacts
credentials before anything reaches the screen.

> **Status:** not yet on the Chrome Web Store. Licence, owner, contacts, and
> evidence retention are settled and a clean release artifact is recorded. What
> remains is a hosted privacy-policy URL, a product video, and validation with
> real users. See [release decisions](./docs/RELEASE_DECISIONS.md).

A Server Action is an opaque `POST` in the Network panel. An RSC navigation is a
byte stream. Exhibit classifies both, partially decodes React Flight payloads
with an explicit decode reason, and states the evidence behind every claim.

It does the same for ordinary REST, GraphQL, and form traffic: each request gets
a one-sentence explanation with visible confidence, and the raw protocol facts
stay one click away.

Because known credential names and shapes are redacted before evidence is
stored, shown, copied, or exported, a screenshot of the panel is safe to attach
to a ticket. There is no server, no account, and no telemetry. Captured evidence
can still be sensitive.

## Quick start

```bash
pnpm install
pnpm build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**,
and select `.output/chrome-mv3`. Open DevTools on any regular web page and pick
the **Exhibit** panel.

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

Exhibit reports only what a browser observer can prove. It cannot see
server-to-server traffic and never guesses a server function name. See
[capture limits](./docs/CAPTURE_LIMITS.md).

## Scripts

| Command                   | Purpose                                                |
| ------------------------- | ------------------------------------------------------ |
| `pnpm build`              | Production Chrome MV3 build into `.output/chrome-mv3`. |
| `pnpm test`               | Unit and integration tests.                            |
| `pnpm test:coverage`      | The same tests with the 90% four-metric gate.          |
| `pnpm test:e2e`           | Playwright end-to-end suite (run `pnpm build` first).  |
| `pnpm screenshots`        | Regenerate deterministic fixture-driven store PNGs.    |
| `pnpm promo-tile`         | Regenerate the 440×280 Chrome Web Store promo tile.    |
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
- [Contributing](./CONTRIBUTING.md)
- [Security policy](./SECURITY.md)
- [Support](./SUPPORT.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Capture limits](./docs/CAPTURE_LIMITS.md)
- [Verification](./docs/VERIFICATION.md)
- [Chrome Web Store listing](./docs/CHROME_WEB_STORE.md)
- [Release decisions](./docs/RELEASE_DECISIONS.md)
- [Release checklist](./docs/RELEASE_CHECKLIST.md)
- [Compatibility floor](./docs/COMPATIBILITY.md)
- [Changelog](./CHANGELOG.md)

## Licence

MIT. See [LICENSE](./LICENSE).

The copyright holder's legal name is still a placeholder; it must be set before
publication. See [release decisions](./docs/RELEASE_DECISIONS.md).
