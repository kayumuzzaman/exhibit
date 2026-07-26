# Payloadra user guide

Payloadra is a Chrome DevTools panel that records browser-visible network
requests, explains what each one did in plain language, and lets you inspect the
sanitized evidence. Everything stays on the machine: the extension has no
backend, sends no telemetry, and declares no host permissions.

## Install the unpacked extension

1. Install dependencies and build:

   ```bash
   pnpm install
   pnpm build
   ```

2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select `.output/chrome-mv3`.
4. Open DevTools on any regular web page. A **Payloadra** panel appears beside
   Elements, Console, and Network.

Chrome 120 or newer is required. Chrome pages (`chrome://`, `edge://`,
`about:`) cannot be inspected; the panel says so instead of showing an empty
ledger.

## Record a session

- **Start** begins recording. The status pill and the screen-reader status
  region both announce the phase.
- Use the page normally. Every browser-visible request that DevTools reports is
  normalized, redacted, classified, and added to the ledger.
- **Stop** ends recording. Captured evidence stays available.
- **Clear** removes the session from memory and from local storage after a
  confirmation dialog.

Recording also asks for interaction access on the inspected tab. If Chrome
declines, the panel keeps recording network evidence and says that interaction
grouping is unavailable.

## Read the evidence

Select a request to open the detail workspace. It has two views:

**Explain** answers "what happened":

- one sentence naming the trigger, the request kind, the outcome, the duration,
  and the classification confidence;
- the Server Action identifier when the protocol proves one, never a guessed
  function name;
- the submitted field names (never their values) and the returned shape;
- related calls, redirects, repeats, cache hits, and service-worker delivery;
- a **Why Payloadra says this** disclosure listing the underlying facts.

**Inspect** shows the developer evidence in tabs: Overview, Request, Response,
Timing, Initiator, and Evidence. Bodies render as **Structured**, **Text**, or
**Raw protocol** (for React Flight payloads). Large bodies render only after
their section is opened.

## Filter, search, and compare

- **API requests only** is on by default. Turn it off to include documents,
  static assets, and unknown traffic.
- Quick filters narrow to **Failures**, **Slow calls** (≥ 1000 ms), or
  **Cache hits**. **Reset filters** returns to the full ledger.
- The search box matches route, status, headers, body text, and evidence.
- When the selected request repeats an earlier one with the same method and
  normalized URL, **Show request comparison** reports status, duration delta,
  changed headers, and body structure changes.

## Copy and export

- **Copy safe cURL** copies a runnable command with credential headers removed.
  Success and failure are announced in the panel.
- **Export** writes a sanitized HAR 1.2 file. Authorization and cookie headers
  are always redacted, and only the current session is written.
- The same export path also produces a Markdown QA report describing the
  session, failures, slow calls, and repeated calls.

## Retention

- **Memory** (default) keeps the session in `chrome.storage.session`. It
  survives closing and reopening the panel and is discarded when the browser
  session ends.
- **Local** keeps the session in IndexedDB so it survives a browser restart.
- **Clear** removes the session from both stores.

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
- [Architecture](./ARCHITECTURE.md)
- [Capture limits](./CAPTURE_LIMITS.md)
- [Verification](./VERIFICATION.md)
- [Chrome Web Store listing](./CHROME_WEB_STORE.md)
