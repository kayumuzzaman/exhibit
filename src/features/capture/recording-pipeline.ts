import { classifyRequest } from '../../domain/classification';
import { explainRequest } from '../../domain/explanation';
import type {
  CapturedRequest,
  Classification,
  Explanation,
  SessionLimits,
} from '../../domain/model';
import { createRequestRedactor, redactInteractionEvent } from '../../domain/redaction';
import type {
  SanitizedCapturedRequest,
  SanitizedInteractionEvent,
} from '../../domain/sanitized';
import type { RedactionConfig } from '../settings/redaction-settings';
import { DEFAULT_REDACTION_CONFIG } from '../settings/redaction-settings';
import type {
  CaptureEvent,
  CaptureIssue,
  CaptureOptions,
  CaptureSource,
} from '../../ports/capture-source';
import type {
  InteractionSource,
  InteractionStartContext,
} from '../../ports/interaction-source';
import { normalizeObservation } from './normalize-har';

export type Result<T, E> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: E; fallback?: T }>;

export interface RecordingSink {
  accept(request: SanitizedCapturedRequest): Promise<void>;
  acceptInteraction(interaction: SanitizedInteractionEvent): void;
  warn(issue: CaptureIssue): void;
  getSnapshot(): Readonly<{ limits: SessionLimits }>;
}

export type RecordingPipelineDependencies = Readonly<{
  capture: CaptureSource;
  controller: RecordingSink;
  interactions?: InteractionSource;
  redactionConfig?: RedactionConfig;
  clock?: () => number;
  idFactory?: () => string;
  normalize?: (
    observation: Parameters<typeof normalizeObservation>[0],
    limits: SessionLimits,
    id: string,
  ) => CapturedRequest;
  classify?: (request: SanitizedCapturedRequest) => Classification;
  explain?: (
    request: SanitizedCapturedRequest,
    related: readonly SanitizedCapturedRequest[],
  ) => Explanation;
}>;

export type RecordingPipelineStageDependencies = Pick<
  RecordingPipelineDependencies,
  'normalize' | 'classify' | 'explain' | 'redactionConfig'
>;

export interface RecordingPipelineStages {
  normalize(
    observation: Parameters<typeof normalizeObservation>[0],
    limits: SessionLimits,
    id: string,
  ): Result<CapturedRequest, CaptureIssue>;
  redact(request: CapturedRequest): Result<SanitizedCapturedRequest, CaptureIssue>;
  classify(request: SanitizedCapturedRequest): Result<Classification, CaptureIssue>;
  explain(
    request: SanitizedCapturedRequest,
    related: readonly SanitizedCapturedRequest[],
  ): Result<Explanation, CaptureIssue>;
  reset(): void;
}

export type RecordingStartOptions = Readonly<{
  capture?: CaptureOptions;
  interaction?: InteractionStartContext;
}>;

export interface RecordingPipeline {
  start(startedAt: number, options?: RecordingStartOptions): Promise<void>;
  stop(stoppedAt: number): Promise<void>;
  dispose(stoppedAt?: number): Promise<void>;
}

const UNKNOWN_CLASSIFICATION: Classification = Object.freeze({
  kind: 'unknown',
  confidence: 'unknown',
  evidence: Object.freeze([]),
});
const UNKNOWN_EXPLANATION: Explanation = Object.freeze({
  outcome: 'unknown',
  summary: 'Request analysis was unavailable.',
  guidance: Object.freeze([]),
  evidence: Object.freeze([]),
});

const ISSUE_MESSAGES = Object.freeze({
  'classification-failed': 'Request classification was unavailable.',
  'explanation-failed': 'Request explanation was unavailable.',
  'normalization-failed': 'A captured request could not be normalized and was skipped.',
  'redaction-failed': 'A captured request failed closed during redaction.',
  'sink-failed': 'A sanitized request could not be added to the session.',
});

type PipelineIssueCode = keyof typeof ISSUE_MESSAGES;

function fixedIssue(code: PipelineIssueCode, requestId?: string): CaptureIssue {
  return {
    code,
    message: ISSUE_MESSAGES[code],
    ...(requestId === undefined ? {} : { requestId }),
  };
}

function classificationValid(value: Classification): boolean {
  return (
    typeof value.kind === 'string' &&
    value.kind.length > 0 &&
    ['confirmed', 'likely', 'unknown'].includes(value.confidence) &&
    Array.isArray(value.evidence) &&
    value.evidence.every((item) => typeof item === 'string') &&
    (value.actionId === undefined || typeof value.actionId === 'string')
  );
}

function explanationValid(value: Explanation): boolean {
  return (
    typeof value.outcome === 'string' &&
    value.outcome.length > 0 &&
    typeof value.summary === 'string' &&
    value.summary.length > 0 &&
    Array.isArray(value.guidance) &&
    value.guidance.every((item) => typeof item === 'string') &&
    Array.isArray(value.evidence) &&
    value.evidence.every((item) => typeof item === 'string')
  );
}

