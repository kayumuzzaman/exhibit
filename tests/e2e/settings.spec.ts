import { expect, FIXTURE_PROFILE, test } from './extension.fixture';

test.describe('local settings', () => {
  test('persists theme and custom redaction, then applies it after reload', async ({
    payloadra,
  }) => {
    await payloadra.page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
    await payloadra.page.getByRole('button', { name: 'Privacy settings' }).click();
    await payloadra.page
      .getByRole('textbox', { name: 'Additional sensitive field names' })
      .fill('displayName');
    await payloadra.page.getByRole('button', { name: 'Save privacy settings' }).click();

    await payloadra.reload();
    await expect(payloadra.page.locator('.app-shell')).toHaveAttribute(
      'data-theme',
      'dark',
    );
    await expect(payloadra.page.getByRole('combobox', { name: 'Theme' })).toHaveValue(
      'dark',
    );

    await payloadra.page.getByRole('button', { name: 'Privacy settings' }).click();
    await expect(
      payloadra.page.getByRole('textbox', {
        name: 'Additional sensitive field names',
      }),
    ).toHaveValue('displayName');
    await payloadra.page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await payloadra.startRecording();
    await payloadra.trigger('save-profile');
    await payloadra.openRequest('/api/profile');
    await payloadra.openInspect();
    await payloadra.openEvidenceTab('Request');

    const detail = payloadra.detailWorkspace();
    await expect(detail).toContainText('displayName');
    await expect(detail).toContainText('[REDACTED]');
    await expect(detail).not.toContainText(FIXTURE_PROFILE.displayName);
  });
});
