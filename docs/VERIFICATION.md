# Verification

Payloadra has one release gate. The commands below are intended to run from a
clean checkout. The latest recorded run is reconstructable: it was produced from
the committed candidate identified below.

## Commands

```bash
pnpm install
pnpm verify            # format, lint, types, build, coverage, audits, E2E
pnpm release:artifact  # pnpm verify, then wxt zip
```

`pnpm verify` runs, in order:

1. `pnpm format:check` — Prettier
2. `pnpm lint` — ESLint with `--max-warnings=0`
3. `pnpm typecheck` — `tsc --noEmit` in strict mode
4. `pnpm build` — production Chrome MV3 build
5. `pnpm test:coverage` — Vitest with a 90% statements/branches/functions/lines gate
6. `pnpm audit:package` — static audit of `.output/chrome-mv3`
7. `pnpm audit:dependencies` — known high/critical dependency advisories
8. `pnpm test:e2e` — Playwright, including the packaged-extension suite

The Playwright global setup builds the panel harness and the Next.js fixture,
and fails fast if `.output/chrome-mv3/manifest.json` is missing.

## Recorded automated run — 2026-07-29

Environment: macOS 26.5.2 (arm64), Node v26.5.0, pnpm 10.33.2, WXT 0.21.2,
Playwright 1.62.0, Chromium 151.0.7922.34, Google Chrome 150.0.7871.187
installed.

Candidate commit: `c40abf5`, the committed tree carrying the fixes and audit
documents described in the unreleased changelog. The gate ran against that
exact tree with no uncommitted changes, so this is reproducible pre-release
evidence; it is still not a signed release record, because the manual installed
Chrome checklist below has not been completed.

| Gate                      | Result                                                                           |
| ------------------------- | -------------------------------------------------------------------------------- |
| `pnpm format:check`       | pass                                                                             |
| `pnpm lint`               | pass, 0 warnings                                                                 |
| `pnpm typecheck`          | pass                                                                             |
| `pnpm test:coverage`      | pass — 49 files, 990 tests                                                       |
| Coverage — statements     | 95.71%                                                                           |
| Coverage — branches       | 93.30%                                                                           |
| Coverage — functions      | 97.32%                                                                           |
| Coverage — lines          | 96.66%                                                                           |
| `pnpm build`              | pass — 523.8 kB unpacked                                                         |
| `pnpm audit:package`      | pass — 0 unapproved network-destination URLs, 0 remote scripts, 0 inline scripts |
| Manifest permissions      | `["scripting","storage"]`; required host permissions `[]`                        |
| `pnpm audit:dependencies` | pass — 0 known vulnerabilities                                                   |
| `pnpm test:e2e`           | pass — 41 tests                                                                  |
| `pnpm zip`                | pass — `.output/payloadra-0.1.0-chrome.zip`, 225,870 bytes                       |

Artifact SHA-256:
`fef20c14fb3c07df6e0966333f8e433ac7620b68927c4b048308e65a25ee3274`.

## Recorded run — 2026-07-26

Environment: macOS 25.5.0 (arm64), Node v26.5.0, pnpm 10.33.2, Playwright
Chromium 151.0.7922.34, Google Chrome 150.0.7871.187 installed.

| Gate                    | Result                                                                           |
| ----------------------- | -------------------------------------------------------------------------------- |
| `pnpm format:check`     | pass                                                                             |
| `pnpm lint`             | pass, 0 warnings                                                                 |
| `pnpm typecheck`        | pass                                                                             |
| `pnpm test:coverage`    | pass — 43 files, 863 tests passed                                                |
| Coverage — statements   | 96.22% (4152/4315)                                                               |
| Coverage — branches     | 93.8% (3285/3502)                                                                |
| Coverage — functions    | 98.43% (818/831)                                                                 |
| Coverage — lines        | 96.94% (3898/4021)                                                               |
| `pnpm build`            | pass — 484.72 kB unpacked                                                        |
| `pnpm audit:package`    | pass — 0 unapproved network-destination URLs, 0 remote scripts, 0 inline scripts |
| Manifest permissions    | `["scripting","storage"]`, host permissions `[]`                                 |
| `pnpm test:e2e`         | pass — 35 tests                                                                  |
| `pnpm release:artifact` | pass — `.output/payloadra-0.1.0-chrome.zip`, 216.02 kB                           |

The unit package-contract tests only run when `.output/chrome-mv3` exists.
Inside `pnpm verify`, the production build now precedes coverage, so those tests
do not skip. The standalone static package audit also runs after that build.

## What the automatic suite covers

- **Recording** — Start/Stop/Clear, API-first display over all-resource capture,
  incremental interaction-aware search, five intersecting evidence facets,
  every quick filter, interaction grouping, redirects, repeated calls, cache
  and service-worker delivery, error and slow states, cancellation, blocked
  cross-origin calls, streamed/binary/truncated/partially decoded bodies,
  comparison, safe cURL, HAR and QA report export, keyboard operation, and
  narrow-layout selection preservation.
- **Privacy** — no canary credential ever reaches page text, exports, session
  storage, or the console; credential headers, query tokens, and body fields
  render as `[REDACTED]`.
- **Accessibility** — axe scans of the empty, recording, Explain, Inspect
  (Request/Response/Timing/Evidence), narrow, drawer, and dialog states with no
  critical or serious violations; dialog focus restoration; live status region;
  non-colour timing labels; reduced-motion honouring; at least 44×44 CSS pixel
  phone controls and evidence rows; and no evidence-tab overflow at 900 px.
- **Retention and settings** — explicit memory/local retention selection,
  ephemeral recovery after reload, persistent recovery from IndexedDB after
  clearing session storage, safe corrupt-record clearing, fresh-database
  handling, clear removing evidence from every evidence store, and theme plus
  bounded additive custom-redaction settings surviving reload.
- **Interaction lifecycle** — tab/origin/document/lease validation, malformed
  message rejection, and a 20-second active-panel heartbeat that keeps an MV3
  lease active while recording.
- **Performance** — capture, persistence, search, dense recovery, and a
  greater-than-400 KiB valid/malformed React Flight fixture run under bounded
  time, output, and warning budgets.
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

## Script-verified in real Chrome — 2026-07-29

`node scripts/smoke-chrome.mjs` against Google Chrome 150.0.7871.187:

- extension load: blocked because this Chrome build refuses
  `--load-extension`;
- fixture profile traffic: HTTP 200;
- remote requests observed: none.

The connected browser-control surface also blocks automated access to
`chrome://extensions`. Loading the unpacked directory and opening the DevTools
panel therefore still require the manual checklist above.

## Script-verified in real Chrome — 2026-07-26

`node scripts/smoke-chrome.mjs` against Google Chrome 150.0.7871.187:

- extension load: blocked by the browser's `--load-extension` policy;
- fixture page traffic: profile load HTTP 200;
- remote requests observed: none.
