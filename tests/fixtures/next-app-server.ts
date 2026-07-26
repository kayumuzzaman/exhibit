import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const NEXT_APP_DIR = fileURLToPath(new URL('./next-app', import.meta.url));
const NEXT_BIN = fileURLToPath(
  new URL('../../node_modules/.bin/next', import.meta.url),
);
const READY_TIMEOUT_MS = 60_000;

export type NextFixture = Readonly<{
  origin: string;
  port: number;
  close(): Promise<void>;
}>;

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((ready) => probe.listen(0, '127.0.0.1', ready));
  const address = probe.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: NEXT_APP_DIR,
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
    );
  });
}

async function waitForReady(origin: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`Next fixture exited early with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`${origin}/next/api/profile`);
      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
    } catch {
      // The server is still binding its port.
    }
    if (Date.now() > deadline) throw new Error('Next fixture did not become ready.');
    await new Promise((done) => setTimeout(done, 250));
  }
}

/** Produces the production Next build once, before any worker starts a server. */
export async function buildNextFixture(): Promise<void> {
  await run(NEXT_BIN, ['build']);
}

/** Serves the already-built production Next fixture on a loopback port. */
export async function startNextFixture(): Promise<NextFixture> {
  const port = await freePort();
  const child = spawn(
    NEXT_BIN,
    ['start', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: NEXT_APP_DIR,
      stdio: 'ignore',
    },
  );
  const origin = `http://127.0.0.1:${port}`;
  try {
    await waitForReady(origin, child);
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }

  return {
    origin,
    port,
    async close() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise<void>((done) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          done();
        }, 5_000);
        child.on('exit', () => {
          clearTimeout(timer);
          done();
        });
      });
    },
  };
}
