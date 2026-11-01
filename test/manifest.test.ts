// package.json is the extension manifest (docs/SPEC.md §5). Parse it with the host's own
// parser so a broken manifest fails here, not at folder install.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parseManifestJson } from '@openchamber/sdk/schemas';

const text = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

test('the manifest parses with the SDK host parser', () => {
  const result = parseManifestJson(text);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const { contributes } = result.manifest;
  assert.equal(result.manifest.apiVersion, 1);
  assert.equal(result.manifest.engines?.openchamber, '>=2.5.0');
  assert.equal(contributes.panel.entry, 'dist/panel/index.html');
  assert.equal(contributes.background?.entry, 'dist/background/index.html');
  assert.equal(contributes.service?.entry, 'dist/service/main.js');
  assert.deepEqual(contributes.commands?.map((command) => command.name), ['design', 'page']);
  assert.deepEqual(contributes.actions?.map((action) => [action.id, action.label]), [['open-as-page', 'Open as page']]);
  assert.deepEqual(contributes.capabilities, ['prompt', 'sessions']);
});

test('command and action text is short and plain (≤ 80 characters, no em dashes)', () => {
  const result = parseManifestJson(text);
  if (!result.ok) return assert.fail(JSON.stringify(result));
  const { contributes } = result.manifest;
  const strings = [...(contributes.commands ?? []).map((command) => command.description ?? ''), ...(contributes.actions ?? []).map((action) => action.label)];
  for (const value of strings) {
    assert.ok(value.length <= 80, `too long: ${value}`);
    assert.doesNotMatch(value, /—/, `em dash in: ${value}`);
  }
});

test('the manifest never claims the browser role (it would fight Design Canvas)', () => {
  assert.doesNotMatch(text, /"provides"/);
});
