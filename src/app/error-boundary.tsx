import { Component, useState, type ReactNode } from 'react';

import { Button } from '../components/button';
import { Dialog } from '../components/dialog';
import { Icon } from '../components/icon';
import type { SessionController } from '../features/session/session-controller';

function RecoveryWorkspace({
  controller,
  exportEvidence,
}: Readonly<{
  controller: SessionController;
  exportEvidence: () => Promise<void>;
}>) {
  const [dialog, setDialog] = useState<'clear' | 'export' | null>(null);
  const [announcement, setAnnouncement] = useState('');

  async function clear(): Promise<void> {
    await controller.clear();
    setDialog(null);
    setAnnouncement('Evidence cleared.');
  }

  async function exportSafe(): Promise<void> {
    await exportEvidence();
    setDialog(null);
    setAnnouncement('Sanitized evidence exported.');
  }

  return (
    <main className="recovery-shell" role="alert">
      <div className="recovery-shell__trace" />
      <p className="eyebrow">Safe recovery</p>
      <h1>Workspace could not render</h1>
      <p>
        Captured evidence remains sanitized. Clear it or export a safe copy, then reopen
        DevTools.
      </p>
      <div className="recovery-shell__actions">
        <Button aria-label="Clear evidence" onClick={() => setDialog('clear')}>
          <Icon name="clear" /> Clear
        </Button>
        <Button aria-label="Export evidence" onClick={() => setDialog('export')}>
          <Icon name="export" /> Export
        </Button>
      </div>
      <p aria-atomic="true" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {dialog === 'clear' ? (
        <Dialog
          description="This removes the current local evidence session. This action cannot be undone."
          onClose={() => setDialog(null)}
          title="Clear captured evidence"
        >
          <div className="dialog__actions">
            <Button data-initial-focus="" onClick={() => setDialog(null)}>
              Keep evidence
            </Button>
            <Button onClick={() => void clear()} tone="danger">
              Clear evidence now
            </Button>
          </div>
        </Dialog>
      ) : null}
      {dialog === 'export' ? (
        <Dialog
          description="Authorization and cookies are always removed from exported evidence."
          onClose={() => setDialog(null)}
          title="Export sanitized evidence"
        >
          <div className="dialog__actions">
            <Button data-initial-focus="" onClick={() => setDialog(null)}>
              Cancel export
            </Button>
            <Button onClick={() => void exportSafe()} tone="primary">
              Export sanitized file
            </Button>
          </div>
        </Dialog>
      ) : null}
    </main>
  );
}

type AppErrorBoundaryProps = Readonly<{
  children: ReactNode;
  controller: SessionController;
  exportEvidence?: () => Promise<void>;
}>;

type AppErrorBoundaryState = Readonly<{ failed: boolean }>;

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  override state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(): void {
    // Raw exception content intentionally never enters the recovery UI or logs.
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <RecoveryWorkspace
          controller={this.props.controller}
          exportEvidence={this.props.exportEvidence ?? (async () => undefined)}
        />
      );
    }
    return this.props.children;
  }
}
