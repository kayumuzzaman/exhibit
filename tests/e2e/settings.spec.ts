import { expect, FIXTURE_PROFILE, test } from './extension.fixture';

test.describe('local settings', () => {
  test('persists theme and custom redaction, then applies it after reload', async ({
    exhibit,
  }) => {
    await exhibit.page.getByRole('button', { name: 'Switch to light theme' }).click();
    await exhibit.page.getByRole('button', { name: 'Settings' }).click();
    await exhibit.page
      .getByRole('textbox', { name: 'Additional sensitive field names' })
      .fill('displayName');
    await exhibit.page.getByRole('button', { name: 'Save privacy settings' }).click();

    await exhibit.reload();
    await expect(exhibit.page.locator('.app-shell')).toHaveAttribute(
      'data-theme',
      'light',
    );
    await expect(
      exhibit.page.getByRole('button', { name: 'Switch to dark theme' }),
    ).toBeVisible();

    await exhibit.page.getByRole('button', { name: 'Settings' }).click();
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
