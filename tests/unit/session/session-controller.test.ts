import { describe, expect, it, vi } from 'vitest';

import type { RecordingPhase, RetentionMode } from '../../../src/domain/model';
import { redactSession, DEFAULT_REDACTION_CONFIG } from '../../../src/domain/redaction';
import { freezeSession } from '../../../src/domain/ring-buffer';
import type { SanitizedRecordingSession } from '../../../src/domain/sanitized';
import { createSession } from '../../../src/domain/session';
import {
  createSessionController,
  type SessionLifecycle,
} from '../../../src/features/session/session-controller';
import { reduceSession } from '../../../src/features/session/session-reducer';
import type { SessionRepository } from '../../../src/ports/session-repository';
import { sanitizedRequestWith as requestWith } from '../../helpers/request-factory';

class MemoryRepository implements SessionRepository {
  readonly calls: string[];
  value: SanitizedRecordingSession | null = null;
  saveError: unknown | null = null;
  clearError: unknown | null = null;
  saveGate: Promise<void> | null = null;
  clearGate: Promise<void> | null = null;

  constructor(
    private readonly name: string,
    calls: string[] = [],
  ) {
    this.calls = calls;
  }

  async load(): Promise<SanitizedRecordingSession | null> {
    return this.value;
  }

  async loadCurrent(tabId: string): Promise<SanitizedRecordingSession | null> {
    return this.value?.tabId === tabId ? this.value : null;
  }

  async save(session: SanitizedRecordingSession): Promise<void> {
    this.calls.push(`${this.name}:save:${session.retention}`);
    if (this.saveGate !== null) {
      await this.saveGate;
    }
    if (this.saveError !== null) {
      throw this.saveError;
    }
    this.value = structuredClone(session);
  }

