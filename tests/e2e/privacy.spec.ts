import { expect, test, FIXTURE_SECRETS } from './extension.fixture';

const SECRET_VALUES = Object.values(FIXTURE_SECRETS);

function assertNoSecrets(label: string, text: string): void {
  for (const secret of SECRET_VALUES) {
    expect(text, `${label} leaked ${secret}`).not.toContain(secret);
  }
}

test.describe('privacy boundaries', () => {
  test('never surfaces credentials in the panel, exports, storage, or console', async ({
    exhibit,
    consoleErrors,
  }) => {
    await exhibit.startRecording();
    await exhibit.trigger('secret');
    await exhibit.trigger('save-profile');
    await exhibit.trigger('submit-form');
    await exhibit.trigger('upload');
    await exhibit.setApiOnly(false);

    await exhibit.openRequest('/api/secret');
    await exhibit.openInspect();
    for (const tab of ['Overview', 'Request', 'Response', 'Evidence'] as const) {
      await exhibit.openEvidenceTab(tab);
      assertNoSecrets(`inspect ${tab}`, await exhibit.pageText());
    }

    await exhibit.stopRecording();
    const har = await exhibit.exportEvidence();
    assertNoSecrets('HAR export', har);
    assertNoSecrets('QA report export', await exhibit.exportEvidence('markdown'));
    assertNoSecrets('session storage', await exhibit.storedSessionText());
    assertNoSecrets('console output', consoleErrors.join('\n'));
  });

  test('redacts credential headers, query tokens, and body fields in place', async ({
    exhibit,
  }) => {
    await exhibit.startRecording();
    await exhibit.trigger('secret');
    await exhibit.setApiOnly(false);

    await exhibit.openRequest('/api/secret');
    await exhibit.openInspect();
    await exhibit.openEvidenceTab('Request');

    const detail = exhibit.detailWorkspace();
    await expect(detail).toContainText('authorization');
    await expect(detail).toContainText('[REDACTED]');
    await expect(detail).not.toContainText(FIXTURE_SECRETS.authorization);

    await exhibit.openEvidenceTab('Overview');
    await expect(detail).toContainText('access_token=[REDACTED]');
  });

  test('keeps the exported HAR limited to the sanitized session', async ({
    exhibit,
  }) => {
    await exhibit.startRecording();
    await exhibit.trigger('save-profile');
    await exhibit.stopRecording();

    const har = JSON.parse(await exhibit.exportEvidence()) as {
      log: { entries: { request: { headers: { name: string; value: string }[] } }[] };
    };

    expect(har.log.entries.length).toBeGreaterThan(0);
    for (const entry of har.log.entries) {
      for (const header of entry.request.headers) {
        if (header.name.toLowerCase() === 'authorization') {
          expect(header.value).toBe('[REDACTED]');
        }
      }
    }
  });
});
