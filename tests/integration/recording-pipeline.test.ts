import { describe, expect, it } from 'vitest';

import type {
  CapturedRequest,
  Classification,
  Explanation,
  SessionLimits,
} from '../../src/domain/model';
import { DEFAULT_REDACTION_CONFIG, redactSession } from '../../src/domain/redaction';
import { freezeSession } from '../../src/domain/ring-buffer';
import type { SanitizedCapturedRequest } from '../../src/domain/sanitized';
import { createSession } from '../../src/domain/session';
import {
  createRecordingPipeline,
  type RecordingSink,
} from '../../src/features/capture/recording-pipeline';
import { createSessionController } from '../../src/features/session/session-controller';
import type {
  CaptureEvent,
  CaptureObservation,
  CaptureOptions,
  CaptureSource,
} from '../../src/ports/capture-source';
import type { InteractionSource } from '../../src/ports/interaction-source';
import type { SessionRepository } from '../../src/ports/session-repository';
import { observation } from '../helpers/har-factory';

const LIMITS: SessionLimits = {
  maxRequests: 20,
  maxBytes: 100_000,
  maxBodyBytes: 10_000,
};

class ManualCapture implements CaptureSource {
  readonly listeners = new Set<(event: CaptureEvent) => void>();
  beginCalls: Array<readonly [number, CaptureOptions | undefined]> = [];
  stopCalls: number[] = [];

