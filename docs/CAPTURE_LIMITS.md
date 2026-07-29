# Capture limits

Exhibit reports only what a browser observer can prove. These limits are
product behaviour, not defects.

## Hidden traffic is unavailable

**Exhibit cannot see server-to-server traffic.** A request your server makes
to another service never reaches the browser, so it never reaches DevTools and
never reaches Exhibit. The same applies to anything the page does not perform:
background jobs, webhooks, database calls, and edge-function fan-out.

What Exhibit can prove is the request the browser made and the response it
received.

## DevTools must be open

Chrome only reports network activity to a DevTools extension while DevTools is
attached to the tab. Requests made before you open DevTools, or while it is
closed, are not captured. Reload the page after starting a recording if you need
the document request itself.

## Body availability

| State         | Meaning                                                                              |
| ------------- | ------------------------------------------------------------------------------------ |
| `available`   | The full body was captured within the limit.                                         |
| `truncated`   | The body exceeded 512 KiB; the captured prefix is shown with its real size.          |
| `binary`      | The MIME type is not textual, so bytes are not decoded.                              |
| `streamed`    | The response was streamed and DevTools did not buffer it. Headers and timing remain. |
| `unavailable` | DevTools did not provide content, timed out, or returned an unsupported encoding.    |

Exhibit reads DevTools evidence, not the page JavaScript CORS view. A CORS
failure can appear as a failed browser request, but it does not by itself define
which fields DevTools returns. Chrome can still omit a body or field for
protocol, cache, streaming, cancellation, privacy, or implementation reasons;
Exhibit reports only the evidence it actually receives.

## Session limits

| Limit                 | Value   | Behaviour at the limit                                                 |
| --------------------- | ------- | ---------------------------------------------------------------------- |
| Requests per session  | 500     | The oldest request is evicted and the panel reports the evicted count. |
| Session bytes         | 8 MiB   | The oldest requests are evicted first.                                 |
| Body bytes per record | 512 KiB | The body is marked `truncated`.                                        |
| Interaction events    | 1000    | The oldest events are dropped.                                         |

## Classification honesty

- **Confirmed** means the protocol proves the kind, for example a `Next-Action`
  header on a POST.
- **Likely** means the evidence is consistent but not exclusive, for example a
  JSON MIME type on an `/api/` path.
- **Unknown** means nothing distinguished the request.

Exhibit never infers a server function name. A Server Action is reported by
its opaque build identifier, and the panel says so. Next.js RSC headers, action
headers, and query markers are internal and version-sensitive; the evidence list
records that caveat with the finding.

## Redaction limits

Redaction fires on a credential-shaped **value** or a credential-indicating
**name**. A secret with neither — an opaque webhook path segment, an OAuth
`code`, a password written into prose — cannot be distinguished from an ordinary
identifier, and redacting every opaque value would erase the evidence the product
exists to show. See [the privacy policy](./PRIVACY.md) for the full list.

## Interaction grouping

Interaction capture needs Chrome to grant access to the inspected tab. When it
is declined, unavailable on a restricted page, or superseded by a navigation,
recording continues in network-only mode and the panel says grouping is
unavailable. Untrusted (script-generated) events are recorded as hints and are
never used to claim a user action occurred.

Interaction capability lives in the MV3 service worker, whose in-memory state
does not survive termination. While recording, the panel sends a fixed
heartbeat message every 20 seconds over the active lease; the worker validates
and acknowledges it, keeping ordinary idle shutdown from silently dropping the
lease. A browser/extension reload, crash, forced worker stop, or destroyed
DevTools context can still end interaction grouping while network capture
continues. Stop and start recording to re-establish it.

## Timing

Timing comes from the HAR record. TLS time belongs to its parent connect phase
and is never added twice. Phases Chrome does not report are shown as `-1` in the
exported HAR and as zero-width segments with their text labels in the panel.
