export interface DevtoolsPanels {
  create(
    title: string,
    icon: string,
    page: string,
    callback: (panel: unknown) => void,
  ): void;
}

export function bootDevtools(panels: DevtoolsPanels = chrome.devtools.panels): void {
  panels.create('Payloadra', 'icon/16.png', 'panel.html', () => undefined);
}
