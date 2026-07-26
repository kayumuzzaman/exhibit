import { useState } from 'react';

import { copyText as copyToClipboard } from '../infrastructure/clipboard';
import { Button } from './button';
import { Icon } from './icon';

export type CopyFunction = (text: string) => Promise<void>;
export type CopyResult = Readonly<{ message: string; tone: 'error' | 'success' }>;

export function CopyButton({
  copy = copyToClipboard,
  errorMessage,
  label,
  onResult,
  successMessage,
  value,
}: Readonly<{
  copy?: CopyFunction;
  errorMessage: string;
  label: string;
  onResult?: (result: CopyResult) => void;
  successMessage: string;
  value: string;
}>) {
  const [result, setResult] = useState<CopyResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function copyValue(): Promise<void> {
    setBusy(true);
    try {
      await copy(value);
      const next = { message: successMessage, tone: 'success' as const };
      setResult(next);
      onResult?.(next);
    } catch {
      const next = { message: errorMessage, tone: 'error' as const };
      setResult(next);
      onResult?.(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        aria-label={label}
        className="copy-button"
        disabled={busy}
        onClick={() => void copyValue()}
        tone="quiet"
      >
        <Icon name="copy" />
        <span>{busy ? 'Copying…' : label}</span>
      </Button>
      {onResult === undefined && result !== null ? (
        <span
          className={`copy-result copy-result--${result.tone}`}
          role={result.tone === 'error' ? 'alert' : 'status'}
        >
          {result.message}
        </span>
      ) : null}
    </>
  );
}
