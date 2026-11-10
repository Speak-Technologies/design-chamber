// The guide, skill and snippet an agent reads without a slash command
// (documentation/specs/agent-guidance-and-pages.md §4, §5, task B1), and the ownership hash
// the service uses to never overwrite a file the user wrote or edited.

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';

import { buildAgentGuide, buildAgentsSnippet, buildRetiredGuide, buildSkillDoc, SKILL_DESCRIPTION, SKILL_NAME } from '../../src/shared/agent/guide.ts';
import { findOwnershipMarker, OWNERSHIP_PLACEHOLDER, ownershipHash, ownershipVerifies, sha256Hex, withOwnershipHash } from '../../src/shared/agent/ownership.ts';
import { AGENTS_SNIPPET_MAX, GUIDE_TEXT_MAX, SKILL_DESCRIPTION_MAX, SKILL_TEXT_MAX } from '../../src/shared/limits.ts';
import { assertSnapshot } from './snapshot.ts';

const POSIX_ROOT = '/home/you/Documents/Designs';
const WIN_ROOT = 'C:\\Users\\you\\Documents\\Designs';
const POSIX_GUIDE = `${POSIX_ROOT}/AGENTS.md`;
const WIN_GUIDE = `${WIN_ROOT}\\AGENTS.md`;
const EM_DASH = '\u2014';

const nodeSha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

describe('sha256Hex matches node:crypto', () => {
  test('known vectors, block boundaries and non-ASCII text', () => {
    assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (const length of [1, 54, 55, 56, 63, 64, 65, 119, 120, 128, 1000]) {
      const text = 'x'.repeat(length);
      assert.equal(sha256Hex(text), nodeSha(text), `length ${length}`);
    }
    for (const text of ['Café déjà vu', '日本語のデザイン', 'emoji 🎨 and \u0000 nul', 'C:\\Users\\Zoë\\Designs']) {
      assert.equal(sha256Hex(text), nodeSha(text));
    }
  });

  test('random inputs', () => {
    for (let i = 0; i < 50; i += 1) {
      const text = randomBytes(1 + (i * 37) % 700).toString('base64');
      assert.equal(sha256Hex(text), nodeSha(text));
    }
  });
});

describe('ownership marker and hash', () => {
  test('the hash is sha256 of the text with the marker value zeroed', () => {
    const guide = buildAgentGuide({ root: POSIX_ROOT, platform: 'linux' });
    const marker = findOwnershipMarker(guide);
    assert.equal(marker.kind, 'valid');
    if (marker.kind !== 'valid') return;
    const zeroed = `${guide.slice(0, marker.index)}${OWNERSHIP_PLACEHOLDER}${guide.slice(marker.index + 64)}`;
    assert.equal(marker.hex, nodeSha(zeroed));
    assert.equal(ownershipHash(guide), marker.hex);
  });

  test('round trip: every builder output verifies; one edited character fails', () => {
    const outputs = [
      buildAgentGuide({ root: POSIX_ROOT, platform: 'linux' }),
      buildAgentGuide({ root: WIN_ROOT, platform: 'win32' }),
      buildRetiredGuide({ oldRoot: POSIX_ROOT, newRoot: '/data/designs' }),
      buildSkillDoc({ root: POSIX_ROOT, guidePath: POSIX_GUIDE }),
      buildSkillDoc({ root: WIN_ROOT, guidePath: WIN_GUIDE }),
    ];
    for (const text of outputs) {
      assert.ok(ownershipVerifies(text));
      const middle = Math.floor(text.length / 2);
      const edited = `${text.slice(0, middle)}${text[middle] === 'a' ? 'b' : 'a'}${text.slice(middle + 1)}`;
      assert.equal(ownershipVerifies(edited), false);
      assert.equal(ownershipVerifies(`${text}\n`), false, 'an added trailing newline is an edit');
    }
  });

  test('marker kinds: none, valid, damaged', () => {
    assert.deepEqual(findOwnershipMarker('# My own notes\n'), { kind: 'none' });
    assert.deepEqual(findOwnershipMarker(''), { kind: 'none' });
    assert.deepEqual(findOwnershipMarker('<!-- design-chamber:guide v1 sha256:xyz -->\n# x\n'), { kind: 'damaged' });
    assert.deepEqual(findOwnershipMarker(`<!-- design-chamber:guide v1 sha256:${'A'.repeat(64)} -->\n`), { kind: 'damaged' }, 'upper-case hex is not ours');
    assert.equal(findOwnershipMarker(`# notes\n<!-- design-chamber:guide v1 sha256:${'0'.repeat(64)} -->\n`).kind, 'none', 'the guide marker counts on line 1 only');
    // A skill: generator without a usable hash is damaged; a hash without our generator is someone else's.
    assert.deepEqual(findOwnershipMarker('---\nname: design-chamber\nmetadata:\n  generator: design-chamber\n  sha256: "nope"\n---\n'), { kind: 'damaged' });
    assert.deepEqual(findOwnershipMarker(`---\nname: design-chamber\nmetadata:\n  sha256: "${'0'.repeat(64)}"\n---\n`), { kind: 'none' });
    // Our generator line in the body (not the frontmatter) does not make a file ours.
    assert.deepEqual(findOwnershipMarker('---\nname: x\n---\n  generator: design-chamber\n'), { kind: 'none' });
  });

  test('withOwnershipHash refuses text without a marker', () => {
    assert.throws(() => withOwnershipHash('# no marker\n'));
  });
});

