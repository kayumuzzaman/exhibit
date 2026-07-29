import { expect, FIXTURE_PROFILE, test } from './extension.fixture';

test.describe('local settings', () => {
  test('persists theme and custom redaction, then applies it after reload', async ({
    exhibit,
  }) => {
    await exhibit.page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
    await exhibit.page.getByRole('button', { name: 'Privacy settings' }).click();
    await exhibit.page
      .getByRole('textbox', { name: 'Additional sensitive field names' })
      .fill('displayName');
    await exhibit.page.getByRole('button', { name: 'Save privacy settings' }).click();

    await exhibit.reload();
    await expect(exhibit.page.locator('.app-shell')).toHaveAttribute(
      'data-theme',
      'dark',
    );
    await expect(exhibit.page.getByRole('combobox', { name: 'Theme' })).toHaveValue(
      'dark',
    );

    await exhibit.page.getByRole('button', { name: 'Privacy settings' }).click();
    await expect(
      exhibit.page.getByRole('textbox', {
        name: 'Additional sensitive field names',
      }),
    ).toHaveValue('displayName');
    await exhibit.page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await exhibit.startRecording();
    await exhibit.trigger('save-profile');
    await exhibit.openRequest('/api/profile');
    await exhibit.openInspect();
    await exhibit.openEvidenceTab('Request');

    const detail = exhibit.detailWorkspace();
    await expect(detail).toContainText('displayName');
    await expect(detail).toContainText('[REDACTED]');
    await expect(detail).not.toContainText(FIXTURE_PROFILE.displayName);
  });
});
