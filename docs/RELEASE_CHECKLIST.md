# Payloadra release checklist

**Prepared:** 2026-07-29 · **Candidate:** `main`, commit recorded in
[VERIFICATION.md](./VERIFICATION.md)

Everything that could be finished without a browser, a legal decision, or a
monitored inbox is finished. What remains is listed here in the order it should
be done, with the exact action for each item.

---

## Part 1 — Done

| Area                 | Evidence                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Quality gate         | `pnpm verify` exit 0: 992 tests, 43 E2E, coverage 95.74 / 93.35 / 97.33 / 96.66                                |
| Package audit        | 0 remote scripts, 0 inline scripts, 0 unapproved network destinations                                          |
| Dependency audit     | 0 known high or critical advisories                                                                            |
| Manifest             | MV3, `["storage","scripting"]`, **no required host permissions**, optional origins only                        |
| Artifact             | `.output/payloadra-0.1.0-chrome.zip` with size and SHA-256 recorded                                            |
| Icons                | 16 / 32 / 48 / 128 PNG present; no unreferenced assets ship                                                    |
| Screenshots          | Five 1280×800 dark-theme PNGs from the real panel, fixture data only                                           |
| Listing copy         | Name, summary, description, category, permission justifications — [CHROME_WEB_STORE.md](./CHROME_WEB_STORE.md) |
| Data-use preparation | Behaviour mapped to the disclosure categories, same document                                                   |
| Compatibility floor  | Every API and platform feature audited against Chrome 120 — [COMPATIBILITY.md](./COMPATIBILITY.md)             |
| Privacy policy text  | [PRIVACY.md](./PRIVACY.md), publishable once it has a URL and an effective date                                |
| UX audit remediation | All P1s, the P2 ledger defect, and the minor findings closed                                                   |

## Part 2 — Yours to do

### Step 1 — Manual Chrome smoke _(blocks everything; ~15 minutes)_

This is the only blocker that is purely mechanical. Nothing in the product has
ever run in a real Chrome: Playwright cannot attach to the DevTools window, and
Chrome 150 refuses `--load-extension`, so the Chrome capture adapter has unit
coverage only.

Run `pnpm build`, then follow the load and walkthrough steps in
[VERIFICATION.md](./VERIFICATION.md) — that document owns the procedure — and
write the outcome into its table. Use this as the pass/fail reference for what
each step should show:

| #   | Step                 | Expected                                                                    |
| --- | -------------------- | --------------------------------------------------------------------------- |
| 1   | Panel registration   | A **Payloadra** tab appears in DevTools                                     |
| 2   | Start/Stop           | Status pill goes live; Stop returns it to Not recording                     |
| 3   | Interaction grouping | Rail lists the action you performed, with its request count and trust state |
| 4   | Explain/Inspect      | Explain gives one sentence with confidence; Inspect renders headers/body    |
| 5   | Redaction            | Authorization header, query token, and password field all show `[REDACTED]` |
| 6   | Clear                | Ledger empties and the confirmation explains what is destroyed              |
| 7   | Sanitized export     | Downloaded HAR contains no credential values                                |

If any step fails, stop and send me the result — that is a code defect, not a
paperwork item.

### Step 2 — Compatibility claim

[COMPATIBILITY.md](./COMPATIBILITY.md) shows Chrome 120 is defensible from the
features the code uses; the highest breaking requirement is `color-mix()` at
Chrome 111. It is still an untested claim. Choose one:

- **Test it** — repeat Step 1 on Chrome 120 and on current stable, on each
  operating system you intend to support, and record the matrix; or
- **Narrow the claim** — publish the statement already drafted in
  COMPATIBILITY.md ("built and verified against Chrome 150 on macOS…").

Note the one known cosmetic gap: `scrollbar-color` needs Chrome 121, so on
Chrome 120 exactly the ledger scrollbars use Chrome's default styling.

### Step 3 — Legal identity

| Decision         | Currently                        | Where it must change                     |
| ---------------- | -------------------------------- | ---------------------------------------- |
| Legal owner name | "the Payloadra project owner"    | `LICENSE`                                |
| Licence terms    | Proprietary, all rights reserved | `LICENSE`, `package.json` (`UNLICENSED`) |
| Store publisher  | Not chosen                       | Chrome Web Store developer account       |

A Web Store submission needs a real publisher account, a verified email, and —
for a paid developer account — the one-time registration fee. Decide whether
Payloadra ships proprietary, open source, or dual-licensed before uploading;
the choice is hard to reverse after publication.

### Step 4 — Monitored contacts

Three documents currently state that no contact exists. Each needs a real,
monitored address:

| File                       | Needs                                         |
| -------------------------- | --------------------------------------------- |
| `SECURITY.md`              | Security address and a response commitment    |
| `SUPPORT.md`               | Support URL or email, supported versions      |
| [PRIVACY.md](./PRIVACY.md) | Privacy contact, effective date, jurisdiction |

The privacy policy also needs a **public URL** — the Web Store form requires
one and it must stay reachable for as long as the item is listed. The repository
has no remote and no hosting, so this needs somewhere to live.

### Step 5 — Store submission

1. `pnpm release:artifact` — runs the full gate, then packages
2. Confirm the audit line reports exactly `["scripting","storage"]`
3. Upload `.output/payloadra-0.1.0-chrome.zip`
4. Paste the listing fields from [CHROME_WEB_STORE.md](./CHROME_WEB_STORE.md)
5. Upload the five screenshots from `docs/screenshots/`
6. Optionally add a 440×280 small promo tile — not generated, and not required
7. Answer every data-use question against the behaviour recorded in that
   document, checking each answer against the form's current wording
8. Add the privacy policy URL from Step 4
9. Submit, and expect review to take longer for an extension that requests host
   access, even optional host access

### Step 6 — After approval

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
- **Segment validation** — no user has used this product. ROADMAP.md Stage 2
  exists for that.
- **Red-team review of redaction and exports** — detection is deliberately
  finite and documented; an adversarial review has not happened.
