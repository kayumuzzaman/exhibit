// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { InteractionGroup } from '../../../src/domain/model';
import type { SanitizedCapturedRequest } from '../../../src/domain/sanitized';
import { ExplainView } from '../../../src/features/explain/explain-view';
import { sanitizedRequestWith } from '../../helpers/request-factory';
import '../../../src/styles/tokens.css';
import '../../../src/styles/reset.css';
import '../../../src/styles/app.css';

const saveGroup: InteractionGroup = {
  id: 'event:save',
  kind: 'event',
  event: {
    id: 'save',
    tabId: 'tab-1',
    kind: 'click',
    occurredAt: 1_700_000_000_000,
    trust: 'trusted',
    target: {
      tag: 'button',
      text: 'Save profile',
    },
  },
  requestIds: ['action'],
};

function serverAction(): SanitizedCapturedRequest {
  return sanitizedRequestWith({
    id: 'action',
    method: 'POST',
    url: 'https://app.test/account',
    responseStatus: 200,
    durationMs: 184,
    requestHeaders: [{ name: 'Next-Action', value: '40f3a8b1' }],
    requestBody: {
      state: 'available',
      size: 53,
      capturedSize: 53,
      mimeType: 'application/json',
      text: '{"email":"[REDACTED]","displayName":"Ada"}',
    },
    responseMime: 'application/json',
    responseText: '{"ok":true,"profile":{"id":"[REDACTED]"}}',
    classification: {
      kind: 'next-server-action',
      confidence: 'confirmed',
      actionId: '40f3a8b1',
      evidence: ['Next-Action request header'],
    },
  });
}

