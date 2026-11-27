// Build every entry OpenChamber loads (docs/SPEC.md §12). OpenChamber never compiles
// TypeScript, so `dist/` must exist before a folder install: run `npm run build`.
//
//   dist/panel/      index.html, styles.css, main.js  — panel + page guest (IIFE, browser)
//   dist/background/ index.html, main.js              — slash-command resolver (IIFE, browser)
//   dist/service/    main.js                          — local service (ESM, Node)
//   dist/cli/        dc.mjs                           — the agent's `dc check` command (ESM, Node)
//   dist/plugin/     index.js, package.json           — the OpenCode plugin (ESM, imports nothing)
//   dist/status/     index.html, status.css, main.js  — Work Status frame (IIFE, browser)
//   dist/blocks/     index.html, blocks.css, main.js  — chat block frame (IIFE, browser)
//   dist/skills/     design-chamber/SKILL.md, presets/<id>.md, design-system-builder/SKILL.md — the bundled agent skills
//
// The design-frame bridge is bundled first, in memory, and injected into the panel bundle
// as the string constant `__DC_BRIDGE__` (src/guest/globals.d.ts).
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts) => path.join(root, ...parts);
const dist = at('dist');

// `__DC_PANEL_MOBILE__` (src/guest/globals.d.ts): whether the shipped manifest opts the panel into the
// phone (`contributes.panel.mobile`), so the phone copy says what was shipped (native-extras §2.2).
const manifest = JSON.parse(await readFile(at('package.json'), 'utf8'));
const panelMobile = manifest?.openchamber?.contributes?.panel?.mobile === true;
const uiDefines = { __DC_PANEL_MOBILE__: JSON.stringify(panelMobile) };

const browser = { bundle: true, format: 'iife', platform: 'browser', target: ['es2020'], sourcemap: false, logLevel: 'warning', legalComments: 'none', define: uiDefines };

await rm(dist, { recursive: true, force: true });
await mkdir(at('dist', 'panel'), { recursive: true });
await mkdir(at('dist', 'background'), { recursive: true });
await mkdir(at('dist', 'plugin'), { recursive: true });
await mkdir(at('dist', 'status'), { recursive: true });
await mkdir(at('dist', 'blocks'), { recursive: true });
await mkdir(at('dist', 'skills', 'design-chamber', 'presets'), { recursive: true });

// (1) Bridge → in-memory IIFE string.
const bridgeResult = await build({ ...browser, entryPoints: [at('src', 'guest', 'bridge', 'bridge.ts')], write: false, minify: true });
const bridgeFile = bridgeResult.outputFiles[0];
if (!bridgeFile) throw new Error('build: the bridge bundle produced no output.');
const bridge = bridgeFile.text;
// The bridge is injected inside a <script> element of the design document.
if (/<\/script/i.test(bridge)) throw new Error('build: the bridge bundle contains "</script", which would end its <script> element early.');
// A near-empty bridge means a placeholder entry was bundled: artboards would load with no
// hit-testing, pins, scroll sync or link handling.
if (Buffer.byteLength(bridge) < 1024) throw new Error(`build: the bridge bundle is only ${Buffer.byteLength(bridge)} bytes — is src/guest/bridge/bridge.ts the real bridge?`);

// (1b) Design-check probe → in-memory IIFE string, run in headless Chrome by the check engine.
const probeResult = await build({
  ...browser,
  entryPoints: [at('src', 'guest', 'probe', 'probe.ts')],
  globalName: '__dcProbe',
  write: false,
  minify: true,
});
const probeFile = probeResult.outputFiles[0];
if (!probeFile) throw new Error('build: the probe bundle produced no output.');
const probe = probeFile.text;
if (Buffer.byteLength(probe) < 1024) throw new Error(`build: the probe bundle is only ${Buffer.byteLength(probe)} bytes — is src/guest/probe/probe.ts the real probe?`);

