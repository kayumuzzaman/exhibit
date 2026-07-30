# Exhibit release checklist

**Prepared:** 2026-07-30 · **Evidence record:**
[VERIFICATION.md](./VERIFICATION.md)

The internal Chrome workflow is accepted. Public distribution still requires
owner decisions, public contacts and policy hosting, compatibility evidence,
store assets, independent review, user validation, and a clean final artifact.

---

## Part 1 — Evidence already collected

| Area                 | Evidence                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Quality gate         | 2026-07-30 development-tree `pnpm verify` exit 0: 1,004 tests, 43 E2E; clean release artifact remains          |
| Package audit        | 0 remote scripts, 0 inline scripts, 0 unapproved network destinations                                          |
| Dependency audit     | 0 known high or critical advisories                                                                            |
| Manifest             | MV3, `["storage","scripting"]`, **no required host permissions**, optional origins only                        |
| Artifact             | Commit `94c74ae` ZIP size and SHA-256 are recorded; current changes still need a replacement clean artifact    |
| Icons                | 16 / 32 / 48 / 128 PNG present; no unreferenced assets ship                                                    |
| Screenshots          | Five 1280×800 light-theme PNGs regenerated from fixture data and visually inspected on 2026-07-30              |
| Listing copy         | Name, summary, description, category, permission justifications — [CHROME_WEB_STORE.md](./CHROME_WEB_STORE.md) |
| Data-use preparation | Behaviour mapped to the disclosure categories, same document                                                   |
| Compatibility floor  | Every API and platform feature audited against Chrome 120 — [COMPATIBILITY.md](./COMPATIBILITY.md)             |
| Privacy policy text  | [PRIVACY.md](./PRIVACY.md), publishable once it has a URL and an effective date                                |
| UX audit remediation | All P1s, the P2 ledger defect, and the minor findings closed                                                   |
| Manual Chrome smoke  | User-reported pass on installed Chrome 150/macOS, recorded 2026-07-30 in [VERIFICATION.md](./VERIFICATION.md)  |

## Part 2 — Yours to do

### Step 1 — Manual Chrome smoke _(completed 2026-07-30)_

The user reported every installed Chrome 150/macOS check passing, including
panel registration, capture, grouping, Explain/Inspect, redaction, Clear, and
sanitized HAR export. [VERIFICATION.md](./VERIFICATION.md) owns that evidence.
Use this table when repeating the smoke against a future release package:

| #   | Step                 | Expected                                                                    |
| --- | -------------------- | --------------------------------------------------------------------------- |
| 1   | Panel registration   | An **Exhibit** tab appears in DevTools                                      |
| 2   | Start/Stop           | Status pill goes live; Stop returns it to Not recording                     |
| 3   | Interaction grouping | Rail lists the action you performed, with its request count and trust state |
| 4   | Explain/Inspect      | Explain gives one sentence with confidence; Inspect renders headers/body    |
| 5   | Redaction            | Authorization header, query token, and password field all show `[REDACTED]` |
| 6   | Clear                | Ledger empties and the confirmation explains what is destroyed              |
| 7   | Sanitized export     | Downloaded HAR contains no credential values                                |

If a future package fails any step, treat it as a code defect, not paperwork.

### Step 2 — Persistent-retention policy decision

