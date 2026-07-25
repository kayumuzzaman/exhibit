import type {
  CapturedRequest,
  ElementDescriptor,
  InteractionEvent,
  InteractionGroup,
  RecordingSession,
} from './model';

const CORRELATION_WINDOW_MS = 5_000;

type SessionEvidence = Pick<RecordingSession, 'interactions' | 'requests'>;

type IndexedEvent = Readonly<{
  event: InteractionEvent;
  inputIndex: number;
}>;

type IndexedRequest = Readonly<{
  request: CapturedRequest;
  inputIndex: number;
}>;

function stableEvents(events: readonly InteractionEvent[]): IndexedEvent[] {
  return events
    .map((event, inputIndex) => ({ event, inputIndex }))
    .filter(({ event }) => Number.isFinite(event.occurredAt))
    .sort(
      (left, right) =>
        left.event.occurredAt - right.event.occurredAt ||
        left.inputIndex - right.inputIndex,
    );
}

function stableRequests(requests: readonly CapturedRequest[]): IndexedRequest[] {
  return requests
    .map((request, inputIndex) => ({ request, inputIndex }))
    .sort((left, right) => {
      const leftFinite = Number.isFinite(left.request.startedAt);
      const rightFinite = Number.isFinite(right.request.startedAt);
      if (leftFinite && rightFinite) {
        return (
          left.request.startedAt - right.request.startedAt ||
          left.inputIndex - right.inputIndex
        );
      }
      if (leftFinite) {
        return -1;
      }
      if (rightFinite) {
        return 1;
      }
      return left.inputIndex - right.inputIndex;
    });
}

function trustedCandidateEvents(events: readonly IndexedEvent[]): number[] {
  const candidates: number[] = [];
  for (let index = 0; index < events.length; index += 1) {
    if (events[index]!.event.trust === 'trusted') {
      candidates.push(index);
    }
  }
  return candidates;
}

function directGroup(
  startedAt: number,
  events: readonly IndexedEvent[],
  candidates: readonly number[],
): number {
  if (!Number.isFinite(startedAt) || candidates.length === 0) {
    return -1;
  }
  let low = 0;
  let high = candidates.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const eventIndex = candidates[middle]!;
    if (events[eventIndex]!.event.occurredAt <= startedAt) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  if (low === 0) {
    return -1;
  }
  const eventIndex = candidates[low - 1]!;
  const delta = startedAt - events[eventIndex]!.event.occurredAt;
  return delta >= 0 && delta <= CORRELATION_WINDOW_MS ? eventIndex : -1;
}

function uniqueRequestIndexes(
  requests: readonly IndexedRequest[],
): ReadonlyMap<string, number> {
  const indexes = new Map<string, number>();
  const duplicates = new Set<string>();
  for (let index = 0; index < requests.length; index += 1) {
    const id = requests[index]!.request.id;
    if (indexes.has(id)) {
      duplicates.add(id);
    } else {
      indexes.set(id, index);
    }
  }
  for (const duplicate of duplicates) {
    indexes.delete(duplicate);
  }
  return indexes;
}

function redirectAssignments(
  requests: readonly IndexedRequest[],
  direct: readonly number[],
): number[] {
  const requestIndexes = uniqueRequestIndexes(requests);
  const resolved = new Array<number | undefined>(requests.length);

  for (let start = 0; start < requests.length; start += 1) {
    if (resolved[start] !== undefined) {
      continue;
    }
    const path: number[] = [];
    const positions = new Map<number, number>();
    let current = start;
    let result: number | undefined;
    let cyclic = false;

    while (true) {
      const cached = resolved[current];
      if (cached !== undefined) {
        result = cached;
        break;
      }
      if (positions.has(current)) {
        cyclic = true;
        break;
      }
      positions.set(current, path.length);
      path.push(current);
      const parentId = requests[current]!.request.evidence.redirectParentId;
      const parentIndex =
        parentId === undefined ? undefined : requestIndexes.get(parentId);
      if (parentIndex === undefined) {
        result = direct[current]!;
        break;
      }
      current = parentIndex;
    }

    if (cyclic) {
      for (const index of path) {
        resolved[index] = direct[index]!;
      }
      continue;
    }
    for (let index = path.length - 1; index >= 0; index -= 1) {
      const pathIndex = path[index]!;
      resolved[pathIndex] = result ?? direct[pathIndex]!;
    }
  }

  return resolved.map((group, index) => group ?? direct[index]!);
}

function cloneTarget(
  target: ElementDescriptor | undefined,
): ElementDescriptor | undefined {
  if (target === undefined) {
    return undefined;
  }
  return Object.freeze({
    tag: target.tag,
    ...(target.role === undefined ? {} : { role: target.role }),
    ...(target.name === undefined ? {} : { name: target.name }),
    ...(target.id === undefined ? {} : { id: target.id }),
    ...(target.text === undefined ? {} : { text: target.text }),
  });
}

function cloneEvent(event: InteractionEvent): InteractionEvent {
  const target = cloneTarget(event.target);
  return Object.freeze({
    id: event.id,
    tabId: event.tabId,
    kind: event.kind,
    occurredAt: event.occurredAt,
    trust: event.trust,
    ...(target === undefined ? {} : { target }),
    ...(event.url === undefined ? {} : { url: event.url }),
  });
}

export function correlate(session: SessionEvidence): readonly InteractionGroup[] {
  const events = stableEvents(session.interactions);
  const requests = stableRequests(session.requests);
  const candidates = trustedCandidateEvents(events);
  const direct = requests.map(({ request }) =>
    directGroup(request.startedAt, events, candidates),
  );
  const assignments = redirectAssignments(requests, direct);
  const requestIds = events.map(() => [] as string[]);
  const unattributed: string[] = [];

  for (let index = 0; index < requests.length; index += 1) {
    const group = assignments[index]!;
    const id = requests[index]!.request.id;
    if (group < 0) {
      unattributed.push(id);
    } else {
      requestIds[group]!.push(id);
    }
  }

  const groups: InteractionGroup[] = events.map(({ event }, index) =>
    Object.freeze({
      id: `event:${event.id}`,
      kind: 'event' as const,
      event: cloneEvent(event),
      requestIds: Object.freeze(requestIds[index]!.slice()),
    }),
  );
  if (unattributed.length > 0) {
    groups.push(
      Object.freeze({
        id: 'unattributed',
        kind: 'unattributed',
        event: null,
        requestIds: Object.freeze(unattributed.slice()),
      }),
    );
  }
  return Object.freeze(groups);
}
