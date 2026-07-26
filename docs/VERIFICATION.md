# Verification

Payloadra has one release gate. Everything below is reproducible from a clean
checkout.

## Commands

```bash
pnpm install
pnpm verify            # format, lint, types, coverage, build, package audit, E2E
pnpm release:artifact  # pnpm verify, then wxt zip
```

`pnpm verify` runs, in order:

1. `pnpm format:check` — Prettier
2. `pnpm lint` — ESLint with `--max-warnings=0`
3. `pnpm typecheck` — `tsc --noEmit` in strict mode
4. `pnpm test:coverage` — Vitest with a 90% statements/branches/functions/lines gate
5. `pnpm build` — production Chrome MV3 build
6. `pnpm audit:package` — static audit of `.output/chrome-mv3`
7. `pnpm test:e2e` — Playwright, including the packaged-extension suite

The Playwright global setup builds the panel harness and the Next.js fixture,
and fails fast if `.output/chrome-mv3/manifest.json` is missing.

## Recorded run — 2026-07-26

Environment: macOS 25.5.0 (arm64), Node v26.5.0, pnpm 10.33.2, Playwright
Chromium 151.0.7922.34, Google Chrome 150.0.7871.187 installed.

| Gate                    | Result                                                   |
| ----------------------- | -------------------------------------------------------- |
| `pnpm format:check`     | pass                                                     |
| `pnpm lint`             | pass, 0 warnings                                         |
| `pnpm typecheck`        | pass                                                     |
| `pnpm test:coverage`    | pass — 43 files, 863 tests passed                        |
| Coverage — statements   | 96.22% (4152/4315)                                       |
| Coverage — branches     | 93.8% (3285/3502)                                        |
| Coverage — functions    | 98.43% (818/831)                                         |
| Coverage — lines        | 96.94% (3898/4021)                                       |
| `pnpm build`            | pass — 484.72 kB unpacked                                |
| `pnpm audit:package`    | pass — 0 remote URLs, 0 remote scripts, 0 inline scripts |
| Manifest permissions    | `["scripting","storage"]`, host permissions `[]`         |
| `pnpm test:e2e`         | pass — 35 tests                                          |
| `pnpm release:artifact` | pass — `.output/payloadra-0.1.0-chrome.zip`, 216.02 kB   |

The package-audit suite only runs when `.output/chrome-mv3` exists. Inside
`pnpm verify` the build precedes the audit, so it always runs there; on a clean
checkout it is skipped rather than failing.

## What the automatic suite covers

- **Recording** — Start/Stop/Clear, API-first default, every quick filter,
  search, interaction grouping, redirects, repeated calls, cache and
  service-worker delivery, error and slow states, cancellation, blocked
  cross-origin calls, streamed/binary/truncated/partially decoded bodies,
  comparison, safe cURL, HAR and QA report export, keyboard operation, and
  narrow-layout selection preservation.
- **Privacy** — no canary credential ever reaches page text, exports, session
  storage, or the console; credential headers, query tokens, and body fields
  render as `[REDACTED]`.
- **Accessibility** — axe scans of the empty, recording, Explain, Inspect
  (Request/Response/Timing/Evidence), narrow, drawer, and dialog states with no
  critical or serious violations; dialog focus restoration; live status region;
  non-colour timing labels; reduced-motion honouring.
- **Retention** — ephemeral recovery after reload, persistent recovery from
  IndexedDB after clearing session storage, and clear removing evidence from
  every store.
- **Next.js** — a real Next 16 production build: Server Action success and
  failure, the route handler, and an RSC navigation payload. The captured
  `Next-Action` header is asserted to be non-empty and opaque; no test pins a
  build identifier or a source function name.
- **Packaged extension** — the built MV3 package is loaded in Playwright
  Chromium: the service worker registers, the manifest matches the declared
  surface, `devtools.html` and `panel.html` are reachable, and the background
  message boundary fails closed for a tab the panel does not own.

## Known limitations of the automatic suite

- **The DevTools window cannot be automated.** Playwright cannot attach to
  Chrome's DevTools UI, so the panel workspace is driven through a harness page
  that mounts the production `PayloadraApp`, session controller, recording
  pipeline, and storage repositories, substituting only the Chrome DevTools
  capture adapter with a browser capture port built on real `fetch`/`XHR`
  interception and real `PerformanceResourceTiming`. The Chrome adapter itself
  is covered by unit tests.
- **`--load-extension` is refused by Chrome 150 stable.** `scripts/smoke-chrome.mjs`
  attempts it and reports the refusal; the packaged-extension suite therefore
  runs on Playwright's Chromium build of the same engine version family.

## Manual browser smoke — required before release

Run this in the locally installed Google Chrome and record the result here.

1. `pnpm build`
2. Open `chrome://extensions`, enable **Developer mode**, choose
   **Load unpacked**, and select `.output/chrome-mv3`.
3. Start the fixtures if you want deterministic traffic, or use any web app.
4. Open DevTools and confirm the **Payloadra** panel is registered.
5. Press **Start**, perform one interaction that issues requests, and confirm
   the ledger fills and the interaction groups the requests.
6. Open **Explain** and **Inspect** for one request and confirm both render.
7. Confirm an authorization header, a query token, and a password field all
   display `[REDACTED]`.
8. Press **Clear** and confirm the ledger empties.
9. Export and confirm the downloaded HAR contains no credential values.

| Step                 | Result  | Date | Browser                      |
| -------------------- | ------- | ---- | ---------------------------- |
| Panel registration   | pending |      | Google Chrome 150.0.7871.187 |
| Start/Stop           | pending |      |                              |
| Interaction grouping | pending |      |                              |
| Explain/Inspect      | pending |      |                              |
| Redaction            | pending |      |                              |
| Clear                | pending |      |                              |
| Sanitized export     | pending |      |                              |

## Script-verified in real Chrome — 2026-07-26

`npx tsx scripts/smoke-chrome.mjs` against Google Chrome 150.0.7871.187:

- extension load: blocked by the browser's `--load-extension` policy;
- fixture page traffic: profile load HTTP 200;
- remote requests observed: none.