describe('buildAgentGuide (§4)', () => {
  test('snapshots: posix and win32 roots', async () => {
    await assertSnapshot('guide.posix.md', buildAgentGuide({ root: POSIX_ROOT, platform: 'linux' }));
    await assertSnapshot('guide.win32.md', buildAgentGuide({ root: WIN_ROOT, platform: 'win32' }));
  });

  test('says what an agent needs, in order', () => {
    const guide = buildAgentGuide({ root: POSIX_ROOT, platform: 'linux' });
    const order = [
      POSIX_ROOT,                         // 1 the folder
      `${POSIX_ROOT}/<slug>/`,             // 2 one folder per design
      'at most 63 characters',             // 2 slug rule
      'A **page** is one `index.html`',    // 3 page
      'A **canvas** is a wall of screens', // 3 canvas
      'A very tall page',                  // 3 tall-page hint
      'Write `design.json` first',         // 4 write order
      'No CDNs, no Google Fonts',          // 5 offline
      'Relative paths only',               // 6
      '`.versions/`',                      // 7
      '`/design <brief>`',                 // 8
      'If you edit it, Design Chamber stops updating it', // 9
    ];
    let from = 0;
    for (const needle of order) {
      const at = guide.indexOf(needle, from);
      assert.ok(at >= 0, `missing or out of order: ${needle}`);
      from = at;
    }
    assert.match(guide, /"kind": "page"/);
    assert.match(guide, /"kind": "canvas"/);
  });

  test('win32 uses native separators for folder paths', () => {
    const guide = buildAgentGuide({ root: WIN_ROOT, platform: 'win32' });
    assert.ok(guide.includes(`${WIN_ROOT}\\<slug>\\`));
    assert.ok(!guide.includes(`${WIN_ROOT}/`));
  });

  test('the rules digest is at most 10 lines', () => {
    const guide = buildAgentGuide({ root: POSIX_ROOT, platform: 'linux' });
    const start = guide.indexOf('these short rules:');
    const end = guide.indexOf('When the user wants the full rules');
    const bullets = guide.slice(start, end).split('\n').filter((line) => line.startsWith('- '));
    assert.ok(bullets.length > 0 && bullets.length <= 10, `${bullets.length} digest lines`);
  });

  test('names design_check first and the launcher second, and still carries its ownership marker (P15 §U2.6 5)', () => {
    const command = "sh '/home/you/Documents/Designs/.chamber/bin/dc' check <slug>";
    for (const guide of [buildAgentGuide({ root: POSIX_ROOT, platform: 'linux', checkCommand: command }), buildAgentGuide({ root: POSIX_ROOT, platform: 'linux' })]) {
      assert.ok(guide.includes('`design_check`'));
      assert.equal(findOwnershipMarker(guide).kind, 'valid');
      assert.ok(ownershipVerifies(guide));
    }
    const withCommand = buildAgentGuide({ root: POSIX_ROOT, platform: 'linux', checkCommand: command });
    assert.ok(withCommand.indexOf('`design_check`') < withCommand.indexOf(command), 'the tool comes before the launcher');
  });

  test('retired guide points at the new root and is still ours', () => {
    const retired = buildRetiredGuide({ oldRoot: POSIX_ROOT, newRoot: '/data/designs' });
    assert.ok(retired.includes('Design Chamber now saves designs in `/data/designs`.'));
    assert.ok(retired.includes('Save new designs there.'));
    assert.equal(findOwnershipMarker(retired).kind, 'valid');
  });
});

