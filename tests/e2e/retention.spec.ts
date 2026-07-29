import { expect, test } from './extension.fixture';

test.describe('retention and recovery', () => {
  test('recovers an ephemeral session after the panel reloads', async ({ exhibit }) => {
    await exhibit.startRecording();
    await exhibit.trigger('save-profile');
    await expect(exhibit.requestRows()).toHaveCount(1);

    await exhibit.reload();

    await expect(exhibit.requestRows()).toHaveCount(1);
    await expect(exhibit.rowFor('/api/profile')).toHaveCount(1);
  });

  test('recovers a persistent session from local storage after reload', async ({
    exhibit,
  }) => {
    await exhibit.setRetention('persistent');
    await exhibit.startRecording();
    await exhibit.trigger('save-profile');
    await exhibit.trigger('graphql');
    await expect(exhibit.requestRows()).toHaveCount(2);

    await exhibit.page.evaluate(() => sessionStorage.clear());
    await exhibit.reload();

    await expect(exhibit.requestRows()).toHaveCount(2);
    await expect(exhibit.rowFor('/graphql')).toHaveCount(1);
    await expect(
      exhibit.page.getByRole('button', { name: 'Start recording' }),
    ).toBeVisible();
    const firstStoppedAt = await exhibit.page.evaluate(
      () => globalThis.exhibitHarness?.controller.getSnapshot().stoppedAt,
    );

    await exhibit.reload();

    expect(
      await exhibit.page.evaluate(
        () => globalThis.exhibitHarness?.controller.getSnapshot().stoppedAt,
      ),
    ).toBe(firstStoppedAt);
  });

  test('clearing removes recovered evidence from every retention store', async ({
    exhibit,
  }) => {
    await exhibit.setRetention('persistent');
    await exhibit.startRecording();
    await exhibit.trigger('save-profile');
    await expect(exhibit.requestRows()).toHaveCount(1);

    await exhibit.clearEvidence();
    await exhibit.reload();

    await expect(exhibit.requestRows()).toHaveCount(0);
    expect(await exhibit.storedSessionText()).not.toContain('/api/profile');
  });

  test('reports the active retention mode in the session rail', async ({ exhibit }) => {
    const rail = exhibit.page.getByRole('navigation', { name: 'Session workspace' });
    await expect(rail).toContainText('Memory');

    await exhibit.setRetention('persistent');
    await expect(rail).toContainText('Local');
  });
});
