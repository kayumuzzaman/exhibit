import { DEFAULT_REDACTION_CONFIG, redactSession } from '../../src/domain/redaction';
import { toSanitizedHar } from '../../src/domain/har-export';
import { safeInspectedOrigin } from '../../src/domain/inspected-page';
import { createSession } from '../../src/domain/session';
import { createDevtoolsThemeSource } from '../../src/devtools/theme';
import { createRecordingPipeline } from '../../src/features/capture/recording-pipeline';
import { createSessionController } from '../../src/features/session/session-controller';
import { chromeCaptureSource } from '../../src/infrastructure/chrome/devtools-capture-source';
import {
  createInteractionSource,
  type RuntimePortLike,
} from '../../src/infrastructure/chrome/interaction-bridge';
import { downloadText } from '../../src/infrastructure/downloads';
import { createIndexedDbSessionRepository } from '../../src/infrastructure/storage/indexeddb-repository';
import {
  createSessionStorageRepository,
  type StorageArea,
} from '../../src/infrastructure/storage/session-storage-repository';
import { bootPanel } from '../../src/panel/boot';
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
  const ephemeral: SessionRepository =
    createSessionStorageRepository(extensionSessionArea());
  const persistent: SessionRepository = createIndexedDbSessionRepository(indexedDB);
  const recovered =
    (await persistent.loadCurrent(tabId).catch(() => null)) ??
    (await ephemeral.loadCurrent(tabId).catch(() => null));
  const initialSession =
    recovered !== null && recovered.origin === page.origin
      ? recovered
      : redactSession(
          createSession(tabId, page.origin, Date.now()),
          DEFAULT_REDACTION_CONFIG,
        );
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
          interaction: { tabId: inspectedTabId, url: current.href },
        });
      },
      async stop(stoppedAt) {
        await pipeline?.stop(stoppedAt);
      },
    },
  });
  pipeline = createRecordingPipeline({ capture, controller, interactions });

  document.addEventListener('visibilitychange', () => {
    capture.visibility(document.visibilityState === 'visible');
  });

  bootPanel(
    controller,
    document,
    undefined,
    async () => {
      downloadText(
        `payloadra-${controller.getSnapshot().id.replace(/[^a-z0-9-]/giu, '-')}.har`,
        'application/json',
        toSanitizedHar(controller.getSnapshot()),
      );
    },
    devtoolsTheme(),
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
    'Payloadra could not start in this DevTools window. Close DevTools and reopen it to try again.';
  container.replaceChildren(notice);
}

void startPanel().catch(() => {
  reportBootFailure();
});
