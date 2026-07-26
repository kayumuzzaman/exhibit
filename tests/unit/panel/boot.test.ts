// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { act, screen } from '@testing-library/react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { PayloadraApp } from '../../../src/app/app';
import { DEFAULT_REDACTION_CONFIG, redactSession } from '../../../src/domain/redaction';
import { createSession } from '../../../src/domain/session';
import type { SanitizedRecordingSession } from '../../../src/domain/sanitized';
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

  it('mounts the real application through the production panel boundary', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const container = document.querySelector('#root')!;
    const root = createRoot(container);
    const snapshot: SanitizedRecordingSession = redactSession(
      createSession('mounted-tab', 'https://mounted.test', 1_000),
      DEFAULT_REDACTION_CONFIG,
    );
    const controller: SessionController = {
      async start() {},
      async stop() {},
      async clear() {},
      async setRetention() {},
      async accept() {},
      acceptInteraction() {},
      warn() {},
      subscribe: () => () => undefined,
      getSnapshot: () => snapshot,
    };

    bootPanel(controller, document, () => root);

    expect(await screen.findByRole('banner')).toBeVisible();
    expect(screen.getByText('https://mounted.test')).toBeVisible();
    act(() => root.unmount());
  });
});
