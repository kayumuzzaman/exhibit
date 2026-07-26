'use client';

import Link from 'next/link';
import { useState } from 'react';

import { failingAction, saveProfile } from './actions';

export default function Page() {
  const [state, setState] = useState('idle');

  return (
    <main>
      <h1>Payloadra Next fixture</h1>
      <p id="next-state">{state}</p>
      <button
        id="next-save-action"
        onClick={() => {
          setState('pending');
          void saveProfile('Ada').then(
            (result) => setState(`saved:${result.displayName}`),
            () => setState('error'),
          );
        }}
        type="button"
      >
        Save profile action
      </button>
      <button
        id="next-failing-action"
        onClick={() => {
          setState('pending');
          void failingAction().then(
            () => setState('unexpected'),
            () => setState('action-failed'),
          );
        }}
        type="button"
      >
        Failing action
      </button>
      <button
        id="next-api-route"
        onClick={() => {
          setState('pending');
          void fetch('/next/api/profile')
            .then((response) => response.json())
            .then(() => setState('api-loaded'))
            .catch(() => setState('error'));
        }}
        type="button"
      >
        Call API route
      </button>
      <Link href="/rsc" id="next-rsc-link">
        Open RSC page
      </Link>
    </main>
  );
}
