import type { RecordingPhase } from '../../domain/model';
import { Button } from '../../components/button';
import { Icon } from '../../components/icon';
import { StatusPill } from '../../components/status-pill';
import type { ThemeMode } from '../settings/exhibit-settings';

export type { ThemeMode } from '../settings/exhibit-settings';
type ExplicitTheme = Extract<ThemeMode, 'dark' | 'light'>;

export function CommandBar({
  busy,
  onClear,
  onExport,
  onRecord,
  onSettings,
  onTheme,
  origin,
  phase,
  resolvedTheme,
}: Readonly<{
  busy: boolean;
  onClear(): void;
  onExport(): void;
  onRecord(): void;
  onSettings(): void;
  onTheme(theme: ExplicitTheme): void;
  origin: string;
  phase: RecordingPhase;
  resolvedTheme: ExplicitTheme;
}>) {
  const recording = phase === 'recording' || phase === 'starting';
  const nextTheme: ExplicitTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
  return (
    <header className="command-bar">
      <div className="command-bar__record">
        <Button
          aria-label={recording ? 'Stop recording' : 'Start recording'}
          className="record-control"
          disabled={busy}
          onClick={onRecord}
          tone={recording ? 'danger' : 'primary'}
        >
          <Icon name={recording ? 'stop' : 'record'} />
          <span>{recording ? 'Stop' : 'Start'}</span>
        </Button>
      </div>

      <div className="brand-lockup">
        <span aria-hidden="true" className="brand-mark">
          <span />
        </span>
        <span className="brand-word">Exhibit</span>
        <span className="brand-scope">Network evidence</span>
      </div>

      <div className="origin-lockup">
        <span>Inspected origin</span>
        <strong title={origin}>{origin}</strong>
      </div>

      <StatusPill phase={phase} />

      <div className="command-bar__actions">
        <Button aria-label="Clear evidence" onClick={onClear} tone="quiet">
          <Icon name="clear" />
          <span>Clear</span>
        </Button>
        <Button aria-label="Export evidence" onClick={onExport}>
          <Icon name="export" />
          <span>Export</span>
        </Button>
        <Button aria-label="Settings" onClick={onSettings} tone="quiet">
          <Icon name="settings" />
          <span>Settings</span>
        </Button>
        <Button
          aria-label={`Switch to ${nextTheme} theme`}
          className="theme-control"
          onClick={() => onTheme(nextTheme)}
          title={`Switch to ${nextTheme} theme`}
          tone="quiet"
        >
          <Icon name="theme" />
        </Button>
      </div>
    </header>
  );
}
