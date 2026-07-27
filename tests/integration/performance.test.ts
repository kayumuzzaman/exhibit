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
import { createSessionController } from '../../src/features/session/session-controller';
import {
  createSessionStorageRepository,
  type StorageArea,
} from '../../src/infrastructure/storage/session-storage-repository';
import { observation } from '../helpers/har-factory';

const REQUEST_COUNT = 500;
const PIPELINE_BUDGET_MS = 500;
const INDEX_BUDGET_MS = 250;
/**
 * The persisted budget is deliberately close to the in-memory pipeline budget.
 * Storage writes are debounced, so a controller that waits for each write would
 * cap capture at the debounce rate and blow past this by two orders of
 * magnitude rather than by a few percent.
 */
const PERSISTED_BUDGET_MS = 2_000;
const ATTEMPTS = 3;

/**
 * Wall-clock budgets measure the code, not the machine. Under a loaded release
 * gate an unlucky run can be descheduled mid-measurement, so the fastest of a
 * few attempts is compared against the budget.
 */
async function fastest(attempt: () => Promise<number>): Promise<number> {
  let best = Number.POSITIVE_INFINITY;
  for (let run = 0; run < ATTEMPTS; run += 1) {
    best = Math.min(best, await attempt());
  }
  return best;
}

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

class MemoryStorageArea implements StorageArea {
  readonly values = new Map<string, unknown>();
  writes = 0;

  async get(key: string): Promise<Record<string, unknown>> {
    return this.values.has(key) ? { [key]: this.values.get(key) } : {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.writes += 1;
    for (const [key, value] of Object.entries(items)) {
      this.values.set(key, value);
    }
  }

  async remove(): Promise<void> {}
}

describe('capture pipeline performance', () => {
  it('normalizes, redacts, classifies, and explains 500 capped requests within budget', async () => {
    let lastSink = new CountingSink();
    const elapsed = await fastest(async () => {
      const capture = new ReplayCapture();
      lastSink = new CountingSink();
      const pipeline = createRecordingPipeline({ capture, controller: lastSink });
      const batch = makeObservations(REQUEST_COUNT);
      await pipeline.start(1_000);

      const start = performance.now();
      for (const item of batch) capture.emit(item);
      await pipeline.stop(2_000);
      return performance.now() - start;
    });

    expect(lastSink.accepted).toHaveLength(REQUEST_COUNT);
    expect(JSON.stringify(lastSink.accepted)).not.toContain('secret-1');
    expect(elapsed).toBeLessThan(PIPELINE_BUDGET_MS);
  });

  it('indexes and queries 500 sanitized requests within budget', async () => {
    const capture = new ReplayCapture();
    const sink = new CountingSink();
    const pipeline = createRecordingPipeline({ capture, controller: sink });
    await pipeline.start(1_000);
    for (const item of makeObservations(REQUEST_COUNT)) capture.emit(item);
    await pipeline.stop(2_000);

    let matched = 0;
    const elapsed = await fastest(async () => {
      const start = performance.now();
      const index = new SearchIndex();
      for (const request of sink.accepted) index.add(request);
      matched = index.query('items').length;
      return performance.now() - start;
    });

    expect(matched).toBeGreaterThan(0);
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

describe('persisted capture performance', () => {
  it('captures 500 requests into a real repository-backed session within budget', async () => {
    let area = new MemoryStorageArea();
    let captured = 0;
    const elapsed = await fastest(async () => {
      area = new MemoryStorageArea();
      const capture = new ReplayCapture();
      const controller = createSessionController({
        initialSession: freezeSession(
          redactSession(
            {
              ...createSession('tab-perf', 'https://app.test', 1_000),
              phase: 'stopped',
            },
            DEFAULT_REDACTION_CONFIG,
          ),
        ),
        repositories: {
          ephemeral: createSessionStorageRepository(area),
          persistent: createSessionStorageRepository(area),
        },
      });
      const pipeline = createRecordingPipeline({ capture, controller });
      const batch = makeObservations(REQUEST_COUNT);
      await pipeline.start(1_000);

      const start = performance.now();
      for (const item of batch) capture.emit(item);
      await pipeline.stop(2_000);
      captured = controller.getSnapshot().requests.length;
      return performance.now() - start;
    });

    expect(captured).toBe(REQUEST_COUNT);
    // Coalescing is the point: a write per request would mean 500 here.
    expect(area.writes).toBeLessThan(REQUEST_COUNT / 4);
    expect(elapsed).toBeLessThan(PERSISTED_BUDGET_MS);
  });
});
