// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { BodyContent, Classification } from '../../../src/domain/model';
import { DEFAULT_REDACTION_CONFIG, redactSession } from '../../../src/domain/redaction';
import type { SanitizedCapturedRequest } from '../../../src/domain/sanitized';
import { createSession } from '../../../src/domain/session';
import { ExplainView } from '../../../src/features/explain/explain-view';
import { EvidenceList } from '../../../src/features/inspect/evidence-list';
import { InspectView } from '../../../src/features/inspect/inspect-view';
import { HeaderList } from '../../../src/features/inspect/header-list';
import { RequestDiffView } from '../../../src/features/inspect/request-diff';
import { RequestTable } from '../../../src/features/session/request-table';
import { SessionRail } from '../../../src/features/session/session-rail';
import { sanitizedRequestWith } from '../../helpers/request-factory';

const NO_FILTERS = { cacheHits: false, failures: false, slowCalls: false } as const;

function request(
  id: string,
  extra: Partial<SanitizedCapturedRequest> = {},
): SanitizedCapturedRequest {
  return { ...sanitizedRequestWith(), id, ...extra };
}

function textBody(mimeType: string, text: string): BodyContent {
  return {
    state: 'available',
    size: text.length,
    capturedSize: text.length,
    text,
    mimeType,
  };
}

