// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { BodyContent } from '../../../src/domain/model';
import { BodyViewer } from '../../../src/features/inspect/body-viewer';
import '../../../src/styles/tokens.css';
import '../../../src/styles/reset.css';
import '../../../src/styles/app.css';

const partialFlightBody: BodyContent = {
  state: 'available',
  size: 22,
  capturedSize: 22,
  mimeType: 'text/x-component',
  text: '0:{"a":1}\n1:Qunknown',
};

describe('BodyViewer', () => {
  it('shows raw fallback beside partial Flight decoding', async () => {
    const user = userEvent.setup();
    render(<BodyViewer body={partialFlightBody} />);

    expect(screen.getByText(/partially decoded/i)).toBeVisible();
    expect(screen.getByText(/chunk 0/i)).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Raw protocol' }));
    expect(screen.getByText(/0:\{"a":1\}/)).toBeVisible();
    expect(screen.getByText(/1:Qunknown/)).toBeVisible();
  });

  it('switches between structured JSON and captured text without executing markup', async () => {
    const user = userEvent.setup();
    render(
      <BodyViewer
        body={{
          state: 'available',
          size: 51,
          capturedSize: 51,
          mimeType: 'application/json',
          text: '{"ok":true,"markup":"<img src=x onerror=alert(1)>"}',
        }}
      />,
    );

    expect(screen.getByText(/"ok": true/)).toBeVisible();
    expect(document.querySelector('img')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Text' }));
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeVisible();
    expect(document.querySelector('img')).not.toBeInTheDocument();
  });

  it.each([
    [
      {
        state: 'binary',
        size: 4096,
        capturedSize: 0,
        mimeType: 'image/png',
        reason: 'Binary response',
      } satisfies BodyContent,
      /binary body · 4 KB · image\/png/i,
    ],
    [
      {
        state: 'streamed',
        size: 0,
        capturedSize: 0,
        mimeType: 'text/event-stream',
        reason: 'Streaming response',
      } satisfies BodyContent,
      /streamed body.*not buffered/i,
    ],
    [
      {
        state: 'unavailable',
        size: 0,
        capturedSize: 0,
        reason: 'DevTools body unavailable',
      } satisfies BodyContent,
      /body unavailable.*DevTools body unavailable/i,
    ],
  ])('describes non-renderable body evidence', (body, message) => {
    render(<BodyViewer body={body} />);
    expect(screen.getByText(message)).toBeVisible();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('labels a truncated body and renders only its captured excerpt', () => {
    render(
      <BodyViewer
        body={{
          state: 'truncated',
          size: 900_000,
          capturedSize: 19,
          mimeType: 'text/plain',
          text: 'safe captured text',
        }}
      />,
    );

    expect(screen.getByText(/truncated/i)).toBeVisible();
    expect(screen.getByText(/19 B of 879 KB captured/i)).toBeVisible();
    expect(screen.getByText('safe captured text')).toBeVisible();
  });

  it('states complete and unsupported Flight decoding while preserving original raw rows', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <BodyViewer
        body={{
          state: 'available',
          size: 9,
          capturedSize: 9,
          mimeType: 'text/x-component',
          text: '0:{"a":1}',
        }}
      />,
    );
    expect(screen.getByText(/decoded within safe limits/i)).toBeVisible();

    rerender(
      <BodyViewer
        body={{
          state: 'available',
          size: 10,
          capturedSize: 10,
          mimeType: 'text/x-component',
          text: '0:Qunknown',
        }}
      />,
    );
    expect(screen.getByText(/could not be decoded/i)).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Raw protocol' }));
    expect(screen.getByText('0:Qunknown')).toBeVisible();
  });

  it('directs plain text to Text mode and handles missing captured text', () => {
    const { rerender } = render(
      <BodyViewer
        body={{
          state: 'available',
          size: 11,
          capturedSize: 11,
          mimeType: 'text/plain',
          text: 'hello world',
        }}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Text' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('hello world')).toBeVisible();

    rerender(<BodyViewer body={{ state: 'available', size: 0, capturedSize: 0 }} />);
    expect(screen.getByText(/no captured text was available/i)).toBeVisible();
  });

  it('formats large binary evidence without requiring a MIME type', () => {
    render(<BodyViewer body={{ state: 'binary', size: 2_097_152, capturedSize: 0 }} />);
    expect(screen.getByText(/binary body · 2\.0 MB/i)).toBeVisible();
  });
});
