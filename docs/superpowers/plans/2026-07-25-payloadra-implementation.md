# Payloadra Implementation Plan

> **Audit note — 2026-07-29:** This file is the historical red/green execution
> plan. Its unchecked boxes were never maintained as a completion ledger. Use
> [release traceability](../../TRACEABILITY.md) for current implementation and
> acceptance status.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and package Payloadra, a privacy-first Chrome DevTools network explainer with ≥90% coverage in all four metrics and automatic browser E2E tests.

**Architecture:** A WXT Manifest V3 extension hosts a React panel. Chrome APIs are isolated behind typed ports; an immutable normalization → redaction → classification → correlation pipeline feeds bounded local repositories and a reducer-driven UI.

**Tech Stack:** TypeScript, WXT, React, Chrome Manifest V3 APIs, Vitest, Testing Library, Playwright Chromium, axe-core, IndexedDB, and pnpm.

## Global Constraints

- Support Chrome 120+ and produce Manifest V3 only.
- Capture only browser-visible DevTools evidence from the selected inspected tab.
- Never use `chrome.debugger`, a proxy, remote code, telemetry, accounts, cloud sync, or remote storage.
- Recording starts only after an explicit Start action and is scoped to the inspected tab.
- Redact before storage, render, clipboard, cURL generation, or export.
- Default session limits are 500 requests, 8 MiB serialized data, and 512 KiB per text body.
- Default retention is ephemeral; persistent retention remains local until Clear.
- Never infer a Server Action source name; show its provable identifier.
- Label uncertain classification and causal analysis as likely, possible, or unknown.
- Enforce ≥90% statements, branches, functions, and lines over substantive source.
- Automatic extension E2E uses Playwright’s persistent Chromium because branded Chrome blocks command-line extension side-loading.
- Production package must contain no remote scripts, remote fonts, remote network destinations, or unnecessary permissions.

---

## File Map

```text
entrypoints/
  background.ts                 tab-scoped interaction relay and script injection
  devtools.html                 DevTools bootstrap document
  devtools/main.ts              creates Payloadra panel
  interaction.ts                dynamically injected unlisted interaction script
  panel.html                    panel document
  panel/main.tsx                React bootstrap
src/
  app/                          composition root, state provider, error boundary
  components/                   shared accessible controls and visual primitives
  domain/                       immutable types, invariants, pure analysis
  features/capture/             Chrome capture adapter and recording pipeline
  features/explain/             plain-language explanation view
  features/inspect/             evidence inspection view
  features/session/             controller, reducer, filters, search, comparison
  features/settings/            retention, redaction, limits, theme settings
  infrastructure/               Chrome bridge, storage, clipboard, downloads
  ports/                        interfaces for external boundaries
  styles/                       tokens, reset, layout, component styles
tests/
  e2e/                          automatic extension and workflow tests
  fixtures/generic/             local REST/GraphQL/forms/cache/stream fixture
  fixtures/next-app/            Next.js API/Server Action/RSC fixture
  helpers/                      Chrome mocks, factories, render helpers
  integration/                  cross-module fixture tests
  unit/                         pure domain and adapter tests
docs/                           user, privacy, architecture, store, verification
```

## Task 1: Reproducible MV3 Foundation and Domain Contract

**Files:**
- Create: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `wxt.config.ts`
- Create: `vitest.config.ts`, `playwright.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.gitignore`
- Create: `entrypoints/devtools.html`, `entrypoints/devtools/main.ts`
- Create: `entrypoints/panel.html`, `entrypoints/panel/main.tsx`, `entrypoints/background.ts`, `entrypoints/interaction.ts`
- Create: `src/domain/model.ts`, `src/domain/session.ts`
- Create: `src/ports/capture-source.ts`, `src/ports/interaction-source.ts`, `src/ports/session-repository.ts`
- Test: `tests/unit/domain/session.test.ts`, `tests/unit/manifest.test.ts`

**Interfaces:**
- Produces: `RecordingSession`, `CapturedRequest`, `InteractionEvent`, `InteractionGroup`, `Classification`, `Explanation`, `SessionLimits`, and `RetentionMode`.
- Produces: `CaptureSource.subscribe(listener): () => void`, `CaptureSource.snapshot(): Promise<CaptureObservation[]>`.
- Produces: `SessionRepository.load/save/clear` and `InteractionSource.start/stop/subscribe`.

- [ ] **Step 1: Write failing domain and manifest tests**

```ts
it('creates a stopped ephemeral session with exact default limits', () => {
  expect(createSession('tab-7', 'https://shop.test', 1_000)).toMatchObject({
    tabId: 'tab-7',
    origin: 'https://shop.test',
    phase: 'stopped',
    retention: 'ephemeral',
    limits: { maxRequests: 500, maxBytes: 8 * 1024 * 1024, maxBodyBytes: 512 * 1024 },
  });
});

it('declares only the minimum MV3 permissions', () => {
  const manifest = buildManifest();
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.minimum_chrome_version).toBe('120');
  expect(manifest.permissions).toEqual(['storage', 'scripting']);
  expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);
  expect(JSON.stringify(manifest)).not.toContain('debugger');
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run tests/unit/domain/session.test.ts tests/unit/manifest.test.ts`
Expected: FAIL because the project and exported contracts do not exist.

- [ ] **Step 3: Scaffold with exact scripts and domain constructors**

`package.json` must expose:

```json
{
  "scripts": {
    "build": "wxt build",
    "zip": "wxt zip",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --max-warnings=0",
    "format:check": "prettier . --check",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "check": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build"
  },
  "engines": { "node": ">=22", "pnpm": ">=10" }
}
```