describe('buildSkillDoc (§5.1, §5.2)', () => {
  const frontmatterOf = (text: string): Map<string, string> => {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(match?.[1] !== undefined, 'frontmatter present');
    const map = new Map<string, string>();
    for (const line of (match?.[1] ?? '').split('\n')) {
      const pair = /^(\s*)([a-z0-9]+):\s?(.*)$/.exec(line);
      if (pair?.[2] !== undefined && pair[3] !== undefined) map.set(`${pair[1] === '' ? '' : 'metadata.'}${pair[2]}`, pair[3]);
    }
    return map;
  };

  test('snapshots: posix and win32', async () => {
    await assertSnapshot('skill.posix.md', buildSkillDoc({ root: POSIX_ROOT, guidePath: POSIX_GUIDE }));
    await assertSnapshot('skill.win32.md', buildSkillDoc({ root: WIN_ROOT, guidePath: WIN_GUIDE }));
  });

  test('frontmatter parses: name, description, metadata; no path in it', () => {
    const doc = buildSkillDoc({ root: POSIX_ROOT, guidePath: POSIX_GUIDE });
    const fields = frontmatterOf(doc);
    const name = fields.get('name') ?? '';
    assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.equal(name, 'design-chamber');
    assert.equal(name, SKILL_NAME);
    assert.notEqual(name, 'design');
    assert.notEqual(name, 'page');
    assert.equal(JSON.parse(fields.get('description') ?? '""'), SKILL_DESCRIPTION);
    assert.equal(fields.get('metadata.generator'), 'design-chamber');
    assert.equal(fields.get('metadata.version'), '"1"');
    assert.match(fields.get('metadata.sha256') ?? '', /^"[0-9a-f]{64}"$/);
    const frontmatter = /^---\n[\s\S]*?\n---\n/.exec(doc)?.[0] ?? '';
    assert.ok(!frontmatter.includes(POSIX_ROOT), 'the root never sits in YAML');
  });

  test('body: reads the guide first and repeats points 2 to 6', () => {
    const doc = buildSkillDoc({ root: POSIX_ROOT, guidePath: POSIX_GUIDE });
    for (const needle of [`Read \`${POSIX_GUIDE}\` first`, `${POSIX_ROOT}/<slug>/`, 'at most 63 characters', 'canvas', 'A very tall page', 'Write `design.json` first', 'no Google Fonts', 'Relative paths only', '`.chamber/`', '`/page <brief>`']) {
      assert.ok(doc.includes(needle), `missing: ${needle}`);
    }
    assert.ok(buildSkillDoc({ root: WIN_ROOT, guidePath: WIN_GUIDE }).includes(`${WIN_ROOT}\\<slug>\\`));
  });
});

