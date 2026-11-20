// PROPOSAL.json (documentation/specs/phase-2-5-technical.md §2.15, §5.14, T17): parseProposal's caps
// (size, id, parts, 200 files, patch sizes) and each field rule, with the sentence every refusal shows;
// and landedSentence, the notice for what landed against what was approved.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SYSTEM_PROPOSAL_MAX_BYTES, SYSTEM_PROPOSAL_PATCH_MAX } from '../../src/shared/limits.ts';
import {
  landedSentence,
  parseProposal,
  PATCH_OMITTED_SENTENCE,
  PROPOSAL_NO_ID,
  PROPOSAL_NO_PARTS,
  PROPOSAL_NOT_JSON,
  PROPOSAL_TOO_LARGE,
  PROPOSAL_TOO_MANY_FILES,
} from '../../src/shared/system-json.ts';
import { SKIP_DIRS } from '../../src/service/discovery.ts';

const ID = 'p_k3m9q2x7';
const file = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ path: 'design-system/tokens.css', change: 'modify', summary: 'The new blue.', added: 1, removed: 1, ...extra });
const doc = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  id: ID,
  supersedes: null,
  created: '2026-11-20T10:00:00.000Z',
  mode: 'fix',
  summary: 'A darker brand blue.',
  parts: [{ name: 'system-files', files: [file()] }],
  wayBack: { kind: 'commit', name: 'abc1234', text: 'Revert the commit.' },
  access: null,
  ...extra,
});
const parse = (value: unknown) => parseProposal(typeof value === 'string' ? value : JSON.stringify(value), { skipDirs: SKIP_DIRS });
const messages = (value: unknown): string[] => parse(value).problems.map((problem) => problem.message);
const onePart = (name: string, files: unknown[]) => doc({ parts: [{ name, files }] });

describe('parseProposal: what makes the file unreadable', () => {
  test('a sound proposal parses with no problem; unknown keys stay on raw', () => {
    const parsed = parse(doc({ later: { kept: true } }));
    assert.equal(parsed.unreadable, null);
    assert.deepEqual(parsed.problems, []);
    assert.equal(parsed.id, ID);
    assert.equal(parsed.proposal?.mode, 'fix');
    assert.deepEqual(parsed.raw?.later, { kept: true });
    assert.deepEqual(parsed.parts, [
      { name: 'system-files', files: [{ path: 'design-system/tokens.css', change: 'modify', summary: 'The new blue.', added: 1, removed: 1, patch: null, patchOmitted: false, from: null, bytes: null, usages: null }] },
    ]);
  });

  test('not JSON, or JSON that is not an object', () => {
    for (const text of ['{', 'null', '[]', '"p_k3m9q2x7"']) {
      const parsed = parse(text);
      assert.equal(parsed.unreadable, PROPOSAL_NOT_JSON, text);
      assert.equal(parsed.id, null);
      assert.equal(parsed.proposal, null);
    }
    assert.equal(PROPOSAL_NOT_JSON, "PROPOSAL.json isn't valid JSON.");
  });

  test('a byte order mark is not a reason to refuse', () => {
    assert.equal(parse(`\uFEFF${JSON.stringify(doc())}`).unreadable, null);
  });

  test('over 512 KB is refused before parsing, counted in bytes', () => {
    const padded = JSON.stringify(doc({ pad: 'a'.repeat(SYSTEM_PROPOSAL_MAX_BYTES) }));
    assert.equal(parse(padded).unreadable, PROPOSAL_TOO_LARGE);
    // 180 000 three-byte characters: fewer characters than the cap, more bytes.
    const wide = JSON.stringify(doc({ pad: '€'.repeat(180_000) }));
    assert.ok(wide.length < SYSTEM_PROPOSAL_MAX_BYTES);
    assert.equal(parse(wide).unreadable, PROPOSAL_TOO_LARGE);
    assert.equal(PROPOSAL_TOO_LARGE, 'PROPOSAL.json is larger than 512 KB.');
  });

  test('an id is required and must match p_ plus 8 to 16 lower-case letters or digits', () => {
    for (const id of [undefined, 42, '', 'p_short', 'p_UPPERCASE1', 'q_k3m9q2x7', 'p_k3m9q2x7/../x', `p_${'a'.repeat(17)}`]) {
      const parsed = parse(doc({ id }));
      assert.equal(parsed.unreadable, PROPOSAL_NO_ID, String(id));
      assert.equal(parsed.id, null);
    }
    assert.equal(parse(doc({ id: `p_${'a'.repeat(16)}` })).unreadable, null);
  });

  test('a parts list is required; the id is still known', () => {
    const parsed = parse(doc({ parts: { name: 'system-files' } }));
    assert.equal(parsed.unreadable, PROPOSAL_NO_PARTS);
    assert.equal(parsed.id, ID);
  });

  test('more than 200 files in all is refused, across parts', () => {
    const many = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => file({ path: `${prefix}/f${i}.md`, change: 'create' }));
    const parsed = parse(doc({ parts: [{ name: 'system-files', files: many(150, 'design-system/notes') }, { name: 'docs', files: many(51, 'docs') }] }));
    assert.equal(parsed.unreadable, PROPOSAL_TOO_MANY_FILES);
    assert.equal(parsed.id, ID);
    assert.equal(parse(doc({ parts: [{ name: 'system-files', files: many(150, 'design-system/notes') }, { name: 'docs', files: many(50, 'docs') }] })).unreadable, null);
  });
});

