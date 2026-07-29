import { fileURLToPath } from 'node:url';
import type { Locator, Page } from 'playwright/test';

import { expect, test } from './extension.fixture';
import type { ExhibitDriver } from './devtools-driver';

const AXE_SOURCE = fileURLToPath(
  new URL('../../node_modules/axe-core/axe.min.js', import.meta.url),
);
const BLOCKING_IMPACTS = new Set(['critical', 'serious']);

type AxeViolation = Readonly<{
  id: string;
  impact: string | null;
  help: string;
  nodes: readonly { target: readonly string[] }[];
}>;

declare global {
  var axe: {
    run(context: unknown, options?: unknown): Promise<{ violations: AxeViolation[] }>;
  };
}

async function scan(page: Page, label: string): Promise<void> {
  await page.addScriptTag({ path: AXE_SOURCE });
  const violations = await page.evaluate(async () => {
    const result = await globalThis.axe.run(document.querySelector('.app-shell'), {
      resultTypes: ['violations'],
    });
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }));
  });
  const blocking = violations.filter(
    (violation) => violation.impact !== null && BLOCKING_IMPACTS.has(violation.impact),
  );
  expect(blocking, `${label} has blocking accessibility violations`).toEqual([]);
}

async function populate(exhibit: ExhibitDriver): Promise<void> {
  await exhibit.startRecording();
  await exhibit.trigger('save-profile');
  await exhibit.trigger('graphql');
  await exhibit.trigger('slow');
}

