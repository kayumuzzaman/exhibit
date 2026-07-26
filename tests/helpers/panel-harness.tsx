import { createRoot } from 'react-dom/client';

import { PayloadraApp } from '../../src/app/app';
import type { RetentionMode } from '../../src/domain/model';
import { toSanitizedHar } from '../../src/domain/har-export';
import { toQaReport } from '../../src/domain/report-export';
import { DEFAULT_REDACTION_CONFIG, redactSession } from '../../src/domain/redaction';
import { createSession } from '../../src/domain/session';
import { createRecordingPipeline } from '../../src/features/capture/recording-pipeline';
import {
  createSessionController,
  type SessionController,
} from '../../src/features/session/session-controller';
import { downloadText } from '../../src/infrastructure/downloads';
import { createIndexedDbSessionRepository } from '../../src/infrastructure/storage/indexeddb-repository';
import {
  createSessionStorageRepository,
  type StorageArea,
} from '../../src/infrastructure/storage/session-storage-repository';
import type { SessionRepository } from '../../src/ports/session-repository';
import { createLoopbackInteractionSource } from './loopback-interactions';
import { createTestCapturePort, type TestCapturePort } from './test-capture-port';

export type PanelHarness = Readonly<{
  controller: SessionController;
  port: TestCapturePort;
  settle(): Promise<void>;
  setRetention(retention: RetentionMode): Promise<void>;
  exportedHar(): string;
  exportedReport(): string;
  /** Loads a same-origin fixture page in a frame and observes its traffic. */
  openFrame(src: string, frameId?: string): Promise<void>;
}>;

export type FixtureActions = Readonly<{
  registerServiceWorker(): Promise<boolean>;
  unregisterServiceWorker(): Promise<boolean>;
  blockedCrossOrigin(origin: string): Promise<unknown>;
}>;

declare global {
  var payloadraHarness: PanelHarness | undefined;
  var fixtureActions: FixtureActions | undefined;
}

/** `chrome.storage.session` stand-in backed by the page's own sessionStorage. */
function sessionStorageArea(): StorageArea {
  return {
    async get(key) {
      const raw = globalThis.sessionStorage.getItem(key);
      return raw === null ? {} : { [key]: JSON.parse(raw) as unknown };
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) {
        globalThis.sessionStorage.setItem(key, JSON.stringify(value));
      }
    },
    async remove(keys) {
      for (const key of typeof keys === 'string' ? [keys] : keys) {
        globalThis.sessionStorage.removeItem(key);
      }
    },
  };
}

export type MountPanelHarnessOptions = Readonly<{
  container: Element;
  origin: string;
  /** Numeric tab identity, matching the DevTools inspected-window contract. */
  tabId?: number;
}>;

/**
 * Mounts the production panel against the real session controller, recording
 * pipeline, and storage repositories, with a browser capture port in place of
 * the Chrome DevTools adapter.
 */
export async function mountPanelHarness(
  options: MountPanelHarnessOptions,
): Promise<PanelHarness> {
  const inspectedTabId = options.tabId ?? 1;
  const tabId = String(inspectedTabId);
  const port = createTestCapturePort();
  const ephemeral: SessionRepository = createSessionStorageRepository(
    sessionStorageArea(),
    { debounceMs: 0 },
  );
  const persistent: SessionRepository = createIndexedDbSessionRepository(indexedDB);
  const restored =
    (await persistent.loadCurrent(tabId).catch(() => null)) ??
    (await ephemeral.loadCurrent(tabId).catch(() => null));
  const initialSession =
    restored !== null && restored.origin === options.origin
      ? restored
      : redactSession(
          createSession(tabId, options.origin, Date.now()),
          DEFAULT_REDACTION_CONFIG,
        );

  const interactions = createLoopbackInteractionSource();
  let pipeline: ReturnType<typeof createRecordingPipeline> | null = null;
  const controller = createSessionController({
    initialSession,
    repositories: { ephemeral, persistent },
    lifecycle: {
      async start(startedAt) {
        await pipeline?.start(startedAt, {
          interaction: { tabId: inspectedTabId, url: globalThis.location.href },
        });
      },
      async stop(stoppedAt) {
        await pipeline?.stop(stoppedAt);
      },
    },
  });
  pipeline = createRecordingPipeline({ capture: port, controller, interactions });

  let lastHar = '';
  let lastReport = '';
  async function exportEvidence(): Promise<void> {
    const snapshot = controller.getSnapshot();
    lastHar = toSanitizedHar(snapshot);
    lastReport = toQaReport(snapshot);
    downloadText(
      `payloadra-${snapshot.id.replace(/[^a-z0-9-]/giu, '-')}.har`,
      'application/json',
      lastHar,
    );
  }

  createRoot(options.container).render(
    <PayloadraApp controller={controller} exportEvidence={exportEvidence} />,
  );

  const harness: PanelHarness = {
    controller,
    port,
    async settle() {
      await port.settled();
      await new Promise((done) => setTimeout(done, 60));
    },
    async setRetention(retention) {
      await controller.setRetention(retention);
    },
    exportedHar() {
      return lastHar;
    },
    exportedReport() {
      return lastReport;
    },
    async openFrame(src, frameId = 'fixture-frame') {
      document.querySelector(`#${frameId}`)?.remove();
      const frame = document.createElement('iframe');
      frame.id = frameId;
      frame.title = 'Fixture application';
      frame.style.cssText = 'width:100%;height:180px;border:0;display:block';
      frame.src = src;
      document.querySelector('#fixture-controls')?.append(frame);

      // The initial about:blank document also fires `load`, so the frame is
      // instrumented only once the requested document is the live one.
      const deadline = Date.now() + 20_000;
      for (;;) {
        const view = frame.contentWindow as (Window & typeof globalThis) | null;
        if (
          view !== null &&
          view.location.pathname.startsWith(new URL(src, location.href).pathname) &&
          view.document.readyState === 'complete'
        ) {
          port.attach(view);
          interactions.attach(view);
          return;
        }
        if (Date.now() > deadline) throw new Error('Fixture frame did not load.');
        await new Promise((done) => setTimeout(done, 25));
      }
    },
  };
  globalThis.payloadraHarness = harness;
  return harness;
}
