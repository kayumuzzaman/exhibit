# Exhibit security policy

**Project status:** Private internal preview

**Last reviewed:** 2026-07-29

## Supported versions

No public version is supported yet. Security fixes apply to the current `main`
branch until a release and support window are published.

Before public distribution, this section must name supported versions, update
channels, and end-of-support dates.

## Reporting a vulnerability

Do not open a public issue containing a vulnerability, captured session,
credential, customer URL, or request/response body.

Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/kayumuzzaman/exhibit/security/advisories/new)
on this repository. That channel keeps the report private until a fix is
published, so no disclosure happens through a public issue.

Expect an acknowledgement within 7 days. Exhibit is maintained by one person
without a paid support commitment, so a fix timeline is agreed case by case
rather than promised in advance.

Include:

- affected commit or package version;
- Chrome version and operating system;
- minimal reproduction using synthetic data;
- expected and observed security boundary;
- whether data reached storage, UI, clipboard, export, logs, or a network
  destination.

Never send a real credential as proof. Use a canary value.

## Security model

Exhibit treats the inspected page, HAR objects, response content, interaction
messages, stored sessions, and imported browser values as untrusted.

Primary trust boundaries:

1. Chrome DevTools and runtime APIs are read defensively.
2. Network observations are normalized into known fields.
3. Size and content-state policy runs before expensive body work.
4. Redaction produces the only request type eligible for trusted storage,
   display, clipboard, cURL, HAR, or Markdown report output.
5. Stored sessions are size-, shape-, origin-, identifier-, and
   bookkeeping-validated, then re-redacted and re-analyzed on recovery.
6. Interaction messages are scoped to the inspected tab, origin, frame,
   document, sender, and active lease.
7. The packaged extension is audited for permissions, remote code, inline
   scripts, and network destinations.

The extension declares `storage` and `scripting`, no required host permission,
and optional `http://*/*`/`https://*/*` access requested for interaction
grouping. Chrome's optional grant is origin-wide and persists until revoked or
uninstalled; Exhibit's collector and recording lease are scoped to the active
inspected tab. It does not use `chrome.debugger`.

## Security guarantees

- Recording starts only after an explicit user action and is tab-scoped.
- The extension has no backend, account, analytics, telemetry, or intended
  outbound request path.
- Authorization and cookie headers are always removed from exports.
- Known credential-shaped names and values are redacted before trusted use.
- Session and body sizes are bounded.
- A malformed request is isolated from the rest of capture.
- Restricted browser pages fail closed.
- Package verification rejects unexpected permissions or remote code.

These guarantees are release claims only after the current package passes
`pnpm verify` and the installed-Chrome acceptance record.

## Known limits

No finite detector can identify every secret. A value may remain when its name
and shape look ordinary, including opaque webhook path segments, OAuth
`code`/`state` values, or a secret embedded in prose. Captured and exported
evidence must still be treated as sensitive.

Exhibit cannot:

- see server-to-server or hidden backend traffic;
- secure an already compromised browser, extension process, or operating
  system;
- prevent another extension or local process from reading files it can access;
- guarantee body availability from Chrome;
- make a user-selected export safe for public distribution.

See [privacy](./docs/PRIVACY.md) and [capture limits](./docs/CAPTURE_LIMITS.md).

## Release security checks

Run from a clean checkout:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm release:artifact
pnpm audit:dependencies
```

The release record must include:

- commit SHA and dirty-state result;
- Node, pnpm, Chrome, and Playwright Chromium versions;
- test, coverage, build, package-audit, and E2E results;
- artifact path, size, and SHA-256;
- installed Google Chrome smoke result;
- dependency-audit result and accepted exceptions;
- reviewer identity and date.

## Response process

1. Acknowledge privately and preserve the report.
2. Reproduce with synthetic data.
3. Determine whether trusted storage, UI, clipboard, export, logs, or network
   boundaries were crossed.
4. Contain publication or distribution if affected.
5. Add a failing regression test before the fix.
6. Fix the root cause and run the full release gate.
7. Rotate any project credential exposed during investigation.
8. Document impact, affected versions, remediation, and disclosure timing.

There is no public bug bounty or guaranteed response SLA at this stage.