// (1c) Storage stand-in for the check browser → in-memory IIFE string, installed before page
// scripts so a design that uses localStorage renders empty and unsaved instead of throwing.
const storageShimResult = await build({ ...browser, entryPoints: [at('src', 'guest', 'bridge', 'storage-shim-entry.ts')], write: false, minify: true });
const storageShimFile = storageShimResult.outputFiles[0];
if (!storageShimFile) throw new Error('build: the storage shim bundle produced no output.');
const storageShim = storageShimFile.text;
if (Buffer.byteLength(storageShim) < 512) throw new Error(`build: the storage shim bundle is only ${Buffer.byteLength(storageShim)} bytes — is src/guest/bridge/storage-shim-entry.ts real?`);

// (2) Panel + page guest.
await build({ ...browser, entryPoints: [at('src', 'ui', 'main.ts')], outfile: at('dist', 'panel', 'main.js'), define: { ...uiDefines, __DC_BRIDGE__: JSON.stringify(bridge) } });
if ((await readFile(at('dist', 'panel', 'main.js'), 'utf8')).includes('__DC_BRIDGE__')) {
  throw new Error('build: __DC_BRIDGE__ was not replaced in the panel bundle.');
}

// (3) Background guest.
await build({ ...browser, entryPoints: [at('src', 'guest', 'background-main.ts')], outfile: at('dist', 'background', 'main.js') });

// (4) Local service, and (6) the check CLI: same options, both embed the probe as `__DC_PROBE__`.
const node = {
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  sourcemap: false,
  logLevel: 'warning',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  define: { __DC_PROBE__: JSON.stringify(probe), __DC_STORAGE_SHIM__: JSON.stringify(storageShim) },
};
await build({ ...node, entryPoints: [at('src', 'service', 'main.ts')], outfile: at('dist', 'service', 'main.js') });
await build({ ...node, entryPoints: [at('src', 'cli', 'dc.ts')], outfile: at('dist', 'cli', 'dc.mjs') });
for (const file of ['service/main.js', 'cli/dc.mjs']) {
  const text = await readFile(at('dist', file), 'utf8');
  if (text.includes('__DC_PROBE__')) throw new Error(`build: __DC_PROBE__ was not replaced in dist/${file}.`);
  if (text.includes('__DC_STORAGE_SHIM__')) throw new Error(`build: __DC_STORAGE_SHIM__ was not replaced in dist/${file}.`);
}

// (5) Static files.
await copyFile(at('src', 'ui', 'index.html'), at('dist', 'panel', 'index.html'));
await copyFile(at('src', 'ui', 'styles.css'), at('dist', 'panel', 'styles.css'));
await writeFile(
  at('dist', 'background', 'index.html'),
  '<!doctype html>\n<html lang="en">\n  <head><meta charset="utf-8" /><title>Design Chamber background</title></head>\n  <body><script src="main.js"></script></body>\n</html>\n',
);

