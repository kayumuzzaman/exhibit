import { redactRecoveredSession, redactSession } from '../../src/domain/redaction';
import { toSanitizedHar } from '../../src/domain/har-export';
import { safeInspectedOrigin } from '../../src/domain/inspected-page';
import { toQaReport } from '../../src/domain/report-export';
import { closeInterruptedSession, createSession } from '../../src/domain/session';
import { createDevtoolsThemeSource } from '../../src/devtools/theme';
import { createRecordingPipeline } from '../../src/features/capture/recording-pipeline';
import { createSessionController } from '../../src/features/session/session-controller';
import {
  buildRedactionConfig,
  createExhibitSettingsRepository,
  DEFAULT_EXHIBIT_SETTINGS,
  normalizeCustomFieldNames,
  type ExhibitSettings,
  type ExhibitSettingsService,
} from '../../src/features/settings/exhibit-settings';
import { chromeCaptureSource } from '../../src/infrastructure/chrome/devtools-capture-source';
import {
  createInteractionSource,
  type RuntimePortLike,
} from '../../src/infrastructure/chrome/interaction-bridge';
import { downloadText } from '../../src/infrastructure/downloads';
import {
  createSessionStorageRepository,
  type StorageArea,
} from '../../src/infrastructure/storage/session-storage-repository';
import { bootPanel } from '../../src/panel/boot';
import { PRODUCTION_CAPTURE_OPTIONS } from '../../src/panel/capture-policy';
import { recoveryForPage } from '../../src/panel/recovery';
import type { SessionRepository } from '../../src/ports/session-repository';
import '../../src/styles/tokens.css';
import '../../src/styles/reset.css';
import '../../src/styles/app.css';

/** A DevTools eval that never calls back would otherwise hang boot forever. */
const INSPECTED_PAGE_TIMEOUT_MS = 2_000;

function inspectedPage(): Promise<Readonly<{ href: string; origin: string }>> {
  return new Promise((resolve) => {
    // An unresolved page identity degrades to the unknown-origin state, which
    // the panel already renders honestly. A hung promise renders nothing at all.
    const timer = setTimeout(() => {
      resolve({ href: '', origin: safeInspectedOrigin(null) });
    }, INSPECTED_PAGE_TIMEOUT_MS);
    chrome.devtools.inspectedWindow.eval(
      '({ href: location.href, origin: location.origin })',
      (result) => {
        clearTimeout(timer);
        const origin = safeInspectedOrigin(result);
        const href =
          result !== null &&
          typeof result === 'object' &&
          typeof (result as { href?: unknown }).href === 'string'
            ? (result as { href: string }).href
            : origin;
        resolve({ href, origin });
      },
    );
  });
}

/** `chrome.storage.session` keeps evidence in memory for the browser session. */
function extensionSessionArea(): StorageArea {
  return {
    get: (key) => chrome.storage.session.get(key),
    set: (items) => chrome.storage.session.set(items),
    remove: (keys) => chrome.storage.session.remove(keys as string | string[]),
  };
}

function extensionLocalSettingsArea() {
  return {
    get: (key: string) => chrome.storage.local.get(key),
    set: (items: Record<string, unknown>) => chrome.storage.local.set(items),
    setAccessLevel: (options: { accessLevel: 'TRUSTED_CONTEXTS' }) =>
      chrome.storage.local.setAccessLevel(options),
  };
}

function systemThemeFallback(): 'dark' | 'light' {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
    ? 'dark'
    : 'light';
}

function devtoolsTheme() {
  return createDevtoolsThemeSource(chrome.devtools.panels, systemThemeFallback());
}

async function startPanel(): Promise<void> {
  const inspectedTabId = chrome.devtools.inspectedWindow.tabId;
  const tabId = String(inspectedTabId);
  const page = await inspectedPage();
  const settingsRepository = createExhibitSettingsRepository(
    extensionLocalSettingsArea(),
  );
  await settingsRepository.restrictToTrustedContexts().catch(() => undefined);
  let currentSettings = await settingsRepository
    .load()
    .catch(() => DEFAULT_EXHIBIT_SETTINGS);
  const initialRedactionConfig = buildRedactionConfig(currentSettings);
  // The published build keeps evidence in browser-session memory only. No
  // repository writes captured evidence to disk, so nothing survives the
  // browser session and there is no unencrypted evidence at rest to disclose.
  // The persistent slot resolves to the same in-memory repository so a snapshot
  // written by an older local build still loads instead of throwing.
  const ephemeral: SessionRepository =
    createSessionStorageRepository(extensionSessionArea());
  const persistent: SessionRepository = ephemeral;
  const recovered = await ephemeral.loadCurrent(tabId).catch(() => null);
  const matchingRecovery = recoveryForPage(recovered, tabId, page.origin);
  const corruptRecovery =
    matchingRecovery?.warnings.some(({ code }) => code === 'corrupt-session') === true;
  const initialSession =
    matchingRecovery === null
      ? redactSession(
          createSession(tabId, page.origin, Date.now()),
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
  const capture = chromeCaptureSource({
    network: chrome.devtools.network,
    runtime: chrome.runtime,
  });
  const interactions = createInteractionSource({
    sendMessage: (message) => chrome.runtime.sendMessage(message),
    connect: (options) => chrome.runtime.connect(options) as unknown as RuntimePortLike,
  });
  let pipeline: ReturnType<typeof createRecordingPipeline> | null = null;
  const controller = createSessionController({
    initialSession,
    repositories: { ephemeral, persistent },
    lifecycle: {
      async start(startedAt) {
        const current = await inspectedPage();
        await pipeline?.start(startedAt, {
          capture: PRODUCTION_CAPTURE_OPTIONS,
          interaction: { tabId: inspectedTabId, url: current.href },
        });
      },
      async stop(stoppedAt) {
        await pipeline?.stop(stoppedAt);
      },
    },
  });
  pipeline = createRecordingPipeline({
    capture,
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

  window.addEventListener(
    'pagehide',
    () => {
      // Start pending writes while the document is still alive. Browsers do not
      // guarantee that unload work finishes, so normal UI/test flows also await
      // repository flushes explicitly.
      void Promise.allSettled([ephemeral.flush(), persistent.flush()]);
    },
    { once: true },
  );

  document.addEventListener('visibilitychange', () => {
    capture.visibility(document.visibilityState === 'visible');
  });

  bootPanel(
    controller,
    document,
    undefined,
    async (format) => {
      const snapshot = controller.getSnapshot();
      const baseName = `exhibit-${snapshot.id.replace(/[^a-z0-9-]/giu, '-')}`;
      if (format === 'markdown') {
        downloadText(`${baseName}.md`, 'text/markdown', toQaReport(snapshot));
        return;
      }
      downloadText(`${baseName}.har`, 'application/json', toSanitizedHar(snapshot));
    },
    devtoolsTheme(),
    settingsService,
  );
}

/**
 * A rejected boot would leave `#root` empty, so the panel would look broken
 * with nothing to explain it. The message is fixed text: a thrown value can
 * carry inspected-page detail, and nothing reaches the panel unredacted.
 */
function reportBootFailure(): void {
  const container = document.querySelector('#root');
  if (container === null) return;
  const notice = document.createElement('p');
  notice.className = 'boot-failure';
  notice.setAttribute('role', 'alert');
  notice.textContent =
    'Exhibit could not start in this DevTools window. Close DevTools and reopen it to try again.';
  container.replaceChildren(notice);
}

void startPanel().catch(() => {
  reportBootFailure();
});