describe('parseProposal: fields that are skipped with a problem', () => {
  test('version, supersedes, created, mode, summary, wayBack, access', () => {
    assert.deepEqual(messages(doc({ version: 2 })), ['version in PROPOSAL.json must be 1.']);
    const supersedes = parse(doc({ supersedes: 'not-an-id' }));
    assert.equal(supersedes.proposal?.supersedes, null);
    assert.deepEqual(supersedes.problems.map((p) => p.message), ['supersedes in PROPOSAL.json is not a proposal id, so it was skipped.']);
    assert.equal(parse(doc({ supersedes: 'p_aaaa1111' })).proposal?.supersedes, 'p_aaaa1111');
    assert.deepEqual(messages(doc({ created: 'yesterday' })), ['created in PROPOSAL.json needs an ISO time.']);
    const mode = parse(doc({ mode: 'yolo' }));
    assert.equal(mode.proposal?.mode, 'none');
    assert.deepEqual(mode.problems.map((p) => p.message), ['mode in PROPOSAL.json must be fix, describe or none.']);
    assert.deepEqual(messages(doc({ summary: 'x'.repeat(501) })), ['The summary in PROPOSAL.json must be text of up to 500 characters.']);
    assert.deepEqual(messages(doc({ summary: 'x'.repeat(500) })), []);
    assert.deepEqual(messages(doc({ wayBack: undefined })), ['PROPOSAL.json should say how to undo the change (wayBack).']);
    assert.deepEqual(messages(doc({ wayBack: { kind: 'tag', name: 'v1', text: 'x' } })), ['wayBack in PROPOSAL.json needs a kind (commit, branch, stash or none), a name and a line of text.']);
    assert.deepEqual(messages(doc({ wayBack: { kind: 'commit', name: 'x'.repeat(101), text: 'x' } })).length, 1);
    const access = parse(doc({ access: 'everyone' }));
    assert.equal(access.proposal?.access, null);
    assert.deepEqual(access.problems.map((p) => p.message), ['access in PROPOSAL.json must be dev, public or null.']);
    assert.equal(parse(doc({ access: 'dev' })).proposal?.access, 'dev');
  });

  test('a part must be named, once, with a files list', () => {
    assert.deepEqual(messages(doc({ parts: ['system-files'] })), ['This part is not an object.']);
    assert.deepEqual(messages(doc({ parts: [{ name: 'tests', files: [] }] })), ['A part is named system-files, token-fixes, docs or living-page.']);
    assert.deepEqual(messages(doc({ parts: [{ name: 'docs', files: [] }, { name: 'docs', files: [] }] })), ['docs appears more than once in PROPOSAL.json.']);
    assert.deepEqual(messages(doc({ parts: [{ name: 'docs' }] })), ['docs needs a files list.']);
  });

  test('a file path is repo-relative, at most 8 folders deep, never in a generated folder', () => {
    const pathRule = 'A file path must be relative to the repo, up to 8 folders deep, and not inside node_modules, .git, dist, build or other generated folders.';
    for (const bad of ['/etc/passwd', '../outside.css', 'a/../b.css', 'C:/x.css', 'a\\b.css', 'a/b/c/d/e/f/g/h/i/j.css', 'node_modules/x/y.css', 'src/.git/config', 'dist/app.css', '.env', '']) {
      const parsed = parse(onePart('docs', [file({ path: bad })]));
      assert.deepEqual(parsed.problems.map((p) => p.message), [pathRule], bad);
      assert.deepEqual(parsed.parts[0]?.files, [], bad);
    }
    assert.deepEqual(messages(onePart('docs', [file({ path: 'a/b/c/d/e/f/g/h.css' })])), []);
  });

  test('change, summary, counts, usages and duplicates', () => {
    assert.deepEqual(messages(onePart('docs', [file({ change: 'rename' })])), ['design-system/tokens.css: change must be create, modify or delete.']);
    assert.deepEqual(messages(onePart('docs', [file({ summary: 'x'.repeat(301) })])), ['design-system/tokens.css: the summary must be text of up to 300 characters.']);
    for (const count of [-1, 1.5, 1_000_001, '3']) {
      assert.deepEqual(messages(onePart('docs', [file({ added: count })])), ['design-system/tokens.css: added and removed are whole numbers from 0 to 1 000 000.'], String(count));
    }
    assert.deepEqual(messages(onePart('docs', [file({ added: 1_000_000, removed: 0 })])), []);
    assert.deepEqual(messages(onePart('docs', [file({ usages: { count: 3 } })])), ['design-system/tokens.css: usages needs a count and listed (true or false).']);
    assert.deepEqual(parse(onePart('docs', [file({ usages: { count: 3, listed: true } })])).parts[0]?.files[0]?.usages, { count: 3, listed: true });
    assert.deepEqual(messages(onePart('docs', [file(), file()])), ['design-system/tokens.css is listed twice in docs.']);
  });

  test('every string stays text: markup is kept as written, never read as markup', () => {
    const parsed = parse(doc({ summary: '<img src=x onerror=alert(1)>' }));
    assert.equal(parsed.proposal?.summary, '<img src=x onerror=alert(1)>');
  });
});

