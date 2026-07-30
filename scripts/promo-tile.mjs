import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/**
 * Renders the Chrome Web Store 440 x 280 small promo tile from the product's
 * own design tokens, so the listing artwork cannot drift from the panel.
 *
 * The tile is deliberately graphic rather than a screenshot: Chrome shows it at
 * small sizes in search and category listings, where panel detail is unreadable
 * and reads as noise. Output is byte-identical across runs — the font is
 * embedded, there is no animation, and no value is derived from the clock.
 */

const OUTPUT_DIR = fileURLToPath(new URL('../docs/promo', import.meta.url));
const OUTPUT_FILE = `${OUTPUT_DIR}/small-tile-440x280.png`;
const FONT_FILE = fileURLToPath(
  new URL(
    '../node_modules/@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2',
    import.meta.url,
  ),
);

const WIDTH = 440;
const HEIGHT = 280;

// The panel's own palette, from src/styles/tokens.css.
const GRAPHITE = '#15191f';
const SLATE = '#232a33';
const CYAN = '#00b8d9';
const PORCELAIN = '#f4f6f5';
const MUTED = '#b4bec9';

/** The icon's pulse, redrawn at tile scale so both marks stay the same shape. */
const PULSE = 'M8 40 H30 L42 12 L58 68 L70 40 H96'; /* viewBox 0 0 104 80, round caps */

function page(fontBase64) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: 'Plex';
    font-weight: 100 700;
    src: url(data:font/woff2;base64,${fontBase64}) format('woff2-variations');
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; }
  body {
    background: ${GRAPHITE};
    color: ${PORCELAIN};
    font-family: 'Plex', sans-serif;
    display: grid;
    grid-template-rows: 1fr auto;
    padding: 30px 34px 26px;
    /* A single soft cyan bloom behind the mark keeps the tile from reading as
       a flat rectangle at listing size, without adding decoration. */
    background-image: radial-gradient(
      420px 260px at 78% 6%,
      rgb(0 184 217 / 16%),
      transparent 62%
    );
  }
  .mark {
    width: 76px;
    height: 58px;
    display: block;
    margin-bottom: 16px;
  }
  .mark path {
    fill: none;
    stroke: ${CYAN};
    stroke-width: 10;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  h1 {
    font-size: 40px;
    font-weight: 600;
    letter-spacing: -0.022em;
    line-height: 1;
  }
  p {
    margin-top: 9px;
    font-size: 17px;
    font-weight: 400;
    line-height: 1.32;
    color: ${MUTED};
    max-width: 26ch;
  }
  b { color: ${PORCELAIN}; font-weight: 600; }
  .rule {
    margin-top: 16px;
    height: 1px;
    background: ${SLATE};
  }
  footer {
    margin-top: 10px;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: ${CYAN};
  }
</style>
</head>
<body>
  <div>
    <svg class="mark" viewBox="0 0 104 80" aria-hidden="true">
      <path d="${PULSE}"/>
    </svg>
    <h1>Exhibit</h1>
    <p><b>Next.js network traffic,</b> explained in DevTools.</p>
  </div>
  <div>
    <div class="rule"></div>
    <footer>Local only &middot; Redacted by default</footer>
  </div>
</body>
</html>`;
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const fontBase64 = (await readFile(FONT_FILE)).toString('base64');
  const html = page(fontBase64);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    locale: 'en-US',
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
  });
  try {
    const tab = await context.newPage();
    await tab.setContent(html, { waitUntil: 'load' });
    // The face is a data URI, so there is no request to wait on — but the
    // screenshot must still wait for it to be decoded and applied.
    await tab.evaluate(async () => {
      await globalThis.document.fonts.ready;
    });
    await tab.screenshot({ path: OUTPUT_FILE });
  } finally {
    await context.close();
    await browser.close();
  }

  process.stdout.write(`- docs/promo/small-tile-440x280.png\n`);
}

await main();
