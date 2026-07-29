import { describe, expect, it } from 'vitest';

import type { Classification } from '../../../src/domain/model';
import type { SanitizedCapturedRequest } from '../../../src/domain/sanitized';
import { filterRequests } from '../../../src/features/session/filter-requests';
import { SearchIndex } from '../../../src/features/session/search-index';
import { sanitizedRequestWith } from '../../helpers/request-factory';

const API: Classification = Object.freeze({
  kind: 'api',
  confidence: 'likely',
  evidence: Object.freeze([]),
});

function requestWithUrl(
  id: string,
  url: string,
  extra: Partial<SanitizedCapturedRequest> = {},
): SanitizedCapturedRequest {
  return { ...sanitizedRequestWith(), id, url, ...extra };
}

describe('filter boundary paths', () => {
  it('excludes a request whose URL cannot be parsed when filtering by domain', () => {
    const usable = requestWithUrl('usable', 'https://app.test/api/x');
    const opaque = requestWithUrl('opaque', 'not-a-url');

    const result = filterRequests([usable, opaque], {
      apiOnly: false,
      domains: ['app.test'],
    });

    expect(result.map(({ id }) => id)).toEqual(['usable']);
  });

  it('narrows by method, kind, and cache miss together', () => {
    const posted = requestWithUrl('posted', 'https://app.test/api/save', {
      method: 'POST',
      classification: API,
    });
    const fetched = requestWithUrl('fetched', 'https://app.test/api/list', {
      classification: API,
    });

    expect(
      filterRequests([posted, fetched], {
        apiOnly: false,
        methods: ['post', '  '],
        kinds: ['api'],
        cache: 'miss',
      }).map(({ id }) => id),
    ).toEqual(['posted']);
  });

  it('keeps only the requests attributed to a selected interaction', () => {
    const first = requestWithUrl('first', 'https://app.test/api/one');
    const second = requestWithUrl('second', 'https://app.test/api/two');

    const result = filterRequests([first, second], {
      apiOnly: false,
      interactionId: 'unattributed',
      interactionGroups: [
        {
          id: 'unattributed',
          kind: 'unattributed',
          event: null,
          requestIds: ['second'],
        },
      ],
    });

    expect(result.map(({ id }) => id)).toEqual(['second']);
  });

  it('returns nothing when the selected interaction has no group', () => {
    const request = requestWithUrl('only', 'https://app.test/api/one');

    expect(
      filterRequests([request], {
        apiOnly: false,
        interactionId: 'missing',
        interactionGroups: [],
      }),
    ).toEqual([]);
  });

  it('falls back to the default threshold when a malformed one is supplied', () => {
    const slow = {
      ...requestWithUrl('slow', 'https://app.test/api/slow'),
      timing: { totalMs: 2_000 },
    };
    const fast = {
      ...requestWithUrl('fast', 'https://app.test/api/fast'),
      timing: { totalMs: 10 },
    };

    expect(
      filterRequests([slow, fast], {
        apiOnly: false,
        slowOnly: true,
        slowThresholdMs: Number.NaN,
      }).map(({ id }) => id),
    ).toEqual(['slow']);
  });
});

describe('search index boundary paths', () => {
  it('indexes an unparsable URL as a single opaque term', () => {
    const index = new SearchIndex();
    index.add(requestWithUrl('opaque', 'exhibit-opaque-url'));

    expect(index.query('exhibit-opaque-url').map(({ id }) => id)).toEqual(['opaque']);
  });

  it('keeps an undecodable percent sequence searchable as written', () => {
    const index = new SearchIndex();
    index.add(requestWithUrl('raw', 'https://app.test/api/%E0%A4%A'));

    expect(index.query('%E0%A4%A').map(({ id }) => id)).toEqual(['raw']);
  });

  it('matches decoded query parameters from the sanitized URL', () => {
    const index = new SearchIndex();
    index.add(
      requestWithUrl('query', 'https://app.test/api/list?filter=open%20orders'),
    );

    expect(index.query('open orders').map(({ id }) => id)).toEqual(['query']);
  });
});
