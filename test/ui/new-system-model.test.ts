import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LocationView, ScanSummary, SystemCandidate } from '../../src/shared/api.ts';
import { SYSTEM_BYTES_MAX, SYSTEM_FILES_MAX, SYSTEM_NAME_MAX } from '../../src/shared/limits.ts';
import {
  BRAND_ACCEPT,
  DESCRIPTION_MAX,
  MAKE_LABEL,
  MISSED_LINE,
  NO_CANDIDATES,
  REGISTER_LABEL,
  SOURCES,
  candidateCountLine,
  candidateMarkLine,
  candidatesMoreLine,
  candidatesNote,
  classifyBrandFile,
  contractProblemLine,
  draftProblems,
  filesReadLabel,
  filesReadMore,
  folderPathProblem,
  forAgentLine,
  leftForAgentLine,
  locationLabel,
  locationValue,
  missedLine,
  nextSources,
  nudgeLine,
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
  type SourceId,
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
  read: 0,
  missed: { pages: 0, components: 0, codeThemes: 0 },
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
  // One skipped file is named with the service's own reason (the canvas's "Skipped 1 file over 1 MB: …").
  assert.equal(skippedLine(scan({ skipped: [{ path: 'design-system/bundle.css', reason: 'It’s larger than 1 MB, so it wasn’t read.' }] })), 'Skipped design-system/bundle.css. It’s larger than 1 MB, so it wasn’t read.');
});

const sources = (over: Partial<Record<SourceId, boolean>> = {}): Record<SourceId, boolean> => ({ code: false, brand: false, description: false, existing: false, ...over });

const draft = (over: Partial<DraftInput> = {}): DraftInput => ({
  name: 'Orchard',
  sources: sources({ description: true }),
  scan: { project: { state: 'idle' }, location: { state: 'idle' } },
  brand: { files: [], folder: '' },
  description: 'Calm and confident.',
  preset: '',
  ...over,
});

test('a draft with a name and a description can be made', () => {
  assert.deepEqual(draftProblems(draft(), []), []);
});

test('a draft with nothing ticked is a blank system: only the name is needed', () => {
  assert.deepEqual(draftProblems(draft({ sources: sources(), description: '' }), []), []);
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
  const ticked = sources({ code: true });
  assert.equal(draftProblems(draft({ sources: ticked, scan: { project: { state: 'idle' }, location: { state: 'idle' } } }), [])[0]?.message, 'Pick the project to read, or untick Project code.');
  assert.equal(draftProblems(draft({ sources: ticked, scan: { project: { state: 'running', directory: 'C:\\x', seen: 3 }, location: { state: 'idle' } } }), [])[0]?.message, 'Wait for the scan to finish, or cancel it and untick Project code.');
  assert.equal(draftProblems(draft({ sources: ticked, scan: { project: { state: 'failed', directory: 'C:\\x', message: 'no' }, location: { state: 'idle' } } }), [])[0]?.message, 'Pick a folder Design Chamber can read, or untick Project code.');
  assert.deepEqual(draftProblems(draft({ sources: ticked, scan: { project: { state: 'done', directory: 'C:\\x', scanId: 'sc_x', summary: scan() }, location: { state: 'idle' } } }), []), []);
});

test('brand files need a file or a folder, and a folder needs a full path', () => {
  const ticked = sources({ brand: true });
  assert.equal(draftProblems(draft({ sources: ticked }), [])[0]?.message, 'Add brand files, or untick Brand files.');
  assert.deepEqual(draftProblems(draft({ sources: ticked, brand: { files: [{ key: 'a', name: 'a.svg', bytes: 1, kind: 'logo' }], folder: '' } }), []), []);
  assert.deepEqual(draftProblems(draft({ sources: ticked, brand: { files: [], folder: 'C:\\Brand' } }), []), []);
  assert.equal(draftProblems(draft({ sources: ticked, brand: { files: [], folder: 'brand' } }), [])[0]?.message, 'Use the full path of the folder, such as C:\\Brand or /Users/you/Brand.');
});

