import { expect, test, FIXTURE_SECRETS } from './extension.fixture';

const SECRET_VALUES = Object.values(FIXTURE_SECRETS);

function assertNoSecrets(label: string, text: string): void {
  for (const secret of SECRET_VALUES) {
    expect(text, `${label} leaked ${secret}`).not.toContain(secret);
  }
}

test.describe('privacy boundaries', () => {
  test('never surfaces credentials in the panel, exports, storage, or console', async ({
    payloadra,
    consoleErrors,
  }) => {
    await payloadra.startRecording();
    await payloadra.trigger('secret');
    await payloadra.trigger('save-profile');
    await payloadra.trigger('submit-form');
    await payloadra.trigger('upload');
    await payloadra.setApiOnly(false);

    await payloadra.openRequest('/api/secret');
    await payloadra.openInspect();
    for (const tab of ['Overview', 'Request', 'Response', 'Evidence'] as const) {
      await payloadra.openEvidenceTab(tab);
      assertNoSecrets(`inspect ${tab}`, await payloadra.pageText());
    }

    await payloadra.stopRecording();
    const har = await payloadra.exportEvidence();
    assertNoSecrets('HAR export', har);
    assertNoSecrets('QA report export', await payloadra.exportEvidence('markdown'));
    assertNoSecrets('session storage', await payloadra.storedSessionText());
    assertNoSecrets('console output', consoleErrors.join('\n'));
  });

  test('redacts credential headers, query tokens, and body fields in place', async ({
    payloadra,
  }) => {
    await payloadra.startRecording();
    await payloadra.trigger('secret');
    await payloadra.setApiOnly(false);

    await payloadra.openRequest('/api/secret');
    await payloadra.openInspect();
    await payloadra.openEvidenceTab('Request');

    const detail = payloadra.detailWorkspace();
    await expect(detail).toContainText('authorization');
    await expect(detail).toContainText('[REDACTED]');
    await expect(detail).not.toContainText(FIXTURE_SECRETS.authorization);

    await payloadra.openEvidenceTab('Overview');
    await expect(detail).toContainText('access_token=[REDACTED]');
  });

  test('keeps the exported HAR limited to the sanitized session', async ({
    payloadra,
  }) => {
    await payloadra.startRecording();
    await payloadra.trigger('save-profile');
    await payloadra.stopRecording();

    const har = JSON.parse(await payloadra.exportEvidence()) as {
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
