// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { InteractionGroup } from '../../../src/domain/model';
import { DEFAULT_REDACTION_CONFIG, redactSession } from '../../../src/domain/redaction';
import { createSession } from '../../../src/domain/session';
import type { SanitizedCapturedRequest } from '../../../src/domain/sanitized';
import { compareRequests } from '../../../src/features/session/compare-requests';
import { InspectView } from '../../../src/features/inspect/inspect-view';
import { CopyButton } from '../../../src/components/copy-button';
import { requestWith, sanitizedRequestWith } from '../../helpers/request-factory';
import '../../../src/styles/tokens.css';
import '../../../src/styles/reset.css';
import '../../../src/styles/app.css';

function inspectedRequest(): SanitizedCapturedRequest {
  const base = sanitizedRequestWith({
    id: 'current',
    url: 'https://app.test/api/profile?token=%5BREDACTED%5D',
    method: 'POST',
    requestHeaders: [
      { name: 'Authorization', value: 'secret-original' },
      { name: 'Content-Type', value: 'application/json' },
    ],
    requestBody: {
      state: 'available',
      size: 22,
      capturedSize: 22,
      mimeType: 'application/json',
      text: '{"name":"[REDACTED]"}',
    },
    responseStatus: 201,
    responseHeaders: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'X-Request-Id', value: 'safe-42' },
    ],
    responseMime: 'application/json',
    responseText: '{"ok":true,"profile":{"id":"safe-42"}}',
    durationMs: 100,
    initiator: 'save-profile.tsx:42',
    classification: {
      kind: 'api',
      confidence: 'confirmed',
      evidence: ['Fetch request', 'JSON response'],
    },
  });
  return {
    ...base,
    timing: {
      totalMs: 100,
      blockedMs: 5,
      dnsMs: 10,
      connectMs: 10,
      sslMs: 20,
      sendMs: 5,
      waitMs: 40,
      receiveMs: 10,
    },
  };
}

const group: InteractionGroup = {
  id: 'event:save',
  kind: 'event',
  event: {
    id: 'save',
    tabId: 'tab-1',
    kind: 'submit',
    occurredAt: 1_700_000_000_000,
    trust: 'trusted',
    target: { tag: 'form', name: 'Save profile' },
  },
  requestIds: ['current'],
};