Local retention writes redacted evidence to IndexedDB without
application-level encryption. Redaction is deliberately finite, so the
remaining values cannot be represented as guaranteed non-sensitive. Before
submission, review Chrome's current
[user-data guidance](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
and choose one path with the publisher/privacy reviewer:

- remove persistent retention from the public build and keep session-memory
  retention only;
- encrypt persistent evidence with a user-controlled key and document the
  threat model and recovery behavior; or
- obtain and record an approved policy interpretation for the current local
  design.

Do not claim encrypted storage while the current implementation remains.

### Step 3 — Compatibility claim

[COMPATIBILITY.md](./COMPATIBILITY.md) shows Chrome 120 is defensible from the
features the code uses; the highest breaking requirement is `color-mix()` at
Chrome 111. It is still an untested claim. Choose one:

- **Test it** — repeat Step 1 on Chrome 120 and on current stable, on each
  operating system you intend to support, and record the matrix; or
- **Narrow the claim** — publish the statement already drafted in
  COMPATIBILITY.md ("Built and manually checked against Chrome 150 on macOS…").

Note the one known cosmetic gap: `scrollbar-color` needs Chrome 121, so on
Chrome 120 exactly the ledger scrollbars use Chrome's default styling.

### Step 4 — Legal identity

| Decision         | Currently                        | Where it must change                     |
| ---------------- | -------------------------------- | ---------------------------------------- |
| Legal owner name | "the Exhibit project owner"      | `LICENSE`                                |
| Licence terms    | Proprietary, all rights reserved | `LICENSE`, `package.json` (`UNLICENSED`) |
| Store publisher  | Not chosen                       | Chrome Web Store developer account       |

A Web Store submission needs a registered developer account, a verified email,
and the one-time registration fee. Decide whether Exhibit ships proprietary,
open source, or dual-licensed before uploading; the choice is hard to reverse
after publication.

### Step 5 — Monitored contacts

Three documents currently state that no contact exists. Each needs a real,
monitored address:

| File                       | Needs                                         |
| -------------------------- | --------------------------------------------- |
| `SECURITY.md`              | Security address and a response commitment    |
| `SUPPORT.md`               | Support URL or email, supported versions      |
| [PRIVACY.md](./PRIVACY.md) | Privacy contact, effective date, jurisdiction |

The privacy policy also needs a **public URL** — the Web Store form requires
one and it must stay reachable for as long as the item is listed. The repository
has a GitHub remote, but no confirmed public policy URL or hosting deployment.

### Step 6 — Store assets and submission

The five tracked screenshots were regenerated in light theme and visually
inspected on 2026-07-30. The remaining assets are a 440×280 small promo tile and
a YouTube product video; only the 1400×560 marquee tile is optional.

1. Rerun `pnpm screenshots` and inspect all five 1280×800 images after any UI
   change.
2. Create and inspect a 440×280 small promo tile matching the Exhibit identity.
3. Record and publish a concise fixture-only product walkthrough video.
4. Commit the intended release tree and confirm `git status --short` is empty.
5. Run `pnpm release:artifact` — full gate, then package.
6. Confirm the audit line reports exactly `["scripting","storage"]`.
7. Record the clean commit, artifact size, and SHA-256 in
   [VERIFICATION.md](./VERIFICATION.md).
8. Upload `.output/exhibit-0.1.0-chrome.zip`.
9. Paste the listing fields from [CHROME_WEB_STORE.md](./CHROME_WEB_STORE.md).
10. Upload the five screenshots, small promo tile, and video URL.
11. Answer every data-use question against the behaviour recorded in that
    document, checking each answer against the form's current wording
12. Add the privacy policy URL from Step 5.
13. Choose distribution visibility and regions, then submit for review.

### Step 7 — After approval

- Tag the released commit so the artifact stays reconstructable
- Record the published version and review date in [VERIFICATION.md](./VERIFICATION.md)
- Set [TRACEABILITY.md](./TRACEABILITY.md)'s release decision to the outcome

---

## What is deliberately not being done

These are open by choice, recorded so nobody assumes they were missed:

- **Inspect consolidation from six tabs to three** — the audit suggested it and
  scored the area 3 of 4; the later audit endorsed the current progressive
  disclosure. It would churn a surface with passing axe and keyboard coverage.
- **In-panel help or glossary** — scored 1 of 4 for Help and Documentation.
  This is a new feature, not a defect.
- **Keyboard accelerators** for Start, search, filters, and Explain/Inspect.
- **Segment validation** — no target-segment participant has completed the
  ROADMAP.md Stage 2 research workflow. The owner-reported Chrome smoke is
  technical acceptance evidence, not segment validation.
- **Red-team review of redaction and exports** — detection is deliberately
  finite and documented; an adversarial review has not happened.
