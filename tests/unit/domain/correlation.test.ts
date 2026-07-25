import { describe, expect, it } from 'vitest';

import { correlate } from '../../../src/domain/correlation';
import type {
  CapturedRequest,
  InteractionEvent,
  RecordingSession,
} from '../../../src/domain/model';
import { createSession } from '../../../src/domain/session';
import { requestWith } from '../../helpers/request-factory';

function eventWith(
  id: string,
  occurredAt: number,
  overrides: Partial<InteractionEvent> = {},
): InteractionEvent {
  return {
    id,
    tabId: '9',
    kind: 'click',
    occurredAt,
    trust: 'trusted',
    target: { tag: 'button', text: id },
    ...overrides,
  };
}

function requestAt(
  id: string,
  startedAt: number,
  redirectParentId?: string,
): CapturedRequest {
  const request = requestWith({ id, startedAt });
  return {
    ...request,
    evidence: {
      ...request.evidence,
      ...(redirectParentId === undefined ? {} : { redirectParentId }),
    },
  };
}

function sessionWith(
  interactions: readonly InteractionEvent[],
  requests: readonly CapturedRequest[],
): RecordingSession {
  return {
    ...createSession('9', 'https://shop.test', 1_000),
    interactions,
    requests,
  };
}

function requestsFor(
  groups: ReturnType<typeof correlate>,
  eventId: string | null,
): readonly string[] {
  const group = groups.find(({ event }) => (event?.id ?? null) === eventId);
  if (group === undefined) {
    throw new Error(`Missing group for ${eventId ?? 'unattributed'}.`);
  }
  return group.requestIds;
}

