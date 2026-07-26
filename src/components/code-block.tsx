import type { ReactNode } from 'react';

export function CodeBlock({
  children,
  label,
  wrap = false,
}: Readonly<{
  children: ReactNode;
  label?: string;
  wrap?: boolean;
}>) {
  return (
    <pre
      {...(label === undefined ? {} : { 'aria-label': label })}
      className={wrap ? 'code-block code-block--wrap' : 'code-block'}
    >
      <code>{children}</code>
    </pre>
  );
}
