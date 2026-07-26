import {
  CopyButton,
  type CopyFunction,
  type CopyResult,
} from '../../components/copy-button';
import { isCredentialHeaderName } from '../../domain/curl';
import type { Header } from '../../domain/model';
import { REDACTED } from '../../domain/redaction';

function safeValue(header: Header): string {
  return isCredentialHeaderName(header.name) ? REDACTED : header.value;
}

export function HeaderList({
  copy,
  headers,
  onCopyResult,
}: Readonly<{
  copy?: CopyFunction;
  headers: readonly Header[];
  onCopyResult?: (result: CopyResult) => void;
}>) {
  if (headers.length === 0) return <p className="body-state">No headers captured.</p>;

  return (
    <ul aria-label="Captured headers" className="header-list">
      {headers.map((header, index) => {
        const value = safeValue(header);
        return (
          <li aria-label={header.name} key={`${header.name}-${index}`}>
            <span className="header-list__name">{header.name}</span>
            <code className="header-list__value">{value}</code>
            <CopyButton
              {...(copy === undefined ? {} : { copy })}
              errorMessage={`${header.name} could not be copied. Clipboard unavailable.`}
              label={`Copy ${header.name} value`}
              {...(onCopyResult === undefined ? {} : { onResult: onCopyResult })}
              successMessage={`${header.name} copied.`}
              value={value}
            />
          </li>
        );
      })}
    </ul>
  );
}
