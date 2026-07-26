// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PayloadraApp } from '../../../src/app/app';
import { DEFAULT_REDACTION_CONFIG, redactSession } from '../../../src/domain/redaction';
import { createSession } from '../../../src/domain/session';
import type { SanitizedRecordingSession } from '../../../src/domain/sanitized';
import type { SessionController } from '../../../src/features/session/session-controller';

function controllerFake(): SessionController {
  let snapshot: SanitizedRecordingSession = redactSession(
    createSession('tab-2', 'https://app.test', 1_000),
    DEFAULT_REDACTION_CONFIG,
  );
  const listeners = new Set<() => void>();
  return {
    async start() {},
    async stop() {},
    async clear() {
      snapshot = { ...snapshot, requests: [] };
      listeners.forEach((listener) => listener());
    },
    async setRetention() {},
    async accept() {},
    acceptInteraction() {},
    warn() {},
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  };
}

describe('command dialogs', () => {
  it('keeps export behind confirmation, traps focus, closes on Escape, and restores focus', async () => {
    const user = userEvent.setup();
    const exportEvidence = vi.fn().mockResolvedValue(undefined);
    render(
      <PayloadraApp controller={controllerFake()} exportEvidence={exportEvidence} />,
    );
    const trigger = screen.getByRole('button', { name: 'Export evidence' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Export sanitized evidence' });
    expect(dialog).toBeVisible();
    expect(
      screen.getByText(/authorization and cookies are always removed/i),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel export' })).toHaveFocus();

    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Export sanitized file' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(dialog).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(exportEvidence).not.toHaveBeenCalled();
  });

  it('ignores outside clicks, announces export completion, and restores trigger focus', async () => {
    const user = userEvent.setup();
    const exportEvidence = vi.fn().mockResolvedValue(undefined);
    render(
      <PayloadraApp controller={controllerFake()} exportEvidence={exportEvidence} />,
    );
    const trigger = screen.getByRole('button', { name: 'Export evidence' });
    await user.click(trigger);
    await user.click(document.body);
    expect(
      screen.getByRole('dialog', { name: 'Export sanitized evidence' }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Export sanitized file' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Sanitized evidence exported.',
    );
    expect(trigger).toHaveFocus();
  });

  it('announces export failure with recovery copy and keeps the dialog open', async () => {
    const user = userEvent.setup();
    const exportEvidence = vi.fn().mockRejectedValue(new Error('raw export detail'));
    render(
      <PayloadraApp controller={controllerFake()} exportEvidence={exportEvidence} />,
    );
    await user.click(screen.getByRole('button', { name: 'Export evidence' }));
    await user.click(screen.getByRole('button', { name: 'Export sanitized file' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /export failed.*try again/i,
    );
    expect(screen.queryByText(/raw export detail/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole('dialog', { name: 'Export sanitized evidence' }),
    ).toBeVisible();
  });

  it('gives clear confirmation initial focus, Escape close, and completion announcement', async () => {
    const user = userEvent.setup();
    render(<PayloadraApp controller={controllerFake()} />);
    const trigger = screen.getByRole('button', { name: 'Clear evidence' });
    await user.click(trigger);

    expect(
      screen.getByRole('dialog', { name: 'Clear captured evidence' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Keep evidence' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Clear evidence now' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Evidence cleared.');
    expect(trigger).toHaveFocus();
  });

  it('keeps clear failure inside the open dialog with safe retry and cancel controls', async () => {
    const user = userEvent.setup();
    const controller = controllerFake();
    controller.clear = vi.fn().mockRejectedValue(new Error('raw clear failure'));
    render(<PayloadraApp controller={controller} />);

    await user.click(screen.getByRole('button', { name: 'Clear evidence' }));
    await user.click(screen.getByRole('button', { name: 'Clear evidence now' }));

    const dialog = screen.getByRole('dialog', { name: 'Clear captured evidence' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /clear failed.*try again/i,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Clear failed.');
    expect(within(dialog).getByRole('button', { name: 'Keep evidence' })).toBeEnabled();
    expect(
      within(dialog).getByRole('button', { name: 'Clear evidence now' }),
    ).toBeEnabled();
    expect(screen.queryByText(/raw clear failure/i)).not.toBeInTheDocument();
  });
});