function withAnalysis(
  request: SanitizedCapturedRequest,
  classification: Classification,
  explanation?: Explanation,
): SanitizedCapturedRequest {
  return {
    ...request,
    classification,
    ...(explanation === undefined ? {} : { explanation }),
  } as SanitizedCapturedRequest;
}

function defaultIdFactory(clock: () => number): () => string {
  let sequence = 0;
  const prefix = Math.max(0, Math.floor(clock())).toString(36);
  return () => {
    sequence += 1;
    try {
      return `req-${crypto.randomUUID()}`;
    } catch {
      return `req-${prefix}-${sequence.toString(36)}`;
    }
  };
}

export function createRecordingPipelineStages(
  dependencies: RecordingPipelineStageDependencies = {},
): RecordingPipelineStages {
  const normalize = dependencies.normalize ?? normalizeObservation;
  const classify = dependencies.classify ?? classifyRequest;
  const explain = dependencies.explain ?? explainRequest;
  const redactor = createRequestRedactor(
    dependencies.redactionConfig ?? DEFAULT_REDACTION_CONFIG,
  );

  return {
    normalize(observation, limits, id): Result<CapturedRequest, CaptureIssue> {
      try {
        return { ok: true, value: normalize(observation, limits, id) };
      } catch {
        return { ok: false, error: fixedIssue('normalization-failed') };
      }
    },

    redact(request: CapturedRequest): Result<SanitizedCapturedRequest, CaptureIssue> {
      const fallback = redactor.redact(request);
      if (fallback.response.body.reason === 'redaction-failed') {
        return {
          ok: false,
          error: fixedIssue('redaction-failed'),
          fallback,
        };
      }
      return { ok: true, value: fallback };
    },

    classify(request: SanitizedCapturedRequest): Result<Classification, CaptureIssue> {
      try {
        const value = classify(request);
        return classificationValid(value)
          ? { ok: true, value }
          : {
              ok: false,
              error: fixedIssue('classification-failed', request.id),
            };
      } catch {
        return {
          ok: false,
          error: fixedIssue('classification-failed', request.id),
        };
      }
    },

    explain(
      request: SanitizedCapturedRequest,
      related: readonly SanitizedCapturedRequest[],
    ): Result<Explanation, CaptureIssue> {
      try {
        const value = explain(request, related);
        return explanationValid(value)
          ? { ok: true, value }
          : {
              ok: false,
              error: fixedIssue('explanation-failed', request.id),
            };
      } catch {
        return {
          ok: false,
          error: fixedIssue('explanation-failed', request.id),
        };
      }
    },

    reset(): void {
      redactor.reset();
    },
  };
}