  subscribe(listener: (event: CaptureEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async begin(startedAt: number, options?: CaptureOptions): Promise<void> {
    this.beginCalls.push([startedAt, options]);
  }

  async reconcile(): Promise<void> {}

  visibility(): void {}

  async stop(stoppedAt: number): Promise<void> {
    this.stopCalls.push(stoppedAt);
  }

  async dispose(): Promise<void> {
    this.listeners.clear();
  }

  emit(event: CaptureEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

class MemorySink implements RecordingSink {
  readonly accepted: SanitizedCapturedRequest[] = [];
  readonly issues: Array<{ code: string; message: string; requestId?: string }> = [];

  constructor(private readonly limits: SessionLimits = LIMITS) {}

  async accept(request: SanitizedCapturedRequest): Promise<void> {
    this.accepted.push(request);
  }

  warn(issue: { code: string; message: string; requestId?: string }): void {
    this.issues.push(issue);
  }

  getSnapshot(): Readonly<{ limits: SessionLimits }> {
    return { limits: this.limits };
  }
}

function secretObservation(): CaptureObservation {
  return observation({
    startedDateTime: '2023-11-14T22:13:20.000Z',
    request: {
      method: 'POST',
      url: 'https://app.test/save?token=query-secret',
      headers: [{ name: 'Authorization', value: 'Bearer header-secret' }],
      postData: {
        mimeType: 'application/json',
        text: '{"password":"body-secret","safe":"ok"}',
      },
    },
    response: {
      status: 200,
      headers: [{ name: 'Set-Cookie', value: 'session=response-secret' }],
      content: { mimeType: 'application/json', size: 27 },
    },
    content: {
      text: '{"token":"response-body-secret"}',
      encoding: '',
      mimeType: 'application/json',
    },
  });
}

describe('recording pipeline', () => {
  it('composes with the real session controller contract', async () => {
    const capture = new ManualCapture();
    let saved = freezeSession(
      redactSession(
        {
          ...createSession('tab-7', 'https://app.test', 1_000),
          limits: LIMITS,
        },
        DEFAULT_REDACTION_CONFIG,
      ),
    );
    const repository: SessionRepository = {
      async load() {
        return saved;
      },
      async loadCurrent() {
        return saved;
      },
      async save(session) {
        saved = session;
      },
      async clear() {},
    };
    const controller = createSessionController({
      initialSession: saved,
      repositories: { ephemeral: repository, persistent: repository },
    });
    const pipeline = createRecordingPipeline({
      capture,
      controller,
      clock: () => 1_000,
    });

    await pipeline.start(1_000);
    capture.emit({ type: 'observation', observation: secretObservation() });
    await pipeline.stop(2_000);

    expect(controller.getSnapshot().requests).toHaveLength(1);
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('query-secret');
  });

  it('coordinates optional interaction lifecycle from explicit start context', async () => {
    const capture = new ManualCapture();
    const sink = new MemorySink();
    const calls: string[] = [];
    let releaseCapture!: () => void;
    const captureStarted = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    capture.begin = () => {
      calls.push('capture:start');
      return captureStarted;
    };
    capture.stop = async () => {
      calls.push('capture:stop');
    };
    const interactions: InteractionSource = {
      async start(context) {
        calls.push(`interactions:start:${context.tabId}:${context.url}`);
        return {
          status: 'active',
          tabId: context.tabId,
          origin: 'https://app.test',
          documentId: 'document-1',
          leaseId: 'lease-1',
        };
      },
      async stop() {
        calls.push('interactions:stop');
      },
      subscribe() {
        return () => undefined;
      },
    };
    const pipeline = createRecordingPipeline({
      capture,
      interactions,
      controller: sink,
    });

    const starting = pipeline.start(1_000, {
      interaction: { tabId: 7, url: 'https://app.test/page' },
    });
    await Promise.resolve();
    expect(calls).toEqual([
      'capture:start',
      'interactions:start:7:https://app.test/page',
    ]);
    releaseCapture();
    await starting;
    await pipeline.stop(2_000);

    expect(calls).toEqual([
      'capture:start',
      'interactions:start:7:https://app.test/page',
      'capture:stop',
      'interactions:stop',
    ]);
  });

  it('warns for network-only interaction startup without treating it as active', async () => {
    const capture = new ManualCapture();
    const sink = new MemorySink();
    let stops = 0;
    const interactions: InteractionSource = {
      async start() {
        return {
          status: 'network-only',
          reason: 'permission-denied',
        };
      },
      async stop() {
        stops += 1;
      },
      subscribe() {
        return () => undefined;
      },
    };
    const pipeline = createRecordingPipeline({
      capture,
      interactions,
      controller: sink,
    });

    await pipeline.start(1_000, {
      interaction: { tabId: 7, url: 'https://app.test/page' },
    });
    await pipeline.stop(2_000);

    expect(stops).toBe(0);
    expect(sink.issues).toContainEqual({
      code: 'interaction-start-failed',
      message: 'Interaction capture was unavailable; network capture continued.',
    });
  });

  it('cancels queued evidence and capture when startup fails after emission', async () => {
    const capture = new ManualCapture();
    const sink = new MemorySink();
    capture.begin = async () => {
      capture.emit({ type: 'observation', observation: secretObservation() });
      throw new Error('startup failed');
    };
    const pipeline = createRecordingPipeline({
      capture,
      controller: sink,
    });

    await expect(pipeline.start(1_000)).rejects.toThrow('startup failed');

    expect(capture.stopCalls).toHaveLength(1);
    expect(capture.listeners.size).toBe(0);
    expect(sink.accepted).toEqual([]);
  });

  it('subscribes before capture begins and forwards explicit lifecycle timestamps', async () => {
    const capture = new ManualCapture();
    const sink = new MemorySink();
    let subscribedAtBegin = false;
    capture.begin = async (startedAt, options) => {
      subscribedAtBegin = capture.listeners.size === 1;
      capture.beginCalls.push([startedAt, options]);
    };
    const pipeline = createRecordingPipeline({
      capture,
      controller: sink,
      clock: () => 9_999,
    });

    await pipeline.start(1_000, { capture: { includeStatic: true } });
    await pipeline.stop(2_000);

    expect(subscribedAtBegin).toBe(true);
    expect(capture.beginCalls).toEqual([[1_000, { includeStatic: true }]]);
    expect(capture.stopCalls).toEqual([2_000]);
    expect(capture.listeners.size).toBe(0);
  });

  it('redacts and brands before classification, explanation, and sink acceptance', async () => {
    const capture = new ManualCapture();
    const sink = new MemorySink();
    const classifiedInputs: CapturedRequest[] = [];
    const explainedInputs: CapturedRequest[] = [];
    const pipeline = createRecordingPipeline({
      capture,
      controller: sink,
      idFactory: () => 'req-opaque-1',
      classify(request) {
        classifiedInputs.push(request);
        throw new Error('Bearer classify-secret');
      },
      explain(request) {
        explainedInputs.push(request);
        throw new Error('Bearer explain-secret');
      },
    });
    await pipeline.start(1_000);

    capture.emit({ type: 'observation', observation: secretObservation() });
    await pipeline.stop(2_000);

    expect(sink.accepted).toHaveLength(1);
    expect(sink.accepted[0]).toMatchObject({
      id: 'req-opaque-1',
      classification: {
        kind: 'unknown',
        confidence: 'unknown',
        evidence: [],
      },
      explanation: {
        outcome: 'unknown',
        summary: 'Request analysis was unavailable.',
        guidance: [],
        evidence: [],
      },
    });
    const serialized = JSON.stringify({
      accepted: sink.accepted,
      classifiedInputs,
      explainedInputs,
      issues: sink.issues,
    });
    for (const secret of [
      'query-secret',
      'header-secret',
      'body-secret',
      'response-secret',
      'response-body-secret',
      'classify-secret',
      'explain-secret',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(sink.issues.map((issue) => issue.code)).toEqual([
      'classification-failed',
      'explanation-failed',
    ]);
  });

  it('uses only previously sanitized requests for explanation', async () => {
    const capture = new ManualCapture();
    const sink = new MemorySink();
    const relatedSeen: readonly SanitizedCapturedRequest[][] = [];
    const pipeline = createRecordingPipeline({
      capture,
      controller: sink,
      idFactory: (() => {
        let sequence = 0;
        return () => `req-${++sequence}`;
      })(),
      explain(_request, related): Explanation {
        (relatedSeen as SanitizedCapturedRequest[][]).push([...related]);
        return {
          outcome: 'success',
          summary: 'Safe explanation.',
          guidance: [],
          evidence: [],
        };
      },
    });
    await pipeline.start(1_000);

    capture.emit({ type: 'observation', observation: secretObservation() });
    capture.emit({ type: 'observation', observation: secretObservation() });
    await pipeline.stop(2_000);

    expect(relatedSeen.map((related) => related.map((request) => request.id))).toEqual([
      [],
      ['req-1'],
    ]);
    expect(JSON.stringify(relatedSeen)).not.toContain('body-secret');
  });

  it('bounds sanitized explanation history to the session request cap', async () => {
    const capture = new ManualCapture();
    const sink = new MemorySink({ ...LIMITS, maxRequests: 2 });
    const relatedIds: string[][] = [];
    let sequence = 0;
    const pipeline = createRecordingPipeline({
      capture,
      controller: sink,
      idFactory: () => `req-${++sequence}`,
      explain(_request, related): Explanation {
        relatedIds.push(related.map((request) => request.id));
        return {
          outcome: 'success',
          summary: 'Safe explanation.',
          guidance: [],
          evidence: [],
        };
      },
    });
    await pipeline.start(1_000);

    for (let index = 0; index < 4; index += 1) {
      capture.emit({ type: 'observation', observation: secretObservation() });
    }
    await pipeline.stop(2_000);

    expect(relatedIds).toEqual([[], ['req-1'], ['req-1', 'req-2'], ['req-2', 'req-3']]);
  });

  it('isolates normalization faults and continues the serialized queue', async () => {
    const capture = new ManualCapture();
    const sink = new MemorySink();
    let calls = 0;
    const pipeline = createRecordingPipeline({
      capture,
      controller: sink,
      idFactory: () => 'opaque',
      normalize(observed, limits, id): CapturedRequest {
        calls += 1;
        if (calls === 1) throw new Error('Bearer normalize-secret');
        const raw = secretObservation();
        return {
          id,
          url: (raw.entry as { request: { url: string } }).request.url,
          method: 'GET',
          startedAt: observed.observedAt,
          request: { headers: [] },
          response: {
            status: limits.maxRequests,
            headers: [],
            body: { state: 'available', size: 0, capturedSize: 0, text: '' },
          },
          timing: { totalMs: 0 },
          evidence: {},
        };
      },
    });
    await pipeline.start(1_000);

    capture.emit({ type: 'observation', observation: secretObservation() });
    capture.emit({ type: 'observation', observation: secretObservation() });
    await pipeline.stop(2_000);

    expect(calls).toBe(2);
    expect(sink.accepted).toHaveLength(1);
    expect(sink.issues).toContainEqual({
      code: 'normalization-failed',
      message: 'A captured request could not be normalized and was skipped.',
    });
    expect(JSON.stringify(sink.issues)).not.toContain('normalize-secret');
  });

  it('turns trusted redaction failure into fixed generic sanitized evidence', async () => {
    const capture = new ManualCapture();
    const sink = new MemorySink();
    const hostile = new Proxy(
      {
        id: 'GET:https://app.test?token=proxy-secret',
        url: 'https://app.test?token=proxy-secret',
        method: 'GET',
        startedAt: 1_000,
        request: { headers: [] },
        response: {
          status: 200,
          headers: [],
          body: { state: 'available' as const, size: 0, capturedSize: 0 },
        },
        timing: { totalMs: 1 },
        evidence: {},
      },
      {
        ownKeys() {
          throw new Error('Bearer proxy-secret');
        },
      },
    );
    const pipeline = createRecordingPipeline({
      capture,
      controller: sink,
      normalize: () => hostile,
    });
    await pipeline.start(1_000);

    capture.emit({ type: 'observation', observation: secretObservation() });
    await pipeline.stop(2_000);

    expect(sink.accepted[0]).toMatchObject({
      method: 'UNKNOWN',
      classification: {
        kind: 'unknown',
        confidence: 'unknown',
        evidence: [],
      },
      explanation: {
        outcome: 'unknown',
        summary: 'Request analysis was unavailable.',
      },
    });
    expect(sink.issues).toContainEqual({
      code: 'redaction-failed',
      message: 'A captured request failed closed during redaction.',
    });
    expect(
      JSON.stringify({ accepted: sink.accepted, issues: sink.issues }),
    ).not.toContain('proxy-secret');
  });

  it('converts source validation issues to warnings and drains async acceptance on stop', async () => {
    const capture = new ManualCapture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sink = new MemorySink();
    sink.accept = async (request) => {
      await gate;
      sink.accepted.push(request);
    };
    const pipeline = createRecordingPipeline({
      capture,
      controller: sink,
      idFactory: () => 'opaque',
    });
    await pipeline.start(1_000);
    capture.emit({
      type: 'issue',
      issue: {
        code: 'invalid-started-time',
        message: 'A network entry was skipped because its start time was invalid.',
      },
    });
    capture.emit({ type: 'observation', observation: secretObservation() });

    let stopped = false;
    const stopping = pipeline.stop(2_000).then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;

    expect(sink.accepted).toHaveLength(1);
    expect(sink.issues).toContainEqual({
      code: 'invalid-started-time',
      message: 'A network entry was skipped because its start time was invalid.',
    });
  });

  it('falls back to generic unknown analysis when stages return malformed values', async () => {
    const capture = new ManualCapture();
    const sink = new MemorySink();
    const pipeline = createRecordingPipeline({
      capture,
      controller: sink,
      idFactory: () => 'opaque',
      classify: () =>
        ({ kind: '', confidence: 'unknown', evidence: [] }) as Classification,
      explain: () =>
        ({ outcome: '', summary: '', guidance: [], evidence: [] }) as Explanation,
    });
    await pipeline.start(1_000);

    capture.emit({ type: 'observation', observation: secretObservation() });
    await pipeline.stop(2_000);

    expect(sink.accepted[0]?.classification?.kind).toBe('unknown');
    expect(sink.accepted[0]?.explanation?.summary).toBe(
      'Request analysis was unavailable.',
    );
    expect(sink.issues.map((issue) => issue.code)).toEqual([
      'classification-failed',
      'explanation-failed',
    ]);
  });
});
