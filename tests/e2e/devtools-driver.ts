import { expect, type FrameLocator, type Locator, type Page } from 'playwright/test';

export type FixtureAction =
  | 'binary'
  | 'cacheable'
  | 'cancelled'
  | 'failing'
  | 'flight'
  | 'flight-partial'
  | 'graphql'
  | 'large'
  | 'load-profile'
  | 'redirect'
  | 'repeated'
  | 'save-profile'
  | 'secret'
  | 'service-worker-data'
  | 'slow'
  | 'stream'
  | 'submit-form'
  | 'upload'
  | 'xhr';

/**
 * Page object for the Exhibit panel. It drives the panel exactly as a
 * developer would: visible controls, accessible names, and keyboard input.
 */
export class ExhibitDriver {
  constructor(readonly page: Page) {}

  async ready(): Promise<void> {
    await this.page.waitForSelector('body[data-harness-ready="true"]');
    await this.page.locator('#fixture-panel').evaluate((node) => {
      (node as HTMLDetailsElement).open = true;
    });
  }

  async reload(): Promise<void> {
    await this.page.reload();
    await this.ready();
  }

  async startRecording(): Promise<void> {
    await this.page.getByRole('button', { name: 'Start recording' }).click();
    await expect(
      this.page.getByRole('button', { name: 'Stop recording' }),
    ).toBeVisible();
  }

  async stopRecording(): Promise<void> {
    await this.page.getByRole('button', { name: 'Stop recording' }).click();
    await expect(
      this.page.getByRole('button', { name: 'Start recording' }),
    ).toBeVisible();
  }

  /** Runs a fixture action through a real user click so interactions correlate. */
  async trigger(action: FixtureAction): Promise<void> {
    const button = this.page.locator(`#fixture-${action}`);
    await button.click();
    await expect(button).toHaveAttribute('data-fixture-done', 'true', {
      timeout: 15_000,
    });
    await this.settle();
  }

  /** Loads the Next fixture in a same-origin frame and instruments its traffic. */
  async openNextFixture(path = '/next'): Promise<void> {
    await this.page.evaluate(async (src) => {
      await globalThis.exhibitHarness?.openFrame(src);
    }, path);
    await expect(this.nextFrame().locator('#next-state')).toHaveText('idle');
  }

  nextFrame(): FrameLocator {
    return this.page.frameLocator('#fixture-frame');
  }

  async triggerInNextFixture(selector: string): Promise<void> {
    await this.nextFrame().locator(selector).click();
    await this.settle();
  }

  async registerServiceWorker(): Promise<void> {
    await this.page.evaluate(async () => {
      await globalThis.fixtureActions?.registerServiceWorker();
    });
  }

  async unregisterServiceWorker(): Promise<void> {
    await this.page.evaluate(async () => {
      await globalThis.fixtureActions?.unregisterServiceWorker();
    });
  }

  /** Performs a cross-origin call the browser blocks, then drains the pipeline. */
  async triggerBlockedCrossOrigin(origin: string): Promise<void> {
    await this.page.evaluate(async (target) => {
      await globalThis.fixtureActions?.blockedCrossOrigin(target);
    }, origin);
    await this.settle();
  }

  async settle(): Promise<void> {
    await this.page.evaluate(async () => {
      await globalThis.exhibitHarness?.settle();
    });
  }

  requestRows(): Locator {
    return this.page
      .getByRole('grid', { name: 'Captured requests' })
      .locator('tbody tr');
  }

  rowFor(route: string): Locator {
    return this.requestRows().filter({ hasText: route });
  }

  async openRequest(route: string): Promise<void> {
    await this.rowFor(route).first().click();
  }

  async search(value: string): Promise<void> {
    await this.page.getByRole('searchbox', { name: 'Search requests' }).fill(value);
  }

  async setApiOnly(enabled: boolean): Promise<void> {
    const checkbox = this.page.getByRole('checkbox', { name: 'API requests only' });
    if ((await checkbox.isChecked()) !== enabled) await checkbox.click();
  }

  async toggleQuickFilter(
    name: 'Cache hits' | 'Failures' | 'Slow calls',
  ): Promise<void> {
    await this.page.getByRole('button', { name, exact: true }).click();
  }

  async setFacetFilter(
    name: 'Cache' | 'Domain' | 'Method' | 'Outcome' | 'Protocol',
    value: string,
  ): Promise<void> {
    const facets = this.page.locator('.facet-filters');
    if ((await facets.getAttribute('open')) === null) {
      await facets.getByText('Evidence facets').click();
    }
    await this.page.getByRole('combobox', { name }).selectOption(value);
  }

  async resetFilters(): Promise<void> {
    await this.page.getByRole('button', { name: 'Reset filters' }).click();
  }

  async openExplain(): Promise<void> {
    await this.page.getByRole('tab', { name: 'Explain' }).click();
  }

  async openInspect(): Promise<void> {
    await this.page.getByRole('tab', { name: 'Inspect' }).click();
  }

  async openEvidenceTab(
    name: 'Overview' | 'Request' | 'Response' | 'Timing' | 'Initiator' | 'Evidence',
  ): Promise<void> {
    await this.page.getByRole('tab', { name, exact: true }).click();
  }

  explainHeading(): Locator {
    return this.page.locator('.outcome-summary h2');
  }

  detailWorkspace(): Locator {
    return this.page.getByRole('region', { name: 'Request detail' });
  }

  responseBody(): Locator {
    return this.page.locator('.body-viewer .code-block');
  }

  async copySafeCurl(): Promise<void> {
    await this.page.getByRole('button', { name: 'Copy safe cURL' }).click();
  }

  copyResult(): Locator {
    return this.page.locator('.copy-result');
  }

  async showComparison(): Promise<void> {
    await this.page.getByRole('button', { name: 'Show request comparison' }).click();
  }

  comparison(): Locator {
    return this.page.getByRole('region', { name: 'Request comparison' });
  }

  async exportEvidence(format: 'har' | 'markdown' = 'har'): Promise<string> {
    const downloadPromise = this.page.waitForEvent('download');
    await this.page.getByRole('button', { name: 'Export evidence' }).click();
    if (format === 'markdown') {
      await this.page.getByRole('radio', { name: 'Markdown QA report' }).check();
    }
    await this.page
      .getByRole('button', {
        name: format === 'har' ? 'Export sanitized HAR' : 'Export Markdown report',
      })
      .click();
    const download = await downloadPromise;
    await download.path();
    return this.page.evaluate(
      (selectedFormat) =>
        selectedFormat === 'har'
          ? (globalThis.exhibitHarness?.exportedHar() ?? '')
          : (globalThis.exhibitHarness?.exportedReport() ?? ''),
      format,
    );
  }

  async exportedReport(): Promise<string> {
    return this.page.evaluate(() => globalThis.exhibitHarness?.exportedReport() ?? '');
  }

  async clearEvidence(): Promise<void> {
    await this.page.getByRole('button', { name: 'Clear evidence' }).click();
    await this.page.getByRole('button', { name: 'Clear evidence now' }).click();
    await expect(this.requestRows()).toHaveCount(0);
  }

  async storedSessionText(): Promise<string> {
    return this.page.evaluate(() => {
      const values: string[] = [];
      for (let index = 0; index < sessionStorage.length; index += 1) {
        const key = sessionStorage.key(index);
        if (key !== null) values.push(sessionStorage.getItem(key) ?? '');
      }
      return values.join('\n');
    });
  }

  async pageText(): Promise<string> {
    return this.page.evaluate(() => document.body.innerText);
  }
}
