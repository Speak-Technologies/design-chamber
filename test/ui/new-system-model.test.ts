import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ScanSummary } from '../../src/shared/api.ts';
import { SYSTEM_BYTES_MAX, SYSTEM_FILES_MAX, SYSTEM_NAME_MAX } from '../../src/shared/limits.ts';
import {
  BRAND_ACCEPT,
  DESCRIPTION_MAX,
  classifyBrandFile,
  draftProblems,
  folderPathProblem,
  forAgentLine,
  resultClause,
  resultHeadline,
  resultToast,
  scanFoundNothing,
  scanSummarySentence,
  skippedLine,
  systemNameProblem,
  takeBrandFiles,
  type DraftInput,
  type PickedFile,
} from '../../src/ui/model/new-system-model.ts';

const MB = 1024 * 1024;

test('a name: required, no control characters, at most 60 characters, unique in any case', () => {
  const existing = [{ name: 'Harbor' }, { name: 'Field notes' }];
  assert.equal(systemNameProblem('  ', existing), 'Give the design system a name.');
  assert.equal(systemNameProblem('Bad\nname', existing), 'A design system name can’t contain line breaks or tabs.');
  assert.equal(systemNameProblem('x'.repeat(SYSTEM_NAME_MAX + 1), existing), `Keep the name to ${SYSTEM_NAME_MAX} characters or fewer.`);
  assert.equal(systemNameProblem('x'.repeat(SYSTEM_NAME_MAX), existing), null);
  assert.equal(systemNameProblem('harbor', existing), 'You already have a system called Harbor.');
  assert.equal(systemNameProblem('FIELD NOTES', existing), 'You already have a system called Field notes.');
  assert.equal(systemNameProblem('Orchard', existing), null);
});

test('a brand file by its ending: fonts, logos and documents, each with its own size limit', () => {
  assert.deepEqual(classifyBrandFile('Inter-Bold.WOFF2', 90_000), { ok: true, kind: 'font' });
  assert.deepEqual(classifyBrandFile('mark.svg', 3000), { ok: true, kind: 'logo' });
  assert.deepEqual(classifyBrandFile('photo.JPEG', 3000), { ok: true, kind: 'logo' });
  assert.deepEqual(classifyBrandFile('guide.pdf', 3000), { ok: true, kind: 'source' });
  assert.deepEqual(classifyBrandFile('notes.md', 3000), { ok: true, kind: 'source' });
});

test('a brand file is refused by name with the reason: a type nobody uses, too large, empty', () => {
  assert.deepEqual(classifyBrandFile('brand.key', 400), { ok: false, reason: 'brand.key isn’t a file type design systems use.' });
  assert.deepEqual(classifyBrandFile('noextension', 400), { ok: false, reason: 'noextension isn’t a file type design systems use.' });
  assert.deepEqual(classifyBrandFile('.env', 400), { ok: false, reason: '.env isn’t a file type design systems use.' });
  assert.deepEqual(classifyBrandFile('big.woff2', 5 * MB + 1), { ok: false, reason: 'big.woff2 is too large (the limit is 5 MB).' });
  assert.deepEqual(classifyBrandFile('big.png', 10 * MB + 1), { ok: false, reason: 'big.png is too large (the limit is 10 MB).' });
  assert.deepEqual(classifyBrandFile('big.pdf', 20 * MB + 1), { ok: false, reason: 'big.pdf is too large (the limit is 20 MB).' });
  assert.deepEqual(classifyBrandFile('empty.txt', 0), { ok: false, reason: 'empty.txt is empty.' });
  assert.equal(classifyBrandFile('edge.woff2', 5 * MB).ok, true, 'exactly the limit is fine');
});

test('the file picker accepts exactly the types the service takes', () => {
  assert.equal(BRAND_ACCEPT, '.woff2,.woff,.ttf,.otf,.svg,.png,.jpg,.jpeg,.webp,.pdf,.md,.txt');
});

test('picking files keeps the good ones, names each refused one, and skips a file picked twice', () => {
  const kept: PickedFile[] = [{ key: 'a', name: 'a.svg', bytes: 100, kind: 'logo' }];
  const { added, refused } = takeBrandFiles(
    [
      { key: 'a', name: 'a.svg', bytes: 100 },
      { key: 'b', name: 'b.woff2', bytes: 100 },
      { key: 'c', name: 'c.key', bytes: 100 },
    ],
    kept,
  );
  assert.deepEqual(added.map((file) => file.name), ['b.woff2']);
  assert.deepEqual(refused, [{ name: 'c.key', reason: 'c.key isn’t a file type design systems use.' }]);
});

