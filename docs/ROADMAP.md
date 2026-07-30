# Exhibit roadmap

**Status:** Stage 0 acceptance complete; distribution readiness pending

**Last reviewed:** 2026-07-30

Exhibit should close the approved version 0.1 contract before expanding its
feature surface. Each stage has an exit condition; passing tests alone does not
substitute for user or owner decisions.

## Stage 0 — internal release candidate

Goal: make the existing approved scope internally complete.

- [x] Fix the short HTTP Basic credential redaction leak.
- [x] Recover valid dense sessions at the documented 500-request limit.
- [x] Retrieve stalled live response content with bounded concurrency.
- [x] Flush pending evidence on panel reload and close interrupted recording
      state honestly.
- [x] Make the performance gate's retry envelope match its test timeout.
- [x] Render computed interaction groups in the left rail.
- [x] Offer HAR and Markdown report export explicitly, including redaction
      state, item count, and selected format.
- [x] Preserve active detail and Inspect tab state across responsive remounts.
- [x] Make evidence retention explicit and recover corrupt or absent storage
      records without destroying recoverable data.
- [x] Persist theme and bounded additive custom redaction names while enforcing
      mandatory defaults.
- [x] Add incremental interaction-aware search and five intersecting evidence
      facets.
- [x] Keep the active interaction lease alive with a validated 20-second
      heartbeat.
- [x] Cover near-cap Flight decoding, phone touch targets, medium-width
      overflow, and fresh-database startup with regressions.
- [x] Pass the full-source Impeccable detector and fresh browser UI audit.
- [x] Run `pnpm verify`, build the zip, and record size and SHA-256.
- [x] Pass the installed Google Chrome DevTools checklist. The user-reported
      Chrome 150/macOS run is recorded in [VERIFICATION.md](./VERIFICATION.md).

Exit condition: every automated gate passes, the artifact is recorded, and all
eight approved acceptance criteria are complete.

The manual acceptance record is complete. Before publication, the current
working tree still needs to become a clean release commit with a newly generated
and recorded artifact.

## Stage 1 — distribution readiness

Goal: create a product that can legally and operationally be offered.

- [ ] Name the legal owner and Chrome Web Store publisher.
- [ ] Choose proprietary, open-source, or dual-licence distribution terms.
- [ ] Approve private-beta licence/NDA and participant data-handling terms
      before sharing a build with outside design partners.
- [ ] Publish monitored privacy, security, and support contacts.
- [ ] Define supported versions, update policy, and support expectations.
- [ ] Run an installed-browser matrix covering the claimed Chrome 120 floor
      and a representative current stable version on each supported operating
      system, or narrow the compatibility claim.
- [ ] Review privacy policy and Web Store data-use answers with the final
      publisher form.
- [ ] Conduct an independent red-team review of redaction and exported
      artifacts.
- [ ] Resolve persistent IndexedDB evidence retention against the final Web
      Store user-data policy: obtain an approved interpretation, add
      user-controlled encryption, or remove persistent retention from the
      public build.
- [ ] Publish the approved privacy policy at a stable public URL with an
      effective date and Limited Use disclosure.
- [x] Regenerate and inspect the five current 1280×800 light-theme store
      screenshots from fixture-only data.
- [ ] Create the required 440×280 small promo tile and YouTube product video.
- [x] Preserve the historical design and implementation plan referenced by
      [TRACEABILITY.md](./TRACEABILITY.md).

Exit condition: owner signs the launch checklist and the final store package
matches reviewed documentation.

Validation note, 2026-07-30: listing copy, policy drafts, permission
justifications, screenshot automation, and package automation exist. They do
not complete the unchecked owner decisions, public contact/hosting work,
compatibility matrix, independent review, or final publisher-form review.

## Stage 2 — problem and segment validation

Goal: test whether QA/support teams on Next.js applications are the right
initial segment.

- [ ] Recruit 5–10 participants across at least three authorized applications.
- [ ] Measure first useful explanation, workflow completion, group selection,
      handoff acceptance, and unsupported claims.
- [ ] Compare the same tasks against Chrome DevTools Network.
- [ ] Record confusion, trust, and accessibility findings without adding
      behavioral telemetry.
- [ ] Decide whether the primary user is QA, support, or frontend development.

Exit condition: observed evidence supports or rejects the proposed wedge and
defines the next usability work.

Validation note, 2026-07-30: the repository contains measures and a proposed
segment, but no participant record or observed research evidence. None of the
Stage 2 items can yet be marked complete.

## Stage 3 — differentiated workflow

Goal: deepen the validated advantage, not copy competitor breadth.

Candidate work, ordered only after Stage 2 evidence:

- interaction-first timeline and clearer time-bounded request correlation;
- guided first-run workflow and in-product capture-limit help;
- denser but more legible request/Inspect navigation;
- report templates tuned to the chosen team workflow;
- broader framework evidence only where fixtures can prove claims;
- managed local deployment and compatibility support if organizations request
  it.

Explicitly deferred until separate evidence and privacy design exist:

- accounts, billing, cloud sync, remote storage, collaboration, and share links;
- screen/video recording, console collection, or ticket integrations;
- traffic mutation, mocking, proxying, replay, or server observability;
- Firefox and mobile/native capture.

## Decision log required

Before moving stages, record:

1. evidence reviewed;
2. decision owner;
3. accepted trade-offs;
4. privacy and permission impact;
5. measurable exit condition.

Current product and commercial hypotheses live in [PRODUCT.md](./PRODUCT.md)
and [BUSINESS_MODEL.md](./BUSINESS_MODEL.md). Competitor evidence lives in
[COMPETITIVE_LANDSCAPE.md](./COMPETITIVE_LANDSCAPE.md).
