import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Screen } from '../../src/shared/types.ts';
import { validateBrief, presetOptions } from '../../src/ui/model/new-model.ts';
import type { AgentSkillStatus, SkillState } from '../../src/shared/types.ts';
import { browserStatus, duplicateSentences, guideSentence, isAbsolutePath, isSameRootInput, permissionSnippet, skillRow, validateRootInput } from '../../src/ui/model/settings-model.ts';
import { artboardLabel } from '../../src/ui/model/format.ts';
import { LABEL_TAIL_MAX, PIN_FAN_SCALE, alignTop, boardAt, clusterPins, fanOut, frameToScreen, labelWidth, liveBoards, pinFramePoint, screenToFrame, separatingScale } from '../../src/ui/model/wall-model.ts';

test('validateRootInput rejects what the service would refuse, with a sentence that says what to do', () => {
  assert.match(validateRootInput('   ') ?? '', /full path/);
  assert.match(validateRootInput('Designs') ?? '', /full path/);
  assert.match(validateRootInput('C:\\') ?? '', /not the drive itself/);
  assert.match(validateRootInput('C:\\Designs\nnext') ?? '', /character/);
  assert.equal(validateRootInput('C:\\Users\\you\\Documents\\Designs'), null, 'the current folder is not an error: Apply is just disabled');
  assert.equal(validateRootInput('D:\\Work\\Designs'), null);
  assert.equal(validateRootInput('/home/you/designs'), null);
  assert.equal(validateRootInput('\\\\nas\\share\\designs'), null);
});

test('isSameRootInput ignores whitespace, a trailing separator, and case on Windows paths only', () => {
  const win = 'C:\\Users\\you\\Documents\\Designs';
  assert.equal(isSameRootInput(win, win), true);
  assert.equal(isSameRootInput(`  ${win}  `, win), true);
  assert.equal(isSameRootInput(`${win}\\`, win), true);
  assert.equal(isSameRootInput('c:\\users\\YOU\\documents\\designs', win), true);
  assert.equal(isSameRootInput('C:/Users/you/Documents/Designs/', win), true);
  assert.equal(isSameRootInput('D:\\Users\\you\\Documents\\Designs', win), false);
  const posix = '/home/you/Designs';
  assert.equal(isSameRootInput('/home/you/Designs/', posix), true);
  assert.equal(isSameRootInput('/home/you/designs', posix), false, 'posix paths are case-sensitive');
  assert.equal(isSameRootInput('/home/you/Designs/archive', posix), false);
  assert.equal(isSameRootInput('/', '/'), true);
});

test('isAbsolutePath knows drive, UNC, posix and home paths', () => {
  for (const ok of ['C:\\a', 'c:/a', '\\\\srv\\share', '/a', '~/a']) assert.equal(isAbsolutePath(ok), true, ok);
  for (const bad of ['a', './a', '..\\a', 'C:a']) assert.equal(isAbsolutePath(bad), false, bad);
});

test('permissionSnippet is valid JSON with a forward-slash glob', () => {
  const parsed: unknown = JSON.parse(permissionSnippet('C:\\Users\\you\\Documents\\Designs\\'));
  assert.deepEqual(parsed, { permission: { external_directory: { 'C:/Users/you/Documents/Designs/**': 'allow' } } });
});

test('browserStatus: no browser is neutral "Live previews", not a warning', () => {
  assert.deepEqual(browserStatus(null, 'none'), {
    tone: 'neutral',
    title: 'Live previews',
    detail: 'No Chrome, Edge or Chromium found, so thumbnails are live previews. Install one or set its path for image thumbnails.',
  });
  assert.equal(browserStatus('C:\\chrome.exe', 'detected').tone, 'success');
  assert.match(browserStatus('C:\\chrome.exe', 'setting').title, /chosen/);
});

const SKILL_PATH = '/home/you/.config/opencode/skills/design-chamber/SKILL.md';
const skill = (state: SkillState, over: Partial<AgentSkillStatus> = {}): AgentSkillStatus => ({ path: SKILL_PATH, state, duplicates: [], ...over });
const flat = (parts: { before: string; path: string | null; after: string }): string => `${parts.before}${parts.path ?? ''}${parts.after}`;