test('picking past the file count or total size refuses the rest by name', () => {
  const full: PickedFile[] = Array.from({ length: SYSTEM_FILES_MAX }, (_, n) => ({ key: `k${n}`, name: `f${n}.svg`, bytes: 1, kind: 'logo' }));
  const overCount = takeBrandFiles([{ key: 'x', name: 'x.svg', bytes: 1 }], full);
  assert.deepEqual(overCount.added, []);
  assert.equal(overCount.refused[0]?.reason, `x.svg wasn’t added: a design system holds up to ${SYSTEM_FILES_MAX} files.`);
  const heavy: PickedFile[] = [{ key: 'h', name: 'h.pdf', bytes: SYSTEM_BYTES_MAX - 10, kind: 'source' }];
  const overSize = takeBrandFiles([{ key: 'y', name: 'y.pdf', bytes: 11 }], heavy);
  assert.deepEqual(overSize.added, []);
  assert.equal(overSize.refused[0]?.reason, 'y.pdf wasn’t added: a design system holds up to 100 MB of files.');
});

test('a folder path must be a full path: a drive, a share or a root', () => {
  assert.equal(folderPathProblem(' '), 'Type the full path of the folder.');
  assert.equal(folderPathProblem('brand'), 'Use the full path of the folder, such as C:\\Brand or /Users/you/Brand.');
  assert.equal(folderPathProblem('..\\brand'), 'Use the full path of the folder, such as C:\\Brand or /Users/you/Brand.');
  assert.equal(folderPathProblem('C:\\Brand'), null);
  assert.equal(folderPathProblem('c:/Brand'), null);
  assert.equal(folderPathProblem('\\\\nas\\brand'), null);
  assert.equal(folderPathProblem('/Users/you/Brand'), null);
});

const scan = (over: Partial<ScanSummary> = {}): ScanSummary => ({
  directory: 'C:\\work\\shop',
  counts: { colours: 48, typography: 9, spacing: 12, radius: 0, shadows: 0, layers: 0, sizes: 0, other: 0, fonts: 3, logos: 2 },
  files: Array.from({ length: 14 }, (_, n) => ({ path: `f${n}.css`, found: 1 })),
  skipped: [],
  assets: [],
  forAgent: [],
  refused: 0,
  partial: false,
  ...over,
});

test('the scan sentence counts what it found, leaving out what it did not', () => {
  assert.equal(scanSummarySentence(scan()), 'Found 48 colours, 9 type styles, 12 spacing values, 3 font files, 2 logo files in 14 files.');
  assert.equal(
    scanSummarySentence(scan({ counts: { colours: 1, typography: 0, spacing: 0, radius: 2, shadows: 1, layers: 0, sizes: 1, other: 1, fonts: 1, logos: 1 }, files: [{ path: 'a.css', found: 5 }] })),
    'Found 1 colour, 2 corner radii, 1 shadow, 2 sizes, 1 font file, 1 logo file in 1 file.',
  );
});

test('a scan that found nothing says so instead of a sentence of zeros', () => {
  const empty = scan({ counts: { colours: 0, typography: 0, spacing: 0, radius: 0, shadows: 0, layers: 0, sizes: 0, other: 0, fonts: 0, logos: 0 }, files: [] });
  assert.equal(scanSummarySentence(empty), null);
  assert.equal(scanFoundNothing(empty), true);
  assert.equal(scanFoundNothing(scan()), false);
});

test('files for the agent and skipped files are said once, in plain words', () => {
  assert.equal(forAgentLine(scan()), null);
  assert.equal(forAgentLine(scan({ forAgent: [{ path: 'tailwind.config.js', why: 'js' }] })), '1 file Design Chamber doesn’t run. The agent will read it.');
  assert.equal(forAgentLine(scan({ forAgent: [{ path: 'a', why: 'js' }, { path: 'b', why: 'js' }] })), '2 files Design Chamber doesn’t run. The agent will read them.');
  assert.equal(skippedLine(scan()), null);
  assert.equal(skippedLine(scan({ skipped: [{ path: 'x.min.css', reason: 'large' }], refused: 2 })), '3 files skipped (too large, secret or unreadable).');
});

