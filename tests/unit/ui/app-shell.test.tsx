// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useSyncExternalStore } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PayloadraApp } from '../../../src/app/app';
import { AppErrorBoundary } from '../../../src/app/error-boundary';
import { RESTRICTED_PAGE_ORIGIN } from '../../../src/domain/inspected-page';
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

  it('keeps async start and stop in the same focused control with honest busy state', async () => {
    const user = userEvent.setup();
    const controller = controllerFake();
    let finishStart: () => void = () => undefined;
    let finishStop: () => void = () => undefined;
    controller.start = () =>
      new Promise<void>((resolve) => {
        finishStart = resolve;
      });
    controller.stop = () =>
      new Promise<void>((resolve) => {
        finishStop = resolve;
      });
    render(<PayloadraApp controller={controller} />);

    const start = screen.getByRole('button', { name: 'Start recording' });
    await user.click(start);
    expect(start).toBeDisabled();
    expect(start).toHaveFocus();

    act(() => {
      controller.replace({ ...controller.getSnapshot(), phase: 'recording' });
      finishStart();
    });
    const stop = await screen.findByRole('button', { name: 'Stop recording' });
    await waitFor(() => expect(stop).toBeEnabled());
    expect(stop).toHaveFocus();

    await user.click(stop);
    expect(stop).toBeDisabled();
    act(() => {
      controller.replace({ ...controller.getSnapshot(), phase: 'stopped' });
      finishStop();
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Start recording' })).toBeEnabled(),
    );
    expect(screen.getByRole('button', { name: 'Start recording' })).toHaveFocus();
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
        origin: RESTRICTED_PAGE_ORIGIN,
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
    expect(Number(railSeparator?.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(
      200,
    );

    await user.click(railSeparator!);
    await user.keyboard('{ArrowRight}{End}');
    expect(railSeparator).toHaveAttribute('aria-valuenow', '360');

    fireEvent.pointerDown(railSeparator!, { clientX: 360 });
    fireEvent.pointerMove(window, { clientX: 10 });
    fireEvent.pointerUp(window);
    expect(railSeparator).toHaveAttribute('aria-valuenow', '200');
  });

  it('keeps all three regions inside exactly 1100 px after combined resizes', async () => {
    setViewport(1_100);
    const user = userEvent.setup();
    const { container } = render(<PayloadraApp controller={controllerFake()} />);
    const workspace = container.querySelector<HTMLElement>('.workspace--wide');
    const [railSeparator, ledgerSeparator] = screen.getAllByRole('separator');
    const usedWidth = () =>
      Number.parseFloat(workspace?.style.getPropertyValue('--rail-width') ?? '0') +
      Number.parseFloat(workspace?.style.getPropertyValue('--list-width') ?? '0') +
      Number.parseFloat(workspace?.style.getPropertyValue('--detail-min') ?? '0') +
      14;

    expect(workspace).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Session workspace' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Request ledger' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Request detail' })).toBeVisible();
    expect(usedWidth()).toBeLessThanOrEqual(1_100);

    await user.click(railSeparator!);
    await user.keyboard('{End}');
    await user.click(ledgerSeparator!);
    await user.keyboard('{End}');
    expect(usedWidth()).toBeLessThanOrEqual(1_100);

    await user.click(railSeparator!);
    await user.keyboard('{Home}');
    await user.click(ledgerSeparator!);
    await user.keyboard('{End}');
    expect(usedWidth()).toBeLessThanOrEqual(1_100);
  });

  it('treats the medium session rail as a dismissible focus-contained drawer', async () => {
    setViewport(900);
    const user = userEvent.setup();
    const { container } = render(<PayloadraApp controller={controllerFake()} />);
    const opener = screen.getByRole('button', { name: 'Open session rail' });

    await user.click(opener);
    const drawer = screen.getByRole('dialog', { name: 'Session filters' });
    const close = within(drawer).getByRole('button', { name: 'Close session rail' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(drawer).toContainElement(document.activeElement as HTMLElement | null);
    await user.keyboard('{Escape}');
    expect(drawer).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    await user.click(opener);
    const backdrop = container.querySelector<HTMLElement>('.rail-drawer-backdrop');
    fireEvent.mouseDown(backdrop!);
    expect(screen.queryByRole('dialog', { name: 'Session filters' })).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('intersects real quick filters, reports no matches, resets, and preserves filter state', async () => {
    setViewport(1_440);
    const user = userEvent.setup();
    const records = [
      sanitizedRequestWith({
        id: 'cached-failure-slow',
        url: 'https://checkout.example/api/cached-failure',
        responseStatus: 503,
        durationMs: 1_500,
        fromCache: true,
        classification: { kind: 'api', confidence: 'confirmed', evidence: [] },
      }),
      sanitizedRequestWith({
        id: 'network-failure-fast',
        url: 'https://checkout.example/api/network-failure',
        responseStatus: 500,
        durationMs: 40,
        fromCache: false,
        classification: { kind: 'api', confidence: 'confirmed', evidence: [] },
      }),
      sanitizedRequestWith({
        id: 'cached-success-slow',
        url: 'https://checkout.example/api/cached-success',
        responseStatus: 200,
        durationMs: 1_600,
        fromCache: true,
        classification: { kind: 'api', confidence: 'confirmed', evidence: [] },
      }),
      sanitizedRequestWith({
        id: 'document',
        url: 'https://checkout.example/account',
        responseStatus: 200,
        classification: {
          kind: 'document',
          confidence: 'confirmed',
          evidence: [],
        },
      }),
    ];
    render(
      <PayloadraApp controller={controllerFake(sessionWith('recording', records))} />,
    );

    const failures = screen.getByRole('button', { name: 'Failures' });
    const slow = screen.getByRole('button', { name: 'Slow calls' });
    const cache = screen.getByRole('button', { name: 'Cache hits' });
    await user.click(failures);
    await user.click(slow);
    await user.click(cache);

    expect(failures).toHaveAttribute('aria-pressed', 'true');
    expect(slow).toHaveAttribute('aria-pressed', 'true');
    expect(cache).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('row', { name: /cached-failure/i })).toBeVisible();

    await user.type(
      screen.getByRole('searchbox', { name: 'Search requests' }),
      'not-present',
    );
    expect(screen.getByText(/no requests match these filters/i)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(screen.getByRole('searchbox', { name: 'Search requests' })).toHaveValue('');
    expect(screen.getAllByRole('row')).toHaveLength(5);

    await user.click(failures);
    act(() => setViewport(900));
    await user.click(screen.getByRole('button', { name: 'Open session rail' }));
    expect(screen.getByRole('button', { name: 'Failures' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('routes an API-only empty result with raw evidence to No matches', async () => {
    setViewport(1_440);
    const user = userEvent.setup();
    const documentRequest = sanitizedRequestWith({
      id: 'document-only',
      url: 'https://checkout.example/account',
      classification: {
        kind: 'document',
        confidence: 'confirmed',
        evidence: [],
      },
    });
    render(
      <PayloadraApp
        controller={controllerFake(sessionWith('recording', [documentRequest]))}
      />,
    );

    expect(screen.getByText(/no requests match these filters/i)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(screen.getByRole('row', { name: /account/i })).toBeVisible();
  });

  it('keeps captured evidence visible under a persistent capture-failure alert', () => {
    const request = sanitizedRequestWith({
      id: 'surviving-evidence',
      url: 'https://checkout.example/api/surviving-evidence',
      classification: { kind: 'api', confidence: 'confirmed', evidence: [] },
    });
    const session = {
      ...sessionWith('stopped', [request]),
      warnings: [
        {
          code: 'capture-failed' as const,
          message: 'Capture lifecycle failed with raw detail.',
        },
      ],
    };
    render(<PayloadraApp controller={controllerFake(session)} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      /capture stopped unexpectedly.*start recording again/i,
    );
    expect(screen.getByRole('row', { name: /surviving-evidence/i })).toBeVisible();
    expect(screen.queryByText(/raw detail/i)).not.toBeInTheDocument();
  });

  it('uses a restrained factual handoff for selected sanitized evidence', async () => {
    setViewport(1_440);
    const user = userEvent.setup();
    const request = sanitizedRequestWith({
      id: 'handoff',
      method: 'POST',
      url: 'https://checkout.example/api/orders',
      responseStatus: 202,
      durationMs: 84,
      classification: { kind: 'api', confidence: 'confirmed', evidence: [] },
    });
    const { container } = render(
      <PayloadraApp controller={controllerFake(sessionWith('recording', [request]))} />,
    );

    await user.click(screen.getByRole('row', { name: /orders/i }));
    const detail = screen.getByRole('region', { name: 'Request detail' });
    expect(detail).toHaveTextContent('/api/orders');
    expect(detail).toHaveTextContent('POST');
    expect(detail).toHaveTextContent('202');
    expect(detail).toHaveTextContent('84 ms');
    expect(detail).toHaveTextContent(/sanitized request.*ready/i);
    expect(within(detail).queryByText('Explain')).toBeNull();
    expect(within(detail).queryByText('Inspect')).toBeNull();
    expect(container.querySelector('.detail-skeleton')).toBeNull();
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
