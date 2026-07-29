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

import { ExhibitApp } from '../../../src/app/app';
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
import type { ExhibitSettingsService } from '../../../src/features/settings/exhibit-settings';
import { requestWith, sanitizedRequestWith } from '../../helpers/request-factory';

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
    acceptInteraction() {},
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

describe('ExhibitApp', () => {
  it('supports the complete keyboard recording path from the stable control', async () => {
    const user = userEvent.setup();
    const controller = controllerFake();
    const { container } = render(<ExhibitApp controller={controller} />);
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
    render(<ExhibitApp controller={controller} />);

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

  it('changes evidence retention through the user-facing session control', async () => {
    setViewport(1_024);
    const user = userEvent.setup();
    const controller = controllerFake();
    controller.setRetention = vi.fn(async (retention) => {
      controller.replace({ ...controller.getSnapshot(), retention });
    });
    render(<ExhibitApp controller={controller} />);
    await user.click(screen.getByRole('button', { name: 'Open session rail' }));

    const retention = screen.getByRole('combobox', {
      name: 'Evidence retention',
    });
    expect(retention).toHaveValue('ephemeral');

    await user.selectOptions(retention, 'persistent');

    expect(controller.setRetention).toHaveBeenCalledWith('persistent');
    expect(retention).toHaveValue('persistent');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Evidence retention changed to Local until Clear.',
    );
  });

  it('keeps the previous retention and explains a failed migration', async () => {
    setViewport(1_024);
    const user = userEvent.setup();
    const controller = controllerFake();
    controller.setRetention = vi.fn(async () => undefined);
    render(<ExhibitApp controller={controller} />);
    await user.click(screen.getByRole('button', { name: 'Open session rail' }));

    const retention = screen.getByRole('combobox', {
      name: 'Evidence retention',
    });
    await user.selectOptions(retention, 'persistent');

    expect(retention).toHaveValue('ephemeral');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Storage mode could not be changed. Existing evidence remains in Memory.',
    );
  });

  it('edits and persists custom privacy fields from the command-bar settings', async () => {
    const user = userEvent.setup();
    const settings: ExhibitSettingsService = {
      initial: { customFieldNames: ['Existing Field'], theme: 'dark' },
      saveCustomFieldNames: vi.fn(async (customFieldNames) => ({
        customFieldNames,
        theme: 'dark' as const,
      })),
      saveTheme: vi.fn(async (theme) => ({
        customFieldNames: ['Existing Field'],
        theme,
      })),
    };
    const { container } = render(
      <ExhibitApp controller={controllerFake()} settings={settings} />,
    );

    expect(container.querySelector('.app-shell')).toHaveAttribute('data-theme', 'dark');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), 'light');
    expect(settings.saveTheme).toHaveBeenCalledWith('light');

    await user.click(screen.getByRole('button', { name: 'Privacy settings' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Privacy and redaction settings',
    });
    const fieldNames = within(dialog).getByRole('textbox', {
      name: 'Additional sensitive field names',
    });
    expect(fieldNames).toHaveValue('Existing Field');
    await user.clear(fieldNames);
    await user.type(fieldNames, 'Private Note,\nX-Customer-Key');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save privacy settings' }),
    );

    expect(settings.saveCustomFieldNames).toHaveBeenCalledWith([
      'Private Note',
      'X-Customer-Key',
    ]);
    expect(
      screen.queryByRole('dialog', { name: 'Privacy and redaction settings' }),
    ).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Privacy settings saved.');
  });

  it('requires stopped, cleared evidence before changing redaction fields', async () => {
    const user = userEvent.setup();
    render(
      <ExhibitApp
        controller={controllerFake(
          sessionWith('recording', [sanitizedRequestWith({ id: 'retained' })]),
        )}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Privacy settings' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Privacy and redaction settings',
    });

    expect(
      within(dialog).getByText(/stop recording and clear the current evidence/i),
    ).toBeVisible();
    expect(
      within(dialog).getByRole('button', { name: 'Save privacy settings' }),
    ).toBeDisabled();
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
    const { container } = render(<ExhibitApp controller={controller} />);

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
    expect(screen.getByRole('grid', { name: 'Captured requests' })).toHaveClass(
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
      <ExhibitApp controller={controllerFake(sessionWith('recording', records))} />,
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

  it('integrates correlated Explain and lazy Inspect workspaces for the selected request', async () => {
    setViewport(1_440);
    const user = userEvent.setup();
    const request = sanitizedRequestWith({
      id: 'save',
      method: 'POST',
      startedAt: 2_000,
      url: 'https://checkout.example/api/profile',
      responseText: '{"saved":true}',
      classification: {
        kind: 'next-server-action',
        confidence: 'confirmed',
        actionId: '40f3a8b1',
        evidence: ['Next-Action header'],
      },
    });
    const session = redactSession(
      {
        ...createSession('tab-9', 'https://checkout.example', 1_000),
        phase: 'recording',
        requests: [request],
        requestBytes: [32],
        interactions: [
          {
            id: 'click-save',
            tabId: 'tab-9',
            kind: 'click' as const,
            occurredAt: 1_990,
            trust: 'trusted' as const,
            target: { tag: 'button', text: 'Save profile' },
          },
        ],
      },
      DEFAULT_REDACTION_CONFIG,
    );
    render(<ExhibitApp controller={controllerFake(session)} />);

    await user.click(screen.getByRole('row', { name: /profile/i }));

    expect(
      screen.getByRole('tablist', { name: 'Request detail workspace' }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', {
        name: /After Save profile, Exhibit observed a Server Action/i,
      }),
    ).toBeVisible();
    expect(screen.queryByText(/"saved"/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Inspect' }));
    expect(screen.getByRole('tab', { name: 'Response' })).toBeVisible();
    expect(screen.queryByText(/"saved"/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Response' }));
    expect(screen.getByText(/"saved": true/)).toBeVisible();
  });

  it('threads only the selected interaction calls into Explain and redirect evidence', async () => {
    setViewport(1_440);
    const user = userEvent.setup();
    const requests = [
      requestWith({
        id: 'action',
        method: 'POST',
        startedAt: 2_000,
        url: 'https://checkout.example/account',
        classification: {
          kind: 'next-server-action',
          confidence: 'confirmed',
          actionId: 'action-safe',
          evidence: ['Next-Action header'],
        },
      }),
      requestWith({
        id: 'audit',
        method: 'POST',
        startedAt: 2_010,
        url: 'https://checkout.example/api/audit',
        responseStatus: 204,
        classification: {
          kind: 'api',
          confidence: 'confirmed',
          evidence: ['Fetch request'],
        },
      }),
      requestWith({
        id: 'redirect-start',
        startedAt: 2_020,
        url: 'https://checkout.example/start',
        responseStatus: 302,
        redirectUrl: 'https://checkout.example/middle',
        classification: {
          kind: 'api',
          confidence: 'confirmed',
          evidence: ['Fetch request'],
        },
      }),
      requestWith({
        id: 'redirect-middle',
        startedAt: 2_030,
        url: 'https://checkout.example/middle',
        responseStatus: 307,
        redirectParentId: 'redirect-start',
        redirectUrl: 'https://checkout.example/final',
        classification: {
          kind: 'api',
          confidence: 'confirmed',
          evidence: ['Fetch request'],
        },
      }),
      requestWith({
        id: 'redirect-final',
        startedAt: 2_040,
        url: 'https://checkout.example/final',
        redirectParentId: 'redirect-middle',
        classification: {
          kind: 'api',
          confidence: 'confirmed',
          evidence: ['Fetch request'],
        },
      }),
      requestWith({
        id: 'unrelated',
        startedAt: 10_000,
        url: 'https://checkout.example/api/unrelated',
        classification: {
          kind: 'api',
          confidence: 'confirmed',
          evidence: ['Fetch request'],
        },
      }),
    ];
    const session = redactSession(
      {
        ...createSession('tab-9', 'https://checkout.example', 1_000),
        phase: 'recording',
        requests,
        requestBytes: requests.map(() => 32),
        interactions: [
          {
            id: 'click-save',
            tabId: 'tab-9',
            kind: 'click' as const,
            occurredAt: 1_990,
            trust: 'trusted' as const,
            target: { tag: 'button', text: 'Save profile' },
          },
          {
            id: 'click-other',
            tabId: 'tab-9',
            kind: 'click' as const,
            occurredAt: 9_990,
            trust: 'trusted' as const,
            target: { tag: 'button', text: 'Other action' },
          },
        ],
      },
      DEFAULT_REDACTION_CONFIG,
    );
    render(<ExhibitApp controller={controllerFake(session)} />);

    await user.click(screen.getByRole('row', { name: /\/account/i }));
    const detail = screen.getByRole('region', { name: 'Request detail' });
    expect(within(detail).getByText(/POST \/api\/audit/i)).toBeVisible();
    expect(within(detail).queryByText(/\/api\/unrelated/i)).toBeNull();

    await user.click(screen.getByRole('row', { name: /\/final/i }));
    await user.click(within(detail).getByRole('tab', { name: 'Inspect' }));
    await user.click(within(detail).getByRole('tab', { name: 'Evidence' }));
    expect(
      within(detail).getByText(
        /redirect hop 1: https:\/\/checkout\.example\/start → https:\/\/checkout\.example\/middle/i,
      ),
    ).toBeVisible();
    expect(
      within(detail).getByText(
        /redirect hop 2: https:\/\/checkout\.example\/middle → https:\/\/checkout\.example\/final/i,
      ),
    ).toBeVisible();
    expect(within(detail).queryByText(/\/api\/unrelated/i)).toBeNull();
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
    render(<ExhibitApp controller={controllerFake(session)} />);
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
    const { container } = render(<ExhibitApp controller={controllerFake(session)} />);

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
    render(<ExhibitApp controller={controllerFake()} />);
    const [railSeparator] = screen.getAllByRole('separator');
    expect(Number(railSeparator?.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(
      200,
    );

    await user.click(railSeparator!);
    await user.keyboard('{ArrowRight}{End}');
    // End travels to the rail's reported maximum, which the ledger's own width
    // constrains, rather than to a fixed pixel value.
    expect(railSeparator).toHaveAttribute(
      'aria-valuenow',
      railSeparator?.getAttribute('aria-valuemax') ?? '',
    );

    fireEvent.pointerDown(railSeparator!, { clientX: 360 });
    fireEvent.pointerMove(window, { clientX: 10 });
    fireEvent.pointerUp(window);
    expect(railSeparator).toHaveAttribute('aria-valuenow', '200');
  });

  it('keeps all three regions inside exactly 1100 px after combined resizes', async () => {
    setViewport(1_100);
    const user = userEvent.setup();
    const { container } = render(<ExhibitApp controller={controllerFake()} />);
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
    const { container } = render(<ExhibitApp controller={controllerFake()} />);
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

  it('blocks medium-drawer background actions with native inert behavior', async () => {
    setViewport(900);
    const user = userEvent.setup();
    const controller = controllerFake(sessionWith('recording'));
    const stop = vi.spyOn(controller, 'stop');
    const { container } = render(
      <>
        <style>{'[inert], [inert] * { pointer-events: none; }'}</style>
        <ExhibitApp controller={controller} />
      </>,
    );
    const opener = screen.getByRole('button', { name: 'Open session rail' });
    const clear = screen.getByRole('button', { name: 'Clear evidence' });
    const exportButton = screen.getByRole('button', { name: 'Export evidence' });
    const stopButton = screen.getByRole('button', { name: 'Stop recording' });
    const theme = screen.getByRole('combobox', { name: 'Theme' });

    await user.click(opener);
    const drawer = screen.getByRole('dialog', { name: 'Session filters' });
    const background = container.querySelector<HTMLElement>('.app-background');
    expect(background).toHaveAttribute('inert');
    expect(background).not.toContainElement(drawer);
    expect(getComputedStyle(clear).pointerEvents).toBe('none');

    for (const action of [
      () => user.click(clear),
      () => user.click(exportButton),
      () => user.click(stopButton),
      () => user.click(theme),
    ]) {
      await expect(action()).rejects.toThrow(/pointer-events/i);
    }

    expect(stop).not.toHaveBeenCalled();
    expect(theme).toHaveValue('devtools');
    expect(screen.getAllByRole('dialog')).toEqual([drawer]);
    expect(drawer).toHaveAttribute('aria-modal', 'true');

    await user.keyboard('{Escape}');
    expect(background).not.toHaveAttribute('inert');
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
      <ExhibitApp controller={controllerFake(sessionWith('recording', records))} />,
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

  it('shows the whole ledger at full width and sheds secondary columns as it narrows', () => {
    const request = sanitizedRequestWith({
      id: 'orders',
      url: 'https://checkout.example/api/orders',
      classification: { kind: 'api', confidence: 'confirmed', evidence: ['fetch'] },
    });
    const headers = () =>
      screen.getAllByRole('columnheader').map((header) => header.textContent);

    setViewport(1_440);
    const { unmount } = render(
      <ExhibitApp controller={controllerFake(sessionWith('recording', [request]))} />,
    );

    // The default ledger is wider than the table minimum, so nothing clips and
    // no evidence hides behind a horizontal scrollbar.
    expect(headers()).toEqual([
      'Time',
      'Method',
      'Route',
      'Kind',
      'Status',
      'Duration',
      'Source',
      'Evidence',
    ]);
    unmount();

    setViewport(1_024);
    const { unmount: unmountMedium } = render(
      <ExhibitApp controller={controllerFake(sessionWith('recording', [request]))} />,
    );

    expect(headers()).toEqual(['Time', 'Method', 'Route', 'Status', 'Duration']);
    unmountMedium();

    setViewport(390);
    render(
      <ExhibitApp controller={controllerFake(sessionWith('recording', [request]))} />,
    );

    expect(headers()).toEqual(['Method', 'Route', 'Status']);
  });

  it('starts recording from the empty ledger instead of only naming the control', async () => {
    setViewport(1_440);
    const user = userEvent.setup();
    const controller = controllerFake();
    render(<ExhibitApp controller={controller} />);

    await user.click(screen.getByRole('button', { name: 'Record this page' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Stop recording' })).toBeVisible(),
    );
  });

  it('exposes method, domain, protocol, outcome, and cache facets as intersections', async () => {
    setViewport(1_440);
    const user = userEvent.setup();
    const matching = sanitizedRequestWith({
      id: 'matching-graphql',
      url: 'https://api.checkout.example/graphql',
      method: 'POST',
      responseStatus: 503,
      fromCache: true,
      classification: {
        kind: 'graphql',
        confidence: 'confirmed',
        evidence: [],
      },
    });
    const records = [
      matching,
      sanitizedRequestWith({
        id: 'network-graphql',
        url: 'https://api.checkout.example/graphql/network',
        method: 'POST',
        responseStatus: 503,
        fromCache: false,
        classification: {
          kind: 'graphql',
          confidence: 'confirmed',
          evidence: [],
        },
      }),
      sanitizedRequestWith({
        id: 'other-domain',
        url: 'https://other.example/graphql',
        method: 'POST',
        responseStatus: 503,
        fromCache: true,
        classification: {
          kind: 'graphql',
          confidence: 'confirmed',
          evidence: [],
        },
      }),
      sanitizedRequestWith({
        id: 'get-graphql',
        url: 'https://api.checkout.example/graphql/get',
        method: 'GET',
        responseStatus: 503,
        fromCache: true,
        classification: {
          kind: 'graphql',
          confidence: 'confirmed',
          evidence: [],
        },
      }),
      sanitizedRequestWith({
        id: 'successful-graphql',
        url: 'https://api.checkout.example/graphql/success',
        method: 'POST',
        responseStatus: 200,
        fromCache: true,
        classification: {
          kind: 'graphql',
          confidence: 'confirmed',
          evidence: [],
        },
      }),
      sanitizedRequestWith({
        id: 'plain-api',
        url: 'https://api.checkout.example/api/failure',
        method: 'POST',
        responseStatus: 503,
        fromCache: true,
        classification: {
          kind: 'api',
          confidence: 'confirmed',
          evidence: [],
        },
      }),
    ];
    render(
      <ExhibitApp controller={controllerFake(sessionWith('recording', records))} />,
    );

    await user.click(screen.getByText('Evidence facets'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Method' }), 'POST');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Domain' }),
      'api.checkout.example',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Protocol' }),
      'graphql',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Outcome' }),
      'failure',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Cache' }), 'hit');

    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(
      screen.getByRole('row', { name: /POST \/graphql graphql 503/i }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(screen.getByRole('combobox', { name: 'Method' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Domain' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Protocol' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Outcome' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Cache' })).toHaveValue('');
    expect(screen.getAllByRole('row')).toHaveLength(records.length + 1);
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
      <ExhibitApp
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
    render(<ExhibitApp controller={controllerFake(session)} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      /capture stopped unexpectedly.*start recording again/i,
    );
    expect(screen.getByRole('row', { name: /surviving-evidence/i })).toBeVisible();
    expect(screen.queryByText(/raw detail/i)).not.toBeInTheDocument();
  });

  it('uses a restrained Explain-first workspace for selected sanitized evidence', async () => {
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
      <ExhibitApp controller={controllerFake(sessionWith('recording', [request]))} />,
    );

    await user.click(screen.getByRole('row', { name: /orders/i }));
    const detail = screen.getByRole('region', { name: 'Request detail' });
    expect(detail).toHaveTextContent('/api/orders');
    expect(detail).toHaveTextContent('POST');
    expect(detail).toHaveTextContent('202');
    expect(detail).toHaveTextContent('84 ms');
    expect(within(detail).getByRole('tab', { name: 'Explain' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(detail).getByRole('tab', { name: 'Inspect' })).toBeVisible();
    expect(detail).toHaveTextContent(/Exhibit observed an API request/i);
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

describe('ExhibitApp dialog failures', () => {
  it('shows a clear failure inside the open dialog', async () => {
    const user = userEvent.setup();
    const controller = controllerFake();
    controller.clear = () => Promise.reject(new Error('storage locked'));
    render(<ExhibitApp controller={controller} />);

    await user.click(screen.getByRole('button', { name: 'Clear evidence' }));
    await user.click(screen.getByRole('button', { name: 'Clear evidence now' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Clear captured evidence',
    });
    expect(dialog).toHaveTextContent('Clear failed.');
    expect(screen.getByRole('status')).toHaveTextContent('Clear failed.');
  });

  it('shows an export failure inside the open dialog', async () => {
    const user = userEvent.setup();
    const controller = controllerFake();
    render(
      <ExhibitApp
        controller={controller}
        exportEvidence={() => Promise.reject(new Error('download blocked'))}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Export evidence' }));
    await user.click(screen.getByRole('button', { name: 'Export sanitized HAR' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Export sanitized evidence',
    });
    expect(dialog).toHaveTextContent('Export failed.');
  });

  it('reports a recording failure outside any dialog', async () => {
    const user = userEvent.setup();
    const controller = controllerFake();
    controller.start = () => Promise.reject(new Error('capture unavailable'));
    render(<ExhibitApp controller={controller} />);

    await user.click(screen.getByRole('button', { name: 'Start recording' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Capture stopped unexpectedly.',
    );
  });
});

describe('ExhibitApp presentation boundaries', () => {
  it('announces the transitional recording phases', () => {
    const { unmount } = render(
      <ExhibitApp controller={controllerFake(sessionWith('starting'))} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Starting recording');
    unmount();

    render(<ExhibitApp controller={controllerFake(sessionWith('stopping'))} />);
    expect(screen.getByRole('status')).toHaveTextContent('Stopping recording');
  });

  it('renders an opaque request URL verbatim and still offers comparison', async () => {
    setViewport(1_440);
    const user = userEvent.setup();
    const opaque = [
      sanitizedRequestWith({
        id: 'first',
        classification: { kind: 'api', confidence: 'confirmed', evidence: [] },
      }),
      sanitizedRequestWith({
        id: 'second',
        classification: { kind: 'api', confidence: 'confirmed', evidence: [] },
      }),
    ].map((request) => ({ ...request, url: 'exhibit-opaque-route' }));

    render(
      <ExhibitApp controller={controllerFake(sessionWith('recording', opaque))} />,
    );

    const rows = screen.getAllByRole('row').slice(1);
    await user.click(rows[1]!);

    const detail = screen.getByRole('region', { name: 'Request detail' });
    expect(detail).toHaveTextContent('exhibit-opaque-route');

    await user.click(within(detail).getByRole('tab', { name: 'Inspect' }));
    expect(
      within(detail).getByRole('button', { name: 'Show request comparison' }),
    ).toBeVisible();
  });

  it('treats a browser without matchMedia as motion-allowed', () => {
    const original = window.matchMedia;
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'matchMedia');

    const { container } = render(<ExhibitApp controller={controllerFake()} />);

    expect(
      container.querySelector('[data-reduced-motion="false"]'),
    ).toBeInTheDocument();

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: original,
    });
  });
});

describe('ExhibitApp shell layout contract', () => {
  it('groups the status region and notices into one shell row', () => {
    const session = sessionWith('recording', [sanitizedRequestWith({ id: 'orders' })]);
    const { container } = render(
      <ExhibitApp controller={controllerFake({ ...session, evictedCount: 3 })} />,
    );

    const notices = container.querySelector('.app-notices');
    expect(notices).toBeInTheDocument();
    expect(notices?.querySelector('[role="status"]')).toBeInTheDocument();
    expect(notices?.querySelector('.session-notice')).toBeInTheDocument();
    expect(container.querySelectorAll('.app-background > *')).toHaveLength(3);
  });
});

describe('ExhibitApp failure reporting', () => {
  it.each([
    [
      'corrupt-session' as const,
      'Stored evidence could not be read. Original local data is retained. Clear evidence to remove it.',
    ],
    [
      'persistence-disabled' as const,
      'Local recovery is unavailable after a storage failure. New evidence remains in this open panel.',
    ],
    [
      'migration-cleanup-failed' as const,
      'Storage mode cleanup failed. Clear evidence to remove residual local data.',
    ],
  ])('surfaces the %s storage warning with recovery guidance', (code, message) => {
    const degraded = {
      ...sessionWith(),
      warnings: [{ code, message: 'Untrusted storage detail must not render.' }],
    };

    render(<ExhibitApp controller={controllerFake(degraded)} />);

    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(document.body.textContent).not.toContain('Untrusted storage detail');
  });

  it('reports a stopped capture rather than claiming recording continues', () => {
    const degraded = redactSession(
      {
        ...createSession('tab-9', 'https://checkout.example', 1_000),
        phase: 'stopped',
        warnings: [
          {
            code: 'interaction-start-failed',
            message: 'Interaction capture was unavailable; network capture continued.',
          },
          { code: 'capture-failed', message: 'Capture lifecycle failed.' },
        ],
      },
      DEFAULT_REDACTION_CONFIG,
    );

    render(<ExhibitApp controller={controllerFake(degraded)} />);

    expect(
      screen.getByText('Capture stopped unexpectedly', { selector: 'h2' }),
    ).toBeVisible();
    expect(screen.queryByText('Network-only recording')).not.toBeInTheDocument();
  });

  it('drops an action failure when its dialog is abandoned', async () => {
    const user = userEvent.setup();
    const controller = controllerFake();
    controller.clear = () => Promise.reject(new Error('storage locked'));
    render(<ExhibitApp controller={controller} />);

    await user.click(screen.getByRole('button', { name: 'Clear evidence' }));
    await user.click(screen.getByRole('button', { name: 'Clear evidence now' }));
    expect(await screen.findByText('Clear failed.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep evidence' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('.session-notice--failure')).toBeNull();
  });

  it('recomputes wide column widths when the viewport changes inside the wide band', () => {
    setViewport(1_600);
    const { container } = render(<ExhibitApp controller={controllerFake()} />);
    const workspace = container.querySelector<HTMLElement>('.workspace--wide');
    const used = () =>
      Number.parseFloat(workspace?.style.getPropertyValue('--rail-width') ?? '0') +
      Number.parseFloat(workspace?.style.getPropertyValue('--list-width') ?? '0');

    const wide = used();
    act(() => setViewport(1_150));

    expect(used()).toBeLessThan(wide);
    expect(used()).toBeLessThanOrEqual(1_150 - 300 - 14);
  });
});

describe('ExhibitApp drawer lifecycle', () => {
  it('closes the filters drawer when the layout becomes wide', async () => {
    setViewport(900);
    const user = userEvent.setup();
    render(<ExhibitApp controller={controllerFake()} />);

    await user.click(screen.getByRole('button', { name: 'Open session rail' }));
    expect(
      await screen.findByRole('dialog', { name: 'Session filters' }),
    ).toBeVisible();

    act(() => setViewport(1_440));

    expect(screen.queryByRole('dialog', { name: 'Session filters' })).toBeNull();
    expect(
      screen.getAllByRole('navigation', { name: 'Session workspace' }),
    ).toHaveLength(1);
  });
});

describe('ExhibitApp approved v0.1 surfaces', () => {
  it('shows interaction groups and filters the ledger by the selected group', async () => {
    setViewport(1_440);
    const user = userEvent.setup();
    const attributed = requestWith({
      id: 'save-request',
      startedAt: 2_000,
      url: 'https://checkout.example/api/save',
      classification: { kind: 'api', confidence: 'confirmed', evidence: [] },
    });
    const unattributed = requestWith({
      id: 'background-request',
      startedAt: 9_000,
      url: 'https://checkout.example/api/background',
      classification: { kind: 'api', confidence: 'confirmed', evidence: [] },
    });
    const session = redactSession(
      {
        ...createSession('tab-9', 'https://checkout.example', 1_000),
        phase: 'recording',
        requests: [attributed, unattributed],
        requestBytes: [32, 32],
        interactions: [
          {
            id: 'save-click',
            tabId: 'tab-9',
            kind: 'click',
            occurredAt: 1_990,
            trust: 'trusted',
            target: { tag: 'button', text: 'Save profile' },
          },
        ],
      },
      DEFAULT_REDACTION_CONFIG,
    );
    render(<ExhibitApp controller={controllerFake(session)} />);

    await user.type(
      screen.getByRole('searchbox', { name: 'Search requests' }),
      'Save profile',
    );
    expect(screen.getByRole('row', { name: /api\/save/i })).toBeVisible();
    expect(screen.queryByRole('row', { name: /api\/background/i })).toBeNull();
    await user.clear(screen.getByRole('searchbox', { name: 'Search requests' }));

    const saveGroup = screen.getByRole('button', {
      name: 'Save profile · Click · Trusted · 1 request',
    });
    const unattributedGroup = screen.getByRole('button', {
      name: 'Unattributed · No trusted interaction · 1 request',
    });
    expect(saveGroup).toHaveAttribute('aria-pressed', 'false');

    await user.click(saveGroup);
    expect(saveGroup).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('row', { name: /api\/save/i })).toBeVisible();
    expect(screen.queryByRole('row', { name: /api\/background/i })).toBeNull();

    await user.click(unattributedGroup);
    expect(screen.getByRole('row', { name: /api\/background/i })).toBeVisible();
    expect(screen.queryByRole('row', { name: /api\/save/i })).toBeNull();
  });

  it('clears stale detail and labels trust when a zero-request hint is selected', async () => {
    setViewport(1_440);
    const user = userEvent.setup();
    const session = redactSession(
      {
        ...createSession('tab-9', 'https://checkout.example', 1_000),
        phase: 'recording',
        requests: [
          requestWith({
            id: 'background-request',
            startedAt: 9_000,
            url: 'https://checkout.example/api/background',
            classification: {
              kind: 'api',
              confidence: 'confirmed',
              evidence: [],
            },
          }),
        ],
        requestBytes: [32],
        interactions: [
          {
            id: 'history-hint',
            tabId: 'tab-9',
            kind: 'history',
            occurredAt: 1_500,
            trust: 'untrusted-hint',
            target: { tag: 'a', text: 'Account history' },
          },
        ],
      },
      DEFAULT_REDACTION_CONFIG,
    );
    render(<ExhibitApp controller={controllerFake(session)} />);

    await user.click(screen.getByRole('row', { name: /api\/background/i }));
    expect(screen.getByRole('region', { name: 'Request detail' })).toHaveTextContent(
      '/api/background',
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Account history · History · Untrusted hint · 0 requests',
      }),
    );

    expect(screen.queryAllByRole('row')).toHaveLength(0);
    // With nothing in the ledger the detail pane stays quiet rather than
    // competing with the ledger's own empty state.
    expect(screen.getByRole('region', { name: 'Request detail' })).toHaveTextContent(
      'Request detail opens here once the ledger has evidence.',
    );
  });

  it('exports the chosen format with redaction and item count visible', async () => {
    setViewport(1_440);
    const user = userEvent.setup();
    const exportEvidence = vi.fn(async () => undefined);
    render(
      <ExhibitApp
        controller={controllerFake(
          sessionWith('stopped', [
            sanitizedRequestWith({ id: 'one' }),
            sanitizedRequestWith({ id: 'two' }),
          ]),
        )}
        exportEvidence={exportEvidence}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Export evidence' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Export sanitized evidence',
    });
    expect(dialog).toHaveTextContent('Redaction');
    expect(dialog).toHaveTextContent('Enforced');
    expect(dialog).toHaveTextContent('2 requests');
    expect(
      within(dialog).getByRole('radio', { name: 'Sanitized HAR 1.2' }),
    ).toBeChecked();

    await user.click(within(dialog).getByRole('radio', { name: 'Markdown QA report' }));
    expect(dialog).toHaveTextContent('Markdown (.md)');
    await user.click(
      within(dialog).getByRole('button', { name: 'Export Markdown report' }),
    );

    expect(exportEvidence).toHaveBeenCalledWith('markdown');
  });

  it('preserves Explain, Inspect, and evidence-tab state across layout remounts', async () => {
    setViewport(1_440);
    const user = userEvent.setup();
    render(
      <ExhibitApp
        controller={controllerFake(
          sessionWith('recording', [
            sanitizedRequestWith({
              id: 'timed',
              url: 'https://checkout.example/api/timed',
              classification: {
                kind: 'api',
                confidence: 'confirmed',
                evidence: [],
              },
            }),
          ]),
        )}
      />,
    );

    await user.click(screen.getByRole('row', { name: /timed/i }));
    await user.click(screen.getByRole('tab', { name: 'Inspect' }));
    await user.click(screen.getByRole('tab', { name: 'Timing' }));
    expect(screen.getByRole('heading', { name: 'Phase breakdown' })).toBeVisible();

    act(() => setViewport(900));

    expect(screen.getByRole('tab', { name: 'Inspect' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Timing' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('heading', { name: 'Phase breakdown' })).toBeVisible();
  });
});