test('a source that is not ticked is never a problem', () => {
  assert.deepEqual(draftProblems(draft({ sources: sources(), scan: { project: { state: 'failed', directory: 'C:\\x', message: 'no' }, location: { state: 'failed', path: 'x', message: 'no' } }, brand: { files: [], folder: 'nope' } }), []), []);
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

// ---------------------------------------------------------------- Phase 2.6 E2: the existing-system start

test('the four starts, in order, each saying what Design Chamber does and what the agent does', () => {
  assert.deepEqual(SOURCES.map((source) => source.id), ['code', 'brand', 'description', 'existing']);
  assert.equal(SOURCES[3]?.label, 'Existing design system');
  assert.equal(SOURCES[3]?.hint, 'Your project already has a system? Point at where it lives. Design Chamber reads its token files; the agent reads its page, docs and components.');
  assert.equal(SOURCES[0]?.hint, 'Design Chamber reads the CSS and token files it can parse. The agent reads the rest of the project and writes the overview, notes and components. The project isn’t changed.');
});

test('ticking Project code or Existing design system unticks the other; the rest stays', () => {
  const start = sources({ code: true, brand: true });
  const existing = nextSources(start, 'existing', true, { description: '', preset: '' });
  assert.deepEqual(existing, { code: false, brand: true, description: false, existing: true });
  const back = nextSources(existing, 'code', true, { description: '', preset: '' });
  assert.deepEqual(back, { code: true, brand: true, description: false, existing: false });
  // Unticking never touches the other sources.
  assert.deepEqual(nextSources(existing, 'existing', false, { description: '', preset: '' }), { code: false, brand: true, description: false, existing: false });
});

test('Existing design system unticks an empty description only when no preset is picked', () => {
  assert.equal(nextSources(sources({ description: true }), 'existing', true, { description: '  ', preset: '' }).description, false);
  assert.equal(nextSources(sources({ description: true }), 'existing', true, { description: 'Calm.', preset: '' }).description, true);
  assert.equal(nextSources(sources({ description: true }), 'existing', true, { description: '', preset: 'editorial' }).description, true);
  // The rule is about ticking existing, not about the description itself.
  assert.equal(nextSources(sources({ description: true }), 'brand', true, { description: '', preset: '' }).description, true);
});

const doneProject = { state: 'done' as const, directory: 'C:\\x', scanId: 'sc_p', summary: scan() };
const doneLocation = { state: 'done' as const, path: 'design-system', scanId: 'sc_l', summary: scan() };

test('existing needs a project read and a location read; each wait and failure says what to do', () => {
  const ticked = sources({ existing: true });
  const withScan = (project: DraftInput['scan']['project'], location: DraftInput['scan']['location']): DraftInput => draft({ sources: ticked, scan: { project, location } });
  assert.equal(draftProblems(withScan({ state: 'idle' }, { state: 'idle' }), [])[0]?.message, 'Pick the project to read, or untick Existing design system.');
  assert.equal(draftProblems(withScan({ state: 'running', directory: 'C:\\x', seen: 2 }, { state: 'idle' }), [])[0]?.message, 'Wait for Design Chamber to look through the project.');
  assert.equal(draftProblems(withScan(doneProject, { state: 'idle' }), [])[0]?.message, 'Pick where the system lives, or type its folder.');
  assert.equal(draftProblems(withScan(doneProject, { state: 'running', path: 'design-system' }), [])[0]?.message, 'Wait for Design Chamber to read that folder.');
  assert.equal(draftProblems(withScan(doneProject, { state: 'failed', path: 'nope', message: 'That folder is gone. Pick another location.' }), [])[0]?.message, 'That folder is gone. Pick another location.');
  assert.deepEqual(draftProblems(withScan(doneProject, doneLocation), []), []);
  // A failed project scan does not block Make once the location itself was read (the path can be typed).
  assert.deepEqual(draftProblems(withScan({ state: 'failed', directory: 'C:\\x', message: 'no' }, doneLocation), []), []);
});

const candidate = (over: Partial<SystemCandidate> = {}): SystemCandidate => ({
  path: 'design-system',
  marks: ['contract', 'page', 'tokens', 'docs'],
  counts: { colours: 24, tokens: 31, docs: 3, components: 14, pages: 1 },
  strong: true,
  registered: null,
  ...over,
});

test('a candidate line says what marks it, in the service’s mark order', () => {
  assert.equal(candidateMarkLine(candidate()), 'system.json, page, tokens, 3 docs');
  assert.equal(candidateMarkLine(candidate({ marks: ['docs'], counts: { colours: 0, tokens: 0, docs: 2, components: 0, pages: 0 } })), '2 docs, no token files');
  assert.equal(candidateMarkLine(candidate({ marks: ['tokens'], counts: { colours: 79, tokens: 143, docs: 0, components: 0, pages: 0 } })), 'token files');
  assert.equal(candidateMarkLine(candidate({ marks: ['page', 'components'], counts: { colours: 0, tokens: 0, docs: 0, components: 14, pages: 1 } })), 'page, 14 components');
  assert.equal(candidateMarkLine(candidate({ marks: ['tokens', 'theme'], counts: { colours: 0, tokens: 4, docs: 0, components: 0, pages: 0 } })), 'tokens, theme');
});

test('a candidate’s counts, its registered system, or Nothing to parse', () => {
  assert.equal(candidateCountLine(candidate()), '24 colours · 31 tokens');
  assert.equal(candidateCountLine(candidate({ counts: { colours: 1, tokens: 0, docs: 0, components: 0, pages: 0 } })), '1 colour');
  assert.equal(candidateCountLine(candidate({ counts: { colours: 0, tokens: 0, docs: 2, components: 0, pages: 0 } })), 'Nothing to parse');
  assert.equal(candidateCountLine(candidate({ registered: { id: 'juniper', name: 'Juniper' } })), 'Already in Design Chamber as Juniper');
});

test('the discovery note counts every place found, and the more line points at the field', () => {
  assert.equal(candidatesNote(1), '1 place found');
  assert.equal(candidatesNote(6), '6 places found');
  assert.equal(candidatesMoreLine(2), 'and 2 more. Type a folder below to use another.');
  assert.equal(NO_CANDIDATES, 'No existing design system found in this project. Point at a folder yourself, or start from the code.');
});

test('a location is named with its trailing slash, and the root in words', () => {
  assert.equal(locationLabel('design-system'), 'design-system/');
  assert.equal(locationLabel('packages/ui/tokens'), 'packages/ui/tokens/');
  assert.equal(locationLabel(''), 'the project root');
  assert.equal(locationLabel('.'), 'the project root');
  assert.equal(locationValue(''), '.');
  assert.equal(locationValue('design-system'), 'design-system');
  assert.equal(nudgeLine(candidate()), 'This project already has a design system in design-system/. Start from it instead?');
  assert.equal(nudgeLine(candidate({ path: '' })), 'This project already has a design system in the project root. Start from it instead?');
});

test('the missed line says what Design Chamber never parses, leaving out zero counts', () => {
  assert.equal(missedLine(scan()), MISSED_LINE);
  assert.equal(missedLine(scan({ missed: { pages: 12, components: 40, codeThemes: 0 } })), `${MISSED_LINE} It saw 12 pages and 40 component files.`);
  assert.equal(missedLine(scan({ missed: { pages: 1, components: 0, codeThemes: 0 } })), `${MISSED_LINE} It saw 1 page.`);
  assert.equal(missedLine(scan({ missed: { pages: 2, components: 3, codeThemes: 1 } })), `${MISSED_LINE} It saw 2 pages, 3 component files and 1 theme in code.`);
  assert.equal(missedLine(scan({ missed: { pages: 0, components: 0, codeThemes: 2 } })), `${MISSED_LINE} It saw 2 themes in code.`);
});

const locationView = (over: Partial<LocationView['read']> = {}): LocationView => ({
  path: 'design-system',
  marks: ['contract', 'page', 'tokens', 'docs', 'components'],
  read: { page: ['design-system/index.html'], docs: ['design-system/DESIGN.md', 'design-system/notes/voice.md', 'design-system/notes/motion.md'], components: Array.from({ length: 14 }, (_, n) => `design-system/components/c${n}.tsx`), ...over },
  contract: { complete: true },
});

test('what a location leaves for the agent: its page paths, doc and component counts', () => {
  assert.equal(leftForAgentLine(locationView()), 'Left for the agent: design-system/index.html, 3 docs and 14 component files.');
  assert.equal(leftForAgentLine(locationView({ page: [], components: [] })), 'Left for the agent: 3 docs.');
  assert.equal(leftForAgentLine(locationView({ page: [], docs: [], components: [] })), null);
});

test('Files read counts the files the scan opened, not only the ones with values', () => {
  // The SpeakAppi bug: 2 files held values but 4 were read; the label must say 4.
  const summary = scan({ read: 4, files: [{ path: 'a.css', found: 5 }, { path: 'b.css', found: 3 }] });
  assert.equal(filesReadLabel(summary), 'Files read (4)');
  assert.equal(filesReadMore(summary), 'and 2 more with no values.');
  assert.equal(filesReadMore(scan({ read: 2, files: [{ path: 'a.css', found: 5 }, { path: 'b.css', found: 3 }] })), null);
  assert.equal(filesReadLabel(scan({ read: 0 })), 'Files read (0)');
});

test('an incomplete contract says what is missing and offers Make instead', () => {
  assert.equal(contractProblemLine(['tokens.css']), 'This folder has a system.json but tokens.css is missing or holds no token values, so it can’t be registered as it is. Make a new system from it instead.');
  assert.equal(contractProblemLine(["system.json can't be read"]), "This folder has a system.json but system.json can't be read, so it can’t be registered as it is. Make a new system from it instead.");
  assert.equal(contractProblemLine(['tokens.css', "system.json can't be read"]), "This folder has a system.json but tokens.css is missing or holds no token values and system.json can't be read, so it can’t be registered as it is. Make a new system from it instead.");
  // The walk/read race: the service answers system.json when the file was there at the walk and gone at the read.
  // The sentence must not claim the folder has the file it names as the gap.
  const raced = contractProblemLine(['system.json']);
  assert.equal(raced, 'While the folder was read, system.json went missing, so it can’t be registered as it is. Read the folder again, or make a new system from it instead.');
  assert.doesNotMatch(raced, /has a system\.json/);
  assert.doesNotMatch(contractProblemLine(['system.json', 'tokens.css']), /has a system\.json/);
  assert.equal(contractProblemLine(['a folder inside the project']), 'The project root can’t be registered as it is. A registered system needs its own folder inside the project. Make a new system from it instead.');
});

test('the footer button follows the choice: Make design system or Register design system', () => {
  assert.equal(MAKE_LABEL, 'Make design system');
  assert.equal(REGISTER_LABEL, 'Register design system');
});
