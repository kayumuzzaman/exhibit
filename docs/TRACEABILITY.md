# Payloadra release traceability

**Audit date:** 2026-07-29

**Baseline:** approved design and implementation plan dated 2026-07-25

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

| Task                                               | Status   | Current evidence                                                                                                                  | Remaining gap                                                         |
| -------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1. Reproducible MV3 foundation and domain contract | Complete | Strict TypeScript, WXT entrypoints, manifest/package tests, production build                                                      | None found                                                            |
| 2. Redaction-first privacy boundary                | Complete | Unit, integration, E2E, storage, clipboard, cURL, HAR, and report tests; short Basic credentials now have a regression            | Secret detection remains intentionally finite and documented          |
| 3. HAR normalization and evidence states           | Complete | Body-policy, content-callback, and HAR normalization suites cover unavailable, streamed, binary, malformed, and truncated content | None found                                                            |
| 4. Protocol and Next.js intelligence               | Complete | Classifier, explanation, Flight, real Next.js Server Action/API/RSC browser fixtures                                              | None found                                                            |
| 5. Bounded repositories and controller             | Complete | Memory/IndexedDB recovery, eviction, corruption, concurrency, and dense 500-request recovery tests                                | None found                                                            |
| 6. Interaction bridge and correlation              | Complete | Tab/origin/document/lease boundary and 20-second heartbeat tests pass; browser tests exercise interaction-group scoping           | Forced worker/browser/extension termination still needs restart       |
| 7. Chrome capture adapter and pipeline             | Complete | HAR/live de-duplication, reconciliation, timeouts, generation, fault isolation, and bounded concurrent live-content tests         | Installed DevTools adapter smoke remains under acceptance criterion 7 |
| 8. Search, filters, compare, cURL, HAR, report     | Complete | Browser coverage exercises incremental interaction search, quick and five-facet filters, compare, cURL, and HAR/Markdown exports  | None found                                                            |
| 9. Accessible responsive panel shell               | Partial  | Axe, keyboard, focus, reduced-motion, and 1440/900/390 state-preservation browser tests pass                                      | Installed DevTools visual/keyboard smoke is pending                   |
| 10. Explain and Inspect workspaces                 | Complete | Browser tests cover Explain, Inspect, timing, evidence, body modes, degradation, and comparison                                   | Installed DevTools smoke pending                                      |
| 11. Fixtures and automatic extension E2E           | Complete | Generic fixture, Next.js production fixture, panel harness, and packaged Chromium tests                                           | The harness cannot automate Chrome's DevTools window                  |
| 12. Coverage, performance, docs, release package   | Partial  | Fresh full gate, artifact/hash, dependency/package audits, performance tests, and user/compliance docs are recorded               | Installed Chrome smoke and owner/licence/contact decisions remain     |

## Approved acceptance criteria

|   # | Criterion                                                          | Status   | Evidence or blocker                                                                                         |
| --: | ------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------- |
|   1 | QA user records an authorized workflow without site changes        | Partial  | Automatic generic and Next.js workflows pass; installed Chrome DevTools workflow is pending                 |
|   2 | Browser-visible calls are grouped and uncertainty is clear         | Complete | Correlation, rail-scoping, attributed, and Unattributed browser/unit scenarios pass                         |
|   3 | Explain and Inspect answer required fixture questions              | Partial  | Automatic fixtures pass; installed Chrome rendering is pending                                              |
|   4 | Sensitive fixtures expose no secrets on trusted surfaces           | Complete | Unit/integration/E2E canaries cover storage, UI, clipboard, cURL, HAR, report, and console                  |
|   5 | Session limits prevent unbounded growth                            | Complete | Request/body/session caps, eviction, performance, schema, and dense-session recovery tests                  |
|   6 | Core workflow is keyboard accessible and responsive                | Partial  | Automated axe, keyboard, focus, and state-preserving responsive suites pass; installed Chrome smoke remains |
|   7 | Production package loads in Chrome with documented permissions     | Blocked  | Package and manifest audits pass in Playwright Chromium; installed Google Chrome DevTools smoke is pending  |
|   8 | All quality gates pass, including four-metric 90% coverage and E2E | Complete | Fresh record: 990 tests, all coverage metrics above 90%, 41 E2E tests, and clean package/dependency audits  |

## Global constraints

| Constraint                               | Status   | Evidence                                                                                                                                              |
| ---------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local-only, no product telemetry/backend | Complete | No application network client; package audit rejects unapproved network-destination URLs and remote/inline scripts                                    |
| No required host access                  | Complete | Manifest has optional per-origin access only; Chrome's grant persists until revoked, while package audit verifies required host permissions are empty |
| Redaction before trusted surfaces        | Complete | Sanitized domain type and boundary suites; fail-closed fallback tests                                                                                 |
| Bounded storage and expensive work       | Complete | 500 request/8 MiB session cap, body caps, traversal guards, lazy work, and near-cap Flight/capture/search performance budgets                         |
| Chrome 120+ compatibility target         | Blocked  | Callback seams are automated, but Chrome 120 plus current-stable installed-browser/OS matrix has not been recorded                                    |
| No publication without authorization     | Complete | Repository remains private and `UNLICENSED`; no upload or store action performed                                                                      |

## Release blockers

1. Complete the manual installed-Google-Chrome DevTools checklist.
2. Record the claimed Chrome/operating-system compatibility matrix or narrow
   the support statement.
3. Name the legal owner and public privacy/security/support contacts, then
   choose distribution and licence terms.
4. Review final Chrome Web Store disclosures against the publisher form and
   package behavior.

See [roadmap](./ROADMAP.md), [verification](./VERIFICATION.md), and the
[independent UX critique](../.impeccable/critique/2026-07-28T18-45-20Z__src-app-app-tsx.md).
