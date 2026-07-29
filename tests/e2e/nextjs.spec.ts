import { expect, test } from './extension.fixture';

test.describe('Next.js evidence', () => {
  test('classifies a real Server Action without inventing a function name', async ({
    exhibit,
  }) => {
    await exhibit.startRecording();
    await exhibit.openNextFixture();
    await exhibit.triggerInNextFixture('#next-save-action');

    await expect(exhibit.nextFrame().locator('#next-state')).toHaveText('saved:Ada');
    const actionRow = exhibit.requestRows().filter({ hasText: 'next-server-action' });
    await expect(actionRow).toHaveCount(1);

    await actionRow.click();
    await expect(exhibit.explainHeading()).toContainText('Server Action');
    await expect(exhibit.detailWorkspace()).not.toContainText('saveProfile');

    await exhibit.openInspect();
    await exhibit.openEvidenceTab('Request');
    const detail = exhibit.detailWorkspace();
    await expect(detail).toContainText('next-action');

    const actionId = await exhibit.page.evaluate(() => {
      const snapshot = globalThis.exhibitHarness?.controller.getSnapshot();
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
    exhibit,
    allowedConsoleErrors,
  }) => {
    allowedConsoleErrors.push(/fixture action failure/u, /Server Action/u, /500/u);
    await exhibit.startRecording();
    await exhibit.openNextFixture();
    await exhibit.triggerInNextFixture('#next-failing-action');

    await expect(exhibit.nextFrame().locator('#next-state')).toHaveText(
      'action-failed',
    );
    await expect(exhibit.requestRows()).not.toHaveCount(0);
  });

  test('classifies the Next API route and the RSC navigation payload', async ({
    exhibit,
  }) => {
    await exhibit.startRecording();
    await exhibit.openNextFixture();
    await exhibit.triggerInNextFixture('#next-api-route');

    await expect(exhibit.nextFrame().locator('#next-state')).toHaveText('api-loaded');
    await expect(exhibit.rowFor('/next/api/profile')).toContainText('next-api');

    await exhibit.triggerInNextFixture('#next-rsc-link');
    await expect(exhibit.nextFrame().locator('#rsc-content')).toBeVisible();
    await exhibit.settle();

    await expect(exhibit.rowFor('_rsc=').first()).toContainText('rsc');
    await exhibit.openRequest('_rsc=');
    await exhibit.openInspect();
    await exhibit.openEvidenceTab('Response');
    await expect(exhibit.detailWorkspace()).toContainText('Flight');
  });
});
