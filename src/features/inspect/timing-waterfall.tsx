import type { RequestTiming } from '../../domain/model';
import type { CSSProperties } from 'react';

const SEGMENTS = [
  ['Blocked', 'blockedMs', 'solid'],
  ['DNS', 'dnsMs', 'dots'],
  ['Connect', 'connectMs', 'slashes'],
  ['SSL', 'sslMs', 'cross'],
  ['Send', 'sendMs', 'bars'],
  ['Wait', 'waitMs', 'waves'],
  ['Receive', 'receiveMs', 'checks'],
] as const;

const PATTERN_GLYPHS: Readonly<Record<(typeof SEGMENTS)[number][2], string>> = {
  solid: '━━━━',
  dots: '····',
  slashes: '////',
  cross: '××××',
  bars: '||||',
  waves: '~~~~',
  checks: '⌄⌄⌄⌄',
};

function finiteNonNegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function TimingWaterfall({ timing }: Readonly<{ timing: RequestTiming }>) {
  const total = finiteNonNegative(timing.totalMs);
  const accessibleSegments = SEGMENTS.map(
    ([label, key]) => `${label} ${Math.round(finiteNonNegative(timing[key]))} ms`,
  ).join('; ');

  return (
    <div className="timing-waterfall">
      {/* Only the bars are a graphic. Wrapping the caption in `role="img"` too
          would make it presentational and hide the TLS caveat from a reader. */}
      <div
        aria-label={`Request timing waterfall, ${Math.round(total)} ms total. ${accessibleSegments}. TLS duration belongs to its parent phase and is not counted twice.`}
        role="img"
      >
        <div className="timing-waterfall__scale" aria-hidden="true">
          <span>0</span>
          <span>{Math.round(total / 2)} ms</span>
          <span>{Math.round(total)} ms</span>
        </div>
        <ol>
          {SEGMENTS.map(([label, key, pattern]) => {
            const value = finiteNonNegative(timing[key]);
            const width = total === 0 ? 0 : Math.min(100, (value / total) * 100);
            return (
              <li
                data-pattern={pattern}
                key={key}
                style={
                  {
                    '--timing-width': `${width}%`,
                    width: `${width}%`,
                  } as CSSProperties
                }
              >
                <span className="timing-waterfall__label">{label}</span>
                <span className="timing-waterfall__pattern" aria-hidden="true">
                  {PATTERN_GLYPHS[pattern]}
                </span>
                <span className="timing-waterfall__value">{Math.round(value)} ms</span>
              </li>
            );
          })}
        </ol>
      </div>
      <p>
        Each phase is scaled against total HAR time. TLS duration belongs to its parent
        phase and is not added twice.
      </p>
    </div>
  );
}
