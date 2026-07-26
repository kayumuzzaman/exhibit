// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RequestTable } from '../../../src/features/session/request-table';
import type { SanitizedCapturedRequest } from '../../../src/domain/sanitized';
import { sanitizedRequestWith } from '../../helpers/request-factory';
import '../../../src/styles/tokens.css';
import '../../../src/styles/reset.css';
import '../../../src/styles/app.css';

function records(): readonly SanitizedCapturedRequest[] {
  return [
    sanitizedRequestWith({
      id: 'orders',
      url: 'https://app.test/api/orders?cursor=redacted',
      method: 'POST',
      responseStatus: 201,
      durationMs: 42,
      classification: {
        kind: 'api',
        confidence: 'confirmed',
        evidence: ['fetch'],
      },
    }),
    sanitizedRequestWith({
      id: 'profile',
      url: 'https://app.test/api/profile',
      method: 'GET',
      responseStatus: 503,
      durationMs: 1_220,
      responseBody: {
        state: 'unavailable',
        size: 0,
        capturedSize: 0,
        reason: 'DevTools body unavailable',
      },
      classification: {
        kind: 'graphql',
        confidence: 'likely',
        evidence: ['operation'],
      },
    }),
    sanitizedRequestWith({
      id: 'audit',
      url: 'https://app.test/api/audit',
      method: 'GET',
      responseStatus: 200,
      responseBody: {
        state: 'truncated',
        size: 800_000,
        capturedSize: 524_288,
        text: 'safe excerpt',
      },
      classification: {
        kind: 'api',
        confidence: 'confirmed',
        evidence: [],
      },
    }),
  ];
}

describe('RequestTable', () => {
  it('uses roving row focus with arrows, Home, End, Enter, and Space', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const dataset = records();
    render(<RequestTable requests={dataset} selectedId={null} onSelect={onSelect} />);
    const rows = screen.getAllByRole('row').slice(1);

    expect(rows[0]).toHaveAttribute('tabindex', '0');
    expect(rows[1]).toHaveAttribute('tabindex', '-1');
    rows[0]!.focus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(rows[1]).toHaveFocus();
    expect(onSelect).toHaveBeenLastCalledWith(dataset[1]);
    await user.keyboard('{End} ');
    expect(rows[2]).toHaveFocus();
    expect(onSelect).toHaveBeenLastCalledWith(dataset[2]);
    await user.keyboard('{Home}');
    expect(rows[0]).toHaveFocus();
  });

  it('presents forensic columns and explicit body availability states', () => {
    const dataset = records();
    render(
      <RequestTable
        requests={dataset}
        selectedId={dataset[1]?.id ?? null}
        onSelect={() => undefined}
      />,
    );

    expect(screen.getByRole('table', { name: 'Captured requests' })).toBeVisible();
    for (const heading of [
      'Time',
      'Method',
      'Route',
      'Kind',
      'Status',
      'Duration',
      'Source',
      'Evidence',
    ]) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeVisible();
    }
    expect(screen.getByRole('row', { name: /profile/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('Body unavailable')).toBeVisible();
    expect(screen.getByText('Body truncated')).toBeVisible();
    expect(screen.getByText('1.22 s')).toBeVisible();
  });

  it('shows a directed no-match state instead of an empty table', () => {
    render(
      <RequestTable
        requests={[]}
        selectedId={null}
        onSelect={() => undefined}
        emptyReason="no-matches"
      />,
    );
    expect(screen.getByText(/no requests match these filters/i)).toBeVisible();
    expect(screen.getByText(/clear search or filters/i)).toBeVisible();
  });

  it('gives the selected phone row a persistent inset rule beyond background color', () => {
    const dataset = records();
    render(
      <RequestTable
        onSelect={() => undefined}
        phone
        requests={dataset}
        selectedId={dataset[1]!.id}
      />,
    );

    const selected = screen.getByRole('row', { name: /profile/i });
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(getComputedStyle(selected).boxShadow).toContain('inset');
  });
});
