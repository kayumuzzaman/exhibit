# Verification

Exhibit has one release gate. The commands below are intended to run from a
clean checkout. The current release artifact is the `c4c96d6` record below, cut
from a clean tree. Older candidates are kept for history and marked superseded.
Working-tree evidence is recorded separately and is not a release artifact.

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

## Current working-tree verification — 2026-07-30

Environment: macOS (arm64), Node v26.5.0, pnpm 10.33.2, WXT 0.21.2,
Playwright 1.62.0.

Base commit: `17a08d8`. This run covered uncommitted source, documentation, and
tracked screenshot changes. The working tree was dirty, so this is fresh
development evidence, not a release artifact record.

| Gate                      | Result                                                                           |
| ------------------------- | -------------------------------------------------------------------------------- |
| `pnpm format:check`       | pass                                                                             |
| `pnpm lint`               | pass, 0 warnings                                                                 |
| `pnpm typecheck`          | pass                                                                             |
| `pnpm build`              | pass — 523.93 kB unpacked                                                        |
| `pnpm test:coverage`      | pass — 50 files, 1,004 tests                                                     |
| Coverage — statements     | 95.75%                                                                           |
| Coverage — branches       | 93.38%                                                                           |
| Coverage — functions      | 97.44%                                                                           |
| Coverage — lines          | 96.67%                                                                           |
| `pnpm audit:package`      | pass — 0 unapproved network-destination URLs, 0 remote scripts, 0 inline scripts |
| Manifest permissions      | `["scripting","storage"]`; required host permissions `[]`                        |
| `pnpm audit:dependencies` | pass — 0 known vulnerabilities                                                   |
| `pnpm test:e2e`           | pass — 43 tests                                                                  |

## Recorded release-artifact run — 2026-07-31 (submission candidate)

Environment: macOS 26.5.2 (arm64), Node v26.5.0, pnpm 10.33.2, WXT 0.21.2,
Playwright 1.62.0, Chromium 151.0.7922.34, Google Chrome 150.0.7871.187
installed.

Release commit: `c4c96d6`. `git status --short` was empty before the run. This is
the first artifact with no placeholders in tracked files: MIT licence naming the
copyright holder, a reachable privacy contact, and memory-only evidence
retention.

