import { Button } from './button';
import { Dialog } from './dialog';

export type EvidenceExportFormat = 'har' | 'markdown';

function countLabel(count: number): string {
  return `${count} ${count === 1 ? 'request' : 'requests'}`;
}

function destinationLabel(format: EvidenceExportFormat): string {
  return format === 'har' ? 'HAR 1.2 (.har)' : 'Markdown (.md)';
}

export function ExportDialog({
  busy,
  error,
  format,
  onClose,
  onExport,
  onFormatChange,
  requestCount,
}: Readonly<{
  busy: boolean;
  error: string;
  format: EvidenceExportFormat;
  onClose(): void;
  onExport(): void;
  onFormatChange(format: EvidenceExportFormat): void;
  requestCount: number;
}>) {
  return (
    <Dialog
      description="Only this sanitized session is exported. Authorization and cookies are always removed."
      onClose={onClose}
      title="Export sanitized evidence"
    >
      <dl className="export-facts">
        <div>
          <dt>Redaction</dt>
          <dd>Enforced</dd>
        </div>
        <div>
          <dt>Items</dt>
          <dd>{countLabel(requestCount)}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>{destinationLabel(format)}</dd>
        </div>
      </dl>

      <fieldset className="export-formats">
        <legend>File format</legend>
        <label className="export-format">
          <input
            aria-label="Sanitized HAR 1.2"
            checked={format === 'har'}
            {...(format === 'har' ? { 'data-initial-focus': '' } : {})}
            name="exhibit-export-format"
            onChange={() => onFormatChange('har')}
            type="radio"
            value="har"
          />
          <span>
            <strong>Sanitized HAR 1.2</strong>
            <small>Complete request evidence for network tools</small>
          </span>
          <code>.har</code>
        </label>
        <label className="export-format">
          <input
            aria-label="Markdown QA report"
            checked={format === 'markdown'}
            {...(format === 'markdown' ? { 'data-initial-focus': '' } : {})}
            name="exhibit-export-format"
            onChange={() => onFormatChange('markdown')}
            type="radio"
            value="markdown"
          />
          <span>
            <strong>Markdown QA report</strong>
            <small>Timeline, failures, slow calls, and repeats</small>
          </span>
          <code>.md</code>
        </label>
      </fieldset>

      {error === '' ? null : (
        <p className="dialog__error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog__actions">
        <Button onClick={onClose}>Cancel export</Button>
        <Button disabled={busy} onClick={onExport} tone="primary">
          {format === 'har' ? 'Export sanitized HAR' : 'Export Markdown report'}
        </Button>
      </div>
    </Dialog>
  );
}
