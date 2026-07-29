# Exhibit product brief

**Status:** Internal preview; not released

**Last reviewed:** 2026-07-29

## Product statement

Exhibit is a local-first Chrome DevTools extension that turns browser-visible
network traffic into sanitized, evidence-backed explanations. It helps a person
connect an interaction to requests observed shortly afterward, understand what
happened, and export safer evidence without changing the inspected website.

Exhibit does not observe server-to-server traffic and does not replace a
proxy, application performance monitor, or server debugger.

## Primary user and wedge

Three roles can use the product:

- QA engineers reproducing failures in modern web applications;
- frontend developers investigating browser/API behavior;
- support engineers preparing evidence for engineering.

The recommended launch wedge is **QA and support teams debugging authorized
Next.js web applications**. This is a positioning hypothesis, not a validated
market decision. It concentrates Exhibit's strongest differentiators:

- time-bounded interaction-to-request correlation;
- conservative explanations with visible confidence and evidence;
- Next.js Server Action, RSC, and partial React Flight awareness;
- local processing and redaction before storage, display, copy, or export.

Developers remain an important user, but Chrome DevTools and proxy tools already
serve their raw-traffic workflow well.

## Jobs to be done

1. **Reproduce:** “When a workflow fails, show which browser requests were
   observed shortly after the interaction I performed.”
2. **Understand:** “Explain the likely request kind and outcome without hiding
   the protocol facts or inventing server behavior.”
3. **Inspect:** “Let me inspect safe request, response, timing, initiator, and
   framework evidence.”
4. **Hand off:** “Give me a sanitized artifact I can attach to a bug without
   manually cleaning obvious credentials.”
5. **Trust:** “Keep the evidence on this machine and tell me clearly what the
   browser cannot prove.”

## Anti-personas and non-goals

Exhibit is not intended for:

- teams needing server, mobile-app, native-client, or container traffic;
- traffic modification, replay, mocking, throttling, or TLS interception;
- screen recording, console capture, ticket routing, or cloud collaboration;
- unattended production monitoring or telemetry;
- inspecting pages or systems without authorization.

## Product principles

### Evidence before inference

Every explanation names the evidence and confidence. Unknown remains unknown.
Exhibit never infers a Server Action source function name from an opaque
identifier.

### Privacy at the trusted boundary

Sensitive data is redacted before a record becomes eligible for storage,
display, clipboard, cURL, HAR, or report export. Local-only processing reduces
exposure; it does not make every captured value non-sensitive.

### Interaction-first, request-deep

The user begins with the workflow action, then drills into requests. A raw
request table is supporting evidence, not the product's differentiator.

### Calm forensic workspace

The interface favors scanability, explicit states, accessible controls, and
progressive disclosure over dashboard decoration.

### Honest constraints

DevTools must be open, body access can fail, interaction permission is
optional, and hidden server traffic is unavailable. These limitations remain
visible in product copy and exports.

## Core workflow

1. Open Exhibit in DevTools on an authorized regular web page.
2. Start recording.
3. Perform the workflow being investigated.
4. Select a time-correlated interaction group or request.
5. Read Explain; open Inspect when raw evidence is needed.
6. Filter, search, or compare related calls.
7. Export a chosen sanitized HAR or Markdown QA report.
8. Clear the local session when finished.

## Success measures

Exhibit has no telemetry by design. Product validation therefore uses
consented research sessions, support feedback, and release-test evidence.

Proposed validation measures:

| Measure                                           |                                Initial target | Collection method                                |
| ------------------------------------------------- | --------------------------------------------: | ------------------------------------------------ |
| First useful explanation                          |         Under 2 minutes from opening DevTools | Moderated usability test                         |
| Core workflow completion                          |   At least 8 of 10 first-time QA participants | Task-based usability test                        |
| Correct interaction group selected                |            At least 90% across test scenarios | Observed test tasks                              |
| Useful result when interaction access is declined |           At least 8 of 10 network-only tasks | Task-based usability test                        |
| Optional access understood before grant           | At least 9 of 10 explain scope and revocation | Comprehension interview                          |
| Sanitized handoff accepted without manual cleanup |              At least 9 of 10 fixture reports | Artifact review                                  |
| Evidence claim accuracy                           |  Zero unsupported claims in acceptance corpus | Maintained protocol fixtures                     |
| Serious accessibility defects                     |                                          Zero | Automated scan plus keyboard/screen-reader smoke |

These are hypotheses until a research round is recorded.

## Release scope

Version 0.1 targets Chrome 120+ and browser-visible REST, GraphQL, forms,
Next.js API routes, Server Actions, SSR, RSC, and partial Flight evidence. It
includes local retention, search/filter/compare, safe cURL, HAR and Markdown
exports, responsive layouts, and keyboard access.

The Chrome 120 floor remains a target until an installed-browser compatibility
matrix covers that version and representative current stable releases on the
operating systems the owner chooses to support.

Accounts, telemetry, cloud storage, collaboration, remote sharing, Firefox,
proxying, and server-side observability are deferred.

## Current readiness

The implementation is an internal release candidate, not a public product.
The automated release gate and artifact record are current. Public release
readiness still requires:

- installed Google Chrome DevTools acceptance;
- the claimed Chrome/operating-system compatibility matrix, or a narrower
  support statement;
- an explicit licence and distribution decision;
- legal owner, privacy contact, and support identity;
- Chrome Web Store disclosures reviewed against the final package;
- first-user usability validation with the primary segment.

See [traceability](./TRACEABILITY.md), [verification](./VERIFICATION.md), and
[business model](./BUSINESS_MODEL.md).