test('skillRow: built in first, then what to do about an older installed copy', () => {
  const none = skillRow(skill('not-installed'));
  assert.equal(flat(none.sentence), 'Built in. Agents in OpenChamber can use it while Design Chamber is on.');
  assert.equal(none.sentence.path, null);
  assert.equal(none.control, null);

  // Ours and unedited, for this folder or an earlier one: removable from Settings.
  for (const state of ['current', 'outdated'] as const) {
    const row = skillRow(skill(state));
    assert.equal(flat(row.sentence), `Built in. An older copy is also installed at ${SKILL_PATH}, so agents may see the skill twice.`, state);
    assert.equal(row.sentence.path, SKILL_PATH, state);
    assert.equal(row.control, 'remove-old-copy', state);
  }

  // Edited or someone else's: never removed by us, so only the path is offered.
  const edited = skillRow(skill('edited'));
  assert.equal(flat(edited.sentence), `Built in. You edited the older copy at ${SKILL_PATH}, so Design Chamber leaves it alone. Delete it if you don’t need it.`);
  assert.equal(edited.control, 'copy-path');
  const foreign = skillRow(skill('foreign'));
  assert.equal(flat(foreign.sentence), `Built in. Another design-chamber skill is installed at ${SKILL_PATH}.`);
  assert.equal(foreign.control, 'copy-path');

  // The service could not look: say so as written, offer nothing.
  const unavailable = skillRow(skill('unavailable', { message: 'Your home folder could not be found.' }));
  assert.equal(flat(unavailable.sentence), 'Built in. Your home folder could not be found.');
  assert.equal(unavailable.control, null);
  assert.match(flat(skillRow(skill('unavailable')).sentence), /can’t look for an older copy/);

  // No state may still word itself as something to install.
  for (const state of ['not-installed', 'outdated', 'current', 'edited', 'foreign', 'unavailable'] as const) {
    assert.doesNotMatch(flat(skillRow(skill(state)).sentence), /\b(Install skill|Update skill|Replace skill|Adds a)\b/, state);
  }
});

test('duplicateSentences warns once per extra copy', () => {
  assert.deepEqual(duplicateSentences(skill('current')), []);
  const two = duplicateSentences(skill('current', { duplicates: ['/home/you/.claude/skills/design-chamber/SKILL.md', '/home/you/.agents/skills/design-chamber/SKILL.md'] }));
  assert.equal(two.length, 2);
  assert.equal(flat(two[0] ?? { before: '', path: null, after: '' }), 'Another copy is at /home/you/.claude/skills/design-chamber/SKILL.md. OpenCode needs one copy, so remove the other.');
});

test('guideSentence covers every guide state', () => {
  const path = 'C:\\Users\\you\\Documents\\Designs\\AGENTS.md';
  assert.equal(flat(guideSentence({ path, state: 'current' })), `Design Chamber keeps a guide for agents at ${path}.`);
  assert.equal(flat(guideSentence({ path, state: 'outdated' })), `Design Chamber keeps a guide for agents at ${path}.`);
  assert.equal(flat(guideSentence({ path, state: 'edited' })), `You edited ${path}, so Design Chamber leaves it alone.`);
  assert.equal(flat(guideSentence({ path, state: 'foreign' })), `${path} is your own file, so Design Chamber didn’t add a guide.`);
  assert.equal(flat(guideSentence({ path, state: 'no-root' })), 'The guide is added once your designs folder exists.');
  assert.equal(flat(guideSentence({ path, state: 'failed', message: 'Design Chamber can’t write to that folder.' })), 'Design Chamber can’t write to that folder.');
  assert.match(flat(guideSentence({ path, state: 'missing' })), /next time it starts/);
});

test('settings copy has no em dashes', () => {
  const texts = [
    browserStatus(null, 'none').detail,
    ...(['not-installed', 'outdated', 'current', 'edited', 'foreign', 'unavailable'] as const).map((state) => flat(skillRow(skill(state)).sentence)),
    ...(['current', 'edited', 'foreign', 'missing', 'no-root', 'failed'] as const).map((state) => flat(guideSentence({ path: '/d/AGENTS.md', state }))),
  ];
  for (const text of texts) assert.doesNotMatch(text, /\u2014/, text);
});

test('new-design form helpers', () => {
  assert.equal(validateBrief('ok'), null);
  assert.match(validateBrief('x'.repeat(2001)) ?? '', /under 2000/);
  const options = presetOptions([{ id: 'minimal-saas', name: 'Minimal SaaS', bestFor: 'dashboards' }]);
  assert.deepEqual(options.map((o) => o.id), ['', 'minimal-saas']);
});

const camera = { x: 100, y: 50, scale: 0.5 };
const board = { x: 200, y: 80, w: 1280, h: 800 };

test('screen ↔ frame mapping round-trips and honours the camera scale', () => {
  const frame = screenToFrame(camera, board, { x: 100 + 0.5 * (200 + 40), y: 50 + 0.5 * (80 + 60) });
  assert.deepEqual(frame, { x: 40, y: 60 });
  assert.deepEqual(frameToScreen(camera, board, frame), { x: 220, y: 120 });
});

test('boardAt picks the topmost artboard under a point, or null on the background', () => {
  const boards = [
    { id: 'a', rect: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'b', rect: { x: 50, y: 50, w: 100, h: 100 } },
  ];
  const cam = { x: 0, y: 0, scale: 1 };
  assert.equal(boardAt(cam, boards, { x: 60, y: 60 })?.id, 'b');
  assert.equal(boardAt(cam, boards, { x: 10, y: 10 })?.id, 'a');
  assert.equal(boardAt(cam, boards, { x: 500, y: 500 }), null);
});

test('pinFramePoint follows the element and the frame scroll', () => {
  const rect = { x: 120, y: 340, w: 600, h: 64 };
  assert.deepEqual(pinFramePoint(rect, { x: 0.5, y: 0.5 }, { x: 0, y: 300 }), { x: 420, y: 72 });
});

