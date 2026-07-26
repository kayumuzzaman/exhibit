import { correlate } from './correlation';
import type { InteractionGroup } from './model';
import type { SanitizedCapturedRequest, SanitizedRecordingSession } from './sanitized';

const SLOW_THRESHOLD_MS = 1_000;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function escapeMarkdown(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replace(/\r\n?|\n/gu, '\\n')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/([`*_{}[\]()#+.!|~-])/gu, '\\$1');
}

function formatTimestamp(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Unavailable';
  try {
    return new Date(value).toISOString();
  } catch {
    return 'Unavailable';
  }
}

function requestTime(request: SanitizedCapturedRequest): number {
  return Number.isFinite(request.startedAt)
    ? request.startedAt
    : Number.POSITIVE_INFINITY;
}

function sortedRequests(
  requests: readonly SanitizedCapturedRequest[],
): SanitizedCapturedRequest[] {
  return requests
    .map((request, index) => ({ request, index }))
    .sort(
      (left, right) =>
        requestTime(left.request) - requestTime(right.request) ||
        left.index - right.index,
    )
    .map(({ request }) => request);
}

function route(value: string): string {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

function normalizedUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    url.searchParams.sort();
    return url.toString();
  } catch {
    return value;
  }
}

function requestLabel(request: SanitizedCapturedRequest): string {
  const status =
    request.response.status === 0
      ? 'no HTTP response'
      : `HTTP ${request.response.status}`;
  return `${escapeMarkdown(request.method.toUpperCase())} ${escapeMarkdown(route(request.url))} — ${status}, ${request.timing.totalMs} ms`;
}

function interactionLabel(group: InteractionGroup): string {
  if (group.kind === 'unattributed') return 'Unattributed';
  const target = group.event.target;
  const label = target?.name ?? target?.role ?? target?.tag ?? group.event.kind;
  return `${escapeMarkdown(label)} (${escapeMarkdown(group.event.kind)})`;
}

function groupTime(
  group: InteractionGroup,
  byId: ReadonlyMap<string, SanitizedCapturedRequest>,
): number {
  if (group.event !== null && Number.isFinite(group.event.occurredAt)) {
    return group.event.occurredAt;
  }
  return Math.min(
    ...group.requestIds.map((id) => {
      const request = byId.get(id);
      return request === undefined ? Number.POSITIVE_INFINITY : requestTime(request);
    }),
  );
}

function evidenceLines(request: SanitizedCapturedRequest): string[] {
  const evidence = [
    ...(request.classification?.evidence ?? []),
    ...(request.explanation?.evidence ?? []),
  ];
  return [...new Set(evidence)].map(
    (item) => `    - Evidence: ${escapeMarkdown(item)}`,
  );
}

function truncationLines(request: SanitizedCapturedRequest): string[] {
  const lines: string[] = [];
  if (request.request.body?.state === 'truncated') {
    lines.push(
      `    - Notice: request body truncated (${request.request.body.capturedSize} of ${request.request.body.size} bytes captured).`,
    );
  }
  if (request.response.body.state === 'truncated') {
    lines.push(
      `    - Notice: response body truncated (${request.response.body.capturedSize} of ${request.response.body.size} bytes captured).`,
    );
  }
  return lines;
}

function callLines(request: SanitizedCapturedRequest): string[] {
  const kind = request.classification?.kind;
  return [
    `  - ${formatTimestamp(request.startedAt)} — ${requestLabel(request)}${kind === undefined ? '' : ` — ${escapeMarkdown(kind)}`}`,
    ...evidenceLines(request),
    ...truncationLines(request),
  ];
}

function failure(request: SanitizedCapturedRequest): boolean {
  return request.response.status === 0 || request.response.status >= 400;
}

type RepeatGroup = Readonly<{
  key: string;
  requests: readonly SanitizedCapturedRequest[];
}>;

function repeatedGroups(requests: readonly SanitizedCapturedRequest[]): RepeatGroup[] {
  const groups = new Map<string, SanitizedCapturedRequest[]>();
  for (const request of requests) {
    const key = `${request.method.toUpperCase()} ${normalizedUrl(request.url)}`;
    const values = groups.get(key) ?? [];
    values.push(request);
    groups.set(key, values);
  }
  return [...groups.entries()]
    .filter(([, values]) => values.length > 1)
    .map(([key, values]) => ({ key, requests: sortedRequests(values) }))
    .sort(
      (left, right) =>
        requestTime(left.requests[0]!) - requestTime(right.requests[0]!) ||
        compareText(left.key, right.key),
    );
}

function section(
  heading: string,
  requests: readonly SanitizedCapturedRequest[],
): string[] {
  return [
    `## ${heading}`,
    '',
    ...(requests.length === 0
      ? ['None.', '']
      : requests.flatMap((request) => [...callLines(request), ''])),
  ];
}

export function toQaReport(session: SanitizedRecordingSession): string {
  const requests = sortedRequests(session.requests);
  const byId = new Map(requests.map((request) => [request.id, request]));
  const groups = [...correlate(session)].sort(
    (left, right) =>
      groupTime(left, byId) - groupTime(right, byId) || compareText(left.id, right.id),
  );
  const lines = [
    '# Payloadra QA Report',
    '',
    '## Environment',
    '',
    `- Origin: ${escapeMarkdown(session.origin)}`,
    `- Session started: ${formatTimestamp(session.startedAt)}`,
    `- Session stopped: ${formatTimestamp(session.stoppedAt)}`,
    `- Captured calls: ${requests.length}`,
    `- Evicted calls: ${session.evictedCount}`,
    '',
    '## Reproduction timeline',
    '',
  ];

  for (const group of groups) {
    const groupedRequests = sortedRequests(
      group.requestIds.flatMap((id) => {
        const request = byId.get(id);
        return request === undefined ? [] : [request];
      }),
    );
    lines.push(
      `### ${formatTimestamp(groupTime(group, byId))} — ${interactionLabel(group)}`,
      '',
    );
    if (groupedRequests.length === 0) {
      lines.push('No captured calls.', '');
    } else {
      lines.push(...groupedRequests.flatMap((request) => [...callLines(request), '']));
    }
  }

  lines.push(
    ...section('Failures', requests.filter(failure)),
    ...section(
      'Slow calls',
      requests.filter(({ timing }) => timing.totalMs >= SLOW_THRESHOLD_MS),
    ),
    '## Repeated calls',
    '',
  );
  const repeats = repeatedGroups(requests);
  if (repeats.length === 0) {
    lines.push('None.', '');
  } else {
    for (const repeat of repeats) {
      const first = repeat.requests[0]!;
      lines.push(
        `- ${escapeMarkdown(first.method.toUpperCase())} ${escapeMarkdown(route(first.url))} — ${repeat.requests.length} calls`,
      );
      for (const request of repeat.requests) {
        lines.push(
          `  - ${formatTimestamp(request.startedAt)} — ${request.response.status === 0 ? 'no HTTP response' : `HTTP ${request.response.status}`}, ${request.timing.totalMs} ms`,
        );
      }
      lines.push('');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
