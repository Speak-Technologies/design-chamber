// The check probe as the build embeds it (`__DC_PROBE__`), bundled in memory for tests that
// run the engine against a real browser. Same options as scripts/build.mjs step (1b).

import path from 'node:path';

import { build } from 'esbuild';

let cached: Promise<string> | null = null;

export const probeSource = (): Promise<string> => {
  cached ??= build({
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    legalComments: 'none',
    logLevel: 'warning',
    entryPoints: [path.resolve(import.meta.dirname, '..', '..', 'src', 'guest', 'probe', 'probe.ts')],
    globalName: '__dcProbe',
    write: false,
    minify: true,
  }).then((result) => {
    const file = result.outputFiles[0];
    if (!file) throw new Error('The probe bundle produced no output.');
    return file.text;
  });
  return cached;
};
