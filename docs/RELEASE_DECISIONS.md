# Exhibit release decisions

**Prepared:** 2026-07-30 · **Updated:** 2026-07-31 · **Owner:** unassigned

Decisions taken on 2026-07-31: **MIT licence**, **memory-only evidence
retention**, and **a dedicated privacy alias with GitHub for security and
support**. All three are applied in the code and documentation.

Two literal values are still missing, and both are placeholders in tracked files
that will ship if nobody replaces them:

| Value                         | Placeholder currently in           | Needed because                                   |
| ----------------------------- | ---------------------------------- | ------------------------------------------------ |
| Copyright holder's legal name | `LICENSE` line 3                   | An MIT grant with no named holder grants nothing |
| Privacy contact address       | `docs/PRIVACY.md`, Contact section | The Web Store form rejects a policy without one  |

`docs/PRIVACY.md` also needs an **effective date**, which should be the
submission date rather than today's.

The rest of this document is what remains after those.

---

## 1. Legal owner — one value still missing

| Decision         | State                                            |
| ---------------- | ------------------------------------------------ |
| Licence terms    | **MIT**, applied to `LICENSE` and `package.json` |
| Store publisher  | Developer console account created                |
| Legal owner name | **Still a placeholder in `LICENSE` line 3**      |

Send the name the copyright should read as and it goes in. An MIT licence whose
copyright line names nobody grants nothing, so this blocks publication on its
own.

Note that MIT is now applied and is effectively irreversible once published:
anyone who obtains the code under it keeps those rights permanently.

## 2. Contacts and a hosted policy URL

| File                       | State                                                    |
| -------------------------- | -------------------------------------------------------- |
| `SECURITY.md`              | Done — GitHub Security Advisories, 7-day acknowledgement |
| `SUPPORT.md`               | Done — GitHub Issues, current release only, best effort  |
| [PRIVACY.md](./PRIVACY.md) | **Needs the alias address and an effective date**        |

Create the alias (for example `exhibit.privacy@…`), send it over, and it goes in.

The policy then needs a **public URL** that stays reachable for as long as the
item is listed. Now that the licence is MIT, making this repository public and
enabling GitHub Pages is the straightforward route, and it costs nothing.

## 3. Persistent retention — settled, no action

On-disk evidence retention is removed from the published build. Evidence is held
in browser-session memory only and never written to disk, so there is no
unencrypted evidence at rest to disclose or defend.

Enforced rather than asserted: the package audit fails the release if an
evidence-capable persistent storage API appears in the shipped bytes.

The visible cost: users lose captured evidence when the browser session ends.
Export before closing the browser.

## 4. Product video

A concise fixture-only walkthrough, uploaded to YouTube, with the URL pasted
into the listing. Screenshots and the promo tile are generated and tracked; the
video cannot be produced from this repository.

Chrome treats the video as optional in the form. It is listed here because the
release checklist has always required it, not because submission will fail
without it.

## 5. First real users — the one that actually matters

No target-segment participant has used Exhibit. Every quality gate in this
repository measures whether the code does what it was told to do, and none of
them measures whether anyone wants it.

The cheapest way to fix that without waiting on the rest of this list is to
publish **unlisted**: a shareable link, no public discovery, no reviews, no
ratings. Give it to five frontend developers working on Next.js applications,
watch them use it, then decide on public listing.

`ROADMAP.md` Stage 2 has the full research script. The wedge claim to test
first: show a Server Action or an RSC request and record whether the participant
understands it unprompted, and whether Chrome's Network panel left them unable
to.

---

## Already prepared — no decision needed

| Area                | State                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| Quality gate        | `pnpm verify` green; see [VERIFICATION.md](./VERIFICATION.md)                     |
| Release artifact    | Built and hashed from a clean commit; recorded in VERIFICATION.md                 |
| Listing copy        | Name, summary, description, category, permission justifications                   |
| Data-use answers    | Behaviour mapped to the disclosure categories                                     |
| Screenshots         | Five 1280×800 PNGs, Server Action frame leading, regenerable and deterministic    |
| Promo tile          | 440×280, generated by `pnpm promo-tile`, byte-identical across runs               |
| Icons               | 16 / 32 / 48 / 128 PNG                                                            |
| Privacy policy text | Publishable once it has a URL, an effective date, and a contact                   |
| Compatibility claim | Narrowed to what was actually tested — see [COMPATIBILITY.md](./COMPATIBILITY.md) |

The ordered submission steps live in
[RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md).
