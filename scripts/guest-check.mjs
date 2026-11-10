// Run the OpenChamber SDK's own package checker (`openchamber-guest-check`) under Node.
//
// The SDK ships that checker as a bun script (`scripts/check-guest.ts`, `#!/usr/bin/env bun`), and
// Node refuses to strip types inside node_modules. This bundles the SDK's file, unchanged, with our
// esbuild into the OS temp folder (zod and the SDK schemas inline), then runs it with this Node on
// the repo root and forwards its output and exit code. Nothing from the checker is re-implemented.
//
// It checks the manifest, every .html file the manifest names (and the scripts they load) and the
// service entry. It does not look at `skills` or `opencodePlugin`: test/package-tree.test.ts does.
// Run `npm run build` first. CI runs `npm run guest-check` after `npm run check`.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checker = path.join(root, 'node_modules', '@openchamber', 'sdk', 'scripts', 'check-guest.ts');

const scratch = await mkdtemp(path.join(tmpdir(), 'dc-guest-check-'));
let status = 1;
try {
  const outfile = path.join(scratch, 'check-guest.mjs');
  await build({
    entryPoints: [checker],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    logLevel: 'warning',
    // zod and the schemas are bundled; some of their dependencies still call require().
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  const result = spawnSync(process.execPath, [outfile, root], { stdio: 'inherit' });
  if (result.error) throw result.error;
  status = result.status ?? 1;
} catch (error) {
  console.error(`guest-check: could not run the SDK checker. ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
process.exit(status);