describe('InspectView', () => {
  it('offers all evidence tabs and keeps body rendering lazy until its section opens', async () => {
    const user = userEvent.setup();
    render(<InspectView group={group} request={inspectedRequest()} />);

    for (const name of [
      'Overview',
      'Request',
      'Response',
      'Timing',
      'Initiator',
      'Evidence',
    ]) {
      expect(screen.getByRole('tab', { name })).toBeVisible();
    }
    expect(screen.queryByText(/"profile"/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Response' }));
    expect(screen.getByText(/"profile"/)).toBeVisible();
  });

  it('keeps all six evidence tabs discoverable without workspace horizontal overflow', () => {
    render(<InspectView group={group} request={inspectedRequest()} />);

    const tablist = screen.getByRole('tablist', {
      name: 'Inspect request evidence',
    });
    expect(tablist.parentElement).toHaveClass('tabs--evidence');
    expect(within(tablist).getAllByRole('tab')).toHaveLength(6);
  });

  it('copies only safe cURL and header values with visible success announcements', async () => {
    const user = userEvent.setup();
    const copy = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    render(<InspectView copy={copy} group={group} request={inspectedRequest()} />);

    await user.click(screen.getByRole('button', { name: 'Copy safe cURL' }));
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy.mock.calls[0]?.[0]).toContain("curl --request 'POST'");
    expect(copy.mock.calls[0]?.[0]).not.toMatch(/secret-original|authorization/i);
    expect(screen.getByRole('status')).toHaveTextContent('Safe cURL copied.');

    await user.click(screen.getByRole('tab', { name: 'Response' }));
    const requestIdRow = screen.getByRole('listitem', { name: /X-Request-Id/i });
    await user.click(
      within(requestIdRow).getByRole('button', { name: /copy X-Request-Id/i }),
    );
    expect(copy).toHaveBeenLastCalledWith('safe-42');
    expect(screen.getByRole('status')).toHaveTextContent('X-Request-Id copied.');
  });

  it('announces clipboard failure without exposing copied content', async () => {
    const user = userEvent.setup();
    const copy = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValue(new Error());
    render(<InspectView copy={copy} group={group} request={inspectedRequest()} />);

    await user.click(screen.getByRole('button', { name: 'Copy safe cURL' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Safe cURL could not be copied. Clipboard unavailable.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      /curl --request|secret-original/i,
    );
  });

  it('forces credential headers to a redacted display even if malformed input reaches the view', async () => {
    const user = userEvent.setup();
    render(<InspectView group={group} request={inspectedRequest()} />);

    await user.click(screen.getByRole('tab', { name: 'Request' }));

    const authorization = screen.getByRole('listitem', { name: /Authorization/i });
    expect(authorization).toHaveTextContent('[REDACTED]');
    expect(authorization).not.toHaveTextContent('secret-original');
  });

  it('renders timing segments to total scale with pattern and text labels', async () => {
    const user = userEvent.setup();
    render(<InspectView group={group} request={inspectedRequest()} />);

    await user.click(screen.getByRole('tab', { name: 'Timing' }));
    const waterfall = screen.getByRole('img', {
      name: /request timing waterfall.*100 ms/i,
    });
    expect(waterfall).toHaveAccessibleName(/blocked 5 ms.*DNS 10 ms.*SSL 20 ms/i);
    for (const label of [
      'Blocked',
      'DNS',
      'Connect',
      'SSL',
      'Send',
      'Wait',
      'Receive',
    ]) {
      const segment = within(waterfall).getByText(new RegExp(label, 'i')).closest('li');
      expect(segment).toHaveAttribute('data-pattern');
      expect(segment).toHaveAttribute('style', expect.stringContaining('width:'));
    }
    expect(within(waterfall).getByText('40 ms')).toBeVisible();
  });

  it('clamps malformed non-finite timing evidence before rendering widths or labels', async () => {
    const user = userEvent.setup();
    const malformed = {
      ...inspectedRequest(),
      timing: {
        totalMs: Number.NaN,
        blockedMs: Number.POSITIVE_INFINITY,
        waitMs: -20,
      },
    };
    render(<InspectView group={group} request={malformed} />);

    await user.click(screen.getByRole('tab', { name: 'Timing' }));
    const waterfall = screen.getByRole('img', {
      name: /request timing waterfall, 0 ms total/i,
    });
    expect(waterfall).not.toHaveTextContent(/NaN|Infinity/);
    for (const segment of within(waterfall).getAllByRole('listitem')) {
      expect(segment).toHaveAttribute('style', expect.stringContaining('width: 0%'));
    }
  });

  it('shows status, duration delta, header changes, and body structure in comparison', async () => {
    const user = userEvent.setup();
    const current = inspectedRequest();
    const prior = sanitizedRequestWith({
      id: 'prior',
      url: current.url,
      method: current.method,
      responseStatus: 503,
      durationMs: 160,
      responseHeaders: [{ name: 'X-Request-Id', value: 'safe-11' }],
      responseMime: 'application/json',
      responseText: '{"ok":false,"error":"timeout"}',
    });
    const comparison = compareRequests(prior, current);
    render(<InspectView comparison={comparison} group={group} request={current} />);

    await user.click(screen.getByRole('button', { name: 'Show request comparison' }));

    const region = screen.getByRole('region', { name: 'Request comparison' });
    expect(within(region).getByText(/503 → 201/)).toBeVisible();
    expect(within(region).getByText(/60 ms faster/i)).toBeVisible();
    expect(within(region).getByText(/x-request-id/i)).toBeVisible();
    expect(within(region).getByText('/error')).toBeVisible();
    expect(within(region).getByText('/profile')).toBeVisible();
  });

  it('labels direct CORS evidence but does not turn generic failure into a CSP diagnosis', async () => {
    const user = userEvent.setup();
    const request = {
      ...inspectedRequest(),
      response: {
        ...inspectedRequest().response,
        status: 0,
        body: {
          state: 'unavailable' as const,
          size: 0,
          capturedSize: 0,
          reason: 'CORS policy blocked response',
        },
      },
    };
    render(<InspectView group={group} request={request} />);

    await user.click(screen.getByRole('tab', { name: 'Evidence' }));
    expect(screen.getByText(/CORS policy blocked response/i)).toBeVisible();
    expect(screen.queryByText(/CSP failure/i)).not.toBeInTheDocument();
  });

  it('supports arrow, Home, and End keyboard tab selection with roving focus', async () => {
    const user = userEvent.setup();
    render(<InspectView request={inspectedRequest()} />);
    const overview = screen.getByRole('tab', { name: 'Overview' });
    overview.focus();

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Evidence' })).toHaveFocus();
    expect(screen.getByText(/Fetch request/i)).toBeVisible();
    await user.keyboard('{ArrowRight}');
    expect(overview).toHaveFocus();
    await user.keyboard('{ArrowLeft}{Home}{ArrowDown}{ArrowUp}');
    expect(overview).toHaveFocus();
  });

  it('computes repeated-request comparison only after the user asks and can hide it', async () => {
    const user = userEvent.setup();
    const current = inspectedRequest();
    const prior = sanitizedRequestWith({
      id: 'prior',
      method: current.method,
      url: current.url,
      responseStatus: 500,
      durationMs: 70,
    });
    render(<InspectView compareWith={prior} request={current} />);

    expect(screen.queryByRole('region', { name: 'Request comparison' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show request comparison' }));
    expect(screen.getByRole('region', { name: 'Request comparison' })).toBeVisible();
    expect(screen.getByText(/30 ms slower/i)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Hide request comparison' }));
    expect(screen.queryByRole('region', { name: 'Request comparison' })).toBeNull();
  });

  it('does not show a computed comparison for a previously selected request', async () => {
    const user = userEvent.setup();
    const currentA = sanitizedRequestWith({
      id: 'current-a',
      responseStatus: 201,
      durationMs: 100,
    });
    const priorA = sanitizedRequestWith({
      id: 'prior-a',
      responseStatus: 503,
      durationMs: 160,
    });
    const currentB = sanitizedRequestWith({
      id: 'current-b',
      responseStatus: 204,
      durationMs: 180,
    });
    const priorB = sanitizedRequestWith({
      id: 'prior-b',
      responseStatus: 200,
      durationMs: 80,
    });
    const { rerender } = render(
      <InspectView compareWith={priorA} request={currentA} />,
    );

    await user.click(screen.getByRole('button', { name: 'Show request comparison' }));
    expect(screen.getByText(/503 → 201/)).toBeVisible();

    rerender(<InspectView compareWith={priorB} request={currentB} />);
    expect(screen.queryByRole('region', { name: 'Request comparison' })).toBeNull();
    expect(screen.queryByText(/503 → 201/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Show request comparison' }));
    expect(screen.getByText(/200 → 204/)).toBeVisible();
    expect(screen.getByText(/100 ms slower/i)).toBeVisible();
  });

  it('shows every sanitized hop in the selected request redirect chain', async () => {
    const user = userEvent.setup();
    const sanitized = redactSession(
      {
        ...createSession('tab-1', 'https://app.test', 1),
        requests: [
          requestWith({
            id: 'redirect-start',
            url: 'https://app.test/start',
            responseStatus: 302,
            redirectUrl: 'https://app.test/middle',
          }),
          requestWith({
            id: 'redirect-middle',
            url: 'https://app.test/middle',
            responseStatus: 307,
            redirectParentId: 'redirect-start',
            redirectUrl: 'https://app.test/final',
          }),
          requestWith({
            id: 'redirect-final',
            url: 'https://app.test/final',
            responseStatus: 200,
            redirectParentId: 'redirect-middle',
          }),
        ],
        requestBytes: [1, 1, 1],
      },
      DEFAULT_REDACTION_CONFIG,
    );
    const [start, middle, final] = sanitized.requests;
    if (start === undefined || middle === undefined || final === undefined) {
      throw new Error('redirect fixture failed');
    }

    render(<InspectView relatedRequests={[start, middle, final]} request={final} />);
    await user.click(screen.getByRole('tab', { name: 'Evidence' }));

    expect(
      screen.getByText(
        /redirect hop 1: https:\/\/app\.test\/start → https:\/\/app\.test\/middle/i,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        /redirect hop 2: https:\/\/app\.test\/middle → https:\/\/app\.test\/final/i,
      ),
    ).toBeVisible();
  });

  it('bounds large structural comparisons and announces the retained row limit', async () => {
    const user = userEvent.setup();
    const left = sanitizedRequestWith({
      id: 'left',
      responseMime: 'application/json',
      responseText: '{}',
    });
    const right = sanitizedRequestWith({
      id: 'right',
      responseMime: 'application/json',
      responseText: JSON.stringify(
        Object.fromEntries(
          Array.from({ length: 105 }, (_, index) => [`field-${index}`, index]),
        ),
      ),
    });
    render(<InspectView comparison={compareRequests(left, right)} request={right} />);

    await user.click(screen.getByRole('button', { name: 'Show request comparison' }));
    expect(screen.getByText(/limited to first 100 body changes/i)).toBeVisible();
  });

  it('directs empty request, initiator, and evidence states without inventing facts', async () => {
    const user = userEvent.setup();
    const request = {
      ...sanitizedRequestWith({
        requestHeaders: [],
        responseHeaders: [],
      }),
      url: ':::',
    };
    render(<InspectView request={request} />);

    expect(screen.getAllByText(':::')).toHaveLength(2);
    await user.click(screen.getByRole('tab', { name: 'Request' }));
    expect(screen.getByText(/no headers captured/i)).toBeVisible();
    expect(screen.getByText(/no request body was captured/i)).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Initiator' }));
    expect(screen.getByText(/no trusted interaction was correlated/i)).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Evidence' }));
    expect(screen.getByText(/no additional protocol evidence/i)).toBeVisible();
  });

  it('keeps standalone copy success and failure visible when no parent live region exists', async () => {
    const user = userEvent.setup();
    const copy = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    const { rerender } = render(
      <CopyButton
        copy={copy}
        errorMessage="Value copy failed."
        label="Copy value"
        successMessage="Value copied."
        value="safe"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Copy value' }));
    expect(screen.getByRole('status')).toHaveTextContent('Value copied.');

    copy.mockRejectedValue(new Error('denied'));
    rerender(
      <CopyButton
        copy={copy}
        errorMessage="Value copy failed."
        label="Copy value"
        successMessage="Value copied."
        value="safe"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Copy value' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Value copy failed.');
  });
});
