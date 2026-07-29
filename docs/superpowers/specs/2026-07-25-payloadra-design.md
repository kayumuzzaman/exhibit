# Payloadra Product and Technical Design

**Status:** Approved for implementation
**Date:** 2026-07-25
**Approval basis:** The supplied “Payloadra — Full Product Plan” explicitly requests full autonomous implementation. This document makes implementation choices without changing that approved product scope.

## 1. Product

Payloadra is a local-first Chrome DevTools extension for QA engineers, developers, and support teams. A user opens DevTools on an authorized tab, starts recording, exercises the site, and gets an evidence-led explanation of every browser-visible API interaction.

Payloadra answers:

- What browser-visible calls happened?
- Which recent user interaction or navigation preceded each call?
- What was sent and returned?
- Did the request succeed, fail, redirect, repeat, hit cache, or pass through a service worker?
- Is the request a generic API call, GraphQL operation, probable Next.js API route, Server Action, SSR document, or React Server Component payload?
- Can safe evidence be copied or exported for a bug report?

Payloadra never claims visibility into server-to-server traffic that Chrome did not receive.

## 2. Release Scope

Version 1 includes phases 1–4 of the supplied plan:

- Manifest V3 Chrome extension and Payloadra DevTools panel.
- Explicit Start, Stop, Clear, retention, and export controls.
- Generic browser request capture and evidence normalization.
- Explain and Inspect modes.
- Interaction grouping, search, filters, comparison, and timing.
- REST, GraphQL, forms, Next.js API, Server Action, SSR, and RSC classification.
- Safe partial React Flight decoding with raw fallback.
- Default-on redaction before storage, display, copy, or export.
- Ephemeral and persistent local-only retention.
- Sanitized HAR and concise Markdown QA-report export.
- Accessibility, keyboard navigation, responsive DevTools layouts, and theme support.
- Unit, integration, fixture, and automatic browser end-to-end tests.
- Chrome Web Store compliance documentation and packaged artifact.

Explicitly deferred:

- Cloud sync, accounts, telemetry, collaboration, and remote storage.
- A proxy, SDK, desktop companion, or website code changes.
- Claims about hidden server traffic.
- Firefox implementation and team reporting. These remain evidence-gated expansion work.

## 3. Architecture Decision

### Selected: WXT + React + strict TypeScript

WXT provides Manifest V3 output, file-based extension entrypoints, React integration, test support, and reproducible packaging while retaining direct access to Chrome DevTools APIs. Domain logic remains framework-independent behind typed ports.

### Rejected alternatives

1. **Raw Vite plus hand-maintained manifest:** maximum control, but adds custom build, reload, manifest, and packaging plumbing without improving capture fidelity.
2. **Chrome Debugger Protocol or local proxy:** richer low-level events, but `chrome.debugger` competes with an open DevTools session and a proxy violates the no-proxy product contract.

## 4. Runtime Components

### DevTools bootstrap

Creates one “Payloadra” panel per inspected tab. It owns no product state and only registers the panel.

### Panel application

Owns the recording lifecycle, network listener, session model, views, search, filters, export, settings, and accessibility behavior. It consumes the `CaptureSource`, `SessionRepository`, and `InteractionSource` ports.

### Chrome capture adapter

Uses `chrome.devtools.network.onRequestFinished`, `getHAR()`, and `Request.getContent()`. It:

- records only requests whose start time is inside the active recording window;
- wraps callback-based APIs for Chrome 120+ compatibility;
- periodically reconciles the HAR while recording and once at Stop, catching failed or incomplete entries that do not emit a normal completion event;
- preserves HAR evidence even when a body is unavailable;
- never uses `chrome.debugger`.

### Interaction bridge

On Start, a background worker requests the current origin’s optional host permission from the user gesture, then injects a small isolated content script into the inspected tab. The script captures metadata—not field values—for clicks, submits, history navigation, and page navigation. Events are timestamped before page handlers run and relayed through a tab-scoped runtime port.

If permission is denied or the page is restricted, network capture still works and the UI clearly labels interaction grouping as unavailable.

### Normalization and analysis pipeline

Each observed request passes through deterministic, separately testable stages:

1. Convert HAR and response content into an immutable `CapturedRequest`.
2. Apply size policy and content-state labels.
3. Redact sensitive material before any repository write.
4. Classify protocol and framework evidence with confidence and reasons.
5. Correlate redirects, repeated calls, navigation, and interaction events.
6. Produce plain-language explanation facts.
7. Add the record to the bounded session ring.

No stage mutates raw Chrome objects.

### Local repositories

- **Ephemeral default:** in-memory working set with debounced snapshots to `chrome.storage.session`; cleared by browser restart, extension reload, or explicit Clear.
- **Persistent optional:** IndexedDB in the extension origin; retained until explicit Clear. Settings remain in `chrome.storage.local`.
- Both implementations obey the same byte-aware ring-buffer contract.
- Sensitive content is redacted before either backend sees it.

