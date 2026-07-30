# Exhibit user guide

Exhibit is a Chrome DevTools panel that records browser-visible network
requests, explains what each one did in plain language, and lets you inspect the
sanitized evidence. Everything stays on the machine: the extension has no
backend, sends no telemetry, and declares no required host permissions.
Optional access is requested for the inspected page's origin only when
interaction grouping starts. Chrome grants that origin access to the extension,
not just one tab, and keeps the grant until the user revokes it or uninstalls
the extension; Exhibit uses it only for the active inspected tab.

## Install the unpacked extension

1. Install dependencies and build:

   ```bash
   pnpm install
   pnpm build
   ```

2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select `.output/chrome-mv3`.
4. Open DevTools on any regular web page. An **Exhibit** panel appears beside
   Elements, Console, and Network.

Chrome 120 or newer is required. Exhibit was built and manually checked against
Chrome 150 on macOS; 120 is the minimum declared from the platform features the
code uses, not a tested matrix. Chrome pages (`chrome://`, `edge://`, `about:`)
cannot be inspected; the panel says so instead of showing an empty ledger.

## Record a session

- **Start** begins recording. The status pill and the screen-reader status
  region both announce the phase.
- Use the page normally. Every browser-visible request that DevTools reports is
  normalized, redacted, classified, and added to the ledger.
- **Stop** ends recording. Captured evidence stays available.
- **Clear** removes the session from memory and from local storage after a
  confirmation dialog.

Recording also asks for interaction access to the inspected page's origin. If
Chrome declines, the panel keeps recording network evidence and says that
interaction grouping is unavailable. Chrome's grant is origin-wide and
persistent, while Exhibit's active collector remains scoped to the inspected
tab and recording lease.

## Read the evidence

Select a request to open the detail workspace. It has two views:

**Explain** answers "what happened":

- one sentence naming the recent correlated interaction, request kind, outcome,
  duration, and classification confidence without claiming causation;
- the Server Action identifier when the protocol proves one, never a guessed
  function name;
- the submitted field names (never their values) and the returned shape;
- related calls, redirects, repeats, cache hits, and service-worker delivery;
- a **Why Exhibit says this** disclosure listing the underlying facts.

**Inspect** shows the developer evidence in tabs: Overview, Request, Response,
Timing, Initiator, and Evidence. Bodies render as **Structured**, **Text**, or
**Raw protocol** (for React Flight payloads). Large bodies render only after
their section is opened.

## Filter, search, and compare

- **API requests only** is on by default. Turn it off to include documents,
  static assets, and unknown traffic.
- Quick filters narrow to **Failures**, **Slow calls** (≥ 1000 ms), or
  **Cache hits**.
- Expand **Evidence facets** to intersect method, domain, protocol, outcome,
  and cache state. **Reset filters** clears quick filters, facets, search,
  interaction scope, and API-only mode.
- **Interaction groups** scopes the ledger to requests observed shortly after
  one trusted page interaction. **Unattributed** keeps requests with no recent
  trusted interaction instead of inventing a causal link.
- The search box matches route, status, headers, body text, and evidence.
- When the selected request repeats an earlier one with the same method and
  normalized URL, **Show request comparison** reports status, duration delta,
  changed headers, and body structure changes.

## Copy and export

- **Copy safe cURL** copies a runnable command with credential headers removed.
  Success and failure are announced in the panel. Clipboard content can outlive
  DevTools and be read by other local applications; Clear cannot retract it.
- **Export** shows the current request count and enforced-redaction state, then
  writes either a sanitized HAR 1.2 file or a deterministic Markdown QA report.
  Authorization and cookie headers are always redacted, and only the current
  session is written.

## Retention

- **Memory** (default) keeps the session in `chrome.storage.session`. It
  survives closing and reopening the panel and is discarded when the browser
  session ends.
- **Local** keeps the session in IndexedDB so it survives a browser restart.
- **Clear** removes the session from both stores.

Clear does not revoke an optional origin permission. Revoke it through Chrome's
extension permissions/site-access controls when it is no longer needed.

The command-bar **Settings** dialog adds custom sensitive field names. Mandatory
authorization, cookie, credential-name, and token-pattern protection cannot be
disabled. Stop and Clear before changing custom names; the setting then applies
to later captures and persists locally. Theme choice also persists locally.

Recovered sessions are re-redacted, their request identifiers are reissued, and
their stored analysis is discarded and recomputed rather than trusted.

## Keyboard

| Context                                                | Keys                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| Request ledger rows                                    | `↑` `↓` `Home` `End` to move, `Enter` or `Space` to open        |
| Tab lists (Explain/Inspect, evidence tabs, body modes) | `←` `→` `↑` `↓` `Home` `End`                                    |
| Column separators                                      | `←` `→` (8 px), `Shift` + `←` `→` (32 px), `Home`, `End`        |
| Dialogs and the filters drawer                         | `Tab` cycles inside, `Esc` closes, focus returns to the trigger |

## Related documents

- [Privacy policy](./PRIVACY.md)
- [Release traceability](./TRACEABILITY.md)
- [Roadmap](./ROADMAP.md)
- [Architecture](./ARCHITECTURE.md)
- [Capture limits](./CAPTURE_LIMITS.md)
- [Verification](./VERIFICATION.md)
- [Release checklist](./RELEASE_CHECKLIST.md)
- [Compatibility floor](./COMPATIBILITY.md)
- [Chrome Web Store listing](./CHROME_WEB_STORE.md)
