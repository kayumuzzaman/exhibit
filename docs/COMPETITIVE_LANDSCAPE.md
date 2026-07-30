# Exhibit competitive landscape

**Research date:** 2026-07-29

**Positioning revised:** 2026-07-30. Only Exhibit's wedge and the resulting
competitor ranking changed; no competitor claim was re-verified after the
research date above.

**Scope:** Browser request debugging, bug evidence, and adjacent Next.js tools

## How to read this document

Competitors solve overlapping jobs, not identical ones. “Verified” statements
come from linked official product or documentation pages accessed on the
research date. “Inference” means the reviewed official material did not
advertise an equivalent capability; it is not proof that no such capability
exists.

Exhibit is currently unreleased and has no approved price. Comparison reflects
the repository's current implementation and verification evidence, not a
published product claim.

## Summary

Exhibit is weaker than mature alternatives in breadth, distribution,
collaboration, manipulation, and ecosystem maturity. Its defensible focus is
narrower: making Next.js browser traffic readable, and redacting known
credential forms before evidence reaches the screen — without a proxy, account,
or site SDK.

The strongest differentiator is **conservative Next.js Server Action, RSC, and
Flight evidence**, supported by time-bounded interaction correlation. Capture,
filtering, timing, cURL, and sanitized HAR are table stakes.

Two comparisons matter, for different reasons:

