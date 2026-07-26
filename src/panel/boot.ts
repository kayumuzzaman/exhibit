import { createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { PayloadraApp } from '../app/app';
import type { SessionController } from '../features/session/session-controller';

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
  exportEvidence?: () => Promise<void>,
): void {
  const container = documentRoot.querySelector('#root');

  if (container === null) {
    throw new Error('Payloadra panel root is unavailable.');
  }

  makeRoot(container).render(
    createElement(PayloadraApp, {
      controller,
      ...(exportEvidence === undefined ? {} : { exportEvidence }),
    }),
  );
}