async function expectTouchTargets(locator: Locator, label: string): Promise<void> {
  const count = await locator.count();
  expect(count, `${label} should expose at least one target`).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const target = locator.nth(index);
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    expect(box, `${label} target ${index + 1} should be rendered`).not.toBeNull();
    expect(box!.width, `${label} target ${index + 1} width`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${label} target ${index + 1} height`).toBeGreaterThanOrEqual(
      44,
    );
  }
}

test.describe('accessibility', () => {
  test('passes axe in the empty, recording, explain, and inspect states', async ({
    exhibit,
  }) => {
    await scan(exhibit.page, 'empty panel');

    await populate(exhibit);
    await scan(exhibit.page, 'recording ledger');

    await exhibit.openRequest('/api/profile');
    await scan(exhibit.page, 'explain workspace');

    await exhibit.openInspect();
    for (const tab of ['Request', 'Response', 'Timing', 'Evidence'] as const) {
      await exhibit.openEvidenceTab(tab);
      await scan(exhibit.page, `inspect ${tab}`);
    }
  });

  test('passes axe in the narrow layout and inside the filters drawer', async ({
    exhibit,
  }) => {
    await populate(exhibit);
    await exhibit.page.setViewportSize({ width: 390, height: 844 });
    await scan(exhibit.page, 'narrow ledger');

    await exhibit.page.getByRole('button', { name: 'Open session rail' }).click();
    await expect(
      exhibit.page.getByRole('dialog', { name: 'Session filters' }),
    ).toBeVisible();
    await scan(exhibit.page, 'session filters drawer');

    const closeRail = exhibit.page.getByRole('button', {
      name: 'Close session rail',
    });
    const closeRailBox = await closeRail.boundingBox();
    expect(closeRailBox).not.toBeNull();
    expect(closeRailBox!.width).toBeGreaterThanOrEqual(44);
    expect(closeRailBox!.height).toBeGreaterThanOrEqual(44);
    await closeRail.click();

    await exhibit.page.getByRole('button', { name: 'Export evidence' }).click();
    const exportActions = exhibit.page.locator('.dialog__actions .button');
    await expect(exportActions).toHaveCount(2);
    for (const action of await exportActions.all()) {
      const box = await action.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('keeps phone controls and evidence rows at least 44 CSS pixels', async ({
    exhibit,
  }) => {
    await populate(exhibit);
    await exhibit.page.setViewportSize({ width: 390, height: 844 });

    await expectTouchTargets(
      exhibit.page.locator(
        '.command-bar .button, .command-bar .theme-control, .ledger-search input, .ledger-search .button',
      ),
      'phone command and search',
    );
    await expectTouchTargets(exhibit.requestRows(), 'phone request row');

    await exhibit.page.getByRole('button', { name: 'Open session rail' }).click();
    const drawer = exhibit.page.getByRole('dialog', { name: 'Session filters' });
    await drawer.locator('.facet-filters summary').click();
    await expectTouchTargets(
      drawer.locator(
        '.session-rail__heading .button, .retention-control select, .rail-check, .quick-filter-chip, .facet-filters summary, .facet-filter-grid select, .rail-reset, .interaction-group',
      ),
      'phone filter drawer',
    );

    await drawer.getByRole('button', { name: 'Close session rail' }).click();
    await exhibit.openRequest('/api/profile');
    await exhibit.openInspect();
    await exhibit.openEvidenceTab('Response');
    await expectTouchTargets(
      exhibit.detailWorkspace().locator('.tabs__tab:visible, .copy-button:visible'),
      'phone evidence controls',
    );
  });

  test('restores focus to the trigger after a dialog closes', async ({ exhibit }) => {
    await populate(exhibit);

    const exportButton = exhibit.page.getByRole('button', {
      name: 'Export evidence',
    });
    await exportButton.click();
    await expect(
      exhibit.page.getByRole('dialog', { name: 'Export sanitized evidence' }),
    ).toBeVisible();
    await scan(exhibit.page, 'export dialog');

    await exhibit.page.keyboard.press('Escape');
    await expect(exportButton).toBeFocused();
  });

  test('announces recording state through a live status region', async ({
    exhibit,
  }) => {
    const status = exhibit.page.getByRole('status');
    await expect(status).toContainText('Not recording');

    await exhibit.startRecording();
    await expect(status).toContainText('Recording');

    await exhibit.stopRecording();
    await expect(status).toContainText('Recording stopped.');
  });

  test('labels timing phases with text as well as colour and pattern', async ({
    exhibit,
  }) => {
    await populate(exhibit);
    await exhibit.openRequest('/api/slow');
    await exhibit.openInspect();
    await exhibit.openEvidenceTab('Timing');

    const waterfall = exhibit.page.getByRole('img', {
      name: /Request timing waterfall/u,
    });
    await expect(waterfall).toBeVisible();
    for (const phase of ['Blocked', 'DNS', 'Connect', 'Send', 'Wait', 'Receive']) {
      await expect(waterfall).toContainText(phase);
    }
    await expect(waterfall).toContainText('ms');
  });

  test('aligns every ledger value under its own heading', async ({ exhibit }) => {
    await populate(exhibit);

    const offsets = await exhibit.page.evaluate(() => {
      const table = document.querySelector('table.request-table');
      const headings = [...(table?.querySelectorAll('thead th') ?? [])];
      const cells = [...(table?.querySelectorAll('tbody tr:first-child td') ?? [])];
      return headings.map((heading, index) => ({
        heading: heading.textContent,
        drift:
          Math.round(heading.getBoundingClientRect().x) -
          Math.round(cells[index]?.getBoundingClientRect().x ?? -1),
      }));
    });

    expect(offsets.length).toBeGreaterThan(0);
    // A row pseudo-element used to generate an anonymous leading cell, which
    // put every value one column right of the heading that named it.
    expect(offsets.filter(({ drift }) => drift !== 0)).toEqual([]);
  });

  test('marks the selected row with more than a background colour', async ({
    exhibit,
  }) => {
    await populate(exhibit);
    await exhibit.openRequest('/api/profile');

    const shadow = await exhibit
      .requestRows()
      .filter({ hasText: '/api/profile' })
      .first()
      .evaluate((row) => getComputedStyle(row).boxShadow);

    expect(shadow).toContain('inset');
  });

  test('honours the reduced-motion preference', async ({ exhibit }) => {
    await exhibit.page.emulateMedia({ reducedMotion: 'reduce' });
    await exhibit.reload();

    await expect(exhibit.page.locator('.app-shell')).toHaveAttribute(
      'data-reduced-motion',
      'true',
    );
  });
});

test.describe('narrow layout focus', () => {
  test('moves focus into the detail region and back to the row', async ({
    exhibit,
  }) => {
    await exhibit.startRecording();
    await exhibit.trigger('save-profile');
    await exhibit.page.setViewportSize({ width: 390, height: 844 });

    await exhibit.openRequest('/api/profile');
    await expect(exhibit.detailWorkspace()).toBeFocused();

    await exhibit.page.getByRole('button', { name: 'Back to requests' }).click();
    await expect(exhibit.requestRows().first()).toBeFocused();
  });
});