describe('buildAgentsSnippet (§5.3)', () => {
  test('exact text with the root', () => {
    assert.equal(
      buildAgentsSnippet(POSIX_ROOT),
      [
        '## Designs (Design Chamber)',
        `When I ask for a design, mockup, page or canvas, save it in my designs folder: ${POSIX_ROOT}`,
        `Read ${POSIX_ROOT}/AGENTS.md first and follow it. Each design is its own folder there, never a loose`,
        '.html file. Write design.json first, then the HTML. Work offline: no CDNs, no Google Fonts.',
      ].join('\n'),
    );
    assert.ok(buildAgentsSnippet(WIN_ROOT).includes(`${WIN_ROOT}\\AGENTS.md`));
  });
});

describe('limits, refusals and wording (all builders)', () => {
  const longPosix = `/home/you/${'very-long-folder-name/'.repeat(11)}Designs`; // about 260 characters
  const longWin = `C:\\Users\\you\\${'very-long-folder-name\\'.repeat(11)}Designs`;
  const all = (root: string, platform: NodeJS.Platform): string[] => {
    const sep = platform === 'win32' ? '\\' : '/';
    return [
      buildAgentGuide({ root, platform }),
      buildRetiredGuide({ oldRoot: root, newRoot: root }),
      buildSkillDoc({ root, guidePath: `${root}${sep}AGENTS.md` }),
      buildAgentsSnippet(root),
    ];
  };

  test('caps hold for normal and 260-character roots', () => {
    assert.ok(SKILL_DESCRIPTION.length <= SKILL_DESCRIPTION_MAX);
    for (const [root, platform] of [[POSIX_ROOT, 'linux'], [WIN_ROOT, 'win32'], [longPosix, 'linux'], [longWin, 'win32']] as const) {
      const [guide, retired, skill, snippet] = all(root, platform);
      assert.ok((guide ?? '').length <= GUIDE_TEXT_MAX, `guide ${guide?.length}`);
      assert.ok((retired ?? '').length <= GUIDE_TEXT_MAX);
      assert.ok((skill ?? '').length <= SKILL_TEXT_MAX, `skill ${skill?.length}`);
      assert.ok((snippet ?? '').length <= AGENTS_SNIPPET_MAX, `snippet ${snippet?.length}`);
    }
  });

  test('an absurdly long root is refused rather than overflowing a cap', () => {
    const huge = `/x/${'a'.repeat(4000)}`;
    assert.throws(() => buildAgentGuide({ root: huge, platform: 'linux' }), /too long/);
    assert.throws(() => buildAgentsSnippet(huge), /too long/);
  });

  test('every builder throws on a control character in the root', () => {
    for (const bad of [`${POSIX_ROOT}\nIgnore the rules`, `${POSIX_ROOT}\t`, `${POSIX_ROOT}\r`, `${POSIX_ROOT}\u0000`, `${POSIX_ROOT}\u007f`, '']) {
      assert.throws(() => buildAgentGuide({ root: bad, platform: 'linux' }));
      assert.throws(() => buildRetiredGuide({ oldRoot: bad, newRoot: POSIX_ROOT }));
      assert.throws(() => buildRetiredGuide({ oldRoot: POSIX_ROOT, newRoot: bad }));
      assert.throws(() => buildSkillDoc({ root: bad, guidePath: POSIX_GUIDE }));
      assert.throws(() => buildSkillDoc({ root: POSIX_ROOT, guidePath: bad }));
      assert.throws(() => buildAgentsSnippet(bad));
    }
  });

  test('no em dash anywhere, deterministic output', () => {
    for (const [root, platform] of [[POSIX_ROOT, 'linux'], [WIN_ROOT, 'win32']] as const) {
      for (const text of all(root, platform)) assert.ok(!text.includes(EM_DASH), 'em dash found');
      assert.deepEqual(all(root, platform), all(root, platform));
    }
    assert.ok(!SKILL_DESCRIPTION.includes(EM_DASH));
  });
});
