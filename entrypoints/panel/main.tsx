import { DEFAULT_REDACTION_CONFIG, redactSession } from '../../src/domain/redaction';
import { toSanitizedHar } from '../../src/domain/har-export';
import { safeInspectedOrigin } from '../../src/domain/inspected-page';
import { createSession } from '../../src/domain/session';
import { createDevtoolsThemeSource } from '../../src/devtools/theme';
import { createRecordingPipeline } from '../../src/features/capture/recording-pipeline';
import { createSessionController } from '../../src/features/session/session-controller';
import { chromeCaptureSource } from '../../src/infrastructure/chrome/devtools-capture-source';
import { downloadText } from '../../src/infrastructure/downloads';
import { bootPanel } from '../../src/panel/boot';
import type { SessionRepository } from '../../src/ports/session-repository';
import '../../src/styles/tokens.css';
import '../../src/styles/reset.css';
import '../../src/styles/app.css';

function inspectedOrigin(): Promise<string> {
  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval(
      '({ href: location.href, origin: location.origin })',
      (result) => {
        resolve(safeInspectedOrigin(result));
      },
    );
  });
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
  const tabId = String(chrome.devtools.inspectedWindow.tabId);
  const initialSession = redactSession(
    createSession(tabId, await inspectedOrigin(), Date.now()),
    DEFAULT_REDACTION_CONFIG,
  );
  const memoryRepository: SessionRepository = {
    async load() {
      return null;
    },
    async loadCurrent() {
      return null;
    },
    async save() {},
    async clear() {},
  };
  const capture = chromeCaptureSource({
    network: chrome.devtools.network,
    runtime: chrome.runtime,
  });
  let pipeline: ReturnType<typeof createRecordingPipeline> | null = null;
  const controller = createSessionController({
    initialSession,
    repositories: {
      ephemeral: memoryRepository,
      persistent: memoryRepository,
    },
    lifecycle: {
      async start(startedAt) {
        await pipeline?.start(startedAt);
      },
      async stop(stoppedAt) {
        await pipeline?.stop(stoppedAt);
      },
    },
  });
  pipeline = createRecordingPipeline({ capture, controller });

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

void startPanel();
