import { expect, test, FIXTURE_PROFILE } from './extension.fixture';

test.describe('recording workflow', () => {
  test('records, explains, inspects, and exports one workflow', async ({
    payloadra,
  }) => {
    await payloadra.startRecording();
    await payloadra.trigger('save-profile');
    await payloadra.trigger('load-profile');
    await payloadra.trigger('graphql');

    await expect(payloadra.requestRows()).toHaveCount(3);

    await payloadra.openRequest('/api/profile');
    await expect(payloadra.explainHeading()).toContainText('Save profile triggered');

    await payloadra.openInspect();
    await payloadra.openEvidenceTab('Response');
    await expect(payloadra.responseBody().first()).toContainText(
      FIXTURE_PROFILE.displayName,
    );

    await payloadra.stopRecording();
    const har = await payloadra.exportEvidence();
    expect(JSON.parse(har)).toMatchObject({ log: { version: '1.2' } });

    const report = await payloadra.exportedReport();
    expect(report).toContain('Payloadra');
  });

  test('keeps the ledger empty until recording starts', async ({ payloadra }) => {
    await payloadra.trigger('load-profile');

    await expect(payloadra.requestRows()).toHaveCount(0);
    await expect(
      payloadra.page.locator('[data-empty-kind="not-recording"]'),
    ).toBeVisible();
  });

  test('clears every captured request and returns to the empty state', async ({
    payloadra,
  }) => {
    await payloadra.startRecording();
    await payloadra.trigger('load-profile');
    await expect(payloadra.requestRows()).toHaveCount(1);

    await payloadra.clearEvidence();

    await expect(payloadra.page.locator('[data-empty-kind]')).toBeVisible();
    await expect(
      payloadra.page.getByRole('button', { name: 'Start recording' }),
    ).toBeVisible();
  });

  test('hides non-API traffic under the default API-only filter', async ({
    payloadra,
  }) => {
    await payloadra.startRecording();
    await payloadra.trigger('binary');
    await payloadra.trigger('load-profile');

    await expect(payloadra.requestRows()).toHaveCount(1);

    await payloadra.setApiOnly(false);
    await expect(payloadra.requestRows()).toHaveCount(2);
    await expect(payloadra.rowFor('/api/binary')).toHaveCount(1);
  });

  test('filters failures, slow calls, and cache hits, then resets', async ({
    payloadra,
    allowedConsoleErrors,
  }) => {
    allowedConsoleErrors.push(/500 \(Internal Server Error\)/u);
    await payloadra.startRecording();
    await payloadra.trigger('load-profile');
    await payloadra.trigger('failing');
    await payloadra.trigger('slow');
    await payloadra.trigger('cacheable');

    await payloadra.toggleQuickFilter('Failures');
    await expect(payloadra.rowFor('/api/error')).toHaveCount(1);
    await expect(payloadra.rowFor('/api/slow')).toHaveCount(0);
    await payloadra.toggleQuickFilter('Failures');

    await payloadra.toggleQuickFilter('Slow calls');
    await expect(payloadra.rowFor('/api/slow')).toHaveCount(1);
    await expect(payloadra.rowFor('/api/error')).toHaveCount(0);
    await payloadra.toggleQuickFilter('Slow calls');

    await payloadra.toggleQuickFilter('Cache hits');
    await expect(payloadra.rowFor('/api/cacheable')).toHaveCount(1);

    await payloadra.resetFilters();
    await expect(payloadra.rowFor('/api/error')).toHaveCount(1);
    await expect(payloadra.rowFor('/api/slow')).toHaveCount(1);
  });

  test('searches the ledger by route text', async ({ payloadra }) => {
    await payloadra.startRecording();
    await payloadra.trigger('load-profile');
    await payloadra.trigger('graphql');

    await payloadra.search('graphql');
    await expect(payloadra.requestRows()).toHaveCount(1);
    await expect(payloadra.rowFor('/graphql')).toHaveCount(1);

    await payloadra.search('no-such-route');
    await expect(
      payloadra.page.locator('[data-empty-kind="no-matches"]'),
    ).toBeVisible();
  });

  test('groups correlated requests under the trusted interaction that caused them', async ({
    payloadra,
  }) => {
    await payloadra.startRecording();
    await payloadra.trigger('save-profile');

    await payloadra.openRequest('/api/profile');
    await expect(payloadra.explainHeading()).toContainText('Save profile triggered');
    await expect(payloadra.explainHeading()).toContainText('succeeded with HTTP 200');

    await payloadra.openInspect();
    await payloadra.openEvidenceTab('Initiator');
    await expect(payloadra.detailWorkspace()).toContainText('click');
  });

  test('reports redirect, repeat, cache, and service-worker evidence', async ({
    payloadra,
  }) => {
    await payloadra.registerServiceWorker();
    await payloadra.startRecording();
    await payloadra.trigger('redirect');
    await payloadra.trigger('repeated');
    await payloadra.trigger('cacheable');
    await payloadra.trigger('service-worker-data');
    await payloadra.trigger('service-worker-data');

    await payloadra.openRequest('/api/redirect');
    await expect(payloadra.explainHeading()).toContainText('triggered');
    await payloadra.openInspect();
    await payloadra.openEvidenceTab('Evidence');
    await expect(payloadra.detailWorkspace()).toContainText('redirect target');

    await payloadra.setApiOnly(false);
    await expect(payloadra.rowFor('/api/service-worker-data').last()).toContainText(
      'Service worker',
    );
    await expect(payloadra.rowFor('/api/profile')).toHaveCount(2);

    await payloadra.unregisterServiceWorker();
  });

  test('compares a repeated call against its previous capture', async ({
    payloadra,
  }) => {
    await payloadra.startRecording();
    await payloadra.trigger('repeated');

    await expect(payloadra.rowFor('/api/profile')).toHaveCount(2);
    await payloadra.rowFor('/api/profile').last().click();
    await payloadra.openInspect();
    await payloadra.showComparison();

    await expect(payloadra.comparison()).toBeVisible();
    await expect(payloadra.comparison()).toContainText('Status');
  });

  test('renders streamed, binary, truncated, and partially decoded bodies', async ({
    payloadra,
  }) => {
    await payloadra.startRecording();
    await payloadra.setApiOnly(false);
    await payloadra.trigger('stream');
    await payloadra.trigger('binary');
    await payloadra.trigger('large');
    await payloadra.trigger('flight-partial');

    await payloadra.openRequest('/api/stream');
    await payloadra.openInspect();
    await payloadra.openEvidenceTab('Response');
    await expect(payloadra.detailWorkspace()).toContainText('Streamed body');

    await payloadra.openRequest('/api/binary');
    await payloadra.openEvidenceTab('Response');
    await expect(payloadra.detailWorkspace()).toContainText('Binary body');

    await payloadra.openRequest('/api/large');
    await payloadra.openEvidenceTab('Response');
    await expect(payloadra.detailWorkspace()).toContainText('Truncated');

    await payloadra.openRequest('/api/flight-partial');
    await payloadra.openEvidenceTab('Response');
    await expect(payloadra.detailWorkspace()).toContainText('partially decoded');
    await payloadra.page.getByRole('tab', { name: 'Raw protocol' }).click();
    await expect(payloadra.responseBody().first()).toContainText('ProfilePage');
  });

  test('records a cancelled call as a failed request without a response', async ({
    payloadra,
  }) => {
    await payloadra.startRecording();
    await payloadra.trigger('cancelled');
    await payloadra.setApiOnly(false);

    await expect(payloadra.rowFor('/api/hang')).toContainText('ERR');
  });

  test('keeps a blocked cross-origin call visible as evidence', async ({
    payloadra,
    thirdParty,
    allowedConsoleErrors,
  }) => {
    allowedConsoleErrors.push(/CORS policy/u, /Failed to load resource/u);
    await payloadra.startRecording();
    await payloadra.triggerBlockedCrossOrigin(thirdParty.origin);
    await payloadra.setApiOnly(false);

    await expect(payloadra.rowFor('/api/profile')).toContainText('ERR');
  });

  test('copies a safe cURL command and announces the outcome', async ({
    payloadra,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await payloadra.startRecording();
    await payloadra.trigger('secret');
    await payloadra.setApiOnly(false);

    await payloadra.openRequest('/api/secret');
    await payloadra.openInspect();
    await payloadra.copySafeCurl();

    await expect(payloadra.copyResult()).toContainText('Safe cURL copied.');
    const clipboard = await payloadra.page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(clipboard).toContain('curl');
    expect(clipboard).not.toContain('payloadra.e2e.authorization.canary');
  });

  test('supports keyboard navigation across rows and evidence tabs', async ({
    payloadra,
  }) => {
    await payloadra.startRecording();
    await payloadra.trigger('load-profile');
    await payloadra.trigger('graphql');

    await payloadra.requestRows().first().focus();
    await payloadra.page.keyboard.press('ArrowDown');
    await payloadra.page.keyboard.press('Enter');
    await expect(payloadra.detailWorkspace()).toContainText('/graphql');

    await payloadra.openInspect();
    await payloadra.page.getByRole('tab', { name: 'Overview', exact: true }).focus();
    await payloadra.page.keyboard.press('ArrowRight');
    await expect(
      payloadra.page.getByRole('tab', { name: 'Request', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  test('keeps the selected request when the layout switches to a narrow viewport', async ({
    payloadra,
  }) => {
    await payloadra.startRecording();
    await payloadra.trigger('load-profile');
    await payloadra.openRequest('/api/profile');
    await expect(payloadra.detailWorkspace()).toContainText('/api/profile');

    await payloadra.page.setViewportSize({ width: 390, height: 844 });
    await expect(payloadra.detailWorkspace()).toContainText('/api/profile');
    await payloadra.page.getByRole('button', { name: 'Back to requests' }).click();
    await expect(payloadra.requestRows()).toHaveCount(1);
  });
});
