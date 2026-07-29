import { expect, test } from './extension.fixture';

test.describe('retention and recovery', () => {
  test('recovers an ephemeral session after the panel reloads', async ({
    payloadra,
  }) => {
    await payloadra.startRecording();
    await payloadra.trigger('save-profile');
    await expect(payloadra.requestRows()).toHaveCount(1);

    await payloadra.reload();

    await expect(payloadra.requestRows()).toHaveCount(1);
    await expect(payloadra.rowFor('/api/profile')).toHaveCount(1);
  });

  test('recovers a persistent session from local storage after reload', async ({
    payloadra,
  }) => {
    await payloadra.setRetention('persistent');
    await payloadra.startRecording();
    await payloadra.trigger('save-profile');
    await payloadra.trigger('graphql');
    await expect(payloadra.requestRows()).toHaveCount(2);

    await payloadra.page.evaluate(() => sessionStorage.clear());
    await payloadra.reload();

    await expect(payloadra.requestRows()).toHaveCount(2);
    await expect(payloadra.rowFor('/graphql')).toHaveCount(1);
    await expect(
      payloadra.page.getByRole('button', { name: 'Start recording' }),
    ).toBeVisible();
    const firstStoppedAt = await payloadra.page.evaluate(
      () => globalThis.payloadraHarness?.controller.getSnapshot().stoppedAt,
    );

    await payloadra.reload();

    expect(
      await payloadra.page.evaluate(
        () => globalThis.payloadraHarness?.controller.getSnapshot().stoppedAt,
      ),
    ).toBe(firstStoppedAt);
  });

  test('clearing removes recovered evidence from every retention store', async ({
    payloadra,
  }) => {
    await payloadra.setRetention('persistent');
    await payloadra.startRecording();
    await payloadra.trigger('save-profile');
    await expect(payloadra.requestRows()).toHaveCount(1);

    await payloadra.clearEvidence();
    await payloadra.reload();

    await expect(payloadra.requestRows()).toHaveCount(0);
    expect(await payloadra.storedSessionText()).not.toContain('/api/profile');
  });

  test('reports the active retention mode in the session rail', async ({
    payloadra,
  }) => {
    const rail = payloadra.page.getByRole('navigation', { name: 'Session workspace' });
    await expect(rail).toContainText('Memory');

    await payloadra.setRetention('persistent');
    await expect(rail).toContainText('Local');
  });
});
