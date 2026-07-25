import { createRoot } from 'react-dom/client';

export function bootPanel(): void {
  const container = document.querySelector('#root');

  if (container === null) {
    throw new Error('Payloadra panel root is unavailable.');
  }

  createRoot(container).render(<main>Payloadra is ready.</main>);
}

bootPanel();
