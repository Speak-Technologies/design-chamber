// "Manual members never alter rules or pins" (documentation/specs/phase-2-6-technical.md §10.4),
// the structural half: the modules that decide a design's system, its RULES.md and its pin lines
// read `DesignRecord.projectDirectory`, settings and the systems index only. None of them may reach
// the folder registry, the batch route or the agent's filing reconciler through any import chain.
// (The behavioural half is in chat-chip-filing.test.ts.)

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const REPO = path.resolve(import.meta.dirname, '..', '..');

const RULE_INPUTS = ['src/shared/systems.ts', 'src/service/discovery.ts', 'src/service/instructions.ts', 'src/shared/agent/rules-doc.ts'];
const FORBIDDEN = ['src/service/folders.ts', 'src/service/folder-requests.ts', 'src/service/routes/memberships.ts', 'src/service/routes/folders.ts'];

/** Relative specifiers of every static import, re-export and dynamic import in a file. */
const importsOf = (text: string): string[] => {
  const found: string[] = [];
  for (const match of text.matchAll(/(?:^|\s)(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|\s)import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier !== undefined && specifier.startsWith('.')) found.push(specifier);
  }
  return found;
};

/** Every repo file reachable from `entry` through relative imports. */
const reachable = async (entry: string): Promise<Set<string>> => {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const text = await readFile(path.join(REPO, file), 'utf8');
    for (const specifier of importsOf(text)) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)));
  }
  return seen;
};

test('the import scanner sees static, type-only, re-export and dynamic imports', () => {
  const text = [
    "import { a } from './a.ts';",
    "import type { B } from '../b.ts';",
    "export { c } from './c.ts';",
    "import './side.ts';",
    "const d = await import('./d.ts');",
    "import path from 'node:path';",
  ].join('\n');
  assert.deepEqual(importsOf(text).sort(), ['../b.ts', './a.ts', './c.ts', './d.ts', './side.ts']);
});

test('the modules that decide rules, systems and pins import nothing from folders or filing', async () => {
  for (const entry of RULE_INPUTS) {
    const files = await reachable(entry);
    assert.ok(files.size >= 1, entry);
    for (const forbidden of FORBIDDEN) assert.equal(files.has(forbidden), false, `${entry} reaches ${forbidden}`);
  }
});

test('the scan would notice a forbidden import (the check can fail)', async () => {
  // chat.ts files new designs, so it reaches folders.ts: the same walk must say so.
  assert.equal((await reachable('src/service/routes/chat.ts')).has('src/service/folders.ts'), true);
});