describe('ExplainView', () => {
  it('states trigger, action identifier, outcome, duration, and confidence without inventing a name', () => {
    render(<ExplainView group={saveGroup} request={serverAction()} />);

    expect(
      screen.getByRole('heading', {
        name: /After Save profile, Exhibit observed a Server Action that succeeded with HTTP 200 in 184 ms; classification confidence is confirmed/i,
      }),
    ).toBeVisible();
    expect(screen.getByText('40f3a8b1')).toBeVisible();
    expect(screen.getByText(/confirmed evidence/i)).toBeVisible();
    expect(screen.queryByText(/function name/i)).not.toBeInTheDocument();
  });

  it('shows safe field names and result shape while keeping submitted values out of the QA hierarchy', () => {
    render(<ExplainView group={saveGroup} request={serverAction()} />);

    expect(screen.getByText('displayName')).toBeVisible();
    expect(screen.getByText('email')).toBeVisible();
    expect(screen.getByText(/JSON result with 2 fields/i)).toBeVisible();
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
    expect(screen.queryByText('true')).not.toBeInTheDocument();
  });

  it('distinguishes repeated calls from retries and states redirect, cache, and service-worker facts', () => {
    const request = sanitizedRequestWith({
      id: 'current',
      method: 'GET',
      url: 'https://app.test/api/orders?cursor=%5BREDACTED%5D',
      responseStatus: 302,
      durationMs: 55,
      redirectUrl: 'https://app.test/login',
      fromCache: true,
      fromServiceWorker: true,
      classification: {
        kind: 'api',
        confidence: 'confirmed',
        evidence: ['Fetch request'],
      },
    });
    const prior = sanitizedRequestWith({
      id: 'prior',
      method: 'GET',
      url: 'https://app.test/api/orders?cursor=%5BREDACTED%5D',
      responseStatus: 200,
    });

    render(<ExplainView group={null} relatedRequests={[prior]} request={request} />);

    expect(screen.getByText(/redirects to https:\/\/app\.test\/login/i)).toBeVisible();
    expect(screen.getByText(/served from browser cache/i)).toBeVisible();
    expect(screen.getByText(/service worker supplied the response/i)).toBeVisible();
    expect(screen.getByText(/repeated call, not proof of a retry/i)).toBeVisible();
    expect(screen.getByText(/compare the repeated calls/i)).toBeVisible();
  });

  it('lists distinct follow-up calls correlated to the same interaction', () => {
    const request = serverAction();
    const audit = sanitizedRequestWith({
      id: 'audit',
      method: 'POST',
      url: 'https://app.test/api/audit',
      responseStatus: 204,
    });
    const refresh = sanitizedRequestWith({
      id: 'refresh',
      method: 'GET',
      url: 'https://app.test/api/profile',
      responseStatus: 200,
    });

    render(
      <ExplainView
        group={{ ...saveGroup, requestIds: ['action', 'audit', 'refresh'] }}
        relatedRequests={[request, audit, refresh]}
        request={request}
      />,
    );

    expect(screen.getByText(/POST \/api\/audit/i)).toBeVisible();
    expect(screen.getByText(/GET \/api\/profile/i)).toBeVisible();
  });

  it('bounds correlated call rows and states how many were omitted', () => {
    const request = serverAction();
    const related = Array.from({ length: 7 }, (_, index) =>
      sanitizedRequestWith({
        id: `related-${index}`,
        url: `https://app.test/api/follow-up-${index}`,
      }),
    );

    render(<ExplainView relatedRequests={[request, ...related]} request={request} />);

    const list = screen.getByRole('list', {
      name: 'Other calls correlated to this interaction',
    });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText(/2 additional correlated calls not shown/i)).toBeVisible();
  });

  it('keeps an unproven browser failure ambiguous instead of guessing CORS or CSP', () => {
    const ambiguous = sanitizedRequestWith({
      responseStatus: 0,
      responseBody: {
        state: 'unavailable',
        size: 0,
        capturedSize: 0,
        reason: 'net::ERR_FAILED',
      },
      classification: {
        kind: 'api',
        confidence: 'unknown',
        evidence: [],
      },
    });

    render(<ExplainView group={null} request={ambiguous} />);

    expect(screen.getByText(/no HTTP response was captured/i)).toBeVisible();
    expect(screen.getByText(/cause is unknown/i)).toBeVisible();
    expect(screen.queryByText(/CORS failure/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/CSP failure/i)).not.toBeInTheDocument();
  });

  it.each([
    ['api', 'API request'],
    ['graphql', 'GraphQL request'],
    ['form', 'form submission'],
    ['ssr', 'SSR document'],
    ['rsc', 'RSC payload'],
  ])('uses evidence-led language for %s traffic', (kind, expected) => {
    render(
      <ExplainView
        group={null}
        request={sanitizedRequestWith({
          classification: {
            kind,
            confidence: 'likely',
            evidence: ['Protocol evidence'],
          },
        })}
      />,
    );

    expect(
      screen.getByRole('heading', { name: new RegExp(expected, 'i') }),
    ).toBeVisible();
    expect(screen.getByText(/likely evidence/i)).toBeVisible();
  });

  it.each([
    [302, /redirected with HTTP 302/i],
    [404, /failed with client error HTTP 404/i],
    [503, /failed with server error HTTP 503/i],
  ])('states HTTP outcome %s without softening the evidence', (status, expected) => {
    render(
      <ExplainView
        request={sanitizedRequestWith({
          responseStatus: status,
          classification: {
            kind: 'api',
            confidence: 'confirmed',
            evidence: [],
          },
        })}
      />,
    );

    expect(screen.getByRole('heading', { name: expected })).toBeVisible();
  });

  it.each([
    [
      {
        state: 'available' as const,
        size: 35,
        capturedSize: 35,
        mimeType: 'application/x-www-form-urlencoded',
        text: 'email=hidden%40test&displayName=Ada',
      },
      ['displayName', 'email'],
      ['Ada', 'hidden@test'],
    ],
  ])('lists %s field names without field values', (body, names, hidden) => {
    render(<ExplainView request={sanitizedRequestWith({ requestBody: body })} />);

    for (const name of names) expect(screen.getByText(name)).toBeVisible();
    for (const value of hidden)
      expect(screen.queryByText(value)).not.toBeInTheDocument();
  });

  it.each([
    [
      {
        state: 'binary' as const,
        size: 2_048,
        capturedSize: 0,
        mimeType: 'application/octet-stream',
      },
      /binary result, 2048 bytes/i,
    ],
    [
      {
        state: 'streamed' as const,
        size: 0,
        capturedSize: 0,
        mimeType: 'text/event-stream',
      },
      /streamed result was not buffered/i,
    ],
    [
      {
        state: 'unavailable' as const,
        size: 0,
        capturedSize: 0,
      },
      /response body was unavailable/i,
    ],
    [
      {
        state: 'truncated' as const,
        size: 1_000,
        capturedSize: 12,
        text: 'safe excerpt',
        mimeType: 'text/plain',
      },
      /text result captured in part, 12 bytes/i,
    ],
  ])(
    'summarizes result support state without exposing raw values',
    (responseBody, summary) => {
      render(<ExplainView request={sanitizedRequestWith({ responseBody })} />);
      expect(screen.getByText(summary)).toBeVisible();
      expect(screen.queryByText('safe excerpt')).not.toBeInTheDocument();
    },
  );

  it.each([
    ['navigation', 'Navigation'],
    ['submit', 'Form submission'],
    ['click', 'Page interaction'],
  ] as const)('uses a factual fallback for an unlabeled %s', (kind, label) => {
    render(
      <ExplainView
        group={{
          id: 'event:unlabeled',
          kind: 'event',
          event: {
            id: 'unlabeled',
            tabId: 'tab-1',
            kind,
            occurredAt: 1_700_000_000_000,
            trust: 'trusted',
          },
          requestIds: ['request-1'],
        }}
        request={sanitizedRequestWith()}
      />,
    );
    expect(screen.getByRole('heading', { name: new RegExp(label, 'i') })).toBeVisible();
  });

  it('does not access large body text in the default Explain hierarchy', () => {
    const base = sanitizedRequestWith({
      classification: {
        kind: 'api',
        confidence: 'confirmed',
        evidence: [],
      },
    });
    const largeBody = {
      state: 'available' as const,
      size: 200_000,
      capturedSize: 200_000,
      mimeType: 'application/json',
      get text(): string {
        throw new Error('large body text was accessed eagerly');
      },
    };
    const request = {
      ...base,
      request: { ...base.request, body: largeBody },
      response: { ...base.response, body: largeBody },
    };

    expect(() => render(<ExplainView request={request} />)).not.toThrow();
    expect(screen.getByText(/large body shape is available in Inspect/i)).toBeVisible();
  });
});
