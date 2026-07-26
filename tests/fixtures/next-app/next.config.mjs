import { resolve } from 'node:path';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

/** @type {import('next').NextConfig} */
export default {
  basePath: '/next',
  typescript: { ignoreBuildErrors: true },
  turbopack: { root: workspaceRoot },
  outputFileTracingRoot: workspaceRoot,
};
