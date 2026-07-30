import { createRoot } from 'react-dom/client';

import { ExhibitApp } from '../../src/app/app';
import type { RetentionMode } from '../../src/domain/model';
import { toSanitizedHar } from '../../src/domain/har-export';
import { toQaReport } from '../../src/domain/report-export';
import { redactRecoveredSession, redactSession } from '../../src/domain/redaction';
import { closeInterruptedSession, createSession } from '../../src/domain/session';
import { createRecordingPipeline } from '../../src/features/capture/recording-pipeline';
import {
  createSessionController,
  type SessionController,
} from '../../src/features/session/session-controller';
import {
  buildRedactionConfig,
  createExhibitSettingsRepository,
  DEFAULT_EXHIBIT_SETTINGS,
  normalizeCustomFieldNames,
  type ExhibitSettings,
  type ExhibitSettingsService,
  type SettingsStorageArea,
} from '../../src/features/settings/exhibit-settings';
import { downloadText } from '../../src/infrastructure/downloads';
import { createIndexedDbSessionRepository } from '../../src/infrastructure/storage/indexeddb-repository';
import {
  createSessionStorageRepository,
  type StorageArea,
} from '../../src/infrastructure/storage/session-storage-repository';
import { recoveryForPage } from '../../src/panel/recovery';
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
  var exhibitHarness: PanelHarness | undefined;
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

/** `chrome.storage.local` stand-in backed by the page's own localStorage. */
function localSettingsArea(): SettingsStorageArea {
  return {
    async get(key) {
      const raw = globalThis.localStorage.getItem(key);
      return raw === null ? {} : { [key]: JSON.parse(raw) as unknown };
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) {
        globalThis.localStorage.setItem(key, JSON.stringify(value));
      }
    },
  };
}

export type MountPanelHarnessOptions = Readonly<{
  container: Element;
  origin: string;
  stableScreenshot?: Readonly<{ runtimeOrigin: string }>;
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
  const port = createTestCapturePort({
    ...(options.stableScreenshot === undefined
      ? {}
      : { stableScreenshot: options.stableScreenshot }),
  });
  const settingsRepository = createExhibitSettingsRepository(localSettingsArea());
  let currentSettings = await settingsRepository
    .load()
    .catch(() => DEFAULT_EXHIBIT_SETTINGS);
  const initialRedactionConfig = buildRedactionConfig(currentSettings);
  const ephemeral: SessionRepository = createSessionStorageRepository(
    sessionStorageArea(),
    { debounceMs: 0 },
  );
  const persistent: SessionRepository = createIndexedDbSessionRepository(indexedDB);
  const restored =
    (await persistent.loadCurrent(tabId).catch(() => null)) ??
    (await ephemeral.loadCurrent(tabId).catch(() => null));
  const matchingRecovery = recoveryForPage(restored, tabId, options.origin);
  const corruptRecovery =
    matchingRecovery?.warnings.some(({ code }) => code === 'corrupt-session') === true;
  const initialSession =
    matchingRecovery === null
      ? redactSession(
          createSession(tabId, options.origin, Date.now()),
          initialRedactionConfig,
        )
      : closeInterruptedSession(
          redactRecoveredSession(matchingRecovery, initialRedactionConfig),
          Date.now(),
        );
  if (
    matchingRecovery !== null &&
    initialSession !== matchingRecovery &&
    !corruptRecovery
  ) {
    const repository =
      initialSession.retention === 'persistent' ? persistent : ephemeral;
    await Promise.allSettled([repository.save(initialSession), repository.flush()]);
  }

  const interactions = createLoopbackInteractionSource({
    ...(options.stableScreenshot === undefined
      ? {}
      : { stableScreenshot: options.stableScreenshot }),
  });
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
  pipeline = createRecordingPipeline({
    capture: port,
    controller,
    interactions,
    redactionConfig: initialRedactionConfig,
  });

  let settingsOperation = Promise.resolve();
  function updateSettings(
    update: (settings: ExhibitSettings) => ExhibitSettings,
    apply?: (settings: ExhibitSettings) => void,
  ): Promise<ExhibitSettings> {
    const result = settingsOperation.then(async () => {
      const saved = await settingsRepository.save(update(currentSettings));
      apply?.(saved);
      currentSettings = saved;
      return saved;
    });
    settingsOperation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  const settingsService: ExhibitSettingsService = {
    initial: currentSettings,
    saveCustomFieldNames(customFieldNames) {
      const snapshot = controller.getSnapshot();
      if (
        snapshot.phase !== 'stopped' ||
        snapshot.requests.length > 0 ||
        snapshot.interactions.length > 0
      ) {
        return Promise.reject(
          new Error('Clear captured evidence before changing redaction settings.'),
        );
      }
      return updateSettings(
        (settings) => ({
          ...settings,
          customFieldNames: normalizeCustomFieldNames(customFieldNames),
        }),
        (settings) => pipeline?.setRedactionConfig(buildRedactionConfig(settings)),
      );
    },
    saveTheme(theme) {
      return updateSettings((settings) => ({ ...settings, theme }));
    },
  };

  let lastHar = '';
  let lastReport = '';
  async function exportEvidence(format: 'har' | 'markdown'): Promise<void> {
    const snapshot = controller.getSnapshot();
    lastHar = toSanitizedHar(snapshot);
    lastReport = toQaReport(snapshot);
    const baseName = `exhibit-${snapshot.id.replace(/[^a-z0-9-]/giu, '-')}`;
    if (format === 'markdown') {
      downloadText(`${baseName}.md`, 'text/markdown', lastReport);
      return;
    }
    downloadText(`${baseName}.har`, 'application/json', lastHar);
  }

  createRoot(options.container).render(
    <ExhibitApp
      controller={controller}
      exportEvidence={exportEvidence}
      settings={settingsService}
    />,
  );

  const harness: PanelHarness = {
    controller,
    port,
    async settle() {
      await port.settled();
      await Promise.all([ephemeral.flush(), persistent.flush()]);
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
  globalThis.exhibitHarness = harness;
  return harness;
}
