import { describe, expect, it } from 'vitest';

import type { InteractionGroup } from '../../../src/domain/model';
import type { SanitizedCapturedRequest } from '../../../src/domain/sanitized';
import { filterRequests } from '../../../src/features/session/filter-requests';
import { sanitizedRequestWith } from '../../helpers/request-factory';

function safeRequest(
  id: string,
  overrides: Parameters<typeof sanitizedRequestWith>[0],
): SanitizedCapturedRequest {
  return {
    ...sanitizedRequestWith(overrides),
    id,
  };
}

const dataset = [
  safeRequest('mutation-failed', {
    url: 'https://api.test/graphql?token=secret-original',
    method: 'POST',
    responseStatus: 500,
    durationMs: 1_250,
    fromCache: false,
    classification: {
      kind: 'graphql',
      confidence: 'confirmed',
      evidence: ['GraphQL operation detected.'],
    },
  }),
  safeRequest('mutation-cached', {
    url: 'https://api.test/graphql',
    method: 'POST',
    responseStatus: 503,
    durationMs: 1_500,
    fromCache: true,
    classification: {
      kind: 'graphql',
      confidence: 'confirmed',
      evidence: [],
    },
  }),
  safeRequest('other-api', {
    url: 'https://other.test/api/items',
    method: 'GET',
    responseStatus: 200,
    classification: {
      kind: 'api',
      confidence: 'likely',
      evidence: [],
    },
  }),
  safeRequest('document', {
    url: 'https://api.test/page',
    method: 'GET',
    responseStatus: 200,
    classification: {
      kind: 'document',
      confidence: 'confirmed',
      evidence: [],
    },
  }),
] as const;

const interactionGroups: readonly InteractionGroup[] = [
  {
    id: 'event:save',
    kind: 'event',
    event: {
      id: 'save',
      tabId: 'tab-1',
      kind: 'submit',
      occurredAt: 1_699_999_999_900,
      trust: 'trusted',
      target: { tag: 'button', name: 'Save' },
    },
    requestIds: ['mutation-failed'],
  },
  {
    id: 'unattributed',
    kind: 'unattributed',
    event: null,
    requestIds: ['mutation-cached', 'other-api', 'document'],
  },
];

describe('filterRequests', () => {
  it('intersects interaction, failure, slow, method, domain, cache, and protocol filters', () => {
    const result = filterRequests(dataset, {
      interactionId: 'save',
      interactionGroups,
      outcome: 'failure',
      slowOnly: true,
      slowThresholdMs: 1_000,
      methods: ['post'],
      domains: ['API.TEST'],
      cache: 'miss',
      kinds: ['GraphQL'],
    });

    expect(result.map(({ id }) => id)).toEqual(['mutation-failed']);
  });

  it('fails closed when an interaction selection has no matching group evidence', () => {
    expect(
      filterRequests(dataset, {
        interactionId: 'missing',
        interactionGroups,
        apiOnly: false,
      }),
    ).toEqual([]);
    expect(
      filterRequests(dataset, {
        interactionId: 'save',
        apiOnly: false,
      }),
    ).toEqual([]);
  });

  it('defaults to API-like protocol kinds and reveals documents only when disabled', () => {
    expect(filterRequests(dataset, {}).map(({ id }) => id)).toEqual([
      'mutation-failed',
      'mutation-cached',
      'other-api',
    ]);
    expect(filterRequests(dataset, { apiOnly: false }).map(({ id }) => id)).toEqual(
      dataset.map(({ id }) => id),
    );
  });

  it('treats missing cache evidence as a miss and status zero as failure', () => {
    const noResponse = safeRequest('no-response', {
      url: 'https://api.test/api/offline',
      responseStatus: 0,
      classification: {
        kind: 'api',
        confidence: 'likely',
        evidence: [],
      },
    });

    expect(
      filterRequests([...dataset, noResponse], {
        outcome: 'failure',
        cache: 'miss',
      }).map(({ id }) => id),
    ).toEqual(['mutation-failed', 'no-response']);
  });

  it('excludes invalid URLs from an active domain filter without disturbing input order', () => {
    const invalid = safeRequest('invalid-url', {
      url: 'not a URL',
      classification: {
        kind: 'api',
        confidence: 'unknown',
        evidence: [],
      },
    });

    expect(
      filterRequests([invalid, ...dataset], {
        domains: ['api.test'],
        apiOnly: false,
      }).map(({ id }) => id),
    ).toEqual(['mutation-failed', 'mutation-cached', 'document']);
  });
});
