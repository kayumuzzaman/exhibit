import type { RecordingPhase } from '../domain/model';

const LABELS: Readonly<Record<RecordingPhase, string>> = {
  recording: 'Recording',
  starting: 'Starting',
  stopped: 'Not recording',
  stopping: 'Stopping',
};

export function StatusPill({ phase }: Readonly<{ phase: RecordingPhase }>) {
  const active = phase === 'recording' || phase === 'starting';
  return (
    <span className="status-pill" data-active={active} data-phase={phase}>
      <span aria-hidden="true" className="status-pill__mark" />
      {LABELS[phase]}
    </span>
  );
}
