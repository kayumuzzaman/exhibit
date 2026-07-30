# Exhibit release traceability

**Audit date:** 2026-07-30

**Baseline:** the approved
[design](./superpowers/specs/2026-07-25-payloadra-design.md) and
[implementation plan](./superpowers/plans/2026-07-25-payloadra-implementation.md)
dated 2026-07-25

**Release decision:** not ready for public distribution

This is the current completion record. The unchecked boxes in the original
implementation plan preserve its historical execution script; they are not
evidence that a task is absent or complete.

Status meanings:

- **Complete** — implementation exists and has automated evidence.
- **Partial** — the underlying capability exists, but a required surface or
  acceptance check is missing.
- **Blocked** — completion needs an owner decision or an installed-browser
  action that this repository cannot perform autonomously.

## Implementation tasks

| Task                                               | Status   | Current evidence                                                                                                                  | Remaining gap                                                                                        |
| -------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1. Reproducible MV3 foundation and domain contract | Complete | Strict TypeScript, WXT entrypoints, manifest/package tests, production build                                                      | None found                                                                                           |
| 2. Redaction-first privacy boundary                | Complete | Unit, integration, E2E, storage, clipboard, cURL, HAR, and report tests; short Basic credentials now have a regression            | Secret detection remains intentionally finite and documented                                         |
| 3. HAR normalization and evidence states           | Complete | Body-policy, content-callback, and HAR normalization suites cover unavailable, streamed, binary, malformed, and truncated content | None found                                                                                           |
| 4. Protocol and Next.js intelligence               | Complete | Classifier, explanation, Flight, real Next.js Server Action/API/RSC browser fixtures                                              | None found                                                                                           |
| 5. Bounded repositories and controller             | Complete | Memory/IndexedDB recovery, eviction, corruption, concurrency, and dense 500-request recovery tests                                | None found                                                                                           |
| 6. Interaction bridge and correlation              | Complete | Tab/origin/document/lease boundary and 20-second heartbeat tests pass; browser tests exercise interaction-group scoping           | Forced worker/browser/extension termination still needs restart                                      |
| 7. Chrome capture adapter and pipeline             | Complete | Automated adapter coverage plus user-reported installed Chrome 150 capture smoke on 2026-07-30                                    | None found                                                                                           |
| 8. Search, filters, compare, cURL, HAR, report     | Complete | Browser coverage exercises incremental interaction search, quick and five-facet filters, compare, cURL, and HAR/Markdown exports  | None found                                                                                           |
| 9. Accessible responsive panel shell               | Complete | Axe, keyboard, focus, reduced-motion, and 1440/900/390 state-preservation tests plus installed Chrome panel smoke                 | None found                                                                                           |
| 10. Explain and Inspect workspaces                 | Complete | Browser tests plus user-reported installed Chrome rendering cover Explain, Inspect, timing, evidence, body modes, and degradation | None found                                                                                           |
| 11. Fixtures and automatic extension E2E           | Complete | Generic fixture, Next.js production fixture, panel harness, and packaged Chromium tests                                           | The harness cannot automate Chrome's DevTools window                                                 |
| 12. Coverage, performance, docs, release package   | Partial  | Full gate, artifact/hash, dependency/package audits, performance tests, and manual Chrome acceptance are recorded                 | Current changes need a clean artifact; owner/licence/contact, compatibility, and store assets remain |

## Approved acceptance criteria

|   # | Criterion                                                          | Status   | Evidence or blocker                                                                                         |
| --: | ------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------- |
|   1 | QA user records an authorized workflow without site changes        | Complete | Automatic workflows pass; installed Chrome 150 recording was user-reported passing on 2026-07-30            |
|   2 | Browser-visible calls are grouped and uncertainty is clear         | Complete | Correlation, rail-scoping, attributed, and Unattributed browser/unit scenarios pass                         |
|   3 | Explain and Inspect answer required fixture questions              | Complete | Automatic fixtures and user-reported installed Chrome rendering pass                                        |
|   4 | Sensitive fixtures expose no secrets on trusted surfaces           | Complete | Unit/integration/E2E canaries cover storage, UI, clipboard, cURL, HAR, report, and console                  |
|   5 | Session limits prevent unbounded growth                            | Complete | Request/body/session caps, eviction, performance, schema, and dense-session recovery tests                  |
|   6 | Core workflow is keyboard accessible and responsive                | Complete | Automated axe, keyboard, focus, and responsive suites pass; installed panel smoke confirms the real surface |
|   7 | Production package loads in Chrome with documented permissions     | Complete | Package/manifest audits pass and the installed Chrome 150 DevTools workflow was user-reported passing       |
|   8 | All quality gates pass, including four-metric 90% coverage and E2E | Complete | 2026-07-30: 1,004 tests, all coverage metrics above 90%, 43 E2E, and clean package/dependency audits        |

## Global constraints

| Constraint                               | Status   | Evidence                                                                                                                                                   |
| ---------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local-only, no product telemetry/backend | Complete | No application network client; package audit rejects unapproved network-destination URLs and remote/inline scripts                                         |
| No required host access                  | Complete | Manifest has optional per-origin access only; Chrome's grant persists until revoked, while package audit verifies required host permissions are empty      |
| Redaction before trusted surfaces        | Complete | Sanitized domain type and boundary suites; fail-closed fallback tests                                                                                      |
| Bounded storage and expensive work       | Complete | 500 request/8 MiB session cap, body caps, traversal guards, lazy work, and near-cap Flight/capture/search performance budgets                              |
| Chrome 120+ compatibility target         | Blocked  | Every API and platform feature is audited against the floor in [COMPATIBILITY.md](./COMPATIBILITY.md); the installed-browser/OS matrix is still unrecorded |
| No publication without authorization     | Complete | Repository remains private and `UNLICENSED`; no upload or store action performed                                                                           |

## Release blockers

1. Record the claimed Chrome/operating-system compatibility matrix or narrow
   the support statement to the one drafted in
   [COMPATIBILITY.md](./COMPATIBILITY.md).
2. Name the legal owner and public privacy/security/support contacts, then
   choose distribution and licence terms.
3. Publish the approved privacy policy and Limited Use disclosure at a stable
   URL, then review the final Chrome Web Store form against package behavior.
4. Resolve unencrypted persistent IndexedDB evidence retention against the
   final user-data policy through approval, encryption, or removal.
5. Create the required 440×280 small promo tile and product video; regenerate
   the completed screenshot set again only after a UI change.
6. Conduct the independent red-team and primary-segment validation required by
   the roadmap before a public launch.
7. Commit the current changes, rerun the full release gate from that clean
   commit, and record the new package size and SHA-256.

Each blocker is broken into an ordered action in
[RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md). A retention-policy decision or a
validation finding may create code work; if it does, repeat screenshots, the
clean-commit gate, and artifact verification afterward.

See [roadmap](./ROADMAP.md), [verification](./VERIFICATION.md), and the
[independent UX critique](../.impeccable/critique/2026-07-28T18-45-20Z__src-app-app-tsx.md).
