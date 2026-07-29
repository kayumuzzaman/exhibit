# Payloadra compatibility floor

**Reviewed:** 2026-07-29

**Declared floor:** `minimum_chrome_version: "120"` in `wxt.config.ts`

This record exists because a compatibility claim that nobody tested is a
promise to users we cannot keep. It separates what is derivable from the source
— every platform feature the extension actually uses, and the Chrome version
each one needs — from what still requires a real browser.

## Method

Every `chrome.*` call, every CSS feature, and every recent JavaScript built-in
in `src/` and `entrypoints/` was enumerated from the source, then matched
against its documented Chrome availability. The highest requirement sets the
floor.

## Extension APIs used

| API                                    | Needs      | Note                                                   |
| -------------------------------------- | ---------- | ------------------------------------------------------ |
| `manifest_version: 3`, service worker  | Chrome 88  | Baseline for the whole package                         |
| `chrome.scripting.executeScript`       | Chrome 88  | Interaction collector injection                        |
| `optional_host_permissions`            | Chrome 91  | Origin access requested at Start                       |
| `chrome.storage.session`               | Chrome 102 | Ephemeral retention; trusted-context by default        |
| `chrome.devtools.network` / `panels`   | Long-lived | Panel registration and capture                         |
| `chrome.devtools.inspectedWindow`      | Long-lived | Tab identity and origin                                |
| `chrome.permissions`                   | Long-lived | Optional origin grant                                  |
| `chrome.runtime` messaging / `connect` | Long-lived | Panel ↔ background ↔ collector                         |
| `chrome.tabs.query`                    | Long-lived | Popup reads `tab.id` only, which needs no `tabs` grant |
| `chrome.storage.local.setAccessLevel`  | See below  | Hardening only; optional-chained and caught            |

## Web platform features used

| Feature                     | Needs      | Impact below that version              |
| --------------------------- | ---------- | -------------------------------------- |
| `color-mix()` (11 uses)     | Chrome 111 | **Breaking** — surface colours fail    |
| `:has()` (3 uses)           | Chrome 105 | Breaking — selector never matches      |
| `inert` attribute           | Chrome 102 | Breaking — modal background stays live |
| `accent-color`              | Chrome 93  | Cosmetic                               |
| `forced-colors` media query | Chrome 89  | High-contrast support absent           |
| `:focus-visible`            | Chrome 86  | Focus ring behaviour                   |
| `scrollbar-color`           | Chrome 121 | **Cosmetic only** — see caveat         |
| `structuredClone`           | Chrome 98  | Breaking                               |
| `Object.hasOwn`             | Chrome 93  | Breaking                               |
| `crypto.randomUUID`         | Chrome 92  | Falls back to a counter-based id       |
| `Array.prototype.at`        | Chrome 92  | Breaking                               |

No API newer than `structuredClone` (Chrome 98) is used in JavaScript. The
bundle's newest syntax is logical assignment (`??=`, Chrome 85).

## Verdict

**120 is defensible and is the correct declared floor.** The highest breaking
requirement is `color-mix()` at Chrome 111, nine versions below the claim.

Two qualifications the publisher should know:

1. **`scrollbar-color` needs Chrome 121**, one version above the floor. On
   Chrome 120 exactly, the evidence ledger's scrollbars render with the default
   Chrome styling instead of the panel's. Nothing else changes. This is
   cosmetic and does not justify raising the floor.
2. **`chrome.storage.local.setAccessLevel` is a hardening call, not a
   dependency.** It restricts the settings area — theme and custom redaction
   field names, never captured evidence — to trusted contexts. It is invoked
   through `?.` and wrapped in `catch`, so on any Chrome that does not expose it
   for `storage.local` the call silently does nothing and the extension works
   normally. Confirm the exact version before making any public claim about
   this specific hardening; the Chrome and MDN pages reviewed on 2026-07-29
   documented the method for all storage areas without pinning the version at
   which `local` gained it.

## What this does not establish

Static analysis proves which features the code _asks for_. It does not prove
Chrome _runs it_. Specifically untested:

- the extension loading from `chrome://extensions` on any real Chrome build;
- `chrome.devtools.network` delivering real requests through
  `src/infrastructure/chrome/devtools-capture-source.ts`, which has unit
  coverage only;
- DevTools panel registration, theming, and docking behaviour;
- behaviour on Chrome 120 itself, or on Windows and Linux.

Until the manual checklist in [VERIFICATION.md](./VERIFICATION.md) is recorded
on at least the floor version and one current stable, the honest public
statement is the narrower one:

> Built and verified against Chrome 150 on macOS. Declares Chrome 120 as its
> minimum supported version based on the platform features it uses.

Claiming tested support for the whole 120-to-current range needs the matrix in
[ROADMAP.md](./ROADMAP.md) Stage 1.