  async clear(): Promise<void> {
    this.calls.push(`${this.name}:clear`);
    if (this.clearError !== null) {
      throw this.clearError;
    }
    if (this.clearGate !== null) {
      await this.clearGate;
    }
    this.value = null;
  }
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function initialSession(
  phase: RecordingPhase = 'stopped',
  retention: RetentionMode = 'ephemeral',
): SanitizedRecordingSession {
  return freezeSession(
    redactSession(
      {
        ...createSession('tab-5', 'https://app.test', 1_000),
        phase,
        retention,
        startedAt: phase === 'stopped' ? null : 1_000,
      },
      DEFAULT_REDACTION_CONFIG,
    ),
  );
}

function controllerFixture(
  options: {
    phase?: RecordingPhase;
    lifecycle?: SessionLifecycle;
    ephemeral?: MemoryRepository;
    persistent?: MemoryRepository;
    now?: () => number;
  } = {},
) {
  const ephemeral = options.ephemeral ?? new MemoryRepository('ephemeral');
  const persistent = options.persistent ?? new MemoryRepository('persistent');
  const controller = createSessionController({
    initialSession: initialSession(options.phase),
    repositories: { ephemeral, persistent },
    ...(options.lifecycle === undefined ? {} : { lifecycle: options.lifecycle }),
    clock: options.now ?? (() => 2_000),
  });
  return { controller, ephemeral, persistent };
}

describe('session controller lifecycle', () => {
  it('stores distinct fixed capture issues without caller text or raw identifiers', () => {
    const { controller } = controllerFixture();

    controller.warn({
      code: 'classification-failed',
      message: 'Bearer warning-secret',
      requestId: 'GET:https://app.test?token=id-secret',
    });
    controller.warn({
      code: 'explanation-failed',
      message: 'Bearer second-secret',
    });

    expect(controller.getSnapshot().warnings).toEqual([
      {
        code: 'classification-failed',
        message: 'Request classification was unavailable.',
      },
      {
        code: 'explanation-failed',
        message: 'Request explanation was unavailable.',
      },
    ]);
    expect(JSON.stringify(controller.getSnapshot().warnings)).not.toMatch(
      /warning-secret|second-secret|id-secret/u,
    );
  });

  it('uses safe default lifecycle and clock dependencies', async () => {
    const repository = new MemoryRepository('shared');
    const controller = createSessionController({
      initialSession: initialSession(),
      repositories: { ephemeral: repository, persistent: repository },
    });

    await controller.start();
    const recording = controller.getSnapshot();
    await controller.start();
    expect(controller.getSnapshot()).toBe(recording);

    await controller.stop();
    expect(controller.getSnapshot().phase).toBe('stopped');
    expect(controller.getSnapshot().startedAt).toEqual(expect.any(Number));
  });

  it('persists successful Start and Stop phases with fresh timestamps', async () => {
    let now = 2_000;
    const ephemeral = new MemoryRepository('ephemeral');
    const { controller } = controllerFixture({
      ephemeral,
      now: () => now,
    });

    await controller.start();
    expect(ephemeral.value).toMatchObject({
      phase: 'recording',
      startedAt: 2_000,
      stoppedAt: null,
    });

    now = 3_000;
    await controller.stop();
    expect(ephemeral.value).toMatchObject({
      phase: 'stopped',
      startedAt: 2_000,
      stoppedAt: 3_000,
    });
  });

  it('keeps lifecycle state in memory and warns when phase persistence fails', async () => {
    const ephemeral = new MemoryRepository('ephemeral');
    ephemeral.saveError = new Error('quota');
    const { controller } = controllerFixture({ ephemeral });

    await expect(controller.start()).resolves.toBeUndefined();

    expect(controller.getSnapshot().phase).toBe('recording');
    expect(controller.getSnapshot().warnings).toContainEqual(
      expect.objectContaining({ code: 'persistence-disabled' }),
    );
  });

  it('does not retry lifecycle persistence while disabled before Clear', async () => {
    const ephemeral = new MemoryRepository('ephemeral');
    ephemeral.saveError = new Error('quota');
    const { controller } = controllerFixture({ ephemeral });
    await controller.accept(requestWith({ id: 'disable-persistence' }));
    const calls = ephemeral.calls.length;
    ephemeral.saveError = null;

    await controller.start();

    expect(controller.getSnapshot().phase).toBe('recording');
    expect(ephemeral.calls).toHaveLength(calls);
  });

  it('serializes stopped → starting → recording and duplicate starts', async () => {
    const gate = deferred();
    const lifecycle = {
      start: vi.fn(() => gate.promise),
      stop: vi.fn(async () => undefined),
    };
    const { controller } = controllerFixture({ lifecycle });

    const first = controller.start();
    const second = controller.start();
    expect(controller.getSnapshot().phase).toBe('starting');
    expect(lifecycle.start).toHaveBeenCalledTimes(1);

    gate.resolve();
    await Promise.all([first, second]);
    expect(controller.getSnapshot().phase).toBe('recording');
    expect(controller.getSnapshot().startedAt).toBe(2_000);
    expect(lifecycle.start).toHaveBeenCalledTimes(1);
  });

  it('serializes recording → stopping → stopped and duplicate stops', async () => {
    const gate = deferred();
    const lifecycle = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(() => gate.promise),
    };
    const { controller } = controllerFixture({
      phase: 'recording',
      lifecycle,
    });

    const first = controller.stop();
    const second = controller.stop();
    expect(controller.getSnapshot().phase).toBe('stopping');
    expect(lifecycle.stop).toHaveBeenCalledTimes(1);

    gate.resolve();
    await Promise.all([first, second]);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'stopped',
      stoppedAt: 2_000,
    });
    expect(lifecycle.stop).toHaveBeenCalledTimes(1);
  });

  it('restores a safe phase and warning when lifecycle startup fails', async () => {
    const lifecycle = {
      start: vi.fn(async () => {
        throw new Error('capture unavailable');
      }),
      stop: vi.fn(async () => undefined),
    };
    const { controller } = controllerFixture({ lifecycle });

    await expect(controller.start()).rejects.toThrow('capture unavailable');

    expect(controller.getSnapshot().phase).toBe('stopped');
    expect(controller.getSnapshot().warnings).toContainEqual(
      expect.objectContaining({ code: 'capture-failed' }),
    );
  });

  it('queues stop requested during startup, then tears down once', async () => {
    const gate = deferred();
    const lifecycle = {
      start: vi.fn(() => gate.promise),
      stop: vi.fn(async () => undefined),
    };
    const { controller } = controllerFixture({ lifecycle });

    const starting = controller.start();
    const stopping = controller.stop();
    gate.resolve();
    await Promise.all([starting, stopping]);

    expect(controller.getSnapshot().phase).toBe('stopped');
    expect(lifecycle.start).toHaveBeenCalledTimes(1);
    expect(lifecycle.stop).toHaveBeenCalledTimes(1);
  });

  it('makes stop during failed startup a safe no-op', async () => {
    const gate = deferred();
    const lifecycle = {
      start: vi.fn(() => gate.promise),
      stop: vi.fn(async () => undefined),
    };
    const { controller } = controllerFixture({ lifecycle });

    const starting = controller.start();
    const stopping = controller.stop();
    gate.reject(new Error('startup failed'));
    await expect(starting).rejects.toThrow('startup failed');
    await expect(stopping).resolves.toBeUndefined();

    expect(controller.getSnapshot().phase).toBe('stopped');
    expect(lifecycle.stop).not.toHaveBeenCalled();
  });

  it('queues start requested during shutdown', async () => {
    const gate = deferred();
    const lifecycle = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(() => gate.promise),
    };
    const { controller } = controllerFixture({
      phase: 'recording',
      lifecycle,
    });

    const stopping = controller.stop();
    const starting = controller.start();
    gate.resolve();
    await Promise.all([stopping, starting]);

    expect(controller.getSnapshot().phase).toBe('recording');
    expect(lifecycle.stop).toHaveBeenCalledTimes(1);
    expect(lifecycle.start).toHaveBeenCalledTimes(1);
  });

  it('handles recovered transitional phases without in-flight promises', async () => {
    const lifecycle = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    const starting = controllerFixture({
      phase: 'starting',
      lifecycle,
    }).controller;
    const stopping = controllerFixture({
      phase: 'stopping',
      lifecycle,
    }).controller;

    await starting.stop();
    await stopping.start();

    expect(starting.getSnapshot().phase).toBe('stopped');
    expect(stopping.getSnapshot().phase).toBe('recording');
  });

  it('stops safely and reports non-Error lifecycle failures', async () => {
    const lifecycle = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => {
        throw 'stop failed';
      }),
    };
    const { controller } = controllerFixture({
      phase: 'recording',
      lifecycle,
    });

    await expect(controller.stop()).rejects.toBe('stop failed');

    expect(controller.getSnapshot().phase).toBe('stopped');
    expect(controller.getSnapshot().warnings).toContainEqual({
      code: 'capture-failed',
      message: 'Capture lifecycle failed.',
    });
  });

  it('deduplicates repeated warnings without replacing a stable snapshot', async () => {
    const lifecycle = {
      start: vi.fn(async () => {
        throw new Error('same failure');
      }),
      stop: vi.fn(async () => undefined),
    };
    const { controller } = controllerFixture({ lifecycle });

    await expect(controller.start()).rejects.toThrow('same failure');
    await expect(controller.start()).rejects.toThrow('same failure');

    expect(
      controller.getSnapshot().warnings.filter(({ code }) => code === 'capture-failed'),
    ).toHaveLength(1);
  });

  it('stops capture before clearing repository and in-memory evidence', async () => {
    const calls: string[] = [];
    const ephemeral = new MemoryRepository('ephemeral', calls);
    const lifecycle = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => {
        calls.push('lifecycle:stop');
      }),
    };
    const { controller } = controllerFixture({
      phase: 'recording',
      lifecycle,
      ephemeral,
    });
    await controller.accept(requestWith({ id: 'evidence' }));
    calls.length = 0;

    await controller.clear();

    expect(calls).toEqual(['lifecycle:stop', 'ephemeral:clear']);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'stopped',
      requests: [],
      byteCount: 0,
      evictedCount: 0,
    });
  });

  it('coalesces concurrent clear calls', async () => {
    const gate = deferred();
    const ephemeral = new MemoryRepository('ephemeral');
    ephemeral.clearGate = gate.promise;
    const { controller } = controllerFixture({ ephemeral });

    const first = controller.clear();
    const second = controller.clear();
    expect(second).toBe(first);
    gate.resolve();
    await Promise.all([first, second]);

    expect(ephemeral.calls).toEqual(['ephemeral:clear']);
  });

  it('queues a new Start until Clear has stopped capture and removed evidence', async () => {
    const calls: string[] = [];
    const gate = deferred();
    const ephemeral = new MemoryRepository('ephemeral', calls);
    const lifecycle = {
      start: vi.fn(async () => {
        calls.push('lifecycle:start');
      }),
      stop: vi.fn(async () => {
        calls.push('lifecycle:stop');
        await gate.promise;
      }),
    };
    const { controller } = controllerFixture({
      phase: 'recording',
      lifecycle,
      ephemeral,
    });

    const clearing = controller.clear();
    const starting = controller.start();
    expect(controller.getSnapshot().phase).toBe('stopping');
    gate.resolve();
    await Promise.all([clearing, starting]);

    expect(calls).toEqual([
      'lifecycle:stop',
      'ephemeral:clear',
      'lifecycle:start',
      'ephemeral:save:ephemeral',
    ]);
    expect(controller.getSnapshot().phase).toBe('recording');
    expect(controller.getSnapshot().requests).toEqual([]);
  });

  it('clears bounded memory and reports a non-Error repository failure', async () => {
    const ephemeral = new MemoryRepository('ephemeral');
    ephemeral.clearError = 'clear failed';
    const { controller } = controllerFixture({ ephemeral });
    await controller.accept(requestWith({ id: 'evidence' }));

    await controller.clear();

    expect(controller.getSnapshot().requests).toEqual([]);
    expect(controller.getSnapshot().warnings).toContainEqual({
      code: 'persistence-disabled',
      message: 'Local persistence was disabled after a storage failure.',
    });
  });

  it('continues Clear after lifecycle teardown rejects', async () => {
    const ephemeral = new MemoryRepository('ephemeral');
    const lifecycle = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => {
        throw new Error('teardown failed');
      }),
    };
    const { controller } = controllerFixture({
      phase: 'recording',
      lifecycle,
      ephemeral,
    });

    await expect(controller.clear()).resolves.toBeUndefined();

    expect(controller.getSnapshot().phase).toBe('stopped');
    expect(ephemeral.calls).toContain('ephemeral:clear');
  });

  it('clears the exact session from both repositories', async () => {
    const calls: string[] = [];
    const ephemeral = new MemoryRepository('ephemeral', calls);
    const persistent = new MemoryRepository('persistent', calls);
    const { controller } = controllerFixture({ ephemeral, persistent });
    await controller.accept(requestWith({ id: 'both-backends' }));
    persistent.value = structuredClone(controller.getSnapshot());
    calls.length = 0;

    await controller.clear();

    expect(calls).toEqual(['ephemeral:clear', 'persistent:clear']);
    expect(ephemeral.value).toBeNull();
    expect(persistent.value).toBeNull();
  });
});