const draft = (over: Partial<DraftInput> = {}): DraftInput => ({
  name: 'Orchard',
  sources: { code: false, brand: false, description: true },
  scan: { state: 'idle' },
  brand: { files: [], folder: '' },
  description: 'Calm and confident.',
  preset: '',
  ...over,
});

test('a draft with a name and a description can be made', () => {
  assert.deepEqual(draftProblems(draft(), []), []);
});

test('a draft with nothing ticked is a blank system: only the name is needed', () => {
  assert.deepEqual(draftProblems(draft({ sources: { code: false, brand: false, description: false }, description: '' }), []), []);
});

test('the name problem comes first and names the field', () => {
  const problems = draftProblems(draft({ name: '', description: '' }), []);
  assert.deepEqual(problems.map((problem) => problem.field), ['name', 'description']);
  assert.equal(problems[0]?.message, 'Give the design system a name.');
});

test('a description or a preset is enough; neither is named; too long is named', () => {
  assert.deepEqual(draftProblems(draft({ description: '', preset: 'editorial' }), []), []);
  assert.equal(draftProblems(draft({ description: '   ', preset: '' }), [])[0]?.message, 'Describe the look you want, pick a style preset, or untick A description.');
  assert.equal(draftProblems(draft({ description: 'x'.repeat(DESCRIPTION_MAX + 1) }), [])[0]?.message, 'Keep the description to 2,000 characters or fewer.');
  assert.deepEqual(draftProblems(draft({ description: 'x'.repeat(DESCRIPTION_MAX) }), []), []);
});

test('project code needs a finished scan: not picked, still running and failed each say what to do', () => {
  const sources = { code: true, brand: false, description: false };
  assert.equal(draftProblems(draft({ sources, scan: { state: 'idle' } }), [])[0]?.message, 'Pick the project to read, or untick Project code.');
  assert.equal(draftProblems(draft({ sources, scan: { state: 'running', directory: 'C:\\x', seen: 3 } }), [])[0]?.message, 'Wait for the scan to finish, or cancel it and untick Project code.');
  assert.equal(draftProblems(draft({ sources, scan: { state: 'failed', directory: 'C:\\x', message: 'no' } }), [])[0]?.message, 'Pick a folder Design Chamber can read, or untick Project code.');
  assert.deepEqual(draftProblems(draft({ sources, scan: { state: 'done', directory: 'C:\\x', scanId: 'sc_x', summary: scan() } }), []), []);
});

test('brand files need a file or a folder, and a folder needs a full path', () => {
  const sources = { code: false, brand: true, description: false };
  assert.equal(draftProblems(draft({ sources }), [])[0]?.message, 'Add brand files, or untick Brand files.');
  assert.deepEqual(draftProblems(draft({ sources, brand: { files: [{ key: 'a', name: 'a.svg', bytes: 1, kind: 'logo' }], folder: '' } }), []), []);
  assert.deepEqual(draftProblems(draft({ sources, brand: { files: [], folder: 'C:\\Brand' } }), []), []);
  assert.equal(draftProblems(draft({ sources, brand: { files: [], folder: 'brand' } }), [])[0]?.message, 'Use the full path of the folder, such as C:\\Brand or /Users/you/Brand.');
});

test('a source that is not ticked is never a problem', () => {
  assert.deepEqual(draftProblems(draft({ sources: { code: false, brand: false, description: false }, scan: { state: 'failed', directory: 'C:\\x', message: 'no' }, brand: { files: [], folder: 'nope' } }), []), []);
});

test('the result after a made system: what is still open, in one clause shared by the headline and the toast', () => {
  assert.equal(resultClause(2, true), '2 files weren’t added');
  assert.equal(resultClause(1, true), '1 file wasn’t added');
  assert.equal(resultClause(0, false), 'the agent wasn’t asked');
  assert.equal(resultClause(2, false), '2 files weren’t added and the agent wasn’t asked');
  assert.equal(resultHeadline(2, false), '2 files weren’t added and the agent wasn’t asked.');
  assert.equal(resultHeadline(0, false), 'The agent wasn’t asked.');
  assert.equal(resultToast('Orchard', 1, true), 'Orchard is made, but 1 file wasn’t added.');
});
