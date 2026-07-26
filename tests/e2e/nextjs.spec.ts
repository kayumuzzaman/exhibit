import { expect, test } from './extension.fixture';

test.describe('Next.js evidence', () => {
  test('classifies a real Server Action without inventing a function name', async ({
    payloadra,
  }) => {
    await payloadra.startRecording();
    await payloadra.openNextFixture();
    await payloadra.triggerInNextFixture('#next-save-action');

    await expect(payloadra.nextFrame().locator('#next-state')).toHaveText('saved:Ada');
    const actionRow = payloadra.requestRows().filter({ hasText: 'next-server-action' });
    await expect(actionRow).toHaveCount(1);

    await actionRow.click();
    await expect(payloadra.explainHeading()).toContainText('Server Action');
    await expect(payloadra.detailWorkspace()).not.toContainText('saveProfile');

    await payloadra.openInspect();
    await payloadra.openEvidenceTab('Request');
    const detail = payloadra.detailWorkspace();
    await expect(detail).toContainText('next-action');

    const actionId = await payloadra.page.evaluate(() => {
      const snapshot = globalThis.payloadraHarness?.controller.getSnapshot();
      const request = snapshot?.requests.find(
        (candidate) => candidate.classification?.kind === 'next-server-action',
      );
      return (
        request?.request.headers.find(
          (header) => header.name.toLowerCase() === 'next-action',
        )?.value ?? ''
      );
    });
    expect(actionId.length).toBeGreaterThan(0);
    expect(actionId).not.toContain('saveProfile');
  });

  test('captures a failing Server Action as evidence', async ({
    payloadra,
    allowedConsoleErrors,
  }) => {
    allowedConsoleErrors.push(/fixture action failure/u, /Server Action/u, /500/u);
    await payloadra.startRecording();
    await payloadra.openNextFixture();
    await payloadra.triggerInNextFixture('#next-failing-action');

    await expect(payloadra.nextFrame().locator('#next-state')).toHaveText(
      'action-failed',
    );
    await expect(payloadra.requestRows()).not.toHaveCount(0);
  });

  test('classifies the Next API route and the RSC navigation payload', async ({
    payloadra,
  }) => {
    await payloadra.startRecording();
    await payloadra.openNextFixture();
    await payloadra.triggerInNextFixture('#next-api-route');

    await expect(payloadra.nextFrame().locator('#next-state')).toHaveText('api-loaded');
    await expect(payloadra.rowFor('/next/api/profile')).toContainText('next-api');

    await payloadra.triggerInNextFixture('#next-rsc-link');
    await expect(payloadra.nextFrame().locator('#rsc-content')).toBeVisible();
    await payloadra.settle();

    await expect(payloadra.rowFor('_rsc=').first()).toContainText('rsc');
    await payloadra.openRequest('_rsc=');
    await payloadra.openInspect();
    await payloadra.openEvidenceTab('Response');
    await expect(payloadra.detailWorkspace()).toContainText('Flight');
  });
});