describe('session controller persistence and observers', () => {
  it('keeps bounded memory and adds one structured warning when save rejects', async () => {
    const ephemeral = new MemoryRepository('ephemeral');
    ephemeral.saveError = new Error('quota');
    const { controller } = controllerFixture({ ephemeral });
    const safe = requestWith({ id: 'safe' });
    const stillSafe = requestWith({ id: 'still-safe' });

    await controller.accept(safe);
    await controller.accept(stillSafe);

    expect(controller.getSnapshot().requests.map(({ id }) => id)).toEqual([
      safe.id,
      stillSafe.id,
    ]);
    expect(controller.getSnapshot().warnings).toEqual([
      expect.objectContaining({
        code: 'persistence-disabled',
        message: expect.any(String),
      }),
    ]);
    expect(ephemeral.calls).toEqual(['ephemeral:save:ephemeral']);
  });

  it('uses a safe message when persistence rejects with a non-Error value', async () => {
    const ephemeral = new MemoryRepository('ephemeral');
    ephemeral.saveError = 'quota';
    const { controller } = controllerFixture({ ephemeral });

    await controller.accept(requestWith({ id: 'safe' }));

    expect(controller.getSnapshot().warnings).toContainEqual({
      code: 'persistence-disabled',
      message: 'Local persistence was disabled after a storage failure.',
    });
  });

  it('re-enables persistence after a fully successful Clear', async () => {
    const ephemeral = new MemoryRepository('ephemeral');
    const persistent = new MemoryRepository('persistent');
    ephemeral.saveError = new Error('quota');
    const { controller } = controllerFixture({ ephemeral, persistent });
    await controller.accept(requestWith({ id: 'failed-save' }));
    expect(controller.getSnapshot().warnings).toContainEqual(
      expect.objectContaining({ code: 'persistence-disabled' }),
    );
    ephemeral.saveError = null;
    ephemeral.calls.length = 0;

    await controller.clear();
    const persistedAfterClear = requestWith({ id: 'persisted-after-clear' });
    await controller.accept(persistedAfterClear);

    expect(ephemeral.calls).toEqual(['ephemeral:clear', 'ephemeral:save:ephemeral']);
    expect(
      controller
        .getSnapshot()
        .warnings.some(({ code }) => code === 'persistence-disabled'),
    ).toBe(false);
    expect(ephemeral.value?.requests[0]?.id).toBe(persistedAfterClear.id);
  });

  it('migrates retention by saving target before clearing the old backend', async () => {
    const calls: string[] = [];
    const ephemeral = new MemoryRepository('ephemeral', calls);
    const persistent = new MemoryRepository('persistent', calls);
    const { controller } = controllerFixture({ ephemeral, persistent });
    const redactedEvidence = requestWith({ id: 'redacted-evidence' });
    await controller.accept(redactedEvidence);
    calls.length = 0;

    await controller.setRetention('persistent');

    expect(calls).toEqual(['persistent:save:persistent', 'ephemeral:clear']);
    expect(controller.getSnapshot().retention).toBe('persistent');
    expect(persistent.value?.requests[0]?.id).toBe(redactedEvidence.id);
  });

  it('includes an immediately accepted record in a concurrent migration', async () => {
    const calls: string[] = [];
    const ephemeral = new MemoryRepository('ephemeral', calls);
    const persistent = new MemoryRepository('persistent', calls);
    const { controller } = controllerFixture({ ephemeral, persistent });
    const racingEvidence = requestWith({ id: 'racing-evidence' });

    const accepting = controller.accept(racingEvidence);
    const migrating = controller.setRetention('persistent');
    await Promise.all([accepting, migrating]);

    expect(controller.getSnapshot().retention).toBe('persistent');
    expect(persistent.value?.requests[0]?.id).toBe(racingEvidence.id);
    expect(ephemeral.value).toBeNull();
  });

  it('does not restart capture when Start queues behind an unrelated migration', async () => {
    const gate = deferred();
    const lifecycle = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    const persistent = new MemoryRepository('persistent');
    persistent.saveGate = gate.promise;
    const { controller } = controllerFixture({
      phase: 'recording',
      lifecycle,
      persistent,
    });

    const migrating = controller.setRetention('persistent');
    const starting = controller.start();
    gate.resolve();
    await Promise.all([migrating, starting]);

    expect(controller.getSnapshot().phase).toBe('recording');
    expect(lifecycle.start).not.toHaveBeenCalled();
  });

  it('retains the old backend and mode when target migration fails', async () => {
    const calls: string[] = [];
    const ephemeral = new MemoryRepository('ephemeral', calls);
    const persistent = new MemoryRepository('persistent', calls);
    persistent.saveError = new Error('disk full');
    const { controller } = controllerFixture({ ephemeral, persistent });

    await controller.setRetention('persistent');

    expect(controller.getSnapshot().retention).toBe('ephemeral');
    expect(calls).toEqual(['persistent:save:persistent', 'persistent:clear']);
    expect(controller.getSnapshot().warnings).toContainEqual(
      expect.objectContaining({ code: 'migration-failed' }),
    );
  });

  it('uses a safe migration message for a non-Error rejection', async () => {
    const persistent = new MemoryRepository('persistent');
    persistent.saveError = 'unavailable';
    const { controller } = controllerFixture({ persistent });

    await controller.setRetention('persistent');

    expect(controller.getSnapshot().warnings).toContainEqual({
      code: 'migration-failed',
      message: 'Retention migration failed; the previous mode remains active.',
    });
  });

  it('rolls back target evidence if clearing the old backend fails', async () => {
    const calls: string[] = [];
    const ephemeral = new MemoryRepository('ephemeral', calls);
    ephemeral.clearError = new Error('locked');
    const persistent = new MemoryRepository('persistent', calls);
    const { controller } = controllerFixture({ ephemeral, persistent });

    await controller.setRetention('persistent');

    expect(controller.getSnapshot().retention).toBe('ephemeral');
    expect(calls).toEqual([
      'persistent:save:persistent',
      'ephemeral:clear',
      'persistent:clear',
    ]);
    expect(persistent.value).toBeNull();
  });

  it('isolates a failed rollback cleanup', async () => {
    const ephemeral = new MemoryRepository('ephemeral');
    ephemeral.clearError = new Error('locked');
    const persistent = new MemoryRepository('persistent');
    persistent.clearError = new Error('rollback locked');
    const { controller } = controllerFixture({ ephemeral, persistent });

    await expect(controller.setRetention('persistent')).resolves.toBeUndefined();

    expect(controller.getSnapshot().retention).toBe('ephemeral');
    expect(controller.getSnapshot().warnings).toContainEqual(
      expect.objectContaining({ code: 'migration-cleanup-failed' }),
    );
  });

  it('does not clear a shared adapter after its own migration save fails', async () => {
    const shared = new MemoryRepository('shared');
    shared.saveError = new Error('offline');
    const controller = createSessionController({
      initialSession: initialSession(),
      repositories: { ephemeral: shared, persistent: shared },
      clock: () => 2_000,
    });

    await controller.setRetention('persistent');

    expect(shared.calls).toEqual(['shared:save:persistent']);
    expect(controller.getSnapshot().retention).toBe('ephemeral');
  });

  it('migrates safely when both retention modes share one adapter', async () => {
    const shared = new MemoryRepository('shared');
    const controller = createSessionController({
      initialSession: initialSession(),
      repositories: { ephemeral: shared, persistent: shared },
      clock: () => 2_000,
    });

    await controller.setRetention('persistent');

    expect(shared.calls).toEqual(['shared:save:persistent']);
    expect(shared.value?.retention).toBe('persistent');
    expect(controller.getSnapshot().retention).toBe('persistent');
  });

  it('surfaces failed rollback cleanup and removes residual target evidence on Clear', async () => {
    const ephemeral = new MemoryRepository('ephemeral');
    const persistent = new MemoryRepository('persistent');
    ephemeral.clearError = new Error('old backend locked');
    persistent.clearError = new Error('rollback cleanup locked');
    const { controller } = controllerFixture({ ephemeral, persistent });

    await controller.setRetention('persistent');

    expect(persistent.value?.retention).toBe('persistent');
    expect(controller.getSnapshot().warnings).toContainEqual(
      expect.objectContaining({
        code: 'migration-cleanup-failed',
        message: expect.stringMatching(/cleanup|residual/i),
      }),
    );

    ephemeral.clearError = null;
    persistent.clearError = null;
    await controller.clear();

    expect(ephemeral.value).toBeNull();
    expect(persistent.value).toBeNull();
    expect(controller.getSnapshot().warnings).toEqual([]);
  });

  it('uses bounded messages when migration and cleanup reject non-Errors', async () => {
    const ephemeral = new MemoryRepository('ephemeral');
    const persistent = new MemoryRepository('persistent');
    ephemeral.clearError = 'old clear failed';
    persistent.clearError = 'cleanup failed';
    const { controller } = controllerFixture({ ephemeral, persistent });

    await controller.setRetention('persistent');

    expect(controller.getSnapshot().warnings).toContainEqual({
      code: 'migration-cleanup-failed',
      message:
        'Retention migration and cleanup failed. Clear removes residual local evidence.',
    });
  });

  it('keeps rollback cleanup failure distinct from an earlier migration warning', async () => {
    const ephemeral = new MemoryRepository('ephemeral');
    const persistent = new MemoryRepository('persistent');
    persistent.saveError = new Error('initial target failure');
    const { controller } = controllerFixture({ ephemeral, persistent });

    await controller.setRetention('persistent');
    expect(controller.getSnapshot().warnings).toContainEqual(
      expect.objectContaining({ code: 'migration-failed' }),
    );

    persistent.saveError = null;
    ephemeral.clearError = new Error('old backend locked');
    persistent.clearError = new Error('cleanup locked');
    await controller.setRetention('persistent');

    expect(controller.getSnapshot().warnings).toContainEqual(
      expect.objectContaining({
        code: 'migration-cleanup-failed',
        message: expect.stringMatching(/residual/i),
      }),
    );
    expect(persistent.value?.retention).toBe('persistent');

    ephemeral.clearError = null;
    persistent.clearError = null;
    await controller.clear();
    expect(ephemeral.value).toBeNull();
    expect(persistent.value).toBeNull();
    expect(controller.getSnapshot().warnings).toEqual([]);
  });

  it('ignores a late old-backend save failure after migration succeeds', async () => {
    const gate = deferred();
    const ephemeral = new MemoryRepository('ephemeral');
    ephemeral.saveGate = gate.promise;
    ephemeral.saveError = new Error('old quota');
    const persistent = new MemoryRepository('persistent');
    const { controller } = controllerFixture({ ephemeral, persistent });

    const accepting = controller.accept(requestWith({ id: 'migrating' }));
    const migrating = controller.setRetention('persistent');
    await migrating;
    gate.resolve();
    await accepting;

    expect(controller.getSnapshot().retention).toBe('persistent');
    expect(
      controller
        .getSnapshot()
        .warnings.some(({ code }) => code === 'persistence-disabled'),
    ).toBe(false);
  });

  it('keeps stable immutable snapshots and isolates listener failures', async () => {
    const { controller } = controllerFixture();
    const healthy = vi.fn();
    const unsubscribeBroken = controller.subscribe(() => {
      throw new Error('listener bug');
    });
    const unsubscribeHealthy = controller.subscribe(healthy);
    const before = controller.getSnapshot();

    expect(controller.getSnapshot()).toBe(before);
    await controller.accept(requestWith({ id: 'notify' }));
    expect(healthy).toHaveBeenCalled();
    expect(Object.isFrozen(controller.getSnapshot())).toBe(true);
    expect(() => {
      (controller.getSnapshot().requests as unknown[]).pop();
    }).toThrow(TypeError);

    unsubscribeBroken();
    unsubscribeHealthy();
    const count = healthy.mock.calls.length;
    await controller.stop();
    expect(healthy).toHaveBeenCalledTimes(count);
  });

  it('treats same-mode retention and stopped stop as idempotent no-ops', async () => {
    const { controller, ephemeral, persistent } = controllerFixture();
    const snapshot = controller.getSnapshot();

    await controller.setRetention('ephemeral');
    await controller.stop();

    expect(controller.getSnapshot()).toBe(snapshot);
    expect(ephemeral.calls).toEqual([]);
    expect(persistent.calls).toEqual([]);
  });

  it('recovers the mutation queue after an unexpected dependency failure', async () => {
    let shouldThrow = true;
    const { controller } = controllerFixture({
      now: () => {
        if (shouldThrow) {
          shouldThrow = false;
          throw new Error('clock failed');
        }
        return 3_000;
      },
    });

    await expect(controller.clear()).rejects.toThrow('clock failed');
    const afterFailure = requestWith({ id: 'after-failure' });
    await expect(controller.accept(afterFailure)).resolves.toBeUndefined();

    expect(controller.getSnapshot().requests[0]?.id).toBe(afterFailure.id);
  });

  it('covers reducer no-op and already-stopped timestamp behavior directly', () => {
    const session = initialSession();
    const warning = {
      code: 'capture-failed' as const,
      message: 'known',
    };
    const warned = reduceSession(session, { type: 'warning', warning });
    const duplicate = reduceSession(warned, { type: 'warning', warning });
    const stopped = reduceSession(session, {
      type: 'phase',
      phase: 'stopped',
      at: 5_000,
    });

    expect(duplicate).toBe(warned);
    expect(stopped.stoppedAt).toBeNull();
  });
});