test('alignTop keeps the zoom and x, and puts the content top the given padding below the surface top', () => {
  const bounds = { x: 0, y: 0, w: 1280, h: 828 };
  const aligned = alignTop({ x: 12, y: 300, scale: 0.25 }, bounds, 16);
  assert.deepEqual(aligned, { x: 12, y: 16, scale: 0.25 });
  // a content box that starts above the origin (labels sit above artboards) still lands at the padding
  assert.equal(alignTop({ x: 0, y: 0, scale: 0.5 }, { x: 0, y: -28, w: 10, h: 10 }, 16).y, 30);
});

const screens: Screen[] = [
  { id: 'home', title: 'Home', file: 'screens/home.html' },
  { id: 'pricing', title: 'Pricing', file: 'screens/pricing.html' },
];

test('liveBoards keeps the boards nearest the centre within the budget and drops far ones', () => {
  const boards = [
    { id: 'near', rect: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'mid', rect: { x: 400, y: 0, w: 100, h: 100 } },
    { id: 'far', rect: { x: 100000, y: 0, w: 100, h: 100 } },
  ];
  const cam = { x: 0, y: 0, scale: 1 };
  const surface = { w: 600, h: 300 };
  assert.deepEqual(liveBoards(boards, cam, surface, 12, 0.5).map((b) => b.id), ['mid', 'near']);
  assert.deepEqual(liveBoards(boards, cam, surface, 1, 0.5).map((b) => b.id), ['mid']);
});

test('liveBoards: a tie for the last live slot goes to the earlier screen, also when float noise splits the distances', () => {
  // Home and Pricing sit either side of the centre, 150 px away; Pricing is a hair nearer (a pan or a zoom leaves such noise).
  const cam = { x: 0, y: 0, scale: 1 };
  const surface = { w: 400, h: 200 };
  const home = { id: 'home', rect: { x: 0, y: 50, w: 100, h: 100 } };
  const pricing = { id: 'pricing', rect: { x: 300 - 1e-7, y: 50, w: 100, h: 100 } };
  assert.ok(Math.hypot(50 - 200, 0) > Math.hypot(300 - 1e-7 + 50 - 200, 0), 'the earlier board is the farther by float noise');
  assert.deepEqual(liveBoards([home, pricing], cam, surface, 1, 0.5).map((b) => b.id), ['home']);
  assert.deepEqual(liveBoards([pricing, home], cam, surface, 1, 0.5).map((b) => b.id), ['pricing'], 'the order given is the order of preference');
  // A real difference still wins over the order.
  const closer = { id: 'closer', rect: { x: 150, y: 50, w: 100, h: 100 } };
  assert.deepEqual(liveBoards([home, closer], cam, surface, 1, 0.5).map((b) => b.id), ['closer']);
});

test('clusterPins folds pins closer than a pin width on screen, anchored on the first; zooming in separates them', () => {
  const pins = [
    { id: 'a', x: 100, y: 100 },
    { id: 'b', x: 140, y: 110 },
    { id: 'c', x: 600, y: 100 },
  ];
  assert.deepEqual(clusterPins(pins, 0.26, 24), [
    { ids: ['a', 'b'], x: 100, y: 100 },
    { ids: ['c'], x: 600, y: 100 },
  ]);
  assert.equal(clusterPins(pins, 1, 24).length, 3);
  // Zooming to the separating scale pulls the pair at least a pin width apart on screen.
  const target = separatingScale(pins.slice(0, 2), 0.26, 24);
  assert.ok(target > 0.26 && target <= PIN_FAN_SCALE);
  assert.equal(clusterPins(pins.slice(0, 2), target, 24).length, 2);
  // Pins on the very same spot cannot be separated by zoom: go to 100 %, where they fan out.
  assert.equal(separatingScale([{ id: 'a', x: 5, y: 5 }, { id: 'b', x: 5, y: 5 }], 0.3, 24), PIN_FAN_SCALE);
});

test('fanOut lays a group out as a row of whole pins at the current zoom', () => {
  const row = fanOut({ ids: ['a', 'b', 'c'], x: 10, y: 20 }, 2, 24, 4);
  assert.deepEqual(row, [
    { id: 'a', x: 10, y: 20 },
    { id: 'b', x: 24, y: 20 },
    { id: 'c', x: 38, y: 20 },
  ]);
});

test('artboard labels name the screen, the viewport and its size; narrow columns borrow the gap', () => {
  const phone = { id: 'phone', label: 'Phone', width: 390, height: 844 };
  assert.deepEqual(artboardLabel('Home', phone), { name: 'Home', detail: 'Phone · 390×844', full: 'Home · Phone · 390×844' });
  const rect = { x: 1376, y: 28, w: 390, h: 844 };
  assert.equal(labelWidth(rect, null, 0.26), LABEL_TAIL_MAX);
  assert.equal(labelWidth({ ...rect, x: 0 }, 1376, 0.26), 1376 * 0.26 - 12);
  assert.equal(labelWidth(rect, null, 1), 390);
});