| Gate                      | Result                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm format:check`       | pass                                                                                                   |
| `pnpm lint`               | pass, 0 warnings                                                                                       |
| `pnpm typecheck`          | pass                                                                                                   |
| `pnpm test:coverage`      | pass — 51 files, 1,009 tests                                                                           |
| Coverage — statements     | 95.85%                                                                                                 |
| Coverage — branches       | 93.48%                                                                                                 |
| Coverage — functions      | 97.54%                                                                                                 |
| Coverage — lines          | 96.75%                                                                                                 |
| `pnpm build`              | pass — 552 KiB unpacked                                                                                |
| `pnpm audit:package`      | pass — 0 network destinations, 0 remote scripts, 0 inline scripts, **0 evidence-at-rest storage APIs** |
| Manifest permissions      | `["storage","scripting"]`; required host permissions `[]`                                              |
| `pnpm audit:dependencies` | pass — 0 known vulnerabilities                                                                         |
| `pnpm test:e2e`           | pass — 43 tests                                                                                        |
| `pnpm zip`                | pass — `.output/exhibit-0.1.0-chrome.zip`, 224,836 bytes                                               |

| Artifact             | Value                                                              |
| -------------------- | ------------------------------------------------------------------ |
| ZIP SHA-256          | `d49f75684578a252003aae4e07836ad17553a60bcfd2999e284c0c4b841b2869` |
| Package content hash | `c443c0b502b93c99feffc457bf6586a0042ff575b3213f6fa98f32bb365c1dba` |

The package shrank from 226,080 to 224,836 bytes because the IndexedDB
repository is no longer reachable from any entrypoint and drops out of the
bundle. The audit now fails the release if an evidence-capable persistent
storage API reappears, so the memory-only disclosure is checked against the
shipped bytes on every run rather than trusted.

This is the artifact to upload. Remaining before submission, all outside this
repository: a public privacy-policy URL, the product video, and first real
users — see [RELEASE_DECISIONS.md](./RELEASE_DECISIONS.md).

## Recorded release-artifact run — 2026-07-31

Environment: macOS 26.5.2 (arm64), Node v26.5.0, pnpm 10.33.2, WXT 0.21.2,
Playwright 1.62.0, Chromium 151.0.7922.34, Google Chrome 150.0.7871.187
installed.

Release commit: `0721fcd`. `git status --short` was empty before the run. This
supersedes the `94c74ae` record: the tree has since gained the Next.js-first
listing copy, the prerender classification fix, its contract tests, the narrowed
compatibility claim, the generated promo tile, and this release cycle's
changelog.

| Gate                      | Result                                                                           |
| ------------------------- | -------------------------------------------------------------------------------- |
| `pnpm format:check`       | pass                                                                             |
| `pnpm lint`               | pass, 0 warnings                                                                 |
| `pnpm typecheck`          | pass                                                                             |
| `pnpm test:coverage`      | pass — 51 files, 1,009 tests                                                     |
| Coverage — statements     | 95.77%                                                                           |
| Coverage — branches       | 93.43%                                                                           |
| Coverage — functions      | 97.44%                                                                           |
| Coverage — lines          | 96.68%                                                                           |
| `pnpm build`              | pass — 525.17 kB unpacked                                                        |
| `pnpm audit:package`      | pass — 0 unapproved network-destination URLs, 0 remote scripts, 0 inline scripts |
| Manifest permissions      | `["storage","scripting"]`; required host permissions `[]`                        |
| `pnpm audit:dependencies` | pass — 0 known vulnerabilities                                                   |
| `pnpm test:e2e`           | pass — 43 tests                                                                  |
| `pnpm zip`                | pass — `.output/exhibit-0.1.0-chrome.zip`, 226,080 bytes                         |

| Artifact             | Value                                                              |
| -------------------- | ------------------------------------------------------------------ |
| ZIP SHA-256          | `d6db4790dc5bfce50014c8b3e9ca7bd47007496da9aad8d5f1f8e060b1f7cb4a` |
| Package content hash | `7190099aa2d2e2aa176b15718024c827c4abc2b04830fcda26fe237935c1dfc9` |

**The ZIP hash is not reproducible, and earlier records in this file implied
otherwise.** `wxt zip` stores build file times in the archive, so every rebuild
of the same tree produces a different ZIP hash at an identical byte size. Two
`pnpm zip` runs over one build do match; a rebuild in between does not. The ZIP
hash therefore identifies one uploaded file, not the commit.

Branch coverage is not bit-stable across runs: repeated gates on this tree
reported 93.38% and 93.43%, a spread of about two branches out of 3,944. The
figure above is what the recorded run produced. Both sit far above the 90% gate,
so the variance changes no outcome, but a verifier recomputing it should expect
a small difference rather than an exact match.

The package content hash is the value that is reproducible from the commit.
Recompute it against a fresh build of `0721fcd` with:

```bash
find .output/chrome-mv3 -type f | sort | xargs shasum -a 256 | shasum -a 256
```

Record both when cutting a release: the ZIP hash to identify the exact file sent
to the Web Store, and the content hash to prove that file was built from this
commit.

The permissions above were read back out of the packaged `manifest.json`, not
from the source config, so they describe what actually ships.

This is the artifact to upload. It is release-gate evidence, not a release
decision: the owner, licence, public contacts, hosted policy URL, retention
call, and product video are still outstanding — see
[RELEASE_DECISIONS.md](./RELEASE_DECISIONS.md). If the retention decision
changes code, this record is void and the gate must be rerun from a new clean
commit.

## Recorded automated run — 2026-07-29

Environment: macOS 26.5.2 (arm64), Node v26.5.0, pnpm 10.33.2, WXT 0.21.2,
Playwright 1.62.0, Chromium 151.0.7922.34, Google Chrome 150.0.7871.187
installed.

Candidate commit: `94c74ae`, the committed tree carrying the fixes and audit
documents described in the unreleased changelog. The gate ran against that
exact tree with no uncommitted changes, so this is reproducible pre-release
evidence. The manual installed-Chrome checklist was completed later on
2026-07-30. **Superseded** by the `0721fcd` record above; kept for history. Its
`Artifact SHA-256` line is a ZIP hash, which the note above explains is not
reproducible from the commit.

| Gate                      | Result                                                                           |
| ------------------------- | -------------------------------------------------------------------------------- |
| `pnpm format:check`       | pass                                                                             |
| `pnpm lint`               | pass, 0 warnings                                                                 |
| `pnpm typecheck`          | pass                                                                             |
| `pnpm test:coverage`      | pass — 49 files, 992 tests                                                       |
| Coverage — statements     | 95.74%                                                                           |
| Coverage — branches       | 93.30%                                                                           |
| Coverage — functions      | 97.33%                                                                           |
| Coverage — lines          | 96.66%                                                                           |
| `pnpm build`              | pass — 523.8 kB unpacked                                                         |
| `pnpm audit:package`      | pass — 0 unapproved network-destination URLs, 0 remote scripts, 0 inline scripts |
| Manifest permissions      | `["scripting","storage"]`; required host permissions `[]`                        |
| `pnpm audit:dependencies` | pass — 0 known vulnerabilities                                                   |
| `pnpm test:e2e`           | pass — 43 tests                                                                  |
| `pnpm zip`                | pass — `.output/exhibit-0.1.0-chrome.zip`, 225,572 bytes                         |

Artifact SHA-256:
`1d42ea363e3ea2388858fb8565b0354f06108f899ee6dbae51b1b090a36be9c1`.

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
| `pnpm release:artifact` | pass — 216.02 kB (produced under the former product name)                        |

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
  that mounts the production `ExhibitApp`, session controller, recording
  pipeline, and storage repositories, substituting only the Chrome DevTools
  capture adapter with a browser capture port built on real `fetch`/`XHR`
  interception and real `PerformanceResourceTiming`. The Chrome adapter itself
  is covered by unit tests.
- **`--load-extension` is refused by Chrome 150 stable.** `scripts/smoke-chrome.mjs`
  attempts it and reports the refusal; the packaged-extension suite therefore
  runs on Playwright's Chromium build of the same engine version family.

## Manual browser smoke — completed 2026-07-30

Run this in the locally installed Google Chrome and record the result here.

1. `pnpm build`
2. Open `chrome://extensions`, enable **Developer mode**, choose
   **Load unpacked**, and select `.output/chrome-mv3`.