describe('parseProposal: patches', () => {
  test('a patch over 20 000 characters is dropped and the file says so; that is not a problem', () => {
    const parsed = parse(onePart('system-files', [file({ patch: 'x'.repeat(SYSTEM_PROPOSAL_PATCH_MAX + 1) })]));
    assert.deepEqual(parsed.problems, []);
    assert.deepEqual([parsed.parts[0]?.files[0]?.patch, parsed.parts[0]?.files[0]?.patchOmitted], [null, true]);
    const kept = parse(onePart('system-files', [file({ patch: 'x'.repeat(SYSTEM_PROPOSAL_PATCH_MAX) })]));
    assert.equal(kept.parts[0]?.files[0]?.patchOmitted, false);
    assert.equal(PATCH_OMITTED_SENTENCE, "The change is too long to show here; it's in the chat.");
  });

  test('patches share a 400 000 character budget; the one that would pass it is dropped', () => {
    const files = Array.from({ length: 21 }, (_, i) => file({ path: `design-system/notes/n${i}.md`, patch: 'x'.repeat(19_999) }));
    const parsed = parse(onePart('system-files', files));
    const omitted = parsed.parts[0]?.files.map((item) => item.patchOmitted) ?? [];
    assert.deepEqual(omitted, [...Array(20).fill(false), true]);
  });

  test('a patch must be text, and the living page never has one', () => {
    assert.deepEqual(messages(onePart('docs', [file({ patch: 3 })])), ['design-system/tokens.css: the patch must be text.']);
    const living = parse(onePart('living-page', [file({ path: 'design-system/index.html', patch: 'x' })]));
    assert.deepEqual(living.problems.map((p) => p.message), ['The living page is generated by Design Chamber, so it has no patch.']);
    assert.equal(living.parts[0]?.files[0]?.patch, null);
  });
});

