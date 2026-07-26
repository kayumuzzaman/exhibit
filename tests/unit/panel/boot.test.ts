import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { PayloadraApp } from '../../../src/app/app';
import type { SessionController } from '../../../src/features/session/session-controller';
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
    const controller = {} as SessionController;

    bootPanel(controller, documentRoot, () => root);

    expect(selector).toBe('#root');
    expect(rendered).toMatchObject({
      type: PayloadraApp,
      props: { controller },
    });
  });

  it('fails clearly when the panel root is unavailable', () => {
    const documentRoot = {
      querySelector: () => null,
    } as PanelDocument;
    const controller = {} as SessionController;

    expect(() =>
      bootPanel(controller, documentRoot, () => ({ render: () => undefined })),
    ).toThrow('Payloadra panel root is unavailable.');
  });
});
