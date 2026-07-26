# Changelog

All notable changes to Payloadra are recorded here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-07-26

First complete build of the product. Not published; the repository is private
and `UNLICENSED`.

### Added

- Reproducible Chrome MV3 extension built with WXT, React 19, and strict
  TypeScript, exposing a DevTools panel and a background service worker.
- Redaction-first privacy boundary: authorization and cookie headers,
  credential-shaped field names, and token-like values are removed before any
  record is stored, displayed, or exported, and redaction fails closed.
- HAR normalization with an explicit body policy covering available, truncated,
  binary, streamed, and unavailable states.
- Protocol and Next.js classification with per-finding evidence and confidence,
  including Server Action, RSC, SSR, Next API, GraphQL, form, and static kinds.
- Bounded session repositories for memory and local retention, with schema
  validation, re-redaction, and reissued identifiers on recovery.
- Tab-scoped interaction capture with leases, an injected collector, a main
  world history hook, and time-window correlation to requests.
- Chrome DevTools capture adapter combining live request events with HAR
  reconciliation, de-duplication, visibility-aware polling, and content
  retrieval with timeouts.
- Search, filters, repeated-call comparison, safe cURL, sanitized HAR export,
  and a Markdown QA report.
- Accessible, responsive panel shell with wide, medium, narrow, and phone
  layouts, keyboard-operable tables, tabs, separators, and dialogs.
- Explain and Inspect workspaces with lazy body rendering, partial React Flight
  decoding beside a raw protocol fallback, and a timing waterfall labelled with
  text and patterns as well as colour.
- Deterministic fixture applications and an automatic end-to-end suite covering
  recording, privacy, accessibility, retention, real Next.js evidence, and the
  packaged MV3 extension.
- Release tooling: a static package audit, performance budgets, and a single
  `pnpm verify` gate.

### Security

- The packaged extension declares no required host permissions, no
  `externally_connectable` surface, and ships no remote or inline scripts; this
  is enforced on every release by `pnpm audit:package`.
