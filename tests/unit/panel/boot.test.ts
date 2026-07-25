import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { bootPanel, type PanelDocument, type PanelRoot } from '../../../src/panel/boot';

describe('bootPanel', () => {
  it('renders the panel application into the root element', () => {
    const container = {} as Element;
    let selector = '';
    let rendered: ReactNode;
    const documentRoot = {
      querySelector: (value: string) => {
        selector = value;
        return container;
      },
    } as PanelDocument;
    const root: PanelRoot = {
      render: (content) => {
        rendered = content;
      },
    };

    bootPanel(documentRoot, () => root);

    expect(selector).toBe('#root');
    expect(rendered).toMatchObject({
      type: 'main',
      props: { children: 'Payloadra is ready.' },
    });
  });

  it('fails clearly when the panel root is unavailable', () => {
    const documentRoot = {
      querySelector: () => null,
    } as PanelDocument;

    expect(() => bootPanel(documentRoot, () => ({ render: () => undefined }))).toThrow(
      'Payloadra panel root is unavailable.',
    );
  });
});
