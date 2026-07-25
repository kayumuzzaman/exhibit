import type { CaptureObservation } from '../../src/ports/capture-source';

type EntryOverrides = Readonly<Record<string, unknown>>;

export function observation(overrides: EntryOverrides = {}): CaptureObservation {
  const responseOverrides =
    overrides.response !== null && typeof overrides.response === 'object'
      ? (overrides.response as Record<string, unknown>)
      : {};
  const requestOverrides =
    overrides.request !== null && typeof overrides.request === 'object'
      ? (overrides.request as Record<string, unknown>)
      : {};
  const timingOverrides =
    overrides.timings !== null && typeof overrides.timings === 'object'
      ? (overrides.timings as Record<string, unknown>)
      : {};

  return {
    observedAt: 1_700_000_000_000,
    entry: {
      startedDateTime: '2023-11-14T22:13:20.000Z',
      time:
        overrides.time ??
        [timingOverrides.wait, timingOverrides.receive].reduce<number>(
          (total, value) => (typeof value === 'number' ? total + value : total),
          0,
        ),
      request: {
        method: 'GET',
        url: 'https://app.test/api/items',
        headers: [],
        ...requestOverrides,
      },
      response: {
        status: 200,
        statusText: 'OK',
        headers: [],
        content: { mimeType: 'application/json', size: 0 },
        ...responseOverrides,
      },
      timings: timingOverrides,
      ...overrides,
    },
  };
}