## 5. Capture Contract and Honest Limits

Payloadra captures only browser-visible DevTools evidence. A request may lack a body because it is binary, streamed, cached, blocked, too large, canceled, compressed in an unsupported way, or unavailable through Chrome’s API.

The UI uses three confidence levels:

- **Confirmed:** direct protocol or HAR evidence.
- **Likely:** multiple strong heuristics, phrased as “likely” or “possible.”
- **Unknown:** insufficient evidence; no guessed explanation.

Specific rules:

- `Next-Action` confirms a Server Action identifier, but never a source function name.
- `text/x-component`, `RSC`, router-state headers, and `_rsc` provide RSC evidence.
- `/api/` plus Next.js evidence yields “Likely Next.js API route”; path alone is not definitive.
- Repeated method/normalized-URL calls are “repeated calls” unless HAR evidence proves a retry.
- CORS, CSP, cache, and service-worker statements name the evidence used; ambiguous failures stay ambiguous.
- React Flight decoding is bounded and fault-tolerant. Known chunk structures are presented; unknown tags and unresolved references retain raw protocol.

## 6. Privacy and Permissions

- Recording is off by default and tab-scoped.
- No background capture and no remote requests from the extension.
- No analytics, telemetry, cloud sync, remote fonts, remote scripts, or remotely hosted code.
- Optional per-origin host permission is requested only when interaction
  capture starts. Chrome keeps the origin-wide grant until the user revokes it
  or uninstalls; collector use remains scoped to the inspected tab.
- Redaction happens before storage, render, clipboard copy, cURL generation, or export.
- Export always requires confirmation and shows redaction status, item count, and destination format.
- Restricted pages fail closed with a clear explanation.

Default redaction covers:

- `Authorization`, `Proxy-Authorization`, `Cookie`, and `Set-Cookie`.
- Password, token, secret, API-key, session, credential, and CSRF-like key names.
- Query strings, JSON, form-urlencoded, multipart fields, GraphQL variables, and nested arrays/objects.
- JWTs, bearer tokens, common API-key shapes, and user-configured case-insensitive field names.

Redaction preserves structure and replaces values with stable `[REDACTED]` markers. It never logs the removed value.

## 7. Performance Policy

- API-first list; static assets hidden unless enabled.
- Default session cap: 500 requests and 8 MiB serialized redacted data, whichever arrives first.
- Default per-request text-body capture: 512 KiB; larger bodies are truncated with original-size metadata.
- Binary bodies are summarized, not decoded.
- Body decoding and structured rendering are lazy.
- Search indexes normalized redacted text and updates incrementally.
- HAR reconciliation runs at a bounded interval and pauses when recording stops or panel is hidden.
- Oldest records are evicted first; session summary reports eviction count.
- Expensive classification and decoding functions are pure and benchmarked against large fixtures.

## 8. Domain Model

Core records:

- `RecordingSession`: identity, inspected origin, lifecycle timestamps, retention mode, limits, counts, and warnings.
- `CapturedRequest`: immutable redacted request/response, HAR timing, content state, initiator, protocol classification, evidence, and body metadata.
- `InteractionEvent`: click, submit, navigation, or history action with timestamp and safe element metadata.
- `InteractionGroup`: one event or navigation plus correlated request IDs.
- `Classification`: kind, confidence, evidence strings, and framework details.
- `Explanation`: outcome, plain-language summary, guidance, and evidence references.
- `ExportArtifact`: sanitized HAR or Markdown report plus redaction manifest.

IDs are generated locally. URLs retain origin and route while sensitive query values are redacted.

## 9. User Experience

### Visual direction

“Calm forensic workspace”: dense enough for developers, legible enough for QA. Deep graphite and warm porcelain surfaces, electric-cyan live state, mint success, amber caution, and coral failure. Typography uses a bundled humanist sans for interface copy and bundled mono for evidence. No gradients, decorative dashboards, or generic card grids.

### Layout

- **Top command bar:** brand, inspected origin, recording status, Start/Stop, Clear, Export, and settings.
- **Left rail:** session summary, filter chips, saved quick filters, and interaction groups.
- **Main request table:** time, method, route, classification, status, duration, source, and compact evidence badges.
- **Detail workspace:** Explain/Inspect segmented switch, request/response tabs, timing waterfall, initiator, related calls, raw evidence, and copy tools.
- Wide panels use three resizable regions. Narrow panels collapse to list → detail navigation without losing state.

### Empty and degraded states

Every non-happy path gets a designed state:

- not recording;
- recording with no API calls;
- interaction permission unavailable;
- body unavailable or truncated;
- unsupported Flight chunk;
- no filter matches;
- storage cap eviction;
- restricted Chrome page;
- capture API error;
- export canceled or failed.

### Accessibility

- WCAG 2.2 AA color contrast.
- Full keyboard operation, visible focus, semantic landmarks, table semantics, labels, and live regions.
- Roving selection for request rows; shortcuts never override browser/DevTools defaults.
- Reduced-motion support.
- Status never relies on color alone.
- Light, dark, and system/DevTools theme modes.

