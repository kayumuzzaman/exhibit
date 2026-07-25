export function bootDevtools(): void {
  chrome.devtools.panels.create(
    'Payloadra',
    'icons/payloadra.svg',
    'panel.html',
    () => undefined,
  );
}

bootDevtools();