3. Start the fixtures if you want deterministic traffic, or use any web app.
4. Open DevTools and confirm the **Exhibit** panel is registered.
5. Press **Start**, perform one interaction that issues requests, and confirm
   the ledger fills and the interaction groups the requests.
6. Open **Explain** and **Inspect** for one request and confirm both render.
7. Confirm an authorization header, a query token, and a password field all
   display `[REDACTED]`.
8. Press **Clear** and confirm the ledger empties.
9. Export and confirm the downloaded HAR contains no credential values.

| Step                 | Result | Date       | Browser                      |
| -------------------- | ------ | ---------- | ---------------------------- |
| Panel registration   | pass   | 2026-07-30 | Google Chrome 150.0.7871.187 |
| Start/Stop           | pass   | 2026-07-30 | Google Chrome 150.0.7871.187 |
| Interaction grouping | pass   | 2026-07-30 | Google Chrome 150.0.7871.187 |
| Explain/Inspect      | pass   | 2026-07-30 | Google Chrome 150.0.7871.187 |
| Redaction            | pass   | 2026-07-30 | Google Chrome 150.0.7871.187 |
| Clear                | pass   | 2026-07-30 | Google Chrome 150.0.7871.187 |
| Sanitized export     | pass   | 2026-07-30 | Google Chrome 150.0.7871.187 |

The passing results dated 2026-07-30 are user-reported manual checks in the
installed browser on macOS. Panel registration is evidenced by the Exhibit
DevTools tab loading successfully for the other panel checks.

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
