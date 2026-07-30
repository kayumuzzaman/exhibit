# Exhibit support

**Status:** Internal preview; no public support service

## Supported environment

Current intended environment:

- Chrome 120 or newer;
- Manifest V3;
- regular `http://` or `https://` pages opened in Chrome DevTools;
- macOS, Windows, or Linux where the packaged Chrome extension can run;
- local development with Node 22.13+ in the 22.x line or Node 24+, and pnpm
  10+.

The automatic browser suite uses Playwright Chromium because automation cannot
drive Chrome's DevTools window. A user-reported installed Chrome 150/macOS smoke
passed on 2026-07-30. Chrome 120+ remains an intended compatibility floor, not a
completed matrix claim: release remains blocked until the owner records Chrome
120 and a representative current stable version on every operating system they
intend to support, or narrows the support statement.

Firefox, Safari, Edge-specific behavior, mobile browsers, native applications,
server traffic, proxies, and unattended production monitoring are unsupported.

## Getting help

For this private repository, use the existing private project channel or issue
tracker. Public distribution is blocked until the owner publishes:

- a support URL or email;
- supported versions and update policy;
- expected response times;
- a security-only reporting route;
- any paid support entitlement.

## Before reporting a defect

1. Confirm DevTools was open before the request.
2. Confirm recording was active on the intended tab.
3. Check the panel notice for restricted pages, interaction permission, body
   availability, eviction, or capture failure.
4. Reproduce with synthetic or non-sensitive data.
5. Run `pnpm verify` when reporting a source-build regression.

## Safe report contents

Include:

- Exhibit commit or package version;
- Chrome and operating-system versions;
- page category and framework version, without customer secrets;
- exact reproduction steps;
- expected and observed result;
- whether the problem appears in Explain, Inspect, storage recovery, copy, HAR,
  or Markdown export;
- sanitized screenshot or fixture-based export;
- relevant test output.

Do not attach a real HAR, session database, authorization header, cookie,
customer response body, or credential. Exhibit redaction reduces risk but
does not make captured evidence public.

Security issues follow [SECURITY.md](./SECURITY.md), not a normal support path.

## Known product limits

- DevTools must remain attached.
- Only browser-visible requests can be observed.
- Body content can be unavailable, truncated, binary, or streamed.
- Interaction grouping needs optional page access. A 20-second lease heartbeat
  covers ordinary MV3 idle shutdown, but browser/extension reloads, forced
  worker stops, and destroyed DevTools contexts can still end it.
- Session limits evict old evidence.
- Secret detection cannot identify arbitrary opaque values.

See the [user guide](./docs/README.md) and
[capture limits](./docs/CAPTURE_LIMITS.md).
