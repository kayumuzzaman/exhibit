// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useSyncExternalStore } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PayloadraApp } from '../../../src/app/app';
import { AppErrorBoundary } from '../../../src/app/error-boundary';
import type { RecordingPhase } from '../../../src/domain/model';
import { DEFAULT_REDACTION_CONFIG, redactSession } from '../../../src/domain/redaction';
import { createSession } from '../../../src/domain/session';
import type {
  SanitizedCapturedRequest,
  SanitizedRecordingSession,
} from '../../../src/domain/sanitized';
import type { SessionController } from '../../../src/features/session/session-controller';
import { sanitizedRequestWith } from '../../helpers/request-factory';

function sessionWith(
  phase: RecordingPhase = 'stopped',
  requests: readonly SanitizedCapturedRequest[] = [],
): SanitizedRecordingSession {
  return redactSession(
    {
      ...createSession('tab-9', 'https://checkout.example', 1_000),
      phase,
      requests,
      requestBytes: requests.map(() => 32),
    },
    DEFAULT_REDACTION_CONFIG,
  );
}

function controllerFake(initial = sessionWith()): SessionController & {
  replace(next: SanitizedRecordingSession): void;
} {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const replace = (next: SanitizedRecordingSession) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return {
    async start() {
      replace({ ...snapshot, phase: 'recording' });
    },
    async stop() {
      replace({ ...snapshot, phase: 'stopped' });
    },
    async clear() {
      replace({ ...snapshot, phase: 'stopped', requests: [] });
    },
    async setRetention() {},
    async accept() {},
    warn() {},
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    replace,
  };
}

function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

