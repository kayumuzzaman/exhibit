import { describe, expect, it } from 'vitest';

import type {
  CapturedRequest,
  Classification,
  Explanation,
} from '../../../src/domain/model';
import { DEFAULT_REDACTION_CONFIG, redactRequest } from '../../../src/domain/redaction';
import type { SanitizedCapturedRequest } from '../../../src/domain/sanitized';
import {
  createRecordingPipelineStages,
  type Result,
} from '../../../src/features/capture/recording-pipeline';
import type { CaptureIssue } from '../../../src/ports/capture-source';
import { observation } from '../../helpers/har-factory';
import { requestWith } from '../../helpers/request-factory';

const LIMITS = {
  maxRequests: 20,
  maxBytes: 100_000,
  maxBodyBytes: 3,
};

function acceptsResult<T>(result: Result<T, CaptureIssue>): void {
  void result;
}

describe('recording pipeline stage adapters', () => {
  it('returns typed Results for normalization/body policy and fixed failures', () => {
    const stages = createRecordingPipelineStages({
      normalize() {
        throw new Error('Bearer normalize-secret');
      },
      classify() {
        throw new Error('Bearer classify-secret');
      },
      explain() {
        throw new Error('Bearer explain-secret');
      },
    });
    const safe = redactRequest(
      requestWith({ id: 'GET-orders-alice42' }),
      DEFAULT_REDACTION_CONFIG,
    );

    const normalization = stages.normalize(observation(), LIMITS, 'raw-id');
    const classification = stages.classify(safe);
    const explanation = stages.explain(safe, []);
    acceptsResult<CapturedRequest>(normalization);
    acceptsResult<Classification>(classification);
    acceptsResult<Explanation>(explanation);

    expect(normalization).toEqual({
      ok: false,
      error: {
        code: 'normalization-failed',
        message: 'A captured request could not be normalized and was skipped.',
      },
    });
    expect(classification).toEqual({
      ok: false,
      error: {
        code: 'classification-failed',
        message: 'Request classification was unavailable.',
        requestId: safe.id,
      },
    });
    expect(explanation).toEqual({
      ok: false,
      error: {
        code: 'explanation-failed',
        message: 'Request explanation was unavailable.',
        requestId: safe.id,
      },
    });
    expect(JSON.stringify({ normalization, classification, explanation })).not.toMatch(
      /normalize-secret|classify-secret|explain-secret/u,
    );
  });

  it('flows body policy success and redaction failure through Result', () => {
    const stages = createRecordingPipelineStages();
    const normalized = stages.normalize(
      {
        ...observation({
          response: {
            status: 200,
            headers: [],
            content: { mimeType: 'application/json', size: 6 },
          },
        }),
        content: {
          text: 'abcdef',
          encoding: '',
          mimeType: 'application/json',
        },
      },
      LIMITS,
      'raw-id',
    );
    expect(normalized).toMatchObject({
      ok: true,
      value: {
        response: {
          body: { state: 'truncated', capturedSize: 3, text: 'abc' },
        },
      },
    });

    const hostile = new Proxy(requestWith({ id: 'GET-orders-alice42' }), {
      ownKeys() {
        throw new Error('Bearer redaction-secret');
      },
    });
    const redaction = stages.redact(hostile);
    acceptsResult<SanitizedCapturedRequest>(redaction);

    expect(redaction).toMatchObject({
      ok: false,
      error: {
        code: 'redaction-failed',
        message: 'A captured request failed closed during redaction.',
      },
      fallback: {
        method: 'UNKNOWN',
        response: { body: { reason: 'redaction-failed' } },
      },
    });
    expect(JSON.stringify(redaction)).not.toMatch(
      /GET-orders-alice42|redaction-secret/u,
    );
  });
});
