import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

/**
 * Static audit of a built Chrome extension directory. It fails a release when
 * the package could reach the network, execute remote or inline code, or ask
 * for permissions the product does not need.
 */

const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.map', '.svg']);
const REMOTE_URL_PATTERN = /\b(?:https?:)?\/\/[a-z0-9.-]+(?::\d+)?[^\s"'`)]*/giu;
/**
 * Inert URL strings that never become a network destination:
 * - `www.w3.org` appears only as an XML namespace in bundled SVG markup;
 * - `react.dev` appears only inside React's minified error text;
 * - the reserved `.invalid` TLD is a parsing base that can never resolve.
 */
const ALLOWED_URL_PREFIXES = [
  'http://www.w3.org/',
  'https://www.w3.org/',
  '//www.w3.org/',
  'https://react.dev/errors/',
];
const ALLOWED_URL_PATTERN = /^https?:\/\/[a-z0-9.-]+\.invalid(?:[/?#]|$)/iu;
const INLINE_SCRIPT_PATTERN = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/giu;
const REMOTE_SCRIPT_PATTERN = /<script[^>]*\bsrc=["'](https?:)?\/\/[^"']+["'][^>]*>/giu;

async function walk(directory) {
  const found = [];
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    const info = await stat(path);
    if (info.isDirectory()) {
      found.push(...(await walk(path)));
    } else {
      found.push(path);
    }
  }
  return found;
}

function isAllowed(url) {
  return (
    ALLOWED_URL_PREFIXES.some((prefix) => url.startsWith(prefix)) ||
    ALLOWED_URL_PATTERN.test(url)
  );
}

/**
 * @param {string} directory Built extension root, for example `.output/chrome-mv3`.
 */
export async function auditPackage(directory) {
  const files = (await walk(directory)).sort();
  const manifestPath = join(directory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  const remoteUrls = [];
  const inlineScripts = [];
  const remoteScripts = [];

  for (const file of files) {
    if (!TEXT_EXTENSIONS.has(extname(file))) continue;
    const relativePath = relative(directory, file);
    const content = await readFile(file, 'utf8');

    for (const match of content.matchAll(REMOTE_URL_PATTERN)) {
      const url = match[0];
      if (isAllowed(url)) continue;
      remoteUrls.push(`${relativePath}: ${url}`);
    }
    if (extname(file) !== '.html') continue;
    for (const match of content.matchAll(INLINE_SCRIPT_PATTERN)) {
      if ((match[1] ?? '').trim().length === 0) continue;
      inlineScripts.push(relativePath);
    }
    for (const match of content.matchAll(REMOTE_SCRIPT_PATTERN)) {
      remoteScripts.push(`${relativePath}: ${match[0]}`);
    }
  }

  return {
    files: files.map((file) => relative(directory, file)),
    manifestVersion: manifest.manifest_version,
    permissions: [...(manifest.permissions ?? [])].sort(),
    optionalHostPermissions: [...(manifest.optional_host_permissions ?? [])].sort(),
    hostPermissions: [...(manifest.host_permissions ?? [])].sort(),
    contentSecurityPolicy: manifest.content_security_policy ?? null,
    externallyConnectable: manifest.externally_connectable ?? null,
    remoteUrls,
    remoteScripts,
    inlineScripts,
  };
}

async function main() {
  const directory = process.argv[2] ?? '.output/chrome-mv3';
  const audit = await auditPackage(directory);
  const failures = [
    ...audit.remoteUrls.map((entry) => `remote URL: ${entry}`),
    ...audit.remoteScripts.map((entry) => `remote script: ${entry}`),
    ...audit.inlineScripts.map((entry) => `inline script: ${entry}`),
    ...(audit.hostPermissions.length > 0
      ? [`declared host permissions: ${audit.hostPermissions.join(', ')}`]
      : []),
    ...(audit.externallyConnectable === null
      ? []
      : ['externally_connectable is declared']),
  ];

  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  if (failures.length > 0) {
    process.stderr.write(`Package audit failed:\n- ${failures.join('\n- ')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Package audit passed.\n');
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1])) {
  await main();
}
