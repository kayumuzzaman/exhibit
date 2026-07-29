# Changelog

All notable changes to Payloadra are recorded here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Findings and remediations from a full review of the 0.1.0 build.
These changes remain a development candidate; the 0.1.0 artifact is not recut
as a release until owner acceptance is complete.

### Added

- Product, business-model, competitive-landscape, roadmap, release-traceability,
  security, and support records for the internal release audit.
- A high/critical dependency audit in the release gate.
- An explicit Evidence retention selector for browser-session memory or local
  persistence until Clear.
- Versioned local settings for theme and bounded additive custom
  credential-field names, with mandatory redaction rules always enforced.
- Incremental interaction-aware search and method, domain, protocol, outcome,
  and cache facets that intersect with quick filters.
- A 20-second active-panel heartbeat for the background interaction lease.
- A deterministic screenshot command and a greater-than-400 KiB React Flight
  performance fixture with bounded warning and output assertions.
- An interaction-group rail that scopes the request ledger to a trusted page
  action or the explicit Unattributed group.
- An export chooser for sanitized HAR 1.2 and Markdown QA reports, with the
  enforced-redaction state, request count, and selected format visible before
  download.
- A toolbar popup. Chrome offers no API for opening DevTools from an extension,
  so clicking the icon previously did nothing at all; the popup now explains
  where the panel lives, and when DevTools is already open on the tab it offers
  a button that switches straight to the Payloadra panel (Chrome 140+, which is
  where `ExtensionPanel.show` arrived).

### Fixed

- The build/test dependency graph now has zero known advisories: WXT and ESLint
  were upgraded, patched PostCSS and esbuild versions are enforced, and unused
  Next.js image-processing binaries are omitted from the fixture toolchain.
- Short valid HTTP Basic credentials are now redacted under custom header names
  without treating ordinary prose such as “Basic plan” as a credential.
- Valid header-dense sessions at the documented 500-request cap now survive
  storage validation and recovery.
- Live response-content retrieval now uses shared bounded concurrency, so
  stalled callbacks drain in configured timeout waves without reordering or
  duplicating observations.
- Panel reload now flushes pending local snapshots, and a recovered active
  session is shown as stopped instead of falsely claiming that its destroyed
  capture sources are still recording.
- The persisted-capture performance regression now receives a test timeout that
  covers its documented three-attempt measurement envelope.
- Capture no longer waits on the debounced storage write. `accept` awaited each
  repository write, so every captured request stalled the pipeline for a whole
  debounce window and capped capture at roughly ten requests per second; 300
  requests through the default retention path took 32.0s and now take 0.36s.
- Session encoding moved from every `save` call to the flush in both
  repositories, and the IndexedDB repository gained the debounced coalescing the
  session-storage repository already had, replacing one full transaction per
  captured request.
- A retention change no longer discards interactions that arrive while the
  migration write is in flight, and `start`, `stop`, and `clear` no longer
  swallow an operation queued behind an opposing one.
- Server Actions are reported as confirmed only when a Flight response backs the
  `Next-Action` request header, which any script on the page can send.
- React Flight decode warnings collapse duplicates and stop at a hard cap, so a
  body carrying thousands of unresolved references can no longer flood the
  panel with one list item per reference.
- The panel boots within a bounded time and reports a failed boot instead of
  rendering an empty root.
- Credential redaction covers URL path segments, untyped JSON bodies, and
  further credential-shaped header and field names.
- Panel layout, focus, and announcement corrections across the narrow and phone
  layouts, the timing waterfall axis, tab and grid semantics, evidence copy
  scoping, and pointer-driven resizing.
- Explain/Inspect and Inspect-subtab state now survives wide, medium, narrow,
  and phone layout remounts.
- Interaction copy now describes the implemented five-second temporal
  correlation instead of claiming that a click or submit caused a request.
- Interaction groups expose trusted, untrusted-hint, and unattributed states;
  selecting a zero-request group clears stale request detail.
- Repository flush failures now reject their public flush promise while timer
  callbacks contain expected background failures.
- Stored-session validation uses a tighter traversal budget, and an interrupted
  recording's recovered stopped timestamp is persisted so repeated reloads stay
  stable.
- Optional-host documentation now states that Chrome grants persistent,
  origin-wide access even though Payloadra's collector use is inspected-tab
  scoped.
- Static assets are captured under the production contract while the API-only
  choice remains a display filter, matching capture, recovery, and export.
- Corrupt storage recovery preserves the exact damaged record for explicit
  clearing, and a fresh IndexedDB without a current-session locator no longer
  raises a false corruption warning.
- Every ledger value now sits under its own heading. The selected-row marker was
  a row pseudo-element, which generates an anonymous leading table cell, so
  Method, Duration, Evidence and every other value rendered one column right of
  the heading that named it and the last column overflowed the pane.
- The ledger keeps Time, Method, Route, Status, and Duration whole at ordinary
  widths and reveals Kind, Source, and Evidence once the pane can show all eight
  columns without clipping.
- The empty ledger now offers a Record this page control instead of naming a
  command the user has to go and find.
- The detail pane no longer answers an empty ledger with a competing
  "No evidence selected" heading.
- The panel follows the DevTools theme by default rather than the operating
  system, so it stops arriving light inside a dark DevTools window.
- Recovered sessions recompute classification and explanation from their
  sanitized evidence. The recovery boundary discards stored analysis so it is
  never trusted, which left every recovered request classified as unknown and
  hidden behind the ledger's API-first default after a panel reload.
- Search synchronizes new request and interaction terms without rebuilding the
  whole index.
- Custom redaction settings are normalized, deduplicated, bounded, loaded
  before recovery and capture, and re-applied to recovered evidence.
- Phone controls and evidence rows meet the 44 CSS pixel target, and evidence
  tabs no longer overflow the medium-width workspace.
- The interface font is IBM Plex Sans, replacing generic Inter while preserving
  JetBrains Mono for evidence; the full-source Impeccable detector is clean.
- The release gate builds before coverage so package-contract tests cannot
  silently skip on a clean worktree, and the screenshot runner is pinned.

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
