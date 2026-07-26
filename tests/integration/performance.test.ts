import { describe, expect, it } from 'vitest';

import { DEFAULT_REDACTION_CONFIG, redactSession } from '../../src/domain/redaction';
import { createSession, DEFAULT_LIMITS } from '../../src/domain/session';
import {
  createRecordingPipeline,
  type RecordingSink,
} from '../../src/features/capture/recording-pipeline';
import type { SanitizedCapturedRequest } from '../../src/domain/sanitized';
import { SearchIndex } from '../../src/features/session/search-index';
import { addBounded, freezeSession } from '../../src/domain/ring-buffer';
import type {
  CaptureEvent,
  CaptureObservation,
  CaptureSource,
} from '../../src/ports/capture-source';
import { observation } from '../helpers/har-factory';

const REQUEST_COUNT = 500;
const PIPELINE_BUDGET_MS = 500;
const INDEX_BUDGET_MS = 250;

class ReplayCapture implements CaptureSource {
  private listener: ((event: CaptureEvent) => void) | null = null;

  subscribe(listener: (event: CaptureEvent) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  async begin(): Promise<void> {}
  async reconcile(): Promise<void> {}
  visibility(): void {}
  async stop(): Promise<void> {}
  async dispose(): Promise<void> {}

  emit(value: CaptureObservation): void {
    this.listener?.({ type: 'observation', observation: value });
  }
}

class CountingSink implements RecordingSink {
  readonly accepted: SanitizedCapturedRequest[] = [];

  async accept(request: SanitizedCapturedRequest): Promise<void> {
    this.accepted.push(request);
  }

  acceptInteraction(): void {}

  warn(): void {}

  getSnapshot() {
    return { limits: DEFAULT_LIMITS };
  }
}

function makeObservations(count: number): CaptureObservation[] {
  return Array.from({ length: count }, (_, index) =>
    observation({
      startedDateTime: new Date(1_700_000_000_000 + index).toISOString(),
      request: {
        method: index % 3 === 0 ? 'POST' : 'GET',
        url: `https://app.test/api/items/${index}?token=secret-${index}&page=${index % 10}`,
        headers: [
          { name: 'authorization', value: `Bearer secret-${index}` },
          { name: 'accept', value: 'application/json' },
        ],
        postData: {
          mimeType: 'application/json',
          text: JSON.stringify({ password: `secret-${index}`, page: index % 10 }),
        },
      },
      response: {
        status: index % 17 === 0 ? 500 : 200,
        headers: [{ name: 'content-type', value: 'application/json' }],
        content: { mimeType: 'application/json', size: 64 },
      },
      content: {
        text: JSON.stringify({ id: index, token: `secret-${index}`, name: 'Ada' }),
        encoding: '',
        mimeType: 'application/json',
      },
    }),
  );
}

describe('capture pipeline performance', () => {
  it('normalizes, redacts, classifies, and explains 500 capped requests within budget', async () => {
    const capture = new ReplayCapture();
    const sink = new CountingSink();
    const pipeline = createRecordingPipeline({ capture, controller: sink });
    const batch = makeObservations(REQUEST_COUNT);
    await pipeline.start(1_000);

    const start = performance.now();
    for (const item of batch) capture.emit(item);
    await pipeline.stop(2_000);
    const elapsed = performance.now() - start;

    expect(sink.accepted).toHaveLength(REQUEST_COUNT);
    expect(JSON.stringify(sink.accepted)).not.toContain('secret-1');
    expect(elapsed).toBeLessThan(PIPELINE_BUDGET_MS);
  });

  it('indexes and queries 500 sanitized requests within budget', async () => {
    const capture = new ReplayCapture();
    const sink = new CountingSink();
    const pipeline = createRecordingPipeline({ capture, controller: sink });
    await pipeline.start(1_000);
    for (const item of makeObservations(REQUEST_COUNT)) capture.emit(item);
    await pipeline.stop(2_000);

    const start = performance.now();
    const index = new SearchIndex();
    for (const request of sink.accepted) index.add(request);
    const matches = index.query('items');
    const elapsed = performance.now() - start;

    expect(matches.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(INDEX_BUDGET_MS);
  });

  it('keeps the bounded session within its request and byte limits', async () => {
    const capture = new ReplayCapture();
    const sink = new CountingSink();
    const pipeline = createRecordingPipeline({ capture, controller: sink });
    await pipeline.start(1_000);
    for (const item of makeObservations(REQUEST_COUNT)) capture.emit(item);
    await pipeline.stop(2_000);

    let session = freezeSession(
      redactSession(
        createSession('tab-perf', 'https://app.test', 1_000),
        DEFAULT_REDACTION_CONFIG,
      ),
    );
    for (const request of sink.accepted) session = addBounded(session, request);

    expect(session.requests.length).toBeLessThanOrEqual(DEFAULT_LIMITS.maxRequests);
    expect(session.byteCount).toBeLessThanOrEqual(DEFAULT_LIMITS.maxBytes);
  });
});
