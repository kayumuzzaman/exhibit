import { describe, expect, it } from 'vitest';

import type { CapturedRequest } from '../../../src/domain/model';
import { DEFAULT_REDACTION_CONFIG, redactRequest } from '../../../src/domain/redaction';
import type { SanitizedCapturedRequest } from '../../../src/domain/sanitized';
import { SearchIndex } from '../../../src/features/session/search-index';
import { requestWith } from '../../helpers/request-factory';

type SafeOverrides = Parameters<typeof requestWith>[0] &
  Readonly<{
    classificationKind?: string;
    classificationEvidence?: readonly string[];
    explanationSummary?: string;
    explanationEvidence?: readonly string[];
  }>;

function safeRequest(id: string, overrides: SafeOverrides): SanitizedCapturedRequest {
  const raw: CapturedRequest = {
    ...requestWith(overrides),
    classification: {
      kind: overrides.classificationKind ?? 'api',
      confidence: 'likely',
      evidence: overrides.classificationEvidence ?? [],
    },
    explanation: {
      outcome: 'success',
      summary: overrides.explanationSummary ?? 'Request completed.',
      guidance: [],
      evidence: overrides.explanationEvidence ?? [],
    },
  };
  return {
    ...redactRequest(raw, DEFAULT_REDACTION_CONFIG),
    id,
  };
}

describe('SearchIndex', () => {
  it('indexes every sanitized discovery surface and requires all query terms', () => {
    const request = safeRequest('alpha', {
      method: 'POST',
      url: 'https://api.test/Κατάλογος?query=ΜΕΓΑ&token=secret-original',
      requestBody: {
        state: 'available',
        size: 24,
        capturedSize: 24,
        text: '{"safe":"needle body"}',
        mimeType: 'application/json',
      },
      responseStatus: 422,
      responseText: 'safe response body',
      classificationKind: 'graphql',
      classificationEvidence: ['Operation CreateWidget.'],
      explanationSummary: 'Validation stopped the save.',
      explanationEvidence: ['Schema evidence is safe.'],
      initiator: 'script',
    });
    const index = new SearchIndex();

    index.add(request, 'Save profile');

    for (const query of [
      'post',
      'api.test',
      'Κατάλογος',
      'μεγα',
      'needle body',
      'response body',
      '422',
      'graphql',
      'Save profile',
      'CreateWidget',
      'Validation',
      'Schema evidence',
      'script',
    ]) {
      expect(
        index.query(query).map(({ id }) => id),
        query,
      ).toEqual(['alpha']);
    }
    expect(index.query('graphql 422 save').map(({ id }) => id)).toEqual(['alpha']);
    expect(index.query('secret-original')).toEqual([]);
    expect(index.query('[redacted]').map(({ id }) => id)).toEqual(['alpha']);
  });

  it('uses locale-independent Unicode lowercase normalization', () => {
    const index = new SearchIndex();
    index.add(
      safeRequest('unicode', {
        url: 'https://api.test/İSTANBUL/ΜΕΓΑ',
      }),
    );

    expect(index.query('i̇stanbul μεγα').map(({ id }) => id)).toEqual(['unicode']);
  });

  it('replaces duplicate IDs without retaining stale searchable text', () => {
    const index = new SearchIndex();
    index.add(
      safeRequest('same-id', {
        url: 'https://api.test/old-needle',
        startedAt: 20,
      }),
    );
    index.add(
      safeRequest('same-id', {
        url: 'https://api.test/new-needle',
        startedAt: 10,
      }),
    );

    expect(index.query('old-needle')).toEqual([]);
    expect(index.query('new-needle').map(({ id }) => id)).toEqual(['same-id']);
    expect(index.size).toBe(1);
  });

  it('removes evicted records and returns deterministic timestamp/id order', () => {
    const index = new SearchIndex();
    index.add(
      safeRequest('later-b', {
        url: 'https://api.test/shared',
        startedAt: 20,
      }),
    );
    index.add(
      safeRequest('early', {
        url: 'https://api.test/shared',
        startedAt: 10,
      }),
    );
    index.add(
      safeRequest('later-a', {
        url: 'https://api.test/shared',
        startedAt: 20,
      }),
    );

    expect(index.query('shared').map(({ id }) => id)).toEqual([
      'early',
      'later-a',
      'later-b',
    ]);
    expect(index.remove('early')).toBe(true);
    expect(index.remove('early')).toBe(false);
    expect(index.query('').map(({ id }) => id)).toEqual(['later-a', 'later-b']);
  });

  it('rejects raw request data at the index boundary during typecheck', () => {
    function compileBoundary(index: SearchIndex, rawRequest: CapturedRequest): void {
      // @ts-expect-error Search must never index pre-redaction data.
      index.add(rawRequest);
    }
    void compileBoundary;
    expect(true).toBe(true);
  });
});