describe('interaction correlation', () => {
  it('keeps stable event groups, including events with zero requests', () => {
    const groups = correlate(
      sessionWith(
        [eventWith('second', 2_000), eventWith('first', 1_000)],
        [requestAt('after-second', 2_100)],
      ),
    );

    expect(
      groups.map((group) => ({
        kind: group.kind,
        event: group.event?.id ?? null,
        requests: group.requestIds,
      })),
    ).toEqual([
      { kind: 'event', event: 'first', requests: [] },
      { kind: 'event', event: 'second', requests: ['after-second'] },
    ]);
  });

  it.each([
    { delta: 4_999, attributed: true },
    { delta: 5_000, attributed: true },
    { delta: 5_001, attributed: false },
  ])(
    'uses the inclusive five-second boundary at delta $delta',
    ({ delta, attributed }) => {
      const groups = correlate(
        sessionWith([eventWith('click', 1_000)], [requestAt('request', 1_000 + delta)]),
      );

      expect(requestsFor(groups, attributed ? 'click' : null)).toEqual(['request']);
    },
  );

  it('assigns an exact next-event timestamp to the next event', () => {
    const groups = correlate(
      sessionWith(
        [eventWith('first', 1_000), eventWith('next', 2_000)],
        [
          requestAt('before-next', 1_999),
          requestAt('at-next', 2_000),
          requestAt('same-as-first', 1_000),
        ],
      ),
    );

    expect(requestsFor(groups, 'first')).toEqual(['same-as-first', 'before-next']);
    expect(requestsFor(groups, 'next')).toEqual(['at-next']);
  });

  it('keeps requests before the first event unattributed and stable-sorts equal times', () => {
    const groups = correlate(
      sessionWith(
        [eventWith('event', 1_000)],
        [
          requestAt('same-a', 1_100),
          requestAt('before', 999),
          requestAt('same-b', 1_100),
          requestAt('invalid-first', Number.NaN),
          requestAt('same-invalid', Number.NaN),
        ],
      ),
    );

    expect(requestsFor(groups, 'event')).toEqual(['same-a', 'same-b']);
    expect(requestsFor(groups, null)).toEqual([
      'before',
      'invalid-first',
      'same-invalid',
    ]);
  });

  it('stable-sorts copies and sends invalid timestamps to unattributed evidence', () => {
    const interactions = [
      eventWith('same-a', 1_000),
      eventWith('invalid', Number.NaN),
      eventWith('same-b', 1_000),
    ];
    const requests = [
      requestAt('late', 1_100),
      requestAt('invalid-request', Number.POSITIVE_INFINITY),
      requestAt('early', 1_050),
    ];
    const eventOrder = interactions.map(({ id }) => id);
    const requestOrder = requests.map(({ id }) => id);

    const groups = correlate(sessionWith(interactions, requests));

    expect(groups.map(({ event }) => event?.id ?? null)).toEqual([
      'same-a',
      'same-b',
      null,
    ]);
    expect(requestsFor(groups, 'same-b')).toEqual(['early', 'late']);
    expect(requestsFor(groups, null)).toEqual(['invalid-request']);
    expect(interactions.map(({ id }) => id)).toEqual(eventOrder);
    expect(requests.map(({ id }) => id)).toEqual(requestOrder);
  });

  it('creates one explicit unattributed group when there are no usable events', () => {
    const groups = correlate(
      sessionWith(
        [eventWith('invalid', Number.NEGATIVE_INFINITY)],
        [requestAt('one', 100), requestAt('two', 200)],
      ),
    );

    expect(groups).toEqual([
      {
        id: 'unattributed',
        kind: 'unattributed',
        event: null,
        requestIds: ['one', 'two'],
      },
    ]);
  });

  it('returns no synthetic group when both events and requests are empty', () => {
    expect(correlate(sessionWith([], []))).toEqual([]);
  });

  it('does not let an untrusted history hint claim or split request causality', () => {
    const groups = correlate(
      sessionWith(
        [
          eventWith('trusted-click', 1_000),
          eventWith('spoofable-history', 2_000, {
            kind: 'history',
            trust: 'untrusted-hint',
          }),
        ],
        [requestAt('after-hint', 2_100)],
      ),
    );

    expect(requestsFor(groups, 'trusted-click')).toEqual(['after-hint']);
    expect(requestsFor(groups, 'spoofable-history')).toEqual([]);
  });

  it('inherits explicit redirect ancestry transitively across later events', () => {
    const groups = correlate(
      sessionWith(
        [eventWith('submit', 1_000), eventWith('later-click', 2_000)],
        [
          requestAt('root', 1_100),
          requestAt('redirect-one', 2_100, 'root'),
          requestAt('redirect-two', 2_200, 'redirect-one'),
        ],
      ),
    );

    expect(requestsFor(groups, 'submit')).toEqual([
      'root',
      'redirect-one',
      'redirect-two',
    ]);
    expect(requestsFor(groups, 'later-click')).toEqual([]);
  });

  it('keeps missing, ambiguous, and cyclic redirect evidence conservative', () => {
    const duplicateA = requestAt('duplicate', 1_100);
    const duplicateB = requestAt('duplicate', 2_100);
    const groups = correlate(
      sessionWith(
        [eventWith('first', 1_000), eventWith('second', 2_000)],
        [
          duplicateA,
          duplicateB,
          requestAt('ambiguous-child', 2_200, 'duplicate'),
          requestAt('missing-child', 2_300, 'missing'),
          requestAt('cycle-a', 1_200, 'cycle-b'),
          requestAt('cycle-b', 2_400, 'cycle-a'),
          requestAt('self-cycle', 2_500, 'self-cycle'),
        ],
      ),
    );

    expect(requestsFor(groups, 'first')).toEqual(['duplicate', 'cycle-a']);
    expect(requestsFor(groups, 'second')).toEqual([
      'duplicate',
      'ambiguous-child',
      'missing-child',
      'cycle-b',
      'self-cycle',
    ]);
  });

  it('returns cloned deeply immutable groups without freezing caller values', () => {
    const target = {
      tag: 'button',
      role: 'button',
      name: 'save',
      id: 'save-button',
    };
    const event = eventWith('save', 1_000, {
      target,
      url: 'https://shop.test/cart',
    });
    const targetless: InteractionEvent = {
      id: 'targetless',
      tabId: '9',
      kind: 'click',
      occurredAt: 2_000,
      trust: 'trusted',
    };
    const groups = correlate(
      sessionWith([event, targetless], [requestAt('save-request', 1_001)]),
    );

    expect(groups[0]?.event).not.toBe(event);
    expect(groups[0]?.event?.target).not.toBe(target);
    expect(Object.isFrozen(groups)).toBe(true);
    expect(Object.isFrozen(groups[0])).toBe(true);
    expect(Object.isFrozen(groups[0]?.event)).toBe(true);
    expect(Object.isFrozen(groups[0]?.event?.target)).toBe(true);
    expect(Object.isFrozen(groups[0]?.requestIds)).toBe(true);
    expect(Object.isFrozen(event)).toBe(false);
    expect(Object.isFrozen(target)).toBe(false);
    expect(groups[0]?.event?.target).toEqual(target);
    expect(groups[0]?.event?.url).toBe('https://shop.test/cart');
    expect(groups[1]?.event?.target).toBeUndefined();
    expect(() => {
      (groups[0]!.requestIds as string[]).push('mutation');
    }).toThrow(TypeError);
  });
});
