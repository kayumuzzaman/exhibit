import { mountPanelHarness } from '../../helpers/panel-harness';
import { SCREENSHOT_ORIGIN } from '../../helpers/stable-screenshot-capture';
import '../../../src/styles/tokens.css';
import '../../../src/styles/reset.css';
import '../../../src/styles/app.css';
import './harness.css';

declare global {
  var renderFixtureControls: ((container: Element) => void) | undefined;
}

function loadFixtureActions(): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/actions.js';
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('actions.js failed')));
    document.head.append(script);
  });
}

async function start(): Promise<void> {
  await loadFixtureActions();
  const controls = document.querySelector('#fixture-controls');
  const panelRoot = document.querySelector('#panel-root');
  if (controls === null || panelRoot === null) {
    throw new Error('Exhibit harness containers are unavailable.');
  }
  const stableScreenshot =
    new URLSearchParams(globalThis.location.search).get('screenshot') === 'stable';
  globalThis.renderFixtureControls?.(controls);
  await mountPanelHarness({
    container: panelRoot,
    origin: stableScreenshot ? SCREENSHOT_ORIGIN : globalThis.location.origin,
    ...(stableScreenshot
      ? {
          stableScreenshot: { runtimeOrigin: globalThis.location.origin },
        }
      : {}),
  });
  document.body.dataset.harnessReady = 'true';
}

void start();