export function createRecordingPipeline(
  dependencies: RecordingPipelineDependencies,
): RecordingPipeline {
  const stages = createRecordingPipelineStages(dependencies);
  const idFactory =
    dependencies.idFactory ?? defaultIdFactory(dependencies.clock ?? Date.now);
  let active = false;
  let interactionActive = false;
  let generation = 0;
  let startupGate: Promise<boolean> = Promise.resolve(true);
  let unsubscribe: (() => void) | null = null;
  let unsubscribeInteractions: (() => void) | null = null;
  let processingTail = Promise.resolve();
  const accepted: SanitizedCapturedRequest[] = [];

  function warn(issue: CaptureIssue): void {
    try {
      dependencies.controller.warn(issue);
    } catch {
      // Warning reporting cannot break the sanitized processing queue.
    }
  }

  function enqueue(task: () => Promise<void>): void {
    processingTail = processingTail.then(task, task).catch(() => {
      warn(fixedIssue('sink-failed'));
    });
  }

  async function processObservation(
    observation: Parameters<typeof normalizeObservation>[0],
  ): Promise<void> {
    const limits = dependencies.controller.getSnapshot().limits;
    const normalization = stages.normalize(observation, limits, idFactory());
    if (!normalization.ok) {
      warn(normalization.error);
      return;
    }

    const redaction = stages.redact(normalization.value);
    let analyzed: SanitizedCapturedRequest;
    if (!redaction.ok) {
      warn(redaction.error);
      if (redaction.fallback === undefined) return;
      analyzed = withAnalysis(
        redaction.fallback,
        UNKNOWN_CLASSIFICATION,
        UNKNOWN_EXPLANATION,
      );
    } else {
      const redacted = redaction.value;
      const classificationResult = stages.classify(redacted);
      const classification = classificationResult.ok
        ? classificationResult.value
        : UNKNOWN_CLASSIFICATION;
      if (!classificationResult.ok) {
        warn(classificationResult.error);
      }

      const classified = withAnalysis(redacted, classification);
      const explanationResult = stages.explain(classified, accepted);
      const explanation = explanationResult.ok
        ? explanationResult.value
        : UNKNOWN_EXPLANATION;
      if (!explanationResult.ok) {
        warn(explanationResult.error);
      }
      analyzed = withAnalysis(classified, classification, explanation);
    }

    try {
      await dependencies.controller.accept(analyzed);
      accepted.push(analyzed);
      if (accepted.length > limits.maxRequests) {
        accepted.splice(0, accepted.length - limits.maxRequests);
      }
    } catch {
      warn(fixedIssue('sink-failed', analyzed.id));
    }
  }

  function receive(event: CaptureEvent): void {
    if (!active) return;
    const expectedGeneration = generation;
    const ready = startupGate;
    if (event.type === 'issue') {
      enqueue(async () => {
        if (!(await ready) || !active || generation !== expectedGeneration) return;
        warn(event.issue);
      });
      return;
    }
    enqueue(async () => {
      if (!(await ready) || !active || generation !== expectedGeneration) return;
      await processObservation(event.observation);
    });
  }

  /**
   * Trusted boundary for page-supplied interaction evidence: every event is
   * redacted before it reaches the session, and stale generations are dropped.
   */
  function subscribeInteractions(
    interactions: InteractionSource,
    expectedGeneration: number,
  ): void {
    releaseInteractionSubscription();
    const config = dependencies.redactionConfig ?? DEFAULT_REDACTION_CONFIG;
    try {
      unsubscribeInteractions = interactions.subscribe((event) => {
        if (!active || generation !== expectedGeneration) return;
        try {
          dependencies.controller.acceptInteraction(
            redactInteractionEvent(event, config),
          );
        } catch {
          warn(fixedIssue('redaction-failed'));
        }
      });
    } catch {
      unsubscribeInteractions = null;
      warn({
        code: 'interaction-start-failed',
        message: 'Interaction capture was unavailable; network capture continued.',
      });
    }
  }

  function releaseInteractionSubscription(): void {
    if (unsubscribeInteractions === null) return;
    try {
      unsubscribeInteractions();
    } catch {
      // A disposed interaction source is already unsubscribed.
    }
    unsubscribeInteractions = null;
  }

  async function stopSources(stoppedAt: number): Promise<unknown> {
    releaseInteractionSubscription();
    let captureFailure: unknown;
    try {
      await dependencies.capture.stop(stoppedAt);
    } catch (error) {
      captureFailure = error;
    }
    if (dependencies.interactions !== undefined && interactionActive) {
      try {
        await dependencies.interactions.stop();
      } catch {
        // Network evidence still drains and remains available.
      }
      interactionActive = false;
    }
    return captureFailure;
  }

  return {
    async start(startedAt, options = {}): Promise<void> {
      if (active) return;
      accepted.length = 0;
      stages.reset();
      generation += 1;
      let settleStartup!: (ready: boolean) => void;
      startupGate = new Promise<boolean>((resolve) => {
        settleStartup = resolve;
      });
      active = true;
      unsubscribe = dependencies.capture.subscribe(receive);
      let interactionRequested = false;
      try {
        const captureStartup = dependencies.capture.begin(startedAt, options.capture);
        let interactionStartup: Promise<Awaited<
          ReturnType<InteractionSource['start']>
        > | null> | null = null;
        if (
          dependencies.interactions !== undefined &&
          options.interaction !== undefined
        ) {
          interactionRequested = true;
          subscribeInteractions(dependencies.interactions, generation);
          try {
            interactionStartup = Promise.resolve(
              dependencies.interactions.start(options.interaction),
            ).catch(() => null);
          } catch {
            interactionStartup = Promise.resolve(null);
          }
        }

        await captureStartup;
        settleStartup(true);
        if (interactionStartup !== null) {
          const result = await interactionStartup;
          interactionActive = result?.status === 'active';
          if (!interactionActive) {
            releaseInteractionSubscription();
            warn({
              code: 'interaction-start-failed',
              message:
                'Interaction capture was unavailable; network capture continued.',
            });
          }
        }
      } catch (error) {
        settleStartup(false);
        active = false;
        generation += 1;
        unsubscribe();
        unsubscribe = null;
        releaseInteractionSubscription();
        if (interactionRequested && dependencies.interactions !== undefined) {
          try {
            await dependencies.interactions.stop();
          } catch {
            // Startup failure remains primary after best-effort teardown.
          }
          interactionActive = false;
        }
        try {
          await dependencies.capture.stop((dependencies.clock ?? Date.now)());
        } catch {
          // Preserve original startup failure after best-effort teardown.
        }
        await processingTail;
        throw error;
      }
    },

    async stop(stoppedAt): Promise<void> {
      if (!active) return;
      const captureFailure = await stopSources(stoppedAt);
      await processingTail;
      active = false;
      generation += 1;
      unsubscribe?.();
      unsubscribe = null;
      if (captureFailure !== undefined) throw captureFailure;
    },

    async dispose(stoppedAt = (dependencies.clock ?? Date.now)()): Promise<void> {
      if (active) {
        await stopSources(stoppedAt);
        await processingTail;
      }
      active = false;
      generation += 1;
      unsubscribe?.();
      unsubscribe = null;
      accepted.length = 0;
      await dependencies.capture.dispose();
    },
  };
}