`createSession` must be deterministic and accept the clock value:

```ts
export const DEFAULT_LIMITS: SessionLimits = {
  maxRequests: 500,
  maxBytes: 8 * 1024 * 1024,
  maxBodyBytes: 512 * 1024,
};

export function createSession(tabId: string, origin: string, now: number): RecordingSession {
  return {
    id: `${tabId}:${now}`,
    tabId,
    origin,
    phase: 'stopped',
    retention: 'ephemeral',
    limits: DEFAULT_LIMITS,
    startedAt: null,
    stoppedAt: null,
    requests: [],
    interactions: [],
    evictedCount: 0,
    warnings: [],
  };
}
```

- [ ] **Step 4: Add thin WXT entrypoints and build manifest**

`wxt.config.ts` exports `buildManifest()` for testability and configures `@wxt-dev/module-react`, `devtools_page`, `minimum_chrome_version`, minimum permissions, and bundled icons. Entrypoints call exported boot functions; all substantive behavior stays under `src/`.

- [ ] **Step 5: Run GREEN and production build**

Run: `pnpm vitest run tests/unit/domain/session.test.ts tests/unit/manifest.test.ts && pnpm typecheck && pnpm build`
Expected: PASS; `.output/chrome-mv3/manifest.json` names `devtools.html`, contains no `debugger`, and has Chrome minimum 120.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json wxt.config.ts vitest.config.ts playwright.config.ts eslint.config.js .prettierrc.json .gitignore entrypoints src/domain src/ports tests/unit
git commit -m "build: scaffold Payloadra MV3 foundation"
```

## Task 2: Redaction-First Privacy Boundary

**Files:**
- Create: `src/domain/redaction.ts`, `src/domain/content-codecs.ts`
- Create: `src/features/settings/redaction-settings.ts`
- Test: `tests/unit/domain/redaction.test.ts`, `tests/unit/domain/content-codecs.test.ts`

**Interfaces:**
- Consumes: `CapturedRequest` from Task 1.
- Produces: `redactRequest(request, config): CapturedRequest`.
- Produces: `redactUrl`, `redactHeaders`, `redactBody`, and `DEFAULT_REDACTION_CONFIG`.
- Produces: `decodeTextBody(input): DecodedBody` with bounded depth and byte limits.

- [ ] **Step 1: Write failing secret-leak tests**

```ts
it.each([
  ['authorization header', requestWithHeader('Authorization', 'Bearer abc.def.ghi')],
  ['nested JSON', requestWithJson({ user: { password: 'hunter2', safe: 'visible' } })],
  ['query token', requestWithUrl('https://api.test/items?token=secret&page=2')],
  ['GraphQL variables', requestWithJson({ query: 'query X', variables: { apiKey: 'sk-live-1' } })],
])('removes %s before returning a record', (_name, request) => {
  const result = redactRequest(request, DEFAULT_REDACTION_CONFIG);
  expect(JSON.stringify(result)).not.toMatch(/hunter2|secret|sk-live-1|abc\.def\.ghi/);
  expect(JSON.stringify(result)).toContain('[REDACTED]');
});

