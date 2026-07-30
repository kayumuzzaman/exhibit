# Exhibit release decisions

**Prepared:** 2026-07-30 · **Owner:** unassigned

Everything in this repository that could be prepared without an owner decision
has been prepared. What remains are facts about the real world that no amount of
engineering can supply: who owns this, how it is licensed, where to reach a
human, and what a real user thinks of it.

This document is the short list. Each row says exactly what to supply, where it
lands, and what it costs to get wrong. Work down it in order; steps 1 and 2 gate
everything else.

---

## 1. Legal owner and licence — gates everything

| Decision         | Currently                        | Lands in                                 |
| ---------------- | -------------------------------- | ---------------------------------------- |
| Legal owner name | `the Exhibit project owner`      | `LICENSE` line 1                         |
| Licence terms    | Proprietary, all rights reserved | `LICENSE`, `package.json` (`UNLICENSED`) |
| Store publisher  | Not chosen                       | Chrome Web Store developer account       |

Decide proprietary, open source, or dual-licensed **before** uploading. After
publication the choice is effectively irreversible: anyone who obtained the code
under an open licence keeps those rights permanently, and a proprietary listing
that later opens up cannot un-publish the earlier terms either.

A Web Store submission also needs a registered developer account, a verified
email, and the one-time registration fee.

## 2. Monitored contacts and a hosted policy URL

Three documents currently state that no contact exists. Each needs a real
address that somebody actually reads.

| File                       | Needs                                         |
| -------------------------- | --------------------------------------------- |
| `SECURITY.md`              | Security address and a response commitment    |
| `SUPPORT.md`               | Support URL or email, supported versions      |
| [PRIVACY.md](./PRIVACY.md) | Privacy contact, effective date, jurisdiction |

The privacy policy also needs a **public URL**. The Web Store form requires one
and it must stay reachable for as long as the item is listed. GitHub Pages on
this repository is sufficient and free; the repository is currently private, so
publishing the policy is itself a disclosure decision.

Use a role address rather than a personal one where possible — it appears in a
public listing, it will be scraped, and it cannot be quietly changed later
without breaking the listing's stated contact.

## 3. Persistent-retention policy call

Local retention writes redacted evidence to IndexedDB with no application-level
encryption. Redaction is deliberately finite, so the remaining values cannot be
described as guaranteed non-sensitive. Pick one with whoever signs off privacy:

- **Remove persistent retention from the public build**, keeping session-memory
  retention only. Smallest disclosure surface, and the cheapest to defend. Costs
  users their evidence on browser restart.
- **Encrypt persistent evidence** with a user-controlled key, and document the
  threat model and recovery behaviour.
- **Record an approved policy interpretation** for the current local design,
  against Chrome's current
  [user-data guidance](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

Do not claim encrypted storage while the current implementation stands. This is
the one remaining item that may require code, so decide it before the final
artifact is cut.

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
