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

  // The published build holds evidence in browser-session memory only. Clearing
  // that memory must lose the evidence: anything still recoverable afterwards
  // would be evidence at rest, which the store disclosure says does not exist.
  test('loses evidence once browser-session memory is cleared', async ({ exhibit }) => {
    await exhibit.startRecording();
    await exhibit.trigger('save-profile');
    await exhibit.trigger('graphql');
    await expect(exhibit.requestRows()).toHaveCount(2);

    await exhibit.page.evaluate(() => sessionStorage.clear());
    await exhibit.reload();

    await expect(exhibit.requestRows()).toHaveCount(0);
    await expect(exhibit.rowFor('/graphql')).toHaveCount(0);
  });

  test('clearing removes recovered evidence from the session store', async ({
    exhibit,
  }) => {
    await exhibit.startRecording();
    await exhibit.trigger('save-profile');
    await expect(exhibit.requestRows()).toHaveCount(1);

    await exhibit.clearEvidence();
    await exhibit.reload();

    await expect(exhibit.requestRows()).toHaveCount(0);
    expect(await exhibit.storedSessionText()).not.toContain('/api/profile');
  });

  test('states memory-only retention and offers no retention control', async ({
    exhibit,
  }) => {
    const rail = exhibit.page.getByRole('navigation', { name: 'Session workspace' });

    await expect(rail).toContainText('Memory');
    await expect(rail).toContainText('never written to disk');
    await expect(
      exhibit.page.getByRole('combobox', { name: 'Evidence retention' }),
    ).toHaveCount(0);
  });
});
