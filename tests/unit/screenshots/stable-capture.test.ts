import { describe, expect, it } from 'vitest';

import {
  SCREENSHOT_DATE_HEADER,
  SCREENSHOT_ORIGIN,
  stableScreenshotCapture,
  stableScreenshotInteraction,
} from '../../helpers/stable-screenshot-capture';

describe('stable screenshot capture', () => {
  it('normalizes origin, time, timing, redirects, and Date headers', () => {
    const runtimeOrigin = 'http://127.0.0.1:54321';

    expect(
      stableScreenshotCapture({
        redirectUrl: `${runtimeOrigin}/api/profile`,
        requestHeaders: [{ name: 'referer', value: `${runtimeOrigin}/panel/` }],
        responseHeaders: [
          { name: 'date', value: 'Thu, 30 Jul 2026 05:40:48 GMT' },
          { name: 'location', value: `${runtimeOrigin}/api/profile` },
        ],
        runtimeOrigin,
        sequence: 5,
        url: `${runtimeOrigin}/api/slow`,
      }),
    ).toEqual({
      redirectUrl: `${SCREENSHOT_ORIGIN}/api/profile`,
      requestHeaders: [{ name: 'referer', value: `${SCREENSHOT_ORIGIN}/panel/` }],
      responseHeaders: [
        { name: 'date', value: SCREENSHOT_DATE_HEADER },
        { name: 'location', value: `${SCREENSHOT_ORIGIN}/api/profile` },
      ],
      startedDateTime: '2026-07-30T10:00:05.000Z',
      time: 1_200,
      timings: {
        blocked: 0,
        connect: 0,
        dns: 0,
        receive: 1,
        send: 1,
        ssl: -1,
        wait: 1_198,
      },
      url: `${SCREENSHOT_ORIGIN}/api/slow`,
    });
  });

  it.each([
    ['/next', 8, 6],
    ['/api/profile', 2, 0],
  ])('uses a stable timing profile for %s', (path, time, wait) => {
    const capture = stableScreenshotCapture({
      redirectUrl: '',
      requestHeaders: [],
      responseHeaders: [],
      runtimeOrigin: 'http://127.0.0.1:54321',
      sequence: 0,
      url: `http://127.0.0.1:54321${path}`,
    });

    expect(capture.time).toBe(time);
    expect(capture.timings.wait).toBe(wait);
  });

  it('keeps interaction identity, URL, and time aligned with stable captures', () => {
    expect(
      stableScreenshotInteraction({
        runtimeOrigin: 'http://127.0.0.1:54321',
        sequence: 3,
        url: 'http://127.0.0.1:54321/panel/',
      }),
    ).toEqual({
      id: 'screenshot-interaction-3',
      occurredAt: Date.parse('2026-07-30T10:00:03.000Z'),
      url: 'http://127.0.0.1:4173/panel/',
    });
  });
});
