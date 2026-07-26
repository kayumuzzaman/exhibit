import { useMemo } from 'react';

import { CodeBlock } from '../../components/code-block';
import { Tabs, type TabItem } from '../../components/tabs';
import type { BodyContent } from '../../domain/model';
import { decodeFlight, type FlightDecodeResult } from '../../domain/react-flight';
import { DEFAULT_LIMITS } from '../../domain/session';

function byteSize(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${Math.round(value / 1_024)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

function isFlight(body: BodyContent): boolean {
  const mime = body.mimeType?.split(';', 1)[0]?.trim().toLowerCase();
  return mime === 'text/x-component';
}

function structuredJson(text: string): string | undefined {
  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2);
  } catch {
    return undefined;
  }
}

function FlightStructure({ result }: Readonly<{ result: FlightDecodeResult }>) {
  return (
    <div className="flight-structure">
      <p className={`decode-state decode-state--${result.status}`}>
        {result.status === 'decoded'
          ? 'Flight body decoded within safe limits.'
          : result.status === 'partial'
            ? 'Flight body partially decoded. Raw protocol remains available.'
            : 'Flight structure could not be decoded. Raw protocol remains available.'}
      </p>
      {result.warnings.length === 0 ? null : (
        <ul className="decode-warnings">
          {result.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {result.chunks.length === 0 ? null : (
        <ol className="flight-chunks">
          {result.chunks.map((chunk) => (
            <li key={chunk.id}>
              <strong>
                Chunk {chunk.id} · {chunk.kind}
              </strong>
              <CodeBlock wrap>{JSON.stringify(chunk.value, null, 2)}</CodeBlock>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function BodyViewer({ body }: Readonly<{ body: BodyContent }>) {
  const text = body.text;
  const flight = isFlight(body);
  const flightResult = useMemo(
    () =>
      flight && text !== undefined
        ? decodeFlight(text, {
            maxBytes: Math.min(DEFAULT_LIMITS.maxBodyBytes, body.capturedSize),
            maxRows: 1_000,
            maxDepth: 20,
          })
        : undefined,
    [body.capturedSize, flight, text],
  );
  const json = useMemo(
    () => (flight || text === undefined ? undefined : structuredJson(text)),
    [flight, text],
  );

  if (body.state === 'binary') {
    return (
      <p className="body-state">
        Binary body · {byteSize(body.size)}
        {body.mimeType === undefined ? '' : ` · ${body.mimeType}`}. Content is not
        decoded.
      </p>
    );
  }
  if (body.state === 'streamed') {
    return (
      <p className="body-state">
        Streamed body was not buffered. Headers and timing remain available.
      </p>
    );
  }
  if (body.state === 'unavailable') {
    return (
      <p className="body-state">
        Body unavailable. {body.reason ?? 'DevTools did not provide content.'}
      </p>
    );
  }
  if (text === undefined) {
    return <p className="body-state">No captured text was available for this body.</p>;
  }

  const meta =
    body.state === 'truncated' ? (
      <p className="body-state body-state--warning">
        Truncated · {byteSize(body.capturedSize)} of {byteSize(body.size)} captured.
      </p>
    ) : null;
  const tabs: Array<TabItem<'structured' | 'text' | 'raw'>> = [
    {
      id: 'structured',
      label: 'Structured',
      content:
        flightResult !== undefined ? (
          <FlightStructure result={flightResult} />
        ) : json === undefined ? (
          <p className="body-state">No structured representation is available.</p>
        ) : (
          <CodeBlock label="Structured body" wrap>
            {json}
          </CodeBlock>
        ),
    },
    {
      id: 'text',
      label: 'Text',
      content: (
        <CodeBlock label="Captured body text" wrap>
          {text}
        </CodeBlock>
      ),
    },
  ];
  if (flight) {
    tabs.push({
      id: 'raw',
      label: 'Raw protocol',
      content: (
        <CodeBlock label="Original raw Flight protocol" wrap>
          {text}
        </CodeBlock>
      ),
    });
  }

  return (
    <div className="body-viewer">
      {meta}
      <Tabs
        defaultActiveId={flight || json !== undefined ? 'structured' : 'text'}
        label="Body representation"
        tabs={tabs}
      />
    </div>
  );
}