- **Chrome's own Network panel decides installation**, because it is already
  installed and already open on the same tab. Worked through under
  [Exhibit versus the Network panel](#exhibit-versus-the-network-panel-in-detail):
  same capture, different job. It is better for debugging; Exhibit is better for
  framework semantics and for evidence that leaves the browser.
- **Next.js DevTools MCP decides whether the wedge survives.** It is the only
  reviewed tool that could answer the same Server Action question, and with
  repository and local-runtime access it can answer it _better_ — with real
  source locations and function names. Exhibit's defence is black-box operation:
  a deployed page, no repo, no local runtime, no site change. That defence holds
  for reviewing staging and production, and does not hold for a developer
  running the app locally with the repo open. See
  [Next.js DevTools MCP and React DevTools](#nextjs-devtools-mcp-and-react-devtools).

Jam was previously treated as the primary competitor, when the wedge was QA
evidence handoff. Under the current wedge it is an adjacent tool for a segment
Exhibit reaches second; see [PRODUCT.md](./PRODUCT.md) for that decision.

## Comparison matrix

| Capability                                         | Exhibit          | Chrome DevTools Network             | Requestly                                         | Jam                                       | HTTP Toolkit                     | Proxyman                                    |
| -------------------------------------------------- | ---------------- | ----------------------------------- | ------------------------------------------------- | ----------------------------------------- | -------------------------------- | ------------------------------------------- |
| Browser request inspection                         | Yes              | Yes                                 | Yes                                               | Yes                                       | Yes                              | Yes                                         |
| Works without proxy/certificate setup              | Yes              | Yes                                 | Browser extension path                            | Yes                                       | No for intercepted HTTPS clients | No for intercepted HTTPS clients            |
| Traffic outside current browser tab                | No               | No                                  | Desktop/mobile options                            | No                                        | Yes                              | Yes                                         |
| Modify, mock, or resend traffic                    | No               | Yes, with broader DevTools features | Yes                                               | No                                        | Yes                              | Yes                                         |
| Screen/console bug capture                         | No               | Console is separate                 | Yes                                               | Yes                                       | No screen replay                 | No screen replay                            |
| Cloud/team sharing                                 | No               | Manual file handoff                 | Cloud save/share and team workflows               | Yes                                       | Limited/product-tier dependent   | Online logs and Team Workspaces             |
| Local-only core workflow                           | Yes              | Yes                                 | Draft in LocalStorage until cloud save/share      | Shared Jam workflow uses service          | HTTP contents remain local       | Desktop core local; team features use cloud |
| Redaction before trusted product storage/UI/export | Yes              | Sanitized HAR export                | Sensitive request headers excluded in SessionBook | Client-side secret obfuscation documented | User-controlled raw traffic      | User-controlled raw traffic                 |
| Evidence-backed plain-language explanation         | Yes              | No equivalent found; inference      | No equivalent found; inference                    | AI summary targets bug reports            | No equivalent found; inference   | No equivalent found; inference              |
| Next.js Server Action/RSC/Flight semantics         | Yes              | Raw protocol evidence               | No equivalent found; inference                    | No equivalent found; inference            | No equivalent found; inference   | No equivalent found; inference              |
| Account required for core use                      | No               | No                                  | Varies by workflow                                | Yes for Jam creation                      | Free local tier available        | Core local use/licence varies               |
| Current maturity                                   | Internal preview | Browser-native                      | Established product                               | Established product                       | Established open-source product  | Established commercial product              |

## Competitors

### Chrome DevTools Network

Chrome's built-in Network panel is the baseline, not a weak substitute. It
records requests, filters and searches them, shows initiators and timings,
supports throttling and other debugging controls, copies cURL/fetch, imports
HAR, and exports a sanitized HAR by default. Chrome says this sanitized export
removes `Cookie`, `Set-Cookie`, and `Authorization` headers.

Sources:

- [Network features reference](https://developer.chrome.com/docs/devtools/network/reference/)
- [DevTools Network extension API](https://developer.chrome.com/docs/extensions/reference/api/devtools/network)

Exhibit loses:

- extra installation and a second mental model;
- narrower raw debugging and performance controls;
- hard session/body caps;
- no request blocking, overrides, throttling, HAR import, or broad copy formats;
- an unreleased package cannot match native availability or trust.

Exhibit wins:

- redaction applies before product storage and display, not only export;
- interaction grouping, explanations, confidence, and evidence ledger;
- evidence held in memory only, with no on-disk store to leak;
- Markdown QA report;
- Next.js/RSC/Flight classification and safe partial raw fallback.

Inference: reviewed Chrome documentation does not describe an equivalent
evidence-backed plain-language or interaction-correlation workflow.

#### Exhibit versus the Network panel in detail

The Network panel is the only competitor that is already installed, already
trusted, and already open on the same tab. It is therefore the comparison that
decides whether Exhibit is worth a second panel at all. Exhibit numbers below
are read from this repository; Network panel behaviour is from the reference
above, re-checked on 2026-07-29.

##### Where they are the same

Both record only while they are watching, both are scoped to one inspected tab,
and neither sees server-to-server traffic. Both list requests with method, route,
status, and duration; both filter and search; both show initiator and a timing
breakdown; both expose request and response headers and bodies; both copy a
request as cURL; both export HAR 1.2. Both redact `Authorization` and cookie
headers from that HAR by default. Neither requires a proxy, a certificate, an
SDK, or a change to the site.

For the plain question "what did this page just send, and what came back", they
answer at the same level. Exhibit is not competing on capture.

##### Where they differ

| Dimension              | Chrome DevTools Network                                               | Exhibit                                                                                                                |
| ---------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Redaction boundary     | Sanitizes the HAR export; the panel itself shows real values          | Redacts before storage, display, clipboard, cURL, HAR, and report                                                      |
| Unsanitized escape     | A setting re-enables full headers in the export                       | None; there is no switch that exports raw credentials                                                                  |
| Organizing model       | A chronological request table                                         | Interaction groups — requests attributed to the click, submit, or navigation before them                               |
| Attribution basis      | Initiator chain from the engine                                       | A 5-second temporal window, labelled trusted, untrusted hint, or unattributed                                          |
| Interpretation         | Raw protocol facts; the reader supplies meaning                       | One-sentence explanation per request with stated confidence and linked evidence                                        |
| Protocol semantics     | Generic HTTP, plus fetch/XHR typing                                   | Classifies `api`, `fetch-xhr`, `form`, `graphql`, `next-api`, `next-server-action`, `rsc`, `ssr`, `static`, `document` |
| React Flight / RSC     | Raw payload bytes                                                     | Partial Flight decoding with an explicit decode reason and a raw fallback                                              |
| Body views             | Preview, Response, and framework-agnostic formatting                  | Structured, Text, and Raw protocol modes                                                                               |
| Traffic control        | Throttling, request blocking, local overrides for content and headers | None — observation only, by design                                                                                     |
| Copy formats           | cURL, PowerShell, fetch, Node.js fetch                                | Safe cURL only                                                                                                         |
| HAR import             | Yes                                                                   | No                                                                                                                     |
| Handoff artifact       | A HAR file                                                            | A HAR file or a deterministic Markdown QA report                                                                       |
| Retention              | Session-bound to the DevTools instance                                | Browser-session memory only; evidence is never written to disk                                                         |
| Recording caps         | None documented                                                       | 500 requests, 8 MiB per session, 512 KiB per body                                                                      |
| Repeat-call comparison | Manual, by reading two rows                                           | Built in against the previous capture of the same call                                                                 |
| Availability           | Native in every Chrome                                                | A separate install, unreleased                                                                                         |

##### Which is best for what

**Use the Network panel when the job is to debug.** It is better for anything
requiring control or breadth: reproducing a failure under throttling, blocking a
request to test a fallback, overriding a response to isolate a bug, replaying
against a modified payload, importing a HAR somebody sent you, or working past
Exhibit's caps on a heavy page. It is also the right tool when you need the
literal unmodified header values, because Exhibit will not show them to you.

**Use Exhibit when the job is to hand evidence to someone else.** Its
advantage is not seeing more, it is what survives leaving the browser. Three
situations where it is the better instrument:

1. **A QA or support person is producing a report for an engineer.** "The Save
   button triggered three calls, this one returned 500" is an Exhibit output;
   assembling it from the Network panel means reading rows and writing prose.
2. **The evidence leaves the machine.** Attaching a Network HAR sanitizes three
   header names. Exhibit applies redaction to query tokens, credential-shaped
   body fields, and known token formats as well, before the data reaches storage
   or the screen — so a screenshot of the panel is also safe to attach.
3. **The application is Next.js.** Server Actions, RSC navigations, and Flight
   payloads read as opaque POSTs and byte streams in the Network panel.

##### The honest limitation

Exhibit is a **narrower** tool that is **safer to quote**. It is not a Network
panel replacement and should never be positioned as one — a developer debugging
their own application on their own machine is usually better served by the
built-in panel. Exhibit earns its place when the request evidence has to
travel: to a ticket, to a colleague, to a customer thread. That is a real job,
but it is a smaller job than the Network panel's.

No timed head-to-head study exists. Everything above is a capability comparison,
not a measured one; see **Evidence still needed** at the end of this document.

### Requestly

Requestly spans browser extensions and desktop interception. It can intercept,
modify, mock, redirect, and inject traffic; team workflows can share rules and
sessions. SessionBook captures screen/mouse activity, console logs, and network
logs. Its current documentation says a draft is stored temporarily in browser
LocalStorage until the user explicitly saves and shares it to the cloud, and
that request headers are not stored.

Sources:

- [HTTP Interceptor](https://requestly.com/products/http-interceptor/)
- [Downloads and supported platforms](https://requestly.com/downloads/)
- [Record bug reports](https://interceptordocs.requestly.com/sessions/record-bug-reports)
- [Public pricing](https://requestly.com/pricing/)

Exhibit loses:

- no traffic mutation, mocking, redirects, replay, or API client;
- no screen, mouse, or console replay;
- no desktop/mobile/system capture;
- no shared workspaces or online session handoff;
- much smaller platform and organizational feature set.

Exhibit wins:

- deliberately read-only forensic scope;
- no account, rule sync, server, or online-save path;
- deeper request explanation and visible evidence confidence;
- redacted yet inspectable headers/bodies instead of excluding whole sensitive
  header classes;
- Next.js/Flight specialization.

Privacy is not an absolute differentiator: Requestly documents drafts stored
temporarily in browser LocalStorage, followed by a cloud save/share action, and
says request headers are not stored. Exhibit's sharper claim is that its
product has no remote save/share path and keeps sanitized headers inspectable.

Pricing note: Requestly's public page showed Free at $0 and API Client Pro at
$12/user/month on the research date. HTTP Rules pricing was not independently
available in the retrieved static page, so this document does not assign that
price to the directly competing workflow.

### Jam

Jam captures screenshots or video with console logs, network requests, user
events, and device context; it integrates with issue trackers and offers AI
summaries, recording links, MCP, webhooks, and enterprise controls. Creating a
Jam uses an account and produces a shareable artifact.

Sources:

- [Jam product](https://jam.dev/)
- [Getting started](https://jam.dev/docs/introduction)
- [Creating a Jam](https://jam.dev/docs/creating-a-jam)
- [Jam DevTools data](https://jam.dev/docs/devtools)
- [Jam MCP](https://jam.dev/docs/jam-mcp)
- [Pricing](https://jam.dev/pricing)

Exhibit loses:

- no screenshot/video/audio or instant replay;
- no console capture, annotations, comments, or recording links;
- no Jira/Linear/Slack routing, MCP context handoff, or AI summary;
- no collaboration, private folders, SSO, audit logs, or customer capture;
- much weaker first-time and non-technical bug-report workflow.

Exhibit wins:

- no account, cloud artifact, or remote service;
- deeper raw request/body/timing evidence inside DevTools;
- conservative protocol explanations rather than an AI bug summary;
- strict memory-only retention and export boundary;
- Next.js/RSC/Flight evidence.

Pricing snapshot: Jam's official page showed Free at $0, Team at
$14/creator/month billed yearly, and Enterprise as custom pricing.

### HTTP Toolkit

HTTP Toolkit is an open-source desktop proxy for Windows, macOS, and Linux. It
can intercept supported browsers, backend clients, mobile apps, and containers;
inspect raw HTTP; manually rewrite traffic; and send requests. Paid features add
automated mocking/rewriting, reusable rules, and advanced tooling. Its official
pricing page identifies Hobbyist, Professional, and Team tiers.

Sources:

- [HTTP Toolkit product](https://httptoolkit.com/)
- [Intercepting traffic](https://httptoolkit.com/docs/getting-started/intercepting/)
- [Pricing and feature tiers](https://httptoolkit.com/pricing/)
- [Open-source repository](https://github.com/httptoolkit/httptoolkit)

Exhibit loses:

- browser-only visibility;
- cannot observe backend, mobile, native, Docker, or arbitrary client traffic;
- no TLS proxy, manual rewrite, resend, mocking, errors, or timeouts;
- narrower protocol and content breadth;
- smaller open-source ecosystem and maturity.

Exhibit wins:

- no proxy, certificate, network configuration, or separate capture profile;
- operates in the already inspected DevTools tab;
- browser interaction grouping;
- QA-readable explanations and report export;
- Next.js-specific evidence.

Local processing is not a unique advantage against HTTP Toolkit. The workflow
and semantic layer are the meaningful differences.

### Proxyman

Proxyman is a cross-platform HTTP debugging proxy with SSL inspection, filters,
breakpoints, mocking, diffing, scripting, mobile workflows, and MCP
integration. Its core desktop traffic processing is local, while its current
privacy policy also documents cloud-backed Online Logs, Team Workspaces, synced
rules, accounts, and SSO for collaboration features.

Sources:

- [Proxyman product](https://proxyman.com/)
- [Pricing](https://proxyman.com/pricing)
- [Downloads](https://proxyman.com/download)
- [Privacy](https://proxyman.com/privacy)

Exhibit loses:

- platform and client reach;
- traffic modification, diff, scripting, and mobile tooling;
- mature commercial distribution and support;
- agent/MCP traffic-control workflow;
- online-log sharing, team workspaces, synced rules, accounts, and SSO.

Exhibit wins:

- zero proxy or root-certificate setup;
- less invasive, current-tab DevTools workflow;
- strict sanitized evidence model;
- interaction correlation and Next.js-specific explanation.

### Next.js DevTools MCP and React DevTools

**Under the current wedge these are the primary strategic threat, not an
adjacency.** They are the only reviewed tools that address the same Server
Action question, and where they apply they answer it with better evidence than a
browser observer can produce. Next.js 16's MCP guide
describes runtime access to errors, logs, routes, and application metadata, and
local framework tools can connect Server Action identifiers to source. React
DevTools inspects components and profiles rendering.

Sources:

- [Next.js MCP guide](https://nextjs.org/docs/app/guides/mcp)
- [Next.js debugging](https://nextjs.org/docs/app/guides/debugging)
- [React Developer Tools](https://react.dev/learn/react-developer-tools)

Exhibit loses:

- with repo and local runtime access, framework tools can expose server logs,
  source locations, and function names that browser evidence cannot prove;
- no component tree or render profiler.

Exhibit wins:

- black-box use on authorized deployed pages without repository access or site
  changes;
- generic REST/GraphQL/form support beyond Next.js;
- explicit browser request and export evidence.

## Where Exhibit is materially worse

1. **Release and trust:** no public distribution, licence, support identity,
   installed-Chrome acceptance, user base, or compatibility history.
2. **Capture breadth:** Chrome-tab traffic only; no server, mobile, native,
   container, or hidden traffic.
3. **Debug control:** observation only; no resend, modification, mocking,
   throttling, breakpoints, or scripting.
4. **Bug-report context:** no screenshot/video, console, annotations, comments,
   or automatic repro steps.
5. **Collaboration:** no share links, integrations, accounts, teams, RBAC, SSO,
   or audit logs.
6. **Onboarding:** current interface assumes DevTools and protocol familiarity.
7. **Ecosystem:** Chrome-only and especially optimized for Next.js; mature tools
   cover more environments.

## Where Exhibit is materially better

1. **Modern Next.js semantics:** Server Action, RSC, SSR, and partial Flight
   evidence are interpreted conservatively. No reviewed browser tool offers an
   equivalent, and it is the only advantage on this list that a competitor
   cannot add with a checkbox.
2. **Redaction lifecycle:** known credential names and shapes are removed
   before trusted storage, rendering, clipboard, cURL, HAR, and Markdown
   export, with detection limits documented. There is no setting that disables
   it, which is what makes a panel screenshot safe to attach.
3. **Evidence honesty:** claims expose confidence and supporting protocol facts;
   unknown behavior is not guessed.
4. **Local-only product boundary:** no account, backend, telemetry, or remote
   save path in the extension.
5. **QA-readable handoff:** explanations and a deterministic Markdown report
   reduce the gap between raw network logs and a bug report.
6. **Low setup:** no proxy, root certificate, SDK, site modification, or
   separate traffic profile.

## Defensible positioning

> The DevTools panel that makes Next.js network traffic readable — Server
> Actions, RSC navigations, and Flight payloads explained from browser evidence
> alone, on any deployed page, with credentials redacted before they reach the
> screen.

Avoid these claims:

- “first” or “only” privacy-safe network debugger;
- replacement for Chrome's Network panel;
- full HTTP debugger or server observability;
- automatic root-cause analysis;
- perfect secret detection;
- collaboration or bug-recording platform.

## Evidence still needed

- interviews proving Next.js frontend developers are the right primary segment;
- evidence that the Server Action/RSC explanation is understood unprompted by a
  developer who has not read the documentation;
- classifier accuracy against the current Next.js release, not only the pinned
  fixture version;
- timed comparison against Chrome Network for the same debugging tasks;
- red-team review of redaction and export artifacts;
- willingness-to-pay tests for organization support/deployment;
- installed-Chrome and cross-version compatibility results;
- comparison refresh before any public pricing or launch claim.