it('never invokes a getter while traversing hostile input', () => {
  const value = Object.create(null, { token: { get: () => { throw new Error('leak'); } } });
  expect(() => redactUnknown(value, DEFAULT_REDACTION_CONFIG)).not.toThrow();
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run tests/unit/domain/redaction.test.ts tests/unit/domain/content-codecs.test.ts`
Expected: FAIL with missing redaction exports.

- [ ] **Step 3: Implement structural and pattern redaction**

Use immutable copies, `Object.getOwnPropertyDescriptors`, a `WeakSet`, maximum depth 32, maximum keys 10,000, and case-insensitive normalized key matching. Handle URL query values, headers, JSON, form-urlencoded, multipart text fields, GraphQL variables, JWT/bearer/API-key patterns, and user-supplied field names.

```ts
export type RedactionConfig = Readonly<{
  fieldNames: readonly string[];
  redactCookies: true;
  redactAuthorization: true;
  scanValuePatterns: boolean;
}>;

export const REDACTED = '[REDACTED]' as const;
```

- [ ] **Step 4: Prove the redacted record is safe to serialize**

Serialize the full result with `JSON.stringify`, structured cloning, URL formatting, and text-body formatting. Assert that none of the original secret fixtures survive and that every redacted field retains its original key and a `[REDACTED]` value. Later boundary tasks consume only this `CapturedRequest` type and repeat the no-secret invariant against their final output.

- [ ] **Step 5: Run GREEN and focused mutation cases**

Run: `pnpm vitest run tests/unit/domain/redaction.test.ts tests/unit/domain/content-codecs.test.ts`
Expected: PASS for cycles, getters, malformed encodings, duplicate headers, mixed-case names, nested arrays, multipart boundaries, and truncation.

- [ ] **Step 6: Commit**

```bash
git add src/domain/redaction.ts src/domain/content-codecs.ts src/features/settings/redaction-settings.ts tests/unit/domain/redaction.test.ts tests/unit/domain/content-codecs.test.ts
git commit -m "feat: enforce redaction-first privacy boundary"
```

## Task 3: HAR Normalization and Evidence States

**Files:**
- Create: `src/features/capture/har-types.ts`, `src/features/capture/normalize-har.ts`
- Create: `src/features/capture/body-policy.ts`, `src/features/capture/evidence.ts`
- Test: `tests/unit/capture/normalize-har.test.ts`, `tests/unit/capture/body-policy.test.ts`
- Create: `tests/helpers/har-factory.ts`

**Interfaces:**
- Produces: `CaptureObservation = { entry: HarEntryLike; content?: RetrievedContent; observedAt: number }`.
- Produces: `normalizeObservation(observation, limits): CapturedRequest`.
- Produces: `BodyContent.state` values `available | unavailable | truncated | binary | streamed`.

- [ ] **Step 1: Write failing normalization tests**

```ts
it('normalizes timing, initiator, cache, service-worker, and redirect evidence', () => {
  const request = normalizeObservation(observation({
    status: 302,
    redirectURL: 'https://app.test/final',
    fromCache: true,
    fromServiceWorker: true,
    wait: 12,
    receive: 8,
  }), DEFAULT_LIMITS);
  expect(request).toMatchObject({
    response: { status: 302 },
    timing: { totalMs: 20 },
    evidence: { fromCache: true, fromServiceWorker: true },
  });
});

it('preserves metadata when content retrieval fails', () => {
  const request = normalizeObservation(observation({ bodySize: 99 }), DEFAULT_LIMITS);
  expect(request.response.body).toMatchObject({ state: 'unavailable', size: 99 });
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run tests/unit/capture/normalize-har.test.ts tests/unit/capture/body-policy.test.ts`
Expected: FAIL with missing normalizer.

- [ ] **Step 3: Implement a defensive HAR adapter**

Validate unknown Chrome objects field-by-field. Clamp negative or non-finite timing values, retain original timestamps, normalize duplicate headers without merging `set-cookie`, classify text/binary MIME types, decode base64 only inside the byte limit, and emit explicit unavailable reasons.

- [ ] **Step 4: Apply body limits before expensive decoding**

```ts
export function applyBodyPolicy(
  content: RetrievedContent | undefined,
  declaredSize: number,
  maxBodyBytes: number,
): BodyContent;
```

The function must measure UTF-8 bytes, truncate on code-point boundaries, keep `size` and `capturedSize`, and never allocate from an untrusted declared size.

- [ ] **Step 5: Run GREEN**

Run: `pnpm vitest run tests/unit/capture/normalize-har.test.ts tests/unit/capture/body-policy.test.ts`
Expected: PASS for invalid HAR values, binary, base64, Unicode truncation, empty bodies, compressed responses, streams, cache, service worker, redirects, and status zero.

- [ ] **Step 6: Commit**

```bash
git add src/features/capture tests/unit/capture tests/helpers/har-factory.ts
git commit -m "feat: normalize browser capture evidence"
```

## Task 4: Protocol and Next.js Intelligence

**Files:**
- Create: `src/domain/classification.ts`, `src/domain/graphql.ts`
- Create: `src/domain/nextjs.ts`, `src/domain/react-flight.ts`
- Create: `src/domain/explanation.ts`
- Test: `tests/unit/domain/classification.test.ts`, `tests/unit/domain/react-flight.test.ts`, `tests/unit/domain/explanation.test.ts`
- Create: `tests/fixtures/protocol/*.txt`, `tests/fixtures/protocol/*.json`

**Interfaces:**
- Consumes: redacted `CapturedRequest`.
- Produces: `classifyRequest(request): Classification`.
- Produces: `decodeFlight(text, limits): FlightDecodeResult`.
- Produces: `explainRequest(request, related): Explanation`.

- [ ] **Step 1: Write failing evidence-led classification tests**

```ts
it('confirms a Server Action only from protocol metadata', () => {
  const result = classifyRequest(requestWith({
    headers: [{ name: 'Next-Action', value: '40f3a8b1' }],
    responseMime: 'text/x-component',
  }));
  expect(result).toMatchObject({
    kind: 'next-server-action',
    confidence: 'confirmed',
    actionId: '40f3a8b1',
  });
  expect(JSON.stringify(result)).not.toContain('functionName');
});

it('does not call every /api path a confirmed Next.js route', () => {
  expect(classifyRequest(requestWith({ url: 'https://plain.test/api/users' }))).toMatchObject({
    kind: 'api',
    confidence: 'likely',
  });
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run tests/unit/domain/classification.test.ts tests/unit/domain/react-flight.test.ts tests/unit/domain/explanation.test.ts`
Expected: FAIL with missing classifiers.

- [ ] **Step 3: Implement scored classification**

Classify static, document, fetch/XHR, REST-like API, GraphQL, form, probable Next API route, Server Action, SSR, and RSC. Each non-generic result carries exact evidence strings. No path-only rule may return `confirmed`.

- [ ] **Step 4: Implement bounded Flight inspection**

Parse newline chunks shaped as `<hex-id>:<tag><payload>`. Decode valid JSON values and known text/reference/error/module tags into a display tree. Preserve unknown tags and malformed lines under `rawChunks`. Cap 10,000 chunks, 32 nesting levels, and the session body limit.

```ts
export type FlightDecodeResult = Readonly<{
  status: 'decoded' | 'partial' | 'unsupported';
  chunks: readonly FlightChunk[];
  rawChunks: readonly string[];
  warnings: readonly string[];
}>;
```

- [ ] **Step 5: Implement plain-language explanations**

Generate deterministic copy from evidence: recent correlated interaction,
protocol kind, status class, duration,
redirect/cache/service-worker/repeated-call facts, and safe next-step guidance.
“Retry,” “CORS,” and “CSP” require direct evidence; otherwise use “repeated
call” or “request failed before an HTTP response.”

- [ ] **Step 6: Run GREEN**

Run: `pnpm vitest run tests/unit/domain/classification.test.ts tests/unit/domain/react-flight.test.ts tests/unit/domain/explanation.test.ts`
Expected: PASS for REST, GraphQL, forms, Next API heuristics, action success/failure, RSC navigation, opaque IDs, malformed Flight, redirects, status zero, cache, and slow calls.

- [ ] **Step 7: Commit**

```bash
git add src/domain tests/unit/domain tests/fixtures/protocol
git commit -m "feat: classify Next.js and browser protocols"
```

## Task 5: Bounded Session Repositories and Controller

**Files:**
- Create: `src/domain/ring-buffer.ts`
- Create: `src/infrastructure/storage/session-storage-repository.ts`
- Create: `src/infrastructure/storage/indexeddb-repository.ts`, `src/infrastructure/storage/schema.ts`
- Create: `src/features/session/session-reducer.ts`, `src/features/session/session-controller.ts`
- Test: `tests/unit/domain/ring-buffer.test.ts`, `tests/unit/storage/repositories.test.ts`, `tests/unit/session/session-controller.test.ts`

**Interfaces:**
- Consumes: Task 1 `SessionRepository` and domain records.
- Produces: `addBounded(session, request): RecordingSession`.
- Produces: `createSessionController(dependencies): SessionController`.
- `SessionController` exposes `start`, `stop`, `clear`, `setRetention`, `subscribe`, and `getSnapshot`.

- [ ] **Step 1: Write failing limit and recovery tests**

```ts
it('evicts oldest requests by count and reports the eviction', () => {
  const session = sessionWithLimits({ maxRequests: 2, maxBytes: 1_000 });
  const next = [request('a', 10), request('b', 10), request('c', 10)]
    .reduce(addBounded, session);
  expect(next.requests.map(({ id }) => id)).toEqual(['b', 'c']);
  expect(next.evictedCount).toBe(1);
});

it('keeps in-memory data when persistence rejects', async () => {
  const controller = createController({ repository: rejectingRepository('quota') });
  await controller.accept(request('safe', 10));
  expect(controller.getSnapshot().requests).toHaveLength(1);
  expect(controller.getSnapshot().warnings).toContainEqual(expect.objectContaining({ code: 'persistence-disabled' }));
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run tests/unit/domain/ring-buffer.test.ts tests/unit/storage/repositories.test.ts tests/unit/session/session-controller.test.ts`
Expected: FAIL with missing storage and controller implementations.

- [ ] **Step 3: Implement byte-aware immutable eviction**

Measure serialized UTF-8 bytes once per record, reject any single record above the total session cap after body truncation, and evict oldest records until both count and byte constraints pass.

- [ ] **Step 4: Implement repositories**

Use `chrome.storage.session` with a 100 ms debounced snapshot for ephemeral mode. Use IndexedDB database `payloadra`, version 1, with `sessions` and `settings` stores for persistent mode. Validate loaded schema before hydration; corruption yields an empty recoverable session without deleting evidence automatically.

- [ ] **Step 5: Implement lifecycle serialization**

Controller transitions are `stopped → starting → recording → stopping → stopped`; duplicate Start/Stop calls are idempotent. Clear during recording stops sources first. Repository switching writes the current redacted snapshot to the chosen backend, then clears the previous backend only after success.

- [ ] **Step 6: Run GREEN**

Run: `pnpm vitest run tests/unit/domain/ring-buffer.test.ts tests/unit/storage/repositories.test.ts tests/unit/session/session-controller.test.ts`
Expected: PASS for count/byte eviction, quota errors, corruption, browser-session recovery, idempotency, clear ordering, and retention migration.

- [ ] **Step 7: Commit**

```bash
git add src/domain/ring-buffer.ts src/infrastructure/storage src/features/session tests/unit/domain/ring-buffer.test.ts tests/unit/storage tests/unit/session
git commit -m "feat: add bounded local session storage"
```

## Task 6: Tab-Scoped Interaction Bridge and Correlation

**Files:**
- Modify: `entrypoints/background.ts`, `entrypoints/interaction.ts`
- Create: `src/infrastructure/chrome/interaction-bridge.ts`, `src/infrastructure/chrome/permissions.ts`
- Create: `src/domain/correlation.ts`, `src/domain/element-label.ts`
- Test: `tests/unit/chrome/interaction-bridge.test.ts`, `tests/unit/domain/correlation.test.ts`

**Interfaces:**
- Implements: `InteractionSource` from Task 1.
- Produces: `correlate(session): readonly InteractionGroup[]`.
- Produces: safe `ElementDescriptor` with tag, role, name, id, and ≤80-character text only.

- [ ] **Step 1: Write failing permission, safety, and ordering tests**

```ts
it('requests only the inspected origin and falls back without interaction capture', async () => {
  permissions.request.mockResolvedValue(false);
  const result = await bridge.start({ tabId: 9, url: 'https://shop.test/cart?token=x' });
  expect(permissions.request).toHaveBeenCalledWith({ origins: ['https://shop.test/*'] });
  expect(result).toEqual({ status: 'network-only', reason: 'permission-denied' });
});

it('never captures form field values or password text', () => {
  document.body.innerHTML = '<form><input name="email" value="qa@test"><input type="password" value="secret"><button>Save</button></form>';
  expect(describeSubmit(document.querySelector('form')!)).not.toMatchObject(
    expect.objectContaining({ value: expect.anything() }),
  );
  expect(JSON.stringify(describeSubmit(document.querySelector('form')!))).not.toMatch(/qa@test|secret/);
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run tests/unit/chrome/interaction-bridge.test.ts tests/unit/domain/correlation.test.ts`
Expected: FAIL with missing bridge and correlator.

- [ ] **Step 3: Implement optional permission and injection flow**

The Start click derives only `origin/*`, rejects `chrome:`, `file:`, and extension pages, requests optional permission, then asks the background worker to inject `/interaction.js` into the inspected `tabId`. Background ports use `payloadra:<tabId>` and validate every sender tab.

- [ ] **Step 4: Implement privacy-safe event capture**

Use capture-phase listeners for click and submit, `popstate`, `hashchange`, and patched `history.pushState/replaceState`. Never read input values. Guard duplicate injection with `globalThis.__payloadraInteractionBridgeV1`; Stop removes listeners and restores history methods.

- [ ] **Step 5: Implement deterministic correlation**

Assign requests by their HAR start timestamp to the nearest preceding event within 5 seconds, stop at the next explicit event, and create a navigation or “Unattributed requests” group when no event qualifies. Redirect descendants inherit the initiating group.

- [ ] **Step 6: Run GREEN**

Run: `pnpm vitest run tests/unit/chrome/interaction-bridge.test.ts tests/unit/domain/correlation.test.ts`
Expected: PASS for denied permissions, restricted pages, multiple tabs, duplicate injection, teardown, timestamp races, navigation, redirects, and unattributed calls.

- [ ] **Step 7: Commit**

```bash
git add entrypoints/background.ts entrypoints/interaction.ts src/infrastructure/chrome src/domain/correlation.ts src/domain/element-label.ts tests/unit/chrome tests/unit/domain/correlation.test.ts
git commit -m "feat: correlate requests with safe interactions"
```

## Task 7: Chrome DevTools Capture Adapter and Recording Pipeline

**Files:**
- Create: `src/infrastructure/chrome/devtools-capture-source.ts`
- Create: `src/features/capture/recording-pipeline.ts`, `src/features/capture/get-content.ts`
- Modify: `src/features/session/session-controller.ts`
- Test: `tests/unit/chrome/devtools-capture-source.test.ts`, `tests/integration/recording-pipeline.test.ts`

**Interfaces:**
- Implements: `CaptureSource`.
- Produces: `createRecordingPipeline({ capture, interactions, controller, clock })`.
- Pipeline order is normalize → body policy → redaction → classification → explanation → bounded repository.

- [ ] **Step 1: Write failing listener and leak-proof pipeline tests**

```ts
it('accepts only requests started after recording began and reconciles at Stop', async () => {
  const source = chromeCaptureSource(fakeDevtools());
  source.begin(2_000);
  emitFinished(harEntry({ startedAt: 1_999 }));
  emitFinished(harEntry({ startedAt: 2_001 }));
  await source.reconcile();
  expect(observedIds()).toEqual(['after-start']);
});

it('redacts before repository save even when classification throws', async () => {
  await pipeline.accept(observationWithSecret('Bearer never-store'));
  expect(JSON.stringify(repository.savedValues)).not.toContain('never-store');
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run tests/unit/chrome/devtools-capture-source.test.ts tests/integration/recording-pipeline.test.ts`
Expected: FAIL with missing adapter and pipeline.

- [ ] **Step 3: Implement callback-compatible DevTools capture**

Wrap `chrome.devtools.network.getHAR` and `request.getContent` callbacks rather than relying on Chrome 151 Promise overloads. Attach one `onRequestFinished` listener per source, deduplicate by method + URL + startedDateTime + HAR connection, poll reconciliation every 1,000 ms only while recording and visible, and perform a final reconciliation on Stop. Before body retrieval, skip image, font, media, stylesheet, and script entries unless `includeStatic` is enabled; always retain fetch/XHR, form, document, redirect, RSC, and Server Action candidates.

- [ ] **Step 4: Implement fault-isolated pipeline**

Each stage returns `Result<T, CaptureIssue>`. A malformed record yields a warning and continues. If classification or explanation fails, store the redacted normalized record with generic `unknown` analysis. Never call repository code with pre-redaction data.

- [ ] **Step 5: Run GREEN**

Run: `pnpm vitest run tests/unit/chrome/devtools-capture-source.test.ts tests/integration/recording-pipeline.test.ts`
Expected: PASS for listener cleanup, hidden panel pause, duplicate HAR entries, body callback errors, pre-start entries, failed requests, stage exceptions, and Stop reconciliation.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/chrome/devtools-capture-source.ts src/features/capture src/features/session/session-controller.ts tests/unit/chrome/devtools-capture-source.test.ts tests/integration/recording-pipeline.test.ts
git commit -m "feat: capture and process DevTools network evidence"
```

## Task 8: Search, Filters, Comparison, cURL, HAR, and QA Report

**Files:**
- Create: `src/features/session/filter-requests.ts`, `src/features/session/search-index.ts`, `src/features/session/compare-requests.ts`
- Create: `src/domain/curl.ts`, `src/domain/har-export.ts`, `src/domain/report-export.ts`
- Create: `src/infrastructure/downloads.ts`, `src/infrastructure/clipboard.ts`
- Test: `tests/unit/session/filter-requests.test.ts`, `tests/unit/session/search-index.test.ts`, `tests/unit/session/compare-requests.test.ts`
- Test: `tests/unit/domain/exports.test.ts`

**Interfaces:**
- Produces: `filterRequests(requests, filter): CapturedRequest[]`.
- Produces: incremental `SearchIndex.add/remove/query`.
- Produces: `compareRequests(left, right): RequestDiff`.
- Produces: `toSafeCurl`, `toSanitizedHar`, and `toQaReport`.

- [ ] **Step 1: Write failing feature and export tests**

```ts
it('combines interaction, failure, slow, method, domain, cache, and protocol filters', () => {
  expect(filterRequests(dataset, {
    interactionId: 'save',
    outcome: 'failure',
    slowOnly: true,
    methods: ['POST'],
    domains: ['api.test'],
    cache: 'miss',
    kinds: ['graphql'],
  }).map(({ id }) => id)).toEqual(['mutation-failed']);
});

it.each([toSafeCurl, toSanitizedHar, toQaReport])('never emits secrets', (exporter) => {
  expect(JSON.stringify(exporter(redactedFixture))).not.toMatch(/secret-original|authorization/i);
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run tests/unit/session tests/unit/domain/exports.test.ts`
Expected: FAIL with missing feature and export functions.

- [ ] **Step 3: Implement incremental discovery tools**

API-only is the default. Normalize search text with locale-independent lowercase. Index method, origin, path, redacted query/body text, status, classification, interaction label, and evidence. Comparison aligns headers case-insensitively and JSON objects by key while preserving array order.

- [ ] **Step 4: Implement safe deterministic exports**

cURL uses POSIX single-quote escaping, drops authorization/cookie headers regardless of settings, and includes only captured redacted text bodies. HAR output is valid 1.2 with `_payloadra` metadata. Markdown reports sort groups and calls by timestamp and include failures, slow calls, repeated calls, evidence, and truncation notices.

- [ ] **Step 5: Implement confirmation-ready adapters**

`downloadText(filename, mime, content)` creates an extension-page object URL, clicks a temporary `<a download>`, removes it, and revokes the URL. `copyText` uses the Clipboard API and returns a typed denied/unavailable error. Neither adapter logs content, and export requires no `downloads` permission.

- [ ] **Step 6: Run GREEN**

Run: `pnpm vitest run tests/unit/session tests/unit/domain/exports.test.ts`
Expected: PASS for filter intersections, Unicode search, index eviction, structural diffs, shell escaping, deterministic HAR/report snapshots, redaction invariants, and adapter failures.

- [ ] **Step 7: Commit**

```bash
git add src/features/session src/domain/curl.ts src/domain/har-export.ts src/domain/report-export.ts src/infrastructure/downloads.ts src/infrastructure/clipboard.ts tests/unit/session tests/unit/domain/exports.test.ts
git commit -m "feat: add discovery and sanitized exports"
```

## Task 9: Premium Accessible Panel Shell

**Required skill:** `frontend-design:frontend-design`

**Files:**
- Create: `src/app/app.tsx`, `src/app/app-provider.tsx`, `src/app/error-boundary.tsx`
- Create: `src/components/button.tsx`, `src/components/icon.tsx`, `src/components/status-pill.tsx`, `src/components/dialog.tsx`, `src/components/resizable.tsx`
- Create: `src/features/session/command-bar.tsx`, `src/features/session/session-rail.tsx`, `src/features/session/request-table.tsx`, `src/features/session/empty-state.tsx`
- Create: `src/styles/tokens.css`, `src/styles/reset.css`, `src/styles/app.css`
- Create: `public/icon/16.png`, `public/icon/32.png`, `public/icon/48.png`, `public/icon/128.png`
- Modify: `package.json`, `pnpm-lock.yaml`
- Modify: `entrypoints/panel/main.tsx`
- Test: `tests/unit/ui/app-shell.test.tsx`, `tests/unit/ui/request-table.test.tsx`, `tests/unit/ui/dialog.test.tsx`

**Interfaces:**
- Consumes: `SessionController`, filters, search, and domain records.
- Produces: responsive shell with command bar, rail, request table, detail slot, dialogs, notices, and no-data states.

- [ ] **Step 1: Write failing interaction and accessibility tests**

```tsx
it('supports the complete keyboard recording path', async () => {
  renderApp();
  await user.tab();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('button', { name: 'Stop recording' })).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('Recording');
});

it('keeps export destructive-adjacent action behind confirmation', async () => {
  await user.click(screen.getByRole('button', { name: 'Export evidence' }));
  expect(screen.getByRole('dialog', { name: 'Export sanitized evidence' })).toBeVisible();
  expect(screen.getByText(/authorization and cookies are always removed/i)).toBeVisible();
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run tests/unit/ui/app-shell.test.tsx tests/unit/ui/request-table.test.tsx tests/unit/ui/dialog.test.tsx`
Expected: FAIL because UI components do not exist.

- [ ] **Step 3: Implement visual system**

Install `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono`, import only their local WOFF2 variable subsets, and fall back to `ui-sans-serif` and `ui-monospace`; no runtime font request is allowed. Tokens must cover graphite/porcelain surfaces, cyan live, mint success, amber warning, coral failure, AA contrast, 4/8 px spacing rhythm, 10 px control radii, 1 px evidence dividers, focus ring, reduced motion, and light/dark DevTools themes.

- [ ] **Step 4: Implement responsive shell**

At ≥1,100 px render resizable rail/list/detail regions. From 720–1,099 px collapse rail to a drawer. Below 720 px use list → detail navigation. Preserve selected request, filters, and scroll state across layout changes.

- [ ] **Step 5: Implement states and command safety**

Design not-recording, recording-empty, network-only, restricted page, no matches, body unavailable, truncation, eviction, capture failure, and export failure states. Start/Stop use one stable control position. Clear and Export dialogs trap focus, restore focus, close on Escape, and announce completion.

- [ ] **Step 6: Run GREEN with axe**

Run: `pnpm vitest run tests/unit/ui/app-shell.test.tsx tests/unit/ui/request-table.test.tsx tests/unit/ui/dialog.test.tsx`
Expected: PASS with no serious axe violations, full keyboard operation, semantic table/landmarks, reduced motion, and narrow viewport assertions.

- [ ] **Step 7: Commit**

```bash
git add src/app src/components src/features/session src/styles public/icon entrypoints/panel/main.tsx tests/unit/ui package.json pnpm-lock.yaml
git commit -m "feat: build premium accessible panel shell"
```

## Task 10: Explain and Inspect Workspaces

**Required skill:** `frontend-design:frontend-design`

**Files:**
- Create: `src/features/explain/explain-view.tsx`, `src/features/explain/outcome-summary.tsx`, `src/features/explain/guidance.tsx`, `src/features/explain/related-requests.tsx`
- Create: `src/features/inspect/inspect-view.tsx`, `src/features/inspect/body-viewer.tsx`, `src/features/inspect/header-list.tsx`, `src/features/inspect/timing-waterfall.tsx`, `src/features/inspect/evidence-list.tsx`, `src/features/inspect/request-diff.tsx`
- Create: `src/components/tabs.tsx`, `src/components/code-block.tsx`, `src/components/copy-button.tsx`
- Modify: `src/app/app.tsx`, `src/styles/app.css`
- Test: `tests/unit/ui/explain-view.test.tsx`, `tests/unit/ui/inspect-view.test.tsx`, `tests/unit/ui/body-viewer.test.tsx`

**Interfaces:**
- Consumes: selected `CapturedRequest`, `Explanation`, `InteractionGroup`, `RequestDiff`.
- Produces: Explain/Inspect segmented workspace, safe copy actions, and lazy body/Flight rendering.

- [ ] **Step 1: Write failing evidence rendering tests**

```tsx
it('states correlated interaction, action identifier, outcome, duration, and confidence without inventing a name', () => {
  render(<ExplainView request={serverActionFixture} group={saveGroup} />);
  expect(screen.getByText(/Save profile triggered a Server Action/i)).toBeVisible();
  expect(screen.getByText('40f3a8b1')).toBeVisible();
  expect(screen.queryByText(/function name/i)).not.toBeInTheDocument();
});

it('shows raw fallback beside partial Flight decoding', async () => {
  render(<BodyViewer body={partialFlightBody} />);
  expect(screen.getByText(/partially decoded/i)).toBeVisible();
  await user.click(screen.getByRole('tab', { name: 'Raw protocol' }));
  expect(screen.getByText(/0:\{"a":1\}/)).toBeVisible();
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run tests/unit/ui/explain-view.test.tsx tests/unit/ui/inspect-view.test.tsx tests/unit/ui/body-viewer.test.tsx`
Expected: FAIL with missing workspace components.

- [ ] **Step 3: Implement Explain**

Lead with one sentence and evidence confidence. Show safe submitted field names/results, status, duration, related calls, redirects, repeated calls, cache/service-worker facts, and evidence-based guidance. Keep developer-only raw values out of the default QA hierarchy.

- [ ] **Step 4: Implement Inspect**

Tabs: Overview, Request, Response, Timing, Initiator, Evidence. Body modes: Structured, Text, Raw protocol. Render large bodies only after the section opens. Provide safe cURL, copy value, and compare actions with visible success/failure announcements.

- [ ] **Step 5: Implement timing and comparison visuals**

Scale blocked, DNS, connect, SSL, send, wait, and receive segments against total HAR time. Patterns and labels supplement colors. Comparison shows added/removed/changed fields, status, duration delta, and body structure.

- [ ] **Step 6: Run GREEN**

Run: `pnpm vitest run tests/unit/ui/explain-view.test.tsx tests/unit/ui/inspect-view.test.tsx tests/unit/ui/body-viewer.test.tsx`
Expected: PASS for generic API, GraphQL, form, Server Action, SSR/RSC, partial decode, binary, stream, cache, service worker, CORS/CSP ambiguity, truncation, copy failure, and compare.

- [ ] **Step 7: Commit**

```bash
git add src/features/explain src/features/inspect src/components src/app/app.tsx src/styles/app.css tests/unit/ui
git commit -m "feat: add Explain and Inspect workspaces"
```

## Task 11: Real Fixture Apps and Automatic Extension E2E

**Files:**
- Create: `tests/fixtures/generic/server.ts`, `tests/fixtures/generic/public/index.html`, `tests/fixtures/generic/public/sw.js`
- Create: `tests/fixtures/next-app/package.json`, `tests/fixtures/next-app/app/layout.tsx`, `tests/fixtures/next-app/app/page.tsx`
- Create: `tests/fixtures/next-app/app/actions.ts`, `tests/fixtures/next-app/app/api/profile/route.ts`
- Create: `tests/e2e/extension.fixture.ts`, `tests/e2e/devtools-driver.ts`, `tests/e2e/recording.spec.ts`, `tests/e2e/privacy.spec.ts`, `tests/e2e/accessibility.spec.ts`, `tests/e2e/retention.spec.ts`
- Create: `tests/helpers/test-capture-port.ts`
- Modify: `playwright.config.ts`, `package.json`

**Interfaces:**
- Generic fixture serves REST, GraphQL, XHR, form, redirect, repeat, timeout, cancellation, cache, service-worker, upload, download, stream, binary, CORS failure, large body, and secret endpoints.
- Next fixture serves API route, action success/failure, SSR, and RSC navigations.
- Test capture port implements the same `CaptureSource` interface when DevTools UI is opened directly for deterministic UI E2E; extension smoke tests exercise the real MV3 worker and injected script.

- [ ] **Step 1: Write failing end-to-end scenarios**

```ts
test('records, explains, inspects, filters, compares, and exports one workflow', async ({ payloadra, fixture }) => {
  await payloadra.startRecording();
  await fixture.saveProfile({ name: 'Ada' });
  await payloadra.selectInteraction('Save profile');
  await expect(payloadra.requestRows()).toHaveCount(3);
  await payloadra.openRequest('POST /api/profile');
  await expect(payloadra.explainHeading()).toContainText('Save profile triggered');
  await payloadra.openInspect();
  await expect(payloadra.responseBody()).toContainText('Ada');
  await payloadra.exportHar();
  expect(await payloadra.downloadedHar()).toMatchObject({ log: { version: '1.2' } });
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm test:e2e`
Expected: FAIL because fixture servers and Playwright extension fixture do not exist.

- [ ] **Step 3: Build deterministic generic and Next fixtures**

Bind to `127.0.0.1` on OS-assigned ports, return deterministic payloads, expose readiness endpoints, and close every socket in teardown. Next action tests assert that the captured `Next-Action` header is non-empty and opaque; they must not pin a build-generated identifier or assert a source function name.

- [ ] **Step 4: Implement persistent Chromium extension fixture**

Build first, create a temporary user-data directory, launch `chromium.launchPersistentContext` with `--disable-extensions-except=<output>` and `--load-extension=<output>`, derive the extension ID from its service worker, open testable panel URL, and always close context and remove the temp directory.

- [ ] **Step 5: Cover full product and privacy paths**

Run automatic cases for Start/Stop/Clear, API-only default, every filter, search, interaction grouping, redirects, repeated calls, error/slow/cache/service-worker states, Server Action success/failure, partial Flight, body limits, ephemeral/persistent recovery, compare, safe cURL, HAR/report export, narrow/wide layouts, keyboard operation, and zero secret occurrence in page text/downloads/storage/console.

- [ ] **Step 6: Add automated accessibility scan**

Inject `axe-core` into each main panel state. Fail for critical or serious violations and assert focus order, dialog focus restoration, status live regions, reduced motion, and non-color timing labels.

- [ ] **Step 7: Run GREEN**

Run: `pnpm build && pnpm test:e2e`
Expected: PASS on Playwright persistent Chromium with no leaked processes, open ports, retained temp profiles, console errors, uncaught page errors, serious axe violations, or secret strings.

- [ ] **Step 8: Commit**

```bash
git add tests/fixtures tests/e2e tests/helpers/test-capture-port.ts playwright.config.ts package.json pnpm-lock.yaml
git commit -m "test: add automatic extension end-to-end coverage"
```

## Task 12: Coverage Closure, Performance, Documentation, and Release Package

**Files:**
- Modify: tests and source files identified by coverage and profiling
- Create: `tests/integration/performance.test.ts`, `tests/integration/package-audit.test.ts`
- Create: `docs/README.md`, `docs/PRIVACY.md`, `docs/ARCHITECTURE.md`, `docs/CAPTURE_LIMITS.md`
- Create: `docs/CHROME_WEB_STORE.md`, `docs/VERIFICATION.md`, `CHANGELOG.md`, `LICENSE`
- Create: `scripts/audit-package.mjs`
- Modify: root `README.md`, `package.json`

**Interfaces:**
- Produces: `pnpm verify` as the single release gate.
- Produces: `.output/payloadra-<version>-chrome.zip` and verification evidence.

- [ ] **Step 1: Run the full gate and record every failure**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build && pnpm test:e2e`
Expected: Any missing coverage branch, type error, lint error, build failure, or E2E failure is visible and blocks release.

- [ ] **Step 2: Close coverage with behavior tests**

Open `coverage/coverage-final.json`; for every substantive file below 90% in any metric, add behavior-focused tests for the uncovered error, boundary, and cleanup paths. Do not exclude a substantive file or add ignore comments to raise the number.

- [ ] **Step 3: Add performance and package audits**

```ts
it('normalizes, redacts, classifies, and indexes 500 capped requests within 500 ms', () => {
  const start = performance.now();
  runPipeline(makeRequests(500));
  expect(performance.now() - start).toBeLessThan(500);
});

it('ships no remote code or undeclared network destination', async () => {
  const audit = await auditPackage('.output/chrome-mv3');
  expect(audit.remoteUrls).toEqual([]);
  expect(audit.inlineScripts).toEqual([]);
  expect(audit.permissions).toEqual(['scripting', 'storage']);
});
```

- [ ] **Step 4: Write complete user and compliance documentation**

Document unpacked installation, Start/Stop workflow, Explain/Inspect, filters, redaction, retention, export, keyboard shortcuts, capture limits, architecture, permission rationale, privacy policy, Web Store listing copy, screenshot requirements, and exact verification commands. State that hidden server-to-server traffic is unavailable. Keep `package.json` private and `UNLICENSED`; use an all-rights-reserved notice so implementation grants no distribution rights before an owner chooses licensing.

- [ ] **Step 5: Add one-command release verification**

`pnpm verify` runs format, lint, typecheck, four-metric coverage, production build, package audit, and automatic E2E in that order. `pnpm release:artifact` runs verify then `wxt zip`.

- [ ] **Step 6: Run final automatic acceptance**

Run: `pnpm verify && pnpm release:artifact`
Expected: all gates PASS; coverage summary shows ≥90% for statements, branches,
functions, and lines; zip exists; package audit reports zero unapproved
network-destination URLs and exact permissions.

- [ ] **Step 7: Smoke installed Google Chrome 150**

Load `.output/chrome-mv3` into a dedicated local Chrome profile, open the generic and Next fixtures, verify panel registration, Start/Stop, one interaction group, Explain/Inspect, redaction, Clear, and sanitized export. Record browser version and results in `docs/VERIFICATION.md`.

- [ ] **Step 8: Independent review and final commit**

Run a specification-compliance review followed by a code-quality/security review. Fix every confirmed critical, high, and medium finding, rerun `pnpm verify`, then:

```bash
git add README.md CHANGELOG.md LICENSE docs scripts package.json pnpm-lock.yaml src tests
git commit -m "release: complete Payloadra v1"
```
