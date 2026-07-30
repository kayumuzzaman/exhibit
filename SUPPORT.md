# Exhibit support

**Status:** Internal preview; no public support service

## Supported environment

**Tested:** built and manually checked against Chrome 150 on macOS. Chrome 120
is declared as the minimum supported version based on the platform features the
extension uses, not on a tested matrix. See
[COMPATIBILITY.md](./docs/COMPATIBILITY.md).

Current intended environment:

- Chrome 120 or newer;
- Manifest V3;
- regular `http://` or `https://` pages opened in Chrome DevTools;
- macOS, Windows, or Linux where the packaged Chrome extension can run;
- local development with Node 22.13+ in the 22.x line or Node 24+, and pnpm
  10+.

The automatic browser suite uses Playwright Chromium because automation cannot
drive Chrome's DevTools window. A user-reported installed Chrome 150/macOS smoke
passed on 2026-07-30. Chrome 120+ is an intended compatibility floor, not a
tested matrix; the public claim above is narrowed to what was actually checked.
Recording Chrome 120 and a representative current stable version on every
operating system the owner intends to support would widen it, and needs no code
change.

Firefox, Safari, Edge-specific behavior, mobile browsers, native applications,
server traffic, proxies, and unattended production monitoring are unsupported.

## Getting help

Open a [GitHub issue](https://github.com/kayumuzzaman/exhibit/issues) with the
detail listed below.

- **Supported version:** the current Chrome Web Store release only. Older
  versions are not patched; update before reporting.
- **Response times:** best effort. Exhibit is maintained by one person and
  carries no paid support entitlement.
- **Security reports** do not belong here. Use the private channel in
  [SECURITY.md](./SECURITY.md) so nothing sensitive lands in a public issue.

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
