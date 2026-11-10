// package.json is the extension manifest (docs/SPEC.md §5). Parse it with the host's own
// parser so a broken manifest fails here, not at folder install.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  GUEST_BLOCK_ARG_NAME,
  GUEST_BLOCK_ARGS_MAX,
  GUEST_BLOCK_DESCRIPTION_MAX,
  GUEST_BLOCK_HEIGHT_MAX,
  GUEST_BLOCK_NAME,
  GUEST_BLOCKS_MAX,
  GUEST_STATUS_SECTION_HEIGHT_MAX,
  GUEST_STATUS_SECTION_HEIGHT_MIN,
  GUEST_STATUS_SECTION_TITLE_MAX,
  GUEST_TOOL_MATCH,
  GUEST_TOOLS_MAX,
} from '@openchamber/sdk';
import { parseManifestJson } from '@openchamber/sdk/schemas';

// The SDK declares this limit (manifest.d.ts) but does not export it from its index.
const GUEST_MENTIONS_LABEL_MAX = 40;

const text = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

test('the manifest parses with the SDK host parser', () => {
  const result = parseManifestJson(text);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const { contributes } = result.manifest;
  assert.equal(result.manifest.apiVersion, 1);
  assert.equal(result.manifest.engines?.openchamber, '>=2.7.0');
  assert.equal(contributes.panel.entry, 'dist/panel/index.html');
  assert.equal(contributes.background?.entry, 'dist/background/index.html');
  assert.equal(contributes.service?.entry, 'dist/service/main.js');
  assert.deepEqual(contributes.commands?.map((command) => command.name), ['design', 'page']);
  assert.deepEqual(contributes.actions?.map((action) => [action.id, action.label]), [['open-as-page', 'Open as page']]);
  assert.deepEqual(contributes.capabilities, ['prompt', 'sessions']);
});

test('the manifest carries every SDK 2.7 key, so users approve once', () => {
  const result = parseManifestJson(text);
  if (!result.ok) return assert.fail(JSON.stringify(result));
  const { contributes } = result.manifest;
  assert.deepEqual(contributes.statusSection, {
    entry: 'dist/status/index.html',
    title: 'Designs',
    height: 120,
    defaultExpanded: true,
    requiresProject: false,
  });
  assert.deepEqual(contributes.sessionEvents, { events: ['turn-started', 'turn-finished', 'turn-failed'] });
  assert.equal(contributes.instructions, true);
  assert.equal(contributes.skills, 'dist/skills');
  assert.equal(contributes.opencodePlugin, 'dist/plugin');
  assert.deepEqual(contributes.mentions, { label: 'Designs' });
  assert.deepEqual(contributes.tools?.map((tool) => tool.match), ['design_check']);
  assert.deepEqual(contributes.blocks?.map((block) => block.name), ['DesignCard', 'DirectionPick']);
  assert.deepEqual(contributes.blocks?.map((block) => block.entry), ['dist/blocks/index.html', 'dist/blocks/index.html']);
  assert.equal(contributes.blocks?.find((block) => block.name === 'DirectionPick')?.answers, true);
  assert.equal(contributes.blocks?.find((block) => block.name === 'DesignCard')?.answers, undefined);
});

test('the new keys stay inside the SDK limits', () => {
  const result = parseManifestJson(text);
  if (!result.ok) return assert.fail(JSON.stringify(result));
  const { statusSection, mentions, tools, blocks } = result.manifest.contributes;
  assert.ok(statusSection && typeof statusSection === 'object');
  assert.ok((statusSection.title?.length ?? 0) >= 1 && (statusSection.title?.length ?? 0) <= GUEST_STATUS_SECTION_TITLE_MAX);
  assert.ok((statusSection.height ?? 0) >= GUEST_STATUS_SECTION_HEIGHT_MIN && (statusSection.height ?? 0) <= GUEST_STATUS_SECTION_HEIGHT_MAX);
  assert.ok((mentions?.label.length ?? 0) >= 1 && (mentions?.label.length ?? 0) <= GUEST_MENTIONS_LABEL_MAX);
  assert.ok((tools?.length ?? 0) <= GUEST_TOOLS_MAX);
  for (const tool of tools ?? []) assert.match(tool.match, GUEST_TOOL_MATCH);
  assert.ok((blocks?.length ?? 0) >= 1 && (blocks?.length ?? 0) <= GUEST_BLOCKS_MAX);
  for (const block of blocks ?? []) {
    assert.match(block.name, GUEST_BLOCK_NAME);
    assert.ok(block.description.length <= GUEST_BLOCK_DESCRIPTION_MAX, `${block.name} description is ${block.description.length} characters`);
    assert.ok((block.args?.length ?? 0) <= GUEST_BLOCK_ARGS_MAX);
    for (const arg of block.args ?? []) assert.match(arg, GUEST_BLOCK_ARG_NAME);
    assert.ok((block.height ?? 0) <= GUEST_BLOCK_HEIGHT_MAX);
  }
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

test('no string the user or an agent reads in the manifest has an em dash', () => {
  // The tool title uses a middle dot on purpose: the owner's copy rule bans the em dash everywhere.
  const result = parseManifestJson(text);
  if (!result.ok) return assert.fail(JSON.stringify(result));
  const { statusSection, mentions, tools, blocks } = result.manifest.contributes;
  const strings: string[] = [
    ...(typeof statusSection === 'object' && statusSection.title ? [statusSection.title] : []),
    ...(mentions ? [mentions.label] : []),
    ...(tools ?? []).flatMap((tool) => [tool.name ?? '', tool.title ?? '']),
    ...(blocks ?? []).map((block) => block.description),
  ];
  assert.ok(strings.length > 0);
  for (const value of strings) assert.doesNotMatch(value, /[—–]/, `dash in: ${value}`);
});

test('the manifest never claims the browser role (it would fight Design Canvas)', () => {
  assert.doesNotMatch(text, /"provides"/);
});
