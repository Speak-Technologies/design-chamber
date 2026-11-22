// QA regression (documentation/specs/phase-2-6-technical.md §5.5, §10.3): existing-system discovery is
// pure and path-only. Structurally, `candidates.ts` imports no filesystem, network or process module and
// calls no `fetch`; behaviourally, running discovery over a realistic walk opens, stats, lists or fetches
// nothing (every fs entry point and the global fetch are spied while it runs).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';

import { findSystemCandidates, locationView, missedCounts } from '../../../src/service/systems/candidates.ts';

const SOURCE = path.join(import.meta.dirname, '../../../src/service/systems/candidates.ts');

test('candidates.ts imports only path helpers and pure rules: no fs, network or child process, no fetch', async () => {
  const text = await readFile(SOURCE, 'utf8');
  const specifiers = [...text.matchAll(/^import\s[^;]*?from\s+'([^']+)';/gms)].map((match) => match[1]);
  assert.ok(specifiers.length > 0);
  const allowed = new Set(['node:path', '../../shared/api.ts', '../../shared/limits.ts', '../../shared/types.ts', '../discovery.ts', '../paths.ts', './extract-rules.ts']);
  for (const specifier of specifiers) assert.ok(allowed.has(specifier ?? ''), `unexpected import ${specifier}`);
  for (const banned of [/\bfetch\s*\(/, /node:(fs|http|https|net|dgram|child_process|dns|tls)\b/, /\bimport\s*\(/, /\brequire\s*\(/]) {
    assert.doesNotMatch(text, banned, `candidates.ts must not use ${banned}`);
  }
});

test('discovery, missedCounts and locationView touch no file and no network while they run', () => {
  const calls: string[] = [];
  const restore: (() => void)[] = [];
  const spy = (target: Record<string, unknown>, label: string): void => {
    for (const key of Object.keys(target)) {
      const original = target[key];
      if (typeof original !== 'function' || key === 'constants' || /^[A-Z]/.test(key)) continue;
      target[key] = function spied(this: unknown, ...args: unknown[]) {
        calls.push(`${label}.${key}`);
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      };
      restore.push(() => {
        target[key] = original;
      });
    }
  };
  spy(fs as unknown as Record<string, unknown>, 'fs');
  spy(fs.promises as unknown as Record<string, unknown>, 'fs.promises');
  syncBuiltinESMExports();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls.push('fetch');
    throw new Error('no network in discovery');
  }) as typeof fetch;
  try {
    const files = [
      'design-system/system.json', 'design-system/tokens.css', 'design-system/index.html', 'design-system/components/button.html',
      'app/design-system/page.tsx', 'src/pages/design-system.tsx', 'docs/design-guide.md', 'DESIGN.md', 'src/styles/tokens.css',
      'src/theme.ts', 'tailwind.config.js', 'src/components/Card.tsx', 'src/routes/+page.svelte',
    ];
    const tokens = [{ file: 'design-system/tokens.css', section: 'colours' as const }, { file: 'src/styles/tokens.css', section: 'spacing' as const }];
    const found = findSystemCandidates({ files, tokens, registered: [{ id: 'acme', name: 'Acme', abs: '/code/shop/design-system' }], root: '/code/shop' });
    assert.ok(found.candidates.length > 0);
    missedCounts(files);
    locationView({ location: 'design-system', files: ['system.json', 'tokens.css', 'index.html'], tokens: [] });
  } finally {
    globalThis.fetch = originalFetch;
    for (const undo of restore) undo();
    syncBuiltinESMExports();
  }
  assert.deepEqual(calls, [], 'discovery is path-only');
});