// (7) OpenCode plugin: one ESM file that imports nothing. OpenCode loads it with a bare
// import() where no node_modules exist, so any import, dynamic import or require fails there.
// Node built-ins are reached through process.getBuiltinModule inside the plugin's own code.
await build({
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: ['es2022'],
  sourcemap: false,
  logLevel: 'warning',
  legalComments: 'none',
  entryPoints: [at('src', 'plugin', 'index.ts')],
  outfile: at('dist', 'plugin', 'index.js'),
});
const pluginCode = await readFile(at('dist', 'plugin', 'index.js'), 'utf8');
if (/^\s*import[\s{*]|\bimport\s*\(|\brequire\s*\(/m.test(pluginCode)) {
  throw new Error('build: dist/plugin/index.js imports something. The plugin must import nothing: reach Node built-ins through process.getBuiltinModule.');
}
const { version } = JSON.parse(await readFile(at('package.json'), 'utf8'));
await writeFile(
  at('dist', 'plugin', 'package.json'),
  `${JSON.stringify({ name: 'design-chamber-tools', version, private: true, type: 'module', exports: { '.': './index.js' } }, null, 2)}\n`,
);

// (8) Work Status frame: browser IIFE plus its own small CSS, so it never touches the panel's
// styles.css. The chat block frame is built at (10c), after the interview it bakes is parsed.
await build({ ...browser, entryPoints: [at('src', 'ui', 'status', 'main.ts')], outfile: at('dist', 'status', 'main.js') });
await copyFile(at('src', 'ui', 'status', 'index.html'), at('dist', 'status', 'index.html'));
await copyFile(at('src', 'ui', 'status', 'status.css'), at('dist', 'status', 'status.css'));

// (10) Bundled skill: SKILL.md within its cap, the presets and the reference docs beside it
// (scripts/build-skill.mjs). skill-doc.ts and presets.ts are pure TypeScript with no Node imports,
// so Node (>= 22.18) loads them directly by stripping the types; nothing is bundled twice.
const { buildBuilderSkill, buildDesignChamberSkill } = await import('./build-skill.mjs');
await buildDesignChamberSkill({ packageRoot: root, distDir: dist });

// (10b) The design-system-builder skill and the interview the SystemAsk block bakes (§8.8 rev 3).
// One file feeds both: rules/SYSTEM-QUESTIONS.md is inlined verbatim into the skill and parsed
// into the set the blocks bundle gets below. A missing or broken file, an over-cap skill or a
// skill named like a command fails the build here.
const systemQuestions = await buildBuilderSkill({ packageRoot: root, distDir: dist });

// (10c) Chat block frame, with the interview baked in as __DC_SYSTEM_QUESTIONS__ (the __DC_BRIDGE__
// pattern): the block's fixed wording and the skill's interview are the same file at the same build.
await build({ ...browser, entryPoints: [at('src', 'ui', 'blocks', 'main.ts')], outfile: at('dist', 'blocks', 'main.js'), define: { ...uiDefines, __DC_SYSTEM_QUESTIONS__: JSON.stringify(systemQuestions) } });
// esbuild leaves a "// <define:NAME>" comment above a replaced value; only a use left in code counts.
if ((await readFile(at('dist', 'blocks', 'main.js'), 'utf8')).replace(/^\s*\/\/ <define:__DC_SYSTEM_QUESTIONS__>\s*$/gm, '').includes('__DC_SYSTEM_QUESTIONS__')) {
  throw new Error('build: __DC_SYSTEM_QUESTIONS__ was not replaced in the blocks bundle.');
}
await copyFile(at('src', 'ui', 'blocks', 'index.html'), at('dist', 'blocks', 'index.html'));
await copyFile(at('src', 'ui', 'blocks', 'blocks.css'), at('dist', 'blocks', 'blocks.css'));

// Every frame bundle that can read __DC_PANEL_MOBILE__ must have it replaced.
for (const file of ['panel/main.js', 'background/main.js', 'status/main.js', 'blocks/main.js']) {
  if ((await readFile(at('dist', file), 'utf8')).replace(/^\s*\/\/ <define:__DC_PANEL_MOBILE__>\s*$/gm, '').includes('__DC_PANEL_MOBILE__')) {
    throw new Error(`build: __DC_PANEL_MOBILE__ was not replaced in dist/${file}.`);
  }
}

const outputs = ['panel/index.html', 'panel/styles.css', 'panel/main.js', 'background/index.html', 'background/main.js', 'service/main.js', 'cli/dc.mjs', 'plugin/index.js', 'status/main.js', 'blocks/main.js', 'skills/design-chamber/SKILL.md', 'skills/design-system-builder/SKILL.md'];
const sizes = await Promise.all(outputs.map(async (file) => `${file} ${((await stat(at('dist', file))).size / 1024).toFixed(1)} kB`));
console.log(`built dist/ (bridge ${(Buffer.byteLength(bridge) / 1024).toFixed(1)} kB)\n  ${sizes.join('\n  ')}`);
