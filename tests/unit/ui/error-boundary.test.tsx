// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppErrorBoundary } from '../../../src/app/error-boundary';
import { DEFAULT_REDACTION_CONFIG, redactSession } from '../../../src/domain/redaction';
import type { SanitizedRecordingSession } from '../../../src/domain/sanitized';
import { createSession } from '../../../src/domain/session';
import type { SessionController } from '../../../src/features/session/session-controller';

function controllerFake(clear: () => Promise<void>): SessionController {
  const snapshot: SanitizedRecordingSession = redactSession(
    createSession('tab-1', 'https://app.test', 1_000),
    DEFAULT_REDACTION_CONFIG,
  );
  return {
    async start() {},
    async stop() {},
    clear,
    async setRetention() {},
    async accept() {},
    acceptInteraction() {},
    warn() {},
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
  };
}

function Exploding(): never {
  throw new Error('render failure with Bearer render-secret');
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
});

describe('application error boundary', () => {
  it('renders children while the workspace is healthy', () => {
    render(
      <AppErrorBoundary controller={controllerFake(async () => {})}>
        <p>Healthy workspace</p>
      </AppErrorBoundary>,
    );

    expect(screen.getByText('Healthy workspace')).toBeVisible();
  });

  it('replaces a failed workspace with recovery actions and no raw error text', () => {
    render(
      <AppErrorBoundary controller={controllerFake(async () => {})}>
        <Exploding />
      </AppErrorBoundary>,
    );

    expect(screen.getByText('Workspace could not render')).toBeVisible();
    expect(document.body.textContent).not.toContain('render-secret');
  });

  it('clears evidence from the recovery workspace and announces the outcome', async () => {
    const user = userEvent.setup();
    const clear = vi.fn(async () => undefined);
    render(
      <AppErrorBoundary controller={controllerFake(clear)}>
        <Exploding />
      </AppErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: 'Clear evidence' }));
    await user.click(screen.getByRole('button', { name: 'Clear evidence now' }));

    expect(clear).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Evidence cleared.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps evidence when the clear dialog is dismissed', async () => {
    const user = userEvent.setup();
    const clear = vi.fn(async () => undefined);
    render(
      <AppErrorBoundary controller={controllerFake(clear)}>
        <Exploding />
      </AppErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: 'Clear evidence' }));
    await user.click(screen.getByRole('button', { name: 'Keep evidence' }));

    expect(clear).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('exports sanitized evidence from the recovery workspace', async () => {
    const user = userEvent.setup();
    const exportEvidence = vi.fn(async () => undefined);
    render(
      <AppErrorBoundary
        controller={controllerFake(async () => {})}
        exportEvidence={exportEvidence}
      >
        <Exploding />
      </AppErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: 'Export evidence' }));
    await user.click(screen.getByRole('button', { name: 'Export sanitized file' }));

    expect(exportEvidence).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Sanitized evidence exported.')).toBeInTheDocument();
  });

  it('tolerates a missing export handler', async () => {
    const user = userEvent.setup();
    render(
      <AppErrorBoundary controller={controllerFake(async () => {})}>
        <Exploding />
      </AppErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: 'Export evidence' }));
    await user.click(screen.getByRole('button', { name: 'Cancel export' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('recovery dialog dismissal', () => {
  it('closes the clear dialog with Escape without clearing evidence', async () => {
    const user = userEvent.setup();
    const clear = vi.fn(async () => undefined);
    render(
      <AppErrorBoundary controller={controllerFake(clear)}>
        <Exploding />
      </AppErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: 'Clear evidence' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(clear).not.toHaveBeenCalled();
  });

  it('closes the export dialog with Escape and runs the default export', async () => {
    const user = userEvent.setup();
    render(
      <AppErrorBoundary controller={controllerFake(async () => {})}>
        <Exploding />
      </AppErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: 'Export evidence' }));
    await user.click(screen.getByRole('button', { name: 'Export sanitized file' }));
    expect(await screen.findByText('Sanitized evidence exported.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Export evidence' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('recovery failure reporting', () => {
  it('reports a failed clear instead of leaving the dialog silent', async () => {
    const user = userEvent.setup();
    const clear = vi.fn(() => Promise.reject(new Error('storage locked')));
    render(
      <AppErrorBoundary controller={controllerFake(clear)}>
        <Exploding />
      </AppErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: 'Clear evidence' }));
    await user.click(screen.getByRole('button', { name: 'Clear evidence now' }));

    expect(
      await screen.findByText(/Clear failed\. Close DevTools/u),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('dialog', { name: 'Clear captured evidence' }),
    ).toBeVisible();
  });

  it('reports a failed export and clears it when the dialog is abandoned', async () => {
    const user = userEvent.setup();
    render(
      <AppErrorBoundary
        controller={controllerFake(async () => {})}
        exportEvidence={() => Promise.reject(new Error('download blocked'))}
      >
        <Exploding />
      </AppErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: 'Export evidence' }));
    await user.click(screen.getByRole('button', { name: 'Export sanitized file' }));
    expect(
      await screen.findByText(/Export failed\. Evidence remains sanitized/u),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel export' }));
    await user.click(screen.getByRole('button', { name: 'Export evidence' }));

    expect(document.querySelector('.dialog__error')).toBeNull();
  });

  it('announces only the failure notice, not the whole recovery screen', () => {
    render(
      <AppErrorBoundary controller={controllerFake(async () => {})}>
        <Exploding />
      </AppErrorBoundary>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Workspace could not render');
    expect(alert.querySelector('button')).toBeNull();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