describe('session rail', () => {
  it('toggles filters and closes the drawer through its own controls', async () => {
    const user = userEvent.setup();
    const onApiOnlyChange = vi.fn();
    const onQuickFilterChange = vi.fn();
    const onResetFilters = vi.fn();
    const onClose = vi.fn();
    const session = redactSession(
      createSession('tab-1', 'https://app.test', 1_000),
      DEFAULT_REDACTION_CONFIG,
    );

    render(
      <SessionRail
        apiOnly={false}
        onApiOnlyChange={onApiOnlyChange}
        onClose={onClose}
        onQuickFilterChange={onQuickFilterChange}
        onResetFilters={onResetFilters}
        quickFilters={NO_FILTERS}
        session={session}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: /API requests only/u }));
    expect(onApiOnlyChange).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole('button', { name: 'Failures' }));
    expect(onQuickFilterChange).toHaveBeenCalledWith('failures', true);

    await user.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(onResetFilters).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Close session rail' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('request table', () => {
  it('shows an unparsable URL verbatim and keeps keyboard bounds', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const rows = [
      { ...request('a'), url: 'payloadra-opaque-route' },
      request('b'),
      request('c'),
    ];

    render(<RequestTable onSelect={onSelect} requests={rows} selectedId={null} />);

    expect(screen.getByText('payloadra-opaque-route')).toBeVisible();

    const first = screen.getAllByRole('row')[1]!;
    first.focus();
    await user.keyboard('{End}');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(rows[2]);

    await user.keyboard('{Home}');
    await user.keyboard('{ArrowUp}');
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenLastCalledWith(rows[0]);
  });

  it('renders the phone layout without optional columns', () => {
    render(
      <RequestTable
        onSelect={vi.fn()}
        phone
        requests={[request('a')]}
        selectedId="a"
      />,
    );

    expect(screen.queryByRole('columnheader', { name: 'Duration' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Route' })).toBeVisible();
  });
});

describe('explain view submitted shapes', () => {
  it('lists form-encoded field names without their values', () => {
    render(
      <ExplainView
        request={{
          ...request('form'),
          request: {
            headers: [],
            body: textBody(
              'application/x-www-form-urlencoded',
              'displayName=Ada&password=secret-value',
            ),
          },
        }}
      />,
    );

    expect(screen.getByText('displayName')).toBeVisible();
    expect(screen.getByText('password')).toBeVisible();
    expect(document.body.textContent).not.toContain('secret-value');
  });

  it('lists multipart part names from the captured prefix', () => {
    render(
      <ExplainView
        request={{
          ...request('multipart'),
          request: {
            headers: [],
            body: textBody(
              'multipart/form-data; boundary=x',
              'content-disposition: form-data; name="avatar"; filename="a.png"\r\n\r\ncontent-disposition: form-data; name="displayName"\r\n\r\nAda',
            ),
          },
        }}
      />,
    );

    expect(screen.getByText('avatar')).toBeVisible();
    expect(screen.getByText('displayName')).toBeVisible();
  });

  it('skips field extraction for a body beyond the explain budget', () => {
    render(
      <ExplainView
        request={{
          ...request('large'),
          request: {
            headers: [],
            body: {
              state: 'available',
              size: 200_000,
              capturedSize: 200_000,
              text: '{"displayName":"Ada"}',
              mimeType: 'application/json',
            },
          },
        }}
      />,
    );

    expect(
      screen.getByText('No safe submitted field names were available.'),
    ).toBeVisible();
  });

  it('reports a large response as shape-only', () => {
    render(
      <ExplainView
        request={{
          ...request('large-response'),
          response: {
            status: 200,
            headers: [],
            body: {
              state: 'available',
              size: 200_000,
              capturedSize: 200_000,
              text: '{"a":1}',
              mimeType: 'application/json',
            },
          },
        }}
      />,
    );

    expect(screen.getByText(/Large body shape is available in Inspect/u)).toBeVisible();
  });
});

describe('evidence ledger', () => {
  it('walks a redirect chain forward and backward without repeating a hop', () => {
    const first = {
      ...request('first'),
      url: 'https://app.test/start',
      evidence: { redirectUrl: 'https://app.test/middle' },
    };
    const middle = {
      ...request('middle'),
      url: 'https://app.test/middle',
      evidence: {
        redirectParentId: 'first',
        redirectUrl: 'https://app.test/end',
      },
    };
    const last = {
      ...request('last'),
      url: 'https://app.test/end',
      evidence: { redirectParentId: 'middle' },
    };

    render(<EvidenceList relatedRequests={[first, middle, last]} request={middle} />);

    expect(screen.getByText(/Redirect hop 1/u)).toBeVisible();
    expect(screen.getByText(/Redirect hop 2/u)).toBeVisible();
  });

  it('stops a redirect chain that points back at itself', () => {
    const looped = {
      ...request('looped'),
      url: 'https://app.test/loop',
      evidence: { redirectParentId: 'looped' },
    };

    render(<EvidenceList relatedRequests={[looped]} request={looped} />);

    expect(
      screen.getByText('No additional protocol evidence was captured.'),
    ).toBeVisible();
  });

  it('reports body support state and truncation as source facts', () => {
    const truncated = {
      ...request('truncated'),
      response: {
        status: 200,
        headers: [],
        body: {
          state: 'truncated' as const,
          size: 900,
          capturedSize: 100,
          text: 'partial',
          reason: 'body-limit',
        },
      },
    };

    render(<EvidenceList request={truncated} />);

    expect(screen.getByText('Body support state: body-limit')).toBeVisible();
    expect(screen.getByText('Body truncated at 100 of 900 bytes.')).toBeVisible();
  });
});

describe('header list', () => {
  it('reports an empty header set instead of an empty list', () => {
    render(<HeaderList headers={[]} />);

    expect(screen.getByText('No headers captured.')).toBeVisible();
  });

  it('announces its own copy outcome when no parent listens', async () => {
    const user = userEvent.setup();
    render(
      <HeaderList
        copy={async () => {
          throw new Error('clipboard unavailable');
        }}
        headers={[{ name: 'accept', value: 'application/json' }]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Copy accept value' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'accept could not be copied.',
    );
  });
});

describe('request comparison rendering', () => {
  it('compacts long and structured values and reports the row limit', () => {
    render(
      <RequestDiffView
        diff={{
          leftId: 'left',
          rightId: 'right',
          method: { left: 'GET', right: 'GET', changed: false },
          url: {
            left: 'https://app.test/api/x',
            right: 'https://app.test/api/x',
            changed: false,
          },
          status: { left: 200, right: 500, changed: true },
          durationMs: { left: 40, right: 10, changed: true },
          requestHeaders: [],
          responseHeaders: [
            { name: 'x-trace', left: ['a'.repeat(200)], right: [], changed: true },
          ],
          requestBody: {
            format: 'json',
            leftState: 'available',
            rightState: 'available',
            changes: [],
          },
          responseBody: {
            format: 'json',
            leftState: 'available',
            rightState: 'available',
            changes: Array.from({ length: 150 }, (_, index) => ({
              kind: 'changed' as const,
              path: `/field${index}`,
              left: { nested: index },
              right: undefined,
            })),
          },
        }}
      />,
    );

    expect(screen.getByText('30 ms faster')).toBeVisible();
    expect(
      screen.getByText(/Comparison limited to first 100 body changes/u),
    ).toBeVisible();
    expect(screen.getByText(/…/u)).toBeVisible();
  });

  it('reports an unchanged comparison plainly', () => {
    render(
      <RequestDiffView
        diff={{
          leftId: 'left',
          rightId: 'right',
          method: { left: 'GET', right: 'GET', changed: false },
          url: {
            left: 'https://app.test/api/x',
            right: 'https://app.test/api/x',
            changed: false,
          },
          status: { left: 200, right: 200, changed: false },
          durationMs: { left: 40, right: 40, changed: false },
          requestHeaders: [],
          responseHeaders: [],
          requestBody: {
            format: 'json',
            leftState: 'available',
            rightState: 'available',
            changes: [],
          },
          responseBody: {
            format: 'json',
            leftState: 'available',
            rightState: 'available',
            changes: [],
          },
        }}
      />,
    );

    expect(screen.getByText('No change')).toBeVisible();
    expect(screen.getByText('No body structure changed.')).toBeVisible();
  });
});

describe('classification fallbacks', () => {
  it('describes an unmapped classification kind without inventing copy', () => {
    const exotic: Classification = {
      kind: 'exotic-kind',
      confidence: 'likely',
      evidence: [],
    };

    render(<ExplainView request={{ ...request('exotic'), classification: exotic }} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'a exotic-kind request',
    );
  });
});

describe('remaining explain and rail branches', () => {
  it('reports no submitted fields for an unrecognized request encoding', () => {
    render(
      <ExplainView
        request={{
          ...request('binary-body'),
          request: {
            headers: [],
            body: textBody('application/octet-stream', 'raw-bytes'),
          },
        }}
      />,
    );

    expect(
      screen.getByText('No safe submitted field names were available.'),
    ).toBeVisible();
  });

  it('reports an unparsable related URL without throwing', () => {
    const related = { ...request('related'), url: 'payloadra-opaque-related' };
    const selected = { ...request('selected'), url: 'payloadra-opaque-related' };

    render(<ExplainView relatedRequests={[related, selected]} request={selected} />);

    expect(screen.getByText(/payloadra-opaque-related/u)).toBeVisible();
    expect(screen.getByText(/matched this method and normalized URL/u)).toBeVisible();
  });

  it('caps a long redirect chain and falls back to the HAR redirect target', () => {
    const chain = Array.from({ length: 12 }, (_, index) => ({
      ...request(`hop-${index}`),
      url: `https://app.test/hop-${index}`,
      evidence: index === 0 ? {} : { redirectParentId: `hop-${index - 1}` },
    }));

    render(<EvidenceList relatedRequests={chain} request={chain.at(-1)!} />);

    expect(screen.getByText(/Redirect chain display limited to 8 hops/u)).toBeVisible();
  });

  it('shows the HAR redirect target when no chain is correlated', () => {
    const single = {
      ...request('single'),
      evidence: { redirectUrl: 'https://app.test/next' },
    };

    render(<EvidenceList request={single} />);

    expect(screen.getByText(/HAR redirect target/u)).toBeVisible();
  });

  it('reports local retention in the session rail', () => {
    const session = redactSession(
      { ...createSession('tab-1', 'https://app.test', 1_000), retention: 'persistent' },
      DEFAULT_REDACTION_CONFIG,
    );

    render(
      <SessionRail
        apiOnly
        onApiOnlyChange={vi.fn()}
        onQuickFilterChange={vi.fn()}
        onResetFilters={vi.fn()}
        quickFilters={NO_FILTERS}
        session={session}
      />,
    );

    expect(screen.getByText('Local')).toBeVisible();
  });
});

describe('explain narration boundaries', () => {
  it('ignores a JSON array body when listing submitted fields', () => {
    render(
      <ExplainView
        request={{
          ...request('array-body'),
          request: { headers: [], body: textBody('application/json', '[1,2,3]') },
        }}
      />,
    );

    expect(
      screen.getByText('No safe submitted field names were available.'),
    ).toBeVisible();
  });

  it('describes a single submitted and returned field in the singular', () => {
    render(
      <ExplainView
        request={{
          ...request('single-field'),
          request: {
            headers: [],
            body: textBody('application/json', '{"displayName":"Ada"}'),
          },
          response: {
            status: 200,
            headers: [],
            body: textBody('application/json', '{"ok":true}'),
          },
        }}
      />,
    );

    expect(screen.getByText('JSON result with 1 field: ok.')).toBeVisible();
  });

  it('describes an empty JSON object result without listing fields', () => {
    render(
      <ExplainView
        request={{
          ...request('empty-json'),
          response: {
            status: 200,
            headers: [],
            body: textBody('application/json', '{}'),
          },
        }}
      />,
    );

    expect(screen.getByText('JSON result with 0 fields.')).toBeVisible();
  });

  it('reports an empty text result and a truncated one distinctly', () => {
    const { unmount } = render(
      <ExplainView
        request={{
          ...request('empty-text'),
          response: {
            status: 200,
            headers: [],
            body: { state: 'available', size: 0, capturedSize: 0, text: '' },
          },
        }}
      />,
    );
    expect(screen.getByText('No captured response content.')).toBeVisible();
    unmount();

    render(
      <ExplainView
        request={{
          ...request('truncated-text'),
          response: {
            status: 200,
            headers: [],
            body: {
              state: 'truncated',
              size: 90,
              capturedSize: 20,
              text: 'partial text body',
              mimeType: 'text/plain',
            },
          },
        }}
      />,
    );
    expect(screen.getByText(/Text result captured in part, 20 bytes\./u)).toBeVisible();
  });

  it('reports binary and streamed results without decoding them', () => {
    const { unmount } = render(
      <ExplainView
        request={{
          ...request('binary-result'),
          response: {
            status: 200,
            headers: [],
            body: {
              state: 'binary',
              size: 4_096,
              capturedSize: 0,
              mimeType: 'image/png',
            },
          },
        }}
      />,
    );
    expect(screen.getByText('Binary result, 4096 bytes.')).toBeVisible();
    unmount();

    render(
      <ExplainView
        request={{
          ...request('streamed-result'),
          response: {
            status: 200,
            headers: [],
            body: { state: 'streamed', size: 0, capturedSize: 0 },
          },
        }}
      />,
    );
    expect(screen.getByText('Streamed result was not buffered.')).toBeVisible();
  });

  it('counts one repeated call and one hidden call in the singular', () => {
    const selected = { ...request('selected'), url: 'https://app.test/api/items' };
    const repeat = { ...request('repeat'), url: 'https://app.test/api/items' };
    const others = Array.from({ length: 5 }, (_, index) => ({
      ...request(`other-${index}`),
      url: `https://app.test/api/other-${index}`,
    }));

    render(
      <ExplainView
        relatedRequests={[selected, repeat, ...others]}
        request={selected}
      />,
    );

    expect(screen.getByText(/1 other request matched/u)).toBeVisible();
    expect(screen.getByText(/1 additional correlated call not shown\./u)).toBeVisible();
  });

  it('marks a related call without a response as having none', () => {
    const selected = { ...request('selected'), url: 'https://app.test/api/items' };
    const failed = {
      ...request('failed'),
      url: 'https://app.test/api/failed',
      response: {
        status: 0,
        headers: [],
        body: { state: 'unavailable' as const, size: 0, capturedSize: 0 },
      },
    };

    render(<ExplainView relatedRequests={[selected, failed]} request={selected} />);

    expect(screen.getByText('No response')).toBeVisible();
  });
});

describe('inspect copy outcome scoping', () => {
  it('drops a copy announcement when a different request is selected', async () => {
    const user = userEvent.setup();
    const first = request('first');
    const second = request('second');
    const { rerender } = render(
      <InspectView copy={async () => undefined} request={first} />,
    );

    await user.click(screen.getByRole('button', { name: 'Copy safe cURL' }));
    expect(await screen.findByText('Safe cURL copied.')).toBeVisible();

    rerender(<InspectView copy={async () => undefined} request={second} />);

    expect(screen.queryByText('Safe cURL copied.')).not.toBeInTheDocument();
  });

  it('keeps a copy failure visible for the request it belongs to', async () => {
    const user = userEvent.setup();
    const only = request('only');
    render(
      <InspectView
        copy={async () => {
          throw new Error('clipboard unavailable');
        }}
        request={only}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Copy safe cURL' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Safe cURL could not be copied.',
    );
  });
});
