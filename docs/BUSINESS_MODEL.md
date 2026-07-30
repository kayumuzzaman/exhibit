# Exhibit business model

**Status:** Strategy hypotheses; no commercial model approved

**Last reviewed:** 2026-07-30

## Current commercial state

Exhibit is public and MIT-licensed as of 2026-07-31, but not yet submitted to
the Chrome Web Store. There is no approved price, billing
system, sales motion, public support channel, legal owner identity, or Chrome
Web Store publisher account in this repository.

This means Exhibit is currently an engineering asset, not a sellable product.

## Customer map

| Role                            | Problem                                                | Value sought                                              | Likely buying role             |
| ------------------------------- | ------------------------------------------------------ | --------------------------------------------------------- | ------------------------------ |
| Frontend developer              | Server Actions and RSC are opaque in the Network panel | Framework-aware explanation from browser evidence         | Self-serve user                |
| QA engineer                     | Reproduction lacks technical evidence                  | Faster, safer handoff                                     | QA lead or engineering manager |
| Support engineer                | Customer report cannot explain browser behavior        | Escalation package engineering can use                    | Support operations lead        |
| Security-conscious organization | Debug evidence may contain credentials                 | Local processing, strict redaction, controlled deployment | Security/IT plus engineering   |

Recommended first segment: frontend developers working on authorized Next.js
applications. This remains a hypothesis until interviews and usage tests support
it.

The segment is deliberately the one with the weakest buying authority, because
at this stage the constraint is adoption, not revenue. Frontend developers
install DevTools extensions without procurement; QA, support, and security
buyers are reached later, through teams that already run it. See
[PRODUCT.md](./PRODUCT.md) for the full wedge rationale.

## Competitive economics

Exhibit competes first with “free and already open”: Chrome DevTools. Mature
tools then add broader interception, screen recording, collaboration,
integrations, or traffic modification. A price cannot be justified by capture,
filtering, timing, cURL, or sanitized HAR alone.

Willingness to pay must come from measurable savings in:

- producing an engineering-ready bug report;
- diagnosing framework-specific browser behavior;
- preventing accidental credential sharing;
- onboarding non-specialists to network evidence;
- satisfying local-only deployment requirements.

Risks that can erase that value:

- the optional origin permission is persistent and origin-wide even though
  Exhibit activates its collector only in the inspected tab;
- users may reject that grant, so the network-only workflow must remain useful;
- “local-only” reduces exposure but also removes the sharing and integration
  convenience mature competitors sell;
- finite credential detection lowers risk but cannot promise a
  credential-free artifact;
- a read-only Chrome-tab tool may not save enough time over free DevTools.

See [competitive landscape](./COMPETITIVE_LANDSCAPE.md).

## Business-model options

### Option A — free local product, paid support and deployment

Keep the local extension free. Charge organizations for managed deployment,
compatibility commitments, priority support, security review material, and
training.

**Advantages:** Preserves no-account promise; low adoption friction; aligns
revenue with organizational needs.

**Costs:** Support revenue is service-heavy; individual use does not monetize;
requires a clear commercial licence and support capacity.

### Option B — paid proprietary extension

Sell individual or organization licences while keeping capture fully local.
Billing and entitlement must be designed without quietly adding product
telemetry.

**Advantages:** Direct value capture; simple product story.

**Costs:** Competes with free DevTools; account/licence enforcement can conflict
with local-only positioning; billing, entitlement, tax/VAT, terms, order,
refund, chargeback, and support operations become mandatory.

### Option C — open-source core, paid organization edition

Open the evidence engine and local extension; sell organization deployment,
policy controls, support, and any future collaboration layer.

**Advantages:** Trust and adoption; community protocol coverage; inspectable
privacy claims.

**Costs:** Requires governance and contribution capacity; differentiation must
extend beyond source availability; dual-licensing needs legal work.

## Recommended sequence

Do not choose paid packaging before validating the wedge.

1. **Authorize research:** name the legal owner; approve private-beta
   licence/NDA and data-handling terms; provide monitored privacy, security, and
   support contacts. Settled on 2026-07-31: MIT, Kayumuzzaman, GitHub
   Advisories and Issues.
2. **Private design-partner beta:** 5–10 frontend developers across at least
   three Next.js applications under those terms. No payment; measure whether the
   Server Action and RSC explanations are understood unprompted, then task
   completion and handoff quality, optional-permission comprehension and
   acceptance, and the usefulness of network-only recording when access is
   declined.
3. **Distribution decision:** choose proprietary, open-source, or dual-licence
   public rights and record the publisher/operating model.
4. **Public free validation:** if approved, publish a clearly scoped local
   edition and measure opt-in interviews, store retention, issue quality, and
   support load without adding behavioral telemetry.
5. **Commercial test:** offer organization support/deployment to teams showing
   repeated usage. Test willingness to pay before building accounts,
   collaboration, or billing.

## Packaging hypotheses

| Package              | Candidate scope                                                                       | Evidence needed before approval                               |
| -------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Local                | Current Chrome extension, local evidence, exports                                     | First-time success and recurring use                          |
| Organization         | Local package plus deployment guide, support, compatibility policy, security material | At least three teams request these needs                      |
| Future team workflow | Controlled sharing/collaboration                                                      | Repeated evidence that sanitized file handoff is insufficient |

Cloud collaboration remains outside version 0.1. It must not be added merely to
copy Jam or Requestly; it needs an evidence-backed user problem and a new
privacy design.

## Acquisition and distribution

Candidate channels:

- Chrome Web Store discovery for “Next.js Server Action,” “RSC,” “React Flight,”
  and “network debugging” searches, which the listing name and summary now
  target;
- framework-focused examples demonstrating Server Action and RSC evidence;
- QA/support workflow guides using sanitized fixture data, published after the
  developer wedge is validated rather than alongside it;
- partnerships or direct outreach to teams with local-only requirements;
- open technical documentation about capture and redaction limits.

Avoid claims that Exhibit replaces Chrome Network, sees server behavior, or
is the first privacy-safe debugger.

## Operating costs

The current product has no runtime backend cost. Business costs still include:

- Chrome/Next.js compatibility testing;
- security and dependency response;
- Web Store publisher and policy maintenance;
- user support and documentation;
- legal/licensing/privacy review;
- fixture and browser-version maintenance.

Future cloud, billing, or collaboration features would materially change the
cost and privacy model.

## Launch gates

No public distribution or commercial sale until all gates pass:

1. Approved licence and legal owner.
2. Public privacy and support contacts.
3. Fresh release gate and signed artifact record.
4. Installed-Chrome DevTools smoke.
5. Chrome Web Store disclosure review and reviewer instructions.
6. Security reporting and incident-response path.
7. Primary-segment usability round.
8. Optional-origin permission copy, revocation path, and network-only fallback
   reviewed with users and against the final store disclosure.
9. Price/package decision recorded separately from product claims.
10. Before any paid order: approved terms and refund policy; billing and
    entitlement design; supported countries; tax/VAT collection and invoices;
    order, cancellation, refund, chargeback, and support operations.

## Owner decisions required

The repository cannot determine these:

- legal owner and public contact;
- proprietary versus open-source licence;
- free versus paid launch;
- supported countries and tax/payment setup;
- support response commitment;
- whether a public website or store listing will collect analytics;
- final privacy counsel and Chrome Web Store disclosure answers.
