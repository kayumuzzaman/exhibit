# Exhibit architecture

Exhibit is a Manifest V3 Chrome extension built with WXT, React 19, and
TypeScript in strict mode. It is organised so that untrusted browser data
crosses exactly one boundary before it becomes evidence the product trusts.

## Surfaces

| Surface                   | Entry point                       | Role                                                              |
| ------------------------- | --------------------------------- | ----------------------------------------------------------------- |
| DevTools page             | `entrypoints/devtools/main.ts`    | Registers the Exhibit panel.                                      |
| Panel                     | `entrypoints/panel/main.tsx`      | Composes capture, interactions, storage, and the React workspace. |
| Background service worker | `entrypoints/background.ts`       | Owns the tab-scoped interaction capability and its leases.        |
| Injected collector        | `entrypoints/interaction.ts`      | Records trusted DOM interactions in the isolated world.           |
| Injected history hook     | `entrypoints/interaction-main.ts` | Observes `history` navigation in the main world.                  |

## Layers

```
entrypoints/  Chrome wiring only
  src/app/          React shell, provider, error boundary
  src/features/     capture pipeline, session, explain, inspect, settings
  src/domain/       pure evidence rules: redaction, classification, explanation,
                    correlation, exports, limits
  src/infrastructure/ Chrome, storage, clipboard, download adapters
  src/ports/        interfaces the domain depends on
```

Dependencies point inward. `src/domain` imports nothing from `infrastructure`
or `entrypoints`, which is what makes the evidence rules testable without a
browser.

## Capture pipeline

1. **Observe.** `chromeCaptureSource` listens to
   `chrome.devtools.network.onRequestFinished` and reconciles against
   `getHAR()` on an interval, on visibility changes, and at stop. Entries are
   de-duplicated by a raw key so a request is emitted once even when both paths
   see it.
2. **Normalize.** `normalizeObservation` copies only the fields it understands
   out of the untrusted HAR object into a frozen `CapturedRequest`. No vendor
   object or accessor escapes this function.
3. **Apply body policy.** Bodies are measured in real UTF-8 bytes and marked
   `available`, `truncated`, `binary`, `streamed`, or `unavailable`.
4. **Redact.** `createRequestRedactor` produces a `SanitizedCapturedRequest`
   with an opaque id. This is the only way a request becomes displayable.
5. **Classify.** Protocol evidence decides the kind (API, GraphQL, form, SSR,
   RSC, Next.js API, Server Action, static, document, unknown) with a
   confidence and the facts behind it.
6. **Explain.** A plain-language outcome and guidance are derived from the same
   evidence, never from guesses about server code.
7. **Accept.** The session controller appends the record inside the ring buffer
   limits and persists a snapshot through the active repository.

Interaction events take a parallel path: the injected collector posts them to
the background coordinator, the panel's interaction source stamps the owning
tab, the pipeline redacts each event, and the controller stores it bounded.
`correlate` groups requests under the trusted interaction that preceded them
inside a five-second window. While recording, the panel sends a validated
heartbeat every 20 seconds over the active lease so the MV3 coordinator remains
live; a disconnect or Stop cancels the timer.

## Session state

`createSessionController` owns a single frozen `SanitizedRecordingSession`
snapshot and serialises start, stop, clear, retention changes, and accepts
through one operation queue. Views subscribe with `useSyncExternalStore`.

The ring buffer enforces `maxRequests` (500), `maxBytes` (8 MiB), and
`maxBodyBytes` (512 KiB). Oversized records are rejected with a warning instead
of evicting good evidence, and warnings themselves are capped.

## Storage

| Retention             | Adapter                  | Lifetime                        |
| --------------------- | ------------------------ | ------------------------------- |
| `ephemeral` (default) | `chrome.storage.session` | Until the browser session ends. |
| `persistent`          | IndexedDB                | Until cleared or uninstalled.   |

Both go through a versioned schema. Decoding validates every field, rejects
oversized or malformed payloads with a `corrupt-session` warning, re-redacts the
contents, reissues request ids, and recomputes classification and explanation
rather than trusting stored analysis.

Panel preferences use a separate versioned record in `chrome.storage.local`.
The record contains the light/dark/system theme and bounded custom
credential-field names. Custom names are additive only: mandatory credential
names are always merged back in before capture or recovery. Clearing evidence
does not clear these preferences.

## Panel workspace

`ExhibitApp` renders a command bar, a session rail, the request ledger, and a
detail workspace, with an error boundary that falls back to a recovery screen
offering Clear and Export. Layout switches between wide, medium, narrow, and
phone modes from the viewport width; the wide layout has draggable, keyboard
operable separators. The session rail provides interaction groups, quick
filters, and method/domain/protocol/outcome/cache facets. Search is updated
incrementally as requests and correlated interactions arrive.

## Testing

- Unit and integration tests (`vitest`) cover the domain rules, the pipeline,
  storage schemas, and the React surfaces, with a 90% four-metric coverage gate.
- End-to-end tests (`playwright`) drive the real panel against real browser
  traffic from a deterministic Node fixture and a real Next.js production build,
  plus a packaged-extension smoke suite that loads the built MV3 package in
  Chromium.