describe('PayloadraApp', () => {
  it('supports the complete keyboard recording path from the stable control', async () => {
    const user = userEvent.setup();
    const controller = controllerFake();
    const { container } = render(<PayloadraApp controller={controller} />);
    const start = screen.getByRole('button', { name: 'Start recording' });
    const slot = start.parentElement;

    await user.tab();
    await user.keyboard('{Enter}');

    const stop = screen.getByRole('button', { name: 'Stop recording' });
    expect(stop).toHaveFocus();
    expect(stop.parentElement).toBe(slot);
    expect(screen.getByRole('status')).toHaveTextContent('Recording');
    expect(container.querySelector('[data-recording="true"]')).toBeInTheDocument();
  });

  it('renders a semantic, responsive forensic workspace without serious axe findings', async () => {
    setViewport(1_440);
    const controller = controllerFake(
      sessionWith('recording', [
        sanitizedRequestWith({
          id: 'orders',
          url: 'https://checkout.example/api/orders',
          classification: {
            kind: 'api',
            confidence: 'confirmed',
            evidence: ['fetch'],
          },
        }),
      ]),
    );
    const { container } = render(<PayloadraApp controller={controller} />);

    expect(screen.getByRole('banner')).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Session workspace' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Request ledger' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Request detail' })).toBeVisible();
    expect(screen.getAllByRole('separator')).toHaveLength(2);

    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(
      results.violations.filter(
        ({ impact }) => impact === 'serious' || impact === 'critical',
      ),
    ).toEqual([]);

    act(() => setViewport(900));
    expect(screen.getByRole('button', { name: 'Open session rail' })).toBeVisible();
    expect(
      screen.queryByRole('navigation', { name: 'Session workspace' }),
    ).not.toBeInTheDocument();

    act(() => setViewport(390));
    expect(screen.getByRole('region', { name: 'Request ledger' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Method' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Route' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    expect(
      screen.queryByRole('columnheader', { name: 'Evidence' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Captured requests' })).toHaveClass(
      'request-table--phone',
    );
    const phoneRow = screen.getByRole('row', { name: /orders/i });
    expect(within(phoneRow).getByText('GET')).toBeVisible();
    expect(within(phoneRow).getByText('/api/orders')).toBeVisible();
    expect(
      screen.queryByRole('region', { name: 'Request detail' }),
    ).not.toBeInTheDocument();
  });

  it('preserves request selection and search when the viewport changes', async () => {
    setViewport(1_440);
    const user = userEvent.setup();
    const records = [
      sanitizedRequestWith({
        id: 'orders',
        url: 'https://checkout.example/api/orders',
        classification: { kind: 'api', confidence: 'confirmed', evidence: [] },
      }),
      sanitizedRequestWith({
        id: 'profile',
        url: 'https://checkout.example/api/profile',
        classification: { kind: 'api', confidence: 'confirmed', evidence: [] },
      }),
    ];
    const { container } = render(
      <PayloadraApp controller={controllerFake(sessionWith('recording', records))} />,
    );

    await user.type(
      screen.getByRole('searchbox', { name: 'Search requests' }),
      'profile',
    );
    await user.click(screen.getByRole('row', { name: /profile/i }));
    const initialScroller =
      container.querySelector<HTMLElement>('.request-table-wrap')!;
    initialScroller.scrollTop = 64;
    fireEvent.scroll(initialScroller);
    expect(screen.getByRole('region', { name: 'Request detail' })).toHaveTextContent(
      '/api/profile',
    );

    act(() => setViewport(900));
    expect(container.querySelector<HTMLElement>('.request-table-wrap')?.scrollTop).toBe(
      64,
    );
    act(() => setViewport(390));
    expect(screen.getByRole('region', { name: 'Request detail' })).toHaveTextContent(
      '/api/profile',
    );
    await user.click(screen.getByRole('button', { name: 'Back to requests' }));
    expect(screen.getByRole('searchbox', { name: 'Search requests' })).toHaveValue(
      'profile',
    );
  });

  it.each([
    ['not recording', sessionWith('stopped'), /start recording to collect/i],
    ['recording empty', sessionWith('recording'), /waiting for browser-visible api/i],
    [
      'restricted page',
      {
        ...sessionWith('stopped'),
        origin: 'chrome://settings',
        warnings: [
          {
            code: 'capture-failed' as const,
            message: 'Capture lifecycle failed.',
          },
        ],
      },
      /chrome pages cannot be inspected/i,
    ],
    [
      'network-only',
      {
        ...sessionWith('recording'),
        warnings: [
          {
            code: 'interaction-start-failed' as const,
            message: 'Interaction capture was unavailable; network capture continued.',
          },
        ],
      },
      /network requests are still recording/i,
    ],
    [
      'capture failure',
      {
        ...sessionWith('stopped'),
        warnings: [
          {
            code: 'capture-failed' as const,
            message: 'Capture lifecycle failed.',
          },
        ],
      },
      /capture stopped unexpectedly/i,
    ],
  ])('gives actionable copy for %s', (_name, session, copy) => {
    render(<PayloadraApp controller={controllerFake(session)} />);
    expect(screen.getByText(copy)).toBeVisible();
  });

  it('marks eviction and reduced-motion state without color-only meaning', () => {
    const originalMatchMedia = window.matchMedia;
    const matchMedia = vi.fn(
      (query: string) =>
        ({
          matches: query === '(prefers-reduced-motion: reduce)',
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: matchMedia,
    });
    const session = { ...sessionWith('recording'), evictedCount: 3 };
    const { container } = render(<PayloadraApp controller={controllerFake(session)} />);

    expect(container.firstElementChild).toHaveAttribute('data-reduced-motion', 'true');
    expect(screen.getByText(/3 oldest requests were removed/i)).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Recording');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it('supports bounded pointer and keyboard resizing with separator values', async () => {
    setViewport(1_440);
    const user = userEvent.setup();
    render(<PayloadraApp controller={controllerFake()} />);
    const [railSeparator] = screen.getAllByRole('separator');
    expect(railSeparator).toHaveAttribute('aria-valuenow', '240');

    await user.click(railSeparator!);
    await user.keyboard('{ArrowRight}{End}');
    expect(railSeparator).toHaveAttribute('aria-valuenow', '360');

    fireEvent.pointerDown(railSeparator!, { clientX: 360 });
    fireEvent.pointerMove(window, { clientX: 10 });
    fireEvent.pointerUp(window);
    expect(railSeparator).toHaveAttribute('aria-valuenow', '200');
  });

  it('keeps safe recovery controls when rendering fails and hides exception text', async () => {
    const user = userEvent.setup();
    const controller = controllerFake();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Throw = () => {
      useSyncExternalStore(controller.subscribe, () => {
        throw new Error('secret raw stack');
      });
      return null;
    };
    render(
      <AppErrorBoundary controller={controller}>
        <Throw />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/workspace could not render/i);
    expect(screen.queryByText(/secret raw stack/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear evidence' }));
    expect(
      screen.getByRole('dialog', { name: 'Clear captured evidence' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export evidence' })).toBeEnabled();
    consoleError.mockRestore();
  });
});
