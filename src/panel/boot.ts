import { createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

export interface PanelDocument {
  querySelector(selectors: string): Element | null;
}

export interface PanelRoot {
  render(content: ReactNode): void;
}

export type RootFactory = (container: Element | DocumentFragment) => PanelRoot;

export function bootPanel(
  documentRoot: PanelDocument = document,
  makeRoot: RootFactory = createRoot,
): void {
  const container = documentRoot.querySelector('#root');

  if (container === null) {
    throw new Error('Payloadra panel root is unavailable.');
  }

  makeRoot(container).render(createElement('main', null, 'Payloadra is ready.'));
}
