import type { BodyContent, BodyContentState, Header } from '../../domain/model';
import type { SanitizedCapturedRequest } from '../../domain/sanitized';

export type ScalarDiff<T> = Readonly<{
  left: T;
  right: T;
  changed: boolean;
}>;

export type HeaderDiff = Readonly<{
  name: string;
  left: readonly string[];
  right: readonly string[];
  changed: boolean;
}>;

export type ValueDiff = Readonly<{
  path: string;
  kind: 'added' | 'removed' | 'changed';
  left?: unknown;
  right?: unknown;
}>;

export type BodyDiff = Readonly<{
  format: 'json' | 'text' | 'unavailable';
  leftState: BodyContentState | 'absent';
  rightState: BodyContentState | 'absent';
  changes: readonly ValueDiff[];
}>;

export type RequestDiff = Readonly<{
  leftId: string;
  rightId: string;
  method: ScalarDiff<string>;
  url: ScalarDiff<string>;
  status: ScalarDiff<number>;
  durationMs: ScalarDiff<number>;
  requestHeaders: readonly HeaderDiff[];
  responseHeaders: readonly HeaderDiff[];
  requestBody: BodyDiff;
  responseBody: BodyDiff;
}>;

function scalar<T>(left: T, right: T): ScalarDiff<T> {
  return { left, right, changed: !Object.is(left, right) };
}

function equalValues(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}

function alignedHeaders(
  left: readonly Header[],
  right: readonly Header[],
): HeaderDiff[] {
  const leftValues = new Map<string, string[]>();
  const rightValues = new Map<string, string[]>();
  for (const header of left) {
    const name = header.name.toLowerCase();
    const values = leftValues.get(name) ?? [];
    values.push(header.value);
    leftValues.set(name, values);
  }
  for (const header of right) {
    const name = header.name.toLowerCase();
    const values = rightValues.get(name) ?? [];
    values.push(header.value);
    rightValues.set(name, values);
  }

  return [...new Set([...leftValues.keys(), ...rightValues.keys()])]
    .sort()
    .map((name) => {
      const leftHeaderValues = leftValues.get(name) ?? [];
      const rightHeaderValues = rightValues.get(name) ?? [];
      return {
        name,
        left: leftHeaderValues,
        right: rightHeaderValues,
        changed: !equalValues(leftHeaderValues, rightHeaderValues),
      };
    })
    .filter(({ changed }) => changed);
}

function jsonMime(value: string | undefined): boolean {
  const mime = value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return mime === 'application/json' || mime.endsWith('+json');
}

function parseJsonBody(body: BodyContent | undefined): unknown | undefined {
  if (body?.text === undefined || !jsonMime(body.mimeType)) return undefined;
  try {
    return JSON.parse(body.text) as unknown;
  } catch {
    return undefined;
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value).sort()) {
      Object.defineProperty(output, key, {
        value: canonicalValue((value as Record<string, unknown>)[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return output;
  }
  return value;
}

function childPath(path: string, key: string | number): string {
  const escaped = String(key).replaceAll('~', '~0').replaceAll('/', '~1');
  return `${path}/${escaped}`;
}

function changedValue(path: string, left: unknown, right: unknown): ValueDiff {
  return {
    path,
    kind: 'changed',
    left: canonicalValue(left),
    right: canonicalValue(right),
  };
}

function compareJson(left: unknown, right: unknown, path = ''): ValueDiff[] {
  if (Object.is(left, right)) return [];
  if (Array.isArray(left) && Array.isArray(right)) {
    const changes: ValueDiff[] = [];
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const nextPath = childPath(path, index);
      if (index >= left.length) {
        changes.push({
          path: nextPath,
          kind: 'added',
          right: canonicalValue(right[index]),
        });
      } else if (index >= right.length) {
        changes.push({
          path: nextPath,
          kind: 'removed',
          left: canonicalValue(left[index]),
        });
      } else {
        changes.push(...compareJson(left[index], right[index], nextPath));
      }
    }
    return changes;
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === 'object' &&
    typeof right === 'object' &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = [
      ...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]),
    ].sort();
    const changes: ValueDiff[] = [];
    for (const key of keys) {
      const nextPath = childPath(path, key);
      if (!Object.hasOwn(leftRecord, key)) {
        changes.push({
          path: nextPath,
          kind: 'added',
          right: canonicalValue(rightRecord[key]),
        });
      } else if (!Object.hasOwn(rightRecord, key)) {
        changes.push({
          path: nextPath,
          kind: 'removed',
          left: canonicalValue(leftRecord[key]),
        });
      } else {
        changes.push(...compareJson(leftRecord[key], rightRecord[key], nextPath));
      }
    }
    return changes;
  }
  return [changedValue(path, left, right)];
}

function bodyState(body: BodyContent | undefined): BodyContentState | 'absent' {
  return body?.state ?? 'absent';
}

function compareBodies(
  left: BodyContent | undefined,
  right: BodyContent | undefined,
): BodyDiff {
  const leftState = bodyState(left);
  const rightState = bodyState(right);
  const leftJson = parseJsonBody(left);
  const rightJson = parseJsonBody(right);
  if (leftJson !== undefined && rightJson !== undefined) {
    return {
      format: 'json',
      leftState,
      rightState,
      changes: compareJson(leftJson, rightJson),
    };
  }

  if (left?.text !== undefined || right?.text !== undefined) {
    const leftText = left?.text;
    const rightText = right?.text;
    const changes =
      leftText === rightText
        ? []
        : [
            {
              path: '',
              kind:
                leftText === undefined
                  ? ('added' as const)
                  : rightText === undefined
                    ? ('removed' as const)
                    : ('changed' as const),
              ...(leftText === undefined ? {} : { left: leftText }),
              ...(rightText === undefined ? {} : { right: rightText }),
            },
          ];
    return { format: 'text', leftState, rightState, changes };
  }

  const changes: ValueDiff[] =
    leftState === rightState
      ? []
      : [
          {
            path: '',
            kind: 'changed',
            left: leftState,
            right: rightState,
          },
        ];
  return { format: 'unavailable', leftState, rightState, changes };
}

export function compareRequests(
  left: SanitizedCapturedRequest,
  right: SanitizedCapturedRequest,
): RequestDiff {
  return {
    leftId: left.id,
    rightId: right.id,
    method: scalar(left.method, right.method),
    url: scalar(left.url, right.url),
    status: scalar(left.response.status, right.response.status),
    durationMs: scalar(left.timing.totalMs, right.timing.totalMs),
    requestHeaders: alignedHeaders(left.request.headers, right.request.headers),
    responseHeaders: alignedHeaders(left.response.headers, right.response.headers),
    requestBody: compareBodies(left.request.body, right.request.body),
    responseBody: compareBodies(left.response.body, right.response.body),
  };
}
