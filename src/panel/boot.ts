import { createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { ExhibitApp } from '../app/app';
import type { EvidenceExportFormat } from '../components/export-dialog';
import type { DevtoolsThemeSource } from '../devtools/theme';
import type { SessionController } from '../features/session/session-controller';
import type { ExhibitSettingsService } from '../features/settings/exhibit-settings';

export interface PanelDocument {
  querySelector(selectors: string): Element | null;
}

export interface PanelRoot {
  render(content: ReactNode): void;
}

export type RootFactory = (container: Element | DocumentFragment) => PanelRoot;

export function bootPanel(
  controller: SessionController,
  documentRoot: PanelDocument = document,
  makeRoot: RootFactory = createRoot,
  exportEvidence?: (format: EvidenceExportFormat) => Promise<void>,
  devtoolsTheme?: DevtoolsThemeSource,
  settings?: ExhibitSettingsService,
): void {
  const container = documentRoot.querySelector('#root');

  if (container === null) {
    throw new Error('Exhibit panel root is unavailable.');
  }

  makeRoot(container).render(
    createElement(ExhibitApp, {
      controller,
      ...(exportEvidence === undefined ? {} : { exportEvidence }),
      ...(devtoolsTheme === undefined ? {} : { devtoolsTheme }),
      ...(settings === undefined ? {} : { settings }),
    }),
  );
}