describe('parseProposal: from and the living page', () => {
  test('from names a contract file under proposal/, only for a create in system-files or docs', () => {
    const create = (extra: Record<string, unknown>) => file({ path: 'design-system/notes/history.md', change: 'create', ...extra });
    assert.equal(parse(onePart('system-files', [create({ from: 'proposal/notes/history.md' })])).parts[0]?.files[0]?.from, 'proposal/notes/history.md');
    assert.equal(parse(onePart('docs', [create({ from: 'proposal/OVERVIEW.md' })])).parts[0]?.files[0]?.from, 'proposal/OVERVIEW.md');
    const where = 'design-system/notes/history.md: from must name a system file under proposal/, like proposal/tokens.css.';
    for (const from of ['notes/history.md', 'proposal/../tokens.css', 'proposal/README.md', 'proposal/notes/deep/x.md', 'proposal/assets/fonts/../x', 7]) {
      assert.deepEqual(messages(onePart('system-files', [create({ from })])), [where], String(from));
    }
    const only = 'design-system/notes/history.md: only a new system file or doc can point at proposal/.';
    assert.deepEqual(messages(onePart('system-files', [create({ change: 'modify', from: 'proposal/notes/history.md' })])), [only]);
    assert.deepEqual(messages(onePart('token-fixes', [create({ from: 'proposal/notes/history.md' })])), [only]);
  });

  test('the living-page part holds exactly one create or change', () => {
    const rule = 'The living-page part holds exactly one file: a create or change of the living page.';
    const page = (extra: Record<string, unknown> = {}) => file({ path: 'design-system/index.html', ...extra });
    assert.deepEqual(messages(onePart('living-page', [page()])), []);
    assert.deepEqual(messages(onePart('living-page', [page({ change: 'create' })])), []);
    assert.deepEqual(messages(onePart('living-page', [page({ change: 'delete' })])), [rule]);
    assert.deepEqual(messages(onePart('living-page', [page(), page({ path: 'docs/index.html' })])), [rule]);
    assert.deepEqual(messages(onePart('living-page', [])), [rule]);
  });
});

describe('landedSentence', () => {
  test('differences, then the parts claimed but not found', () => {
    assert.equal(landedSentence({ differ: [], unclaimed: [] }, 'shop'), null);
    assert.equal(landedSentence({ differ: ['tokens.css'], unclaimed: [] }, 'shop'), 'What landed in shop differs from what you approved in 1 file: tokens.css.');
    assert.equal(
      landedSentence({ differ: ['tokens.css', 'OVERVIEW.md'], unclaimed: ['docs'] }, 'shop'),
      'What landed in shop differs from what you approved in 2 files: tokens.css, OVERVIEW.md. The agent says it applied docs, but Design Chamber found no docs in shop.',
    );
    assert.match(landedSentence({ differ: [], unclaimed: ['docs', 'living-page'] }, 'shop') ?? '', /found none of them in shop\.$/);
    // An entry that is not a part name is never echoed.
    assert.equal(landedSentence({ differ: [], unclaimed: ['<b>x</b>'] }, 'shop'), null);
  });
});
