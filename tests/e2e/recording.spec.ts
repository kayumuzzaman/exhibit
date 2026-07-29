import { expect, test, FIXTURE_PROFILE } from './extension.fixture';

test.describe('recording workflow', () => {
  test('records, explains, inspects, and exports one workflow', async ({ exhibit }) => {
    await exhibit.startRecording();
    await exhibit.trigger('save-profile');
    await exhibit.trigger('load-profile');
    await exhibit.trigger('graphql');

    await expect(exhibit.requestRows()).toHaveCount(3);

    await exhibit.openRequest('/api/profile');
    await expect(exhibit.explainHeading()).toContainText(
      'After Save profile, Exhibit observed',
    );

    await exhibit.openInspect();
    await exhibit.openEvidenceTab('Response');
    await expect(exhibit.responseBody().first()).toContainText(
      FIXTURE_PROFILE.displayName,
    );

    await exhibit.stopRecording();
    const har = await exhibit.exportEvidence();
    expect(JSON.parse(har)).toMatchObject({ log: { version: '1.2' } });

    const report = await exhibit.exportEvidence('markdown');
    expect(report).toContain('Exhibit');
  });

  test('fills the panel height with the workspace when no notice is shown', async ({
    exhibit,
  }) => {
    const shell = await exhibit.page.locator('.app-shell').boundingBox();
    const workspace = await exhibit.page.locator('.workspace').boundingBox();

    expect(shell).not.toBeNull();
    expect(workspace).not.toBeNull();
    expect(workspace!.y + workspace!.height).toBeCloseTo(shell!.y + shell!.height, 0);
  });

  test('keeps the ledger empty until recording starts', async ({ exhibit }) => {
    await exhibit.trigger('load-profile');

    await expect(exhibit.requestRows()).toHaveCount(0);
    await expect(
      exhibit.page.locator('[data-empty-kind="not-recording"]'),
    ).toBeVisible();
  });

  test('clears every captured request and returns to the empty state', async ({
    exhibit,
  }) => {
    await exhibit.startRecording();
    await exhibit.trigger('load-profile');
    await expect(exhibit.requestRows()).toHaveCount(1);

    await exhibit.clearEvidence();

    await expect(exhibit.page.locator('[data-empty-kind]')).toBeVisible();
    await expect(
      exhibit.page.getByRole('button', { name: 'Start recording' }),
    ).toBeVisible();
  });

  test('hides non-API traffic under the default API-only filter', async ({
    exhibit,
  }) => {
    await exhibit.startRecording();
    await exhibit.trigger('binary');
    await exhibit.trigger('load-profile');

    await expect(exhibit.requestRows()).toHaveCount(1);

    await exhibit.setApiOnly(false);
    await expect(exhibit.requestRows()).toHaveCount(2);
    await expect(exhibit.rowFor('/api/binary')).toHaveCount(1);
  });

  test('filters failures, slow calls, and cache hits, then resets', async ({
    exhibit,
    allowedConsoleErrors,
  }) => {
    allowedConsoleErrors.push(/500 \(Internal Server Error\)/u);
    await exhibit.startRecording();
    await exhibit.trigger('load-profile');
    await exhibit.trigger('failing');
    await exhibit.trigger('slow');
    await exhibit.trigger('cacheable');

    await exhibit.toggleQuickFilter('Failures');
    await expect(exhibit.rowFor('/api/error')).toHaveCount(1);
    await expect(exhibit.rowFor('/api/slow')).toHaveCount(0);
    await exhibit.toggleQuickFilter('Failures');

    await exhibit.toggleQuickFilter('Slow calls');
    await expect(exhibit.rowFor('/api/slow')).toHaveCount(1);
    await expect(exhibit.rowFor('/api/error')).toHaveCount(0);
    await exhibit.toggleQuickFilter('Slow calls');

    await exhibit.toggleQuickFilter('Cache hits');
    await expect(exhibit.rowFor('/api/cacheable')).toHaveCount(1);

    await exhibit.resetFilters();
    await expect(exhibit.rowFor('/api/error')).toHaveCount(1);
    await expect(exhibit.rowFor('/api/slow')).toHaveCount(1);
  });

  test('intersects method, domain, protocol, outcome, and cache facets', async ({
    exhibit,
    allowedConsoleErrors,
  }) => {
    allowedConsoleErrors.push(/500 \(Internal Server Error\)/u);
    await exhibit.startRecording();
    await exhibit.trigger('load-profile');
    await exhibit.trigger('save-profile');
    await exhibit.trigger('failing');
    await exhibit.trigger('graphql');

    const domain = new URL(exhibit.page.url()).hostname;
    await exhibit.setFacetFilter('Method', 'POST');
    await exhibit.setFacetFilter('Domain', domain);
    await exhibit.setFacetFilter('Protocol', 'graphql');
    await exhibit.setFacetFilter('Outcome', 'success');
    await exhibit.setFacetFilter('Cache', 'miss');

    await expect(exhibit.requestRows()).toHaveCount(1);
    await expect(exhibit.rowFor('/graphql')).toHaveCount(1);

    await exhibit.resetFilters();
    await expect(exhibit.requestRows()).toHaveCount(4);
  });

  test('searches the ledger by route text', async ({ exhibit }) => {
    await exhibit.startRecording();
    await exhibit.trigger('load-profile');
    await exhibit.trigger('graphql');

    await exhibit.search('graphql');
    await expect(exhibit.requestRows()).toHaveCount(1);
    await expect(exhibit.rowFor('/graphql')).toHaveCount(1);

    await exhibit.search('no-such-route');
    await expect(exhibit.page.locator('[data-empty-kind="no-matches"]')).toBeVisible();
  });

  test('groups requests after the trusted interaction they correlate with', async ({
    exhibit,
  }) => {
    await exhibit.startRecording();
    await exhibit.trigger('save-profile');
    await exhibit.trigger('graphql');

    await expect(exhibit.requestRows()).toHaveCount(2);
    await exhibit.page
      .getByRole('button', {
        name: 'Save profile · Click · Trusted · 1 request',
      })
      .click();
    await expect(exhibit.requestRows()).toHaveCount(1);
    await exhibit.page
      .getByRole('button', { name: 'All interactions · 2 requests' })
      .click();
    await expect(exhibit.requestRows()).toHaveCount(2);

    await exhibit.openRequest('/api/profile');
    await expect(exhibit.explainHeading()).toContainText(
      'After Save profile, Exhibit observed',
    );
    await expect(exhibit.explainHeading()).toContainText('succeeded with HTTP 200');

    await exhibit.openInspect();
    await exhibit.openEvidenceTab('Initiator');
    await expect(exhibit.detailWorkspace()).toContainText('click');
  });

  test('reports redirect, repeat, cache, and service-worker evidence', async ({
    exhibit,
  }) => {
    await exhibit.registerServiceWorker();
    await exhibit.startRecording();
    await exhibit.trigger('redirect');
    await exhibit.trigger('repeated');
    await exhibit.trigger('cacheable');
    await exhibit.trigger('service-worker-data');
    await exhibit.trigger('service-worker-data');

    await exhibit.openRequest('/api/redirect');
    await expect(exhibit.explainHeading()).toContainText('Exhibit observed');
    await exhibit.openInspect();
    await exhibit.openEvidenceTab('Evidence');
    await expect(exhibit.detailWorkspace()).toContainText('redirect target');

    await exhibit.setApiOnly(false);
    await expect(exhibit.rowFor('/api/service-worker-data').last()).toContainText(
      'Service worker',
    );
    await expect(exhibit.rowFor('/api/profile')).toHaveCount(2);

    await exhibit.unregisterServiceWorker();
  });

  test('compares a repeated call against its previous capture', async ({ exhibit }) => {
    await exhibit.startRecording();
    await exhibit.trigger('repeated');

    await expect(exhibit.rowFor('/api/profile')).toHaveCount(2);
    await exhibit.rowFor('/api/profile').last().click();
    await exhibit.openInspect();
    await exhibit.showComparison();

    await expect(exhibit.comparison()).toBeVisible();
    await expect(exhibit.comparison()).toContainText('Status');
  });

  test('renders streamed, binary, truncated, and partially decoded bodies', async ({
    exhibit,
  }) => {
    await exhibit.startRecording();
    await exhibit.setApiOnly(false);
    await exhibit.trigger('stream');
    await exhibit.trigger('binary');
    await exhibit.trigger('large');
    await exhibit.trigger('flight-partial');

    await exhibit.openRequest('/api/stream');
    await exhibit.openInspect();
    await exhibit.openEvidenceTab('Response');
    await expect(exhibit.detailWorkspace()).toContainText('Streamed body');

    await exhibit.openRequest('/api/binary');
    await exhibit.openEvidenceTab('Response');
    await expect(exhibit.detailWorkspace()).toContainText('Binary body');

    await exhibit.openRequest('/api/large');
    await exhibit.openEvidenceTab('Response');
    await expect(exhibit.detailWorkspace()).toContainText('Truncated');

    await exhibit.openRequest('/api/flight-partial');
    await exhibit.openEvidenceTab('Response');
    await expect(exhibit.detailWorkspace()).toContainText('partially decoded');
    await exhibit.page.getByRole('tab', { name: 'Raw protocol' }).click();
    await expect(exhibit.responseBody().first()).toContainText('ProfilePage');
  });

  test('records a cancelled call as a failed request without a response', async ({
    exhibit,
  }) => {
    await exhibit.startRecording();
    await exhibit.trigger('cancelled');
    await exhibit.setApiOnly(false);

    await expect(exhibit.rowFor('/api/hang')).toContainText('ERR');
  });

  test('keeps a blocked cross-origin call visible as evidence', async ({
    exhibit,
    thirdParty,
    allowedConsoleErrors,
  }) => {
    allowedConsoleErrors.push(/CORS policy/u, /Failed to load resource/u);
    await exhibit.startRecording();
    await exhibit.triggerBlockedCrossOrigin(thirdParty.origin);
    await exhibit.setApiOnly(false);

    await expect(exhibit.rowFor('/api/profile')).toContainText('ERR');
  });

  test('copies a safe cURL command and announces the outcome', async ({
    exhibit,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await exhibit.startRecording();
    await exhibit.trigger('secret');
    await exhibit.setApiOnly(false);

    await exhibit.openRequest('/api/secret');
    await exhibit.openInspect();
    await exhibit.copySafeCurl();

    await expect(exhibit.copyResult()).toContainText('Safe cURL copied.');
    const clipboard = await exhibit.page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('curl');
    expect(clipboard).not.toContain('exhibit.e2e.authorization.canary');
  });

  test('supports keyboard navigation across rows and evidence tabs', async ({
    exhibit,
  }) => {
    await exhibit.startRecording();
    await exhibit.trigger('load-profile');
    await exhibit.trigger('graphql');

    await exhibit.requestRows().first().focus();
    await exhibit.page.keyboard.press('ArrowDown');
    await exhibit.page.keyboard.press('Enter');
    await expect(exhibit.detailWorkspace()).toContainText('/graphql');

    await exhibit.openInspect();
    await exhibit.page.getByRole('tab', { name: 'Overview', exact: true }).focus();
    await exhibit.page.keyboard.press('ArrowRight');
    await expect(
      exhibit.page.getByRole('tab', { name: 'Request', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  test('keeps selection and inspector state across responsive layouts', async ({
    exhibit,
  }) => {
    await exhibit.startRecording();
    await exhibit.trigger('load-profile');
    await exhibit.openRequest('/api/profile');
    await exhibit.openInspect();
    await exhibit.openEvidenceTab('Timing');
    await expect(exhibit.detailWorkspace()).toContainText('/api/profile');

    await exhibit.page.setViewportSize({ width: 900, height: 844 });
    await expect(
      exhibit.page.getByRole('tab', { name: 'Inspect', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(
      exhibit.page.getByRole('tab', { name: 'Timing', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    const evidenceTabs = exhibit.page.getByRole('tablist', {
      name: 'Inspect request evidence',
    });
    const evidenceWidth = await evidenceTabs.evaluate((node) => ({
      client: node.clientWidth,
      scroll: node.scrollWidth,
    }));
    expect(evidenceWidth.scroll).toBeLessThanOrEqual(evidenceWidth.client);

    await exhibit.page.setViewportSize({ width: 390, height: 844 });
    await expect(exhibit.detailWorkspace()).toContainText('/api/profile');
    await exhibit.page.getByRole('button', { name: 'Back to requests' }).click();
    await expect(exhibit.requestRows()).toHaveCount(1);
  });
});