## 10. Explain and Inspect Behavior

**Explain** leads with one sentence: recent correlated interaction, request kind,
outcome, duration, and confidence, without claiming causation. It then shows
safe submitted fields, returned result summary, related calls,
cache/repeat/redirect facts, and evidence-based next steps.

**Inspect** exposes normalized and raw evidence:

- URL, method, query, headers, cookies as redacted entries.
- Request and response bodies with structured/text/raw modes.
- Status and HAR timing waterfall.
- Initiator and interaction correlation.
- Redirect chain and repeated-call comparison.
- Cache, service-worker, CORS/CSP, truncation, encoding, and support states.
- Copy safe cURL and copy field actions.

The same redacted domain record powers both views, preventing privacy drift.

## 11. Export

Sanitized HAR export:

- emits HAR 1.2-compatible session metadata and entries;
- includes only redacted/truncated content already present in the session;
- marks Payloadra-specific classification and redaction metadata under namespaced extension fields;
- excludes browser cookies and authorization values even if custom redaction settings are relaxed.

QA report export:

- Markdown summary with environment, interaction groups, failed/slow/repeated requests, evidence, and reproduction timeline;
- deterministic ordering and stable formatting for issue trackers;
- no embedded binary content.

## 12. Test Strategy

All implementation follows red → green → refactor.

### Coverage gate

Vitest enforces at least **90% statements, branches, functions, and lines** across substantive source code. Generated output, fixture applications, type declarations, and one-line entrypoint bootstraps are excluded; domain, adapters, state, exports, and UI behavior are not.

### Unit and component tests

- HAR normalization and unavailable-body states.
- Protocol classification and confidence.
- Server Action and React Flight fixtures, including unknown tags.
- Redaction for headers, URLs, JSON, forms, multipart, GraphQL, patterns, and malicious nesting.
- Interaction grouping, redirects, repeated calls, timing, eviction, and storage recovery.
- cURL, HAR, and Markdown generation.
- Reducers, filters, search, keyboard behavior, error boundaries, and accessible states.

### Integration fixtures

A local fixture server covers REST, GraphQL, fetch, XHR, forms, redirect, delay, cancellation, cache, service worker, CORS/CSP-like failures, upload, download, stream, binary, large bodies, and secrets. A minimal supported Next.js fixture covers API routes, Server Action success/failure, SSR navigation, and RSC/Flight responses.

### Automatic browser E2E

Playwright launches its persistent Chromium build with the unpacked MV3 extension. Tests cover:

- extension/service-worker startup;
- panel workflow through a testable capture port;
- live fixture interactions, recording lifecycle, grouping, Explain/Inspect, filters, search, compare, redaction, retention, clear, and export;
- keyboard-only core workflow and automated accessibility scans;
- build artifact loading and manifest permissions.

Google Chrome and Edge no longer permit Playwright’s command-line side-loading path. Therefore CI uses Playwright Chromium, as Playwright requires for extension automation. Final acceptance also performs a smoke test in installed Google Chrome 150 when local interactive loading is available.

### Release gates

- TypeScript strict check, lint, format check, and production build.
- Four-metric 90% coverage threshold.
- Full automatic E2E suite.
- Accessibility scan with zero serious or critical violations.
- Package inspection: no remote code, source maps with secrets, unneeded permissions, or network destinations.
- Manual evidence checklist against installed Chrome.

## 13. Error Handling

Every external boundary returns a typed result. Capture, permission, body retrieval, storage, decoding, clipboard, and download failures become recoverable UI notices with retry or fallback where useful. A single malformed request can never stop the recording loop. Global error boundaries preserve export/clear controls.

Storage writes are transactional or versioned. On quota or corruption, Payloadra keeps the in-memory session, disables persistence for that session, and explains the recovery path.

## 14. Packaging and Documentation

Deliverables:

- reproducible Chrome MV3 zip;
- install and usage guide;
- privacy policy and permission rationale;
- architecture and capture-limit documentation;
- test/coverage commands and generated reports;
- Chrome Web Store listing copy, screenshots checklist, and compliance checklist;
- no publication or external upload without explicit user authorization.

## 15. Acceptance Criteria

Release is ready only when:

1. A QA user can record an authorized workflow without site code changes.
2. Payloadra correctly groups browser-visible calls and clearly labels uncertainty.
3. Explain and Inspect answer the supplied success questions across required fixtures.
4. Sensitive fixtures never expose secrets in storage, UI, clipboard, cURL, HAR, report, logs, or test artifacts.
5. Session limits prevent unbounded memory/storage growth.
6. Core workflow is keyboard accessible and responsive in narrow and wide DevTools panels.
7. Production package loads in Chrome and requests only documented permissions.
8. All quality gates pass, including ≥90% in all four coverage metrics and automatic E2E.
