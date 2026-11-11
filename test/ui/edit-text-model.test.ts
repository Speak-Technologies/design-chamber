import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { SourceResponse } from '../../src/shared/api.ts';
import type { EditProbe } from '../../src/shared/bridge-protocol.ts';
import { SOURCE_TEXT_MAX, TEXT_EDIT_MAX } from '../../src/shared/limits.ts';
import {
  AGENT_WORKING_LINE,
  CLICK_AWAY_LINE,
  STALE_TEXT,
  agentIsWorking,
  answerSource,
  checkPick,
  counterAnnouncement,
  counterState,
  counterText,
  editorWidth,
  hasChange,
  normalizeTyped,
  placeEditor,
  placeToolbar,
  reasonSentence,
  refusalOf,
  reloadOutcome,
  saveDecision,
  toolbarLabels,
  toolbarName,
  type EditReason,
  type PickCheck,
  type SourceAnswer,
} from '../../src/ui/model/edit-text-model.ts';

const rect = { x: 10, y: 20, w: 300, h: 40 };

const probe = (over: Partial<EditProbe> = {}): EditProbe => ({ tag: 'h1', id: null, leaf: true, text: 'Simple pricing', truncated: false, sameIndex: 0, sameCount: 1, dir: 'ltr', rect, ...over });

const file = (text: string, over: Partial<SourceResponse> = {}): SourceAnswer => ({
  ok: true,
  source: { text, bytes: text.length, sha256: 'a'.repeat(64), utf8: true, link: false, ...over },
});

const refused = (check: PickCheck): EditReason => {
  assert.equal(check.editable, false);
  return check.editable ? 'unclear' : check.reason;
};

describe('checkPick: why Edit text is off', () => {
  const html = '<main><h1>Simple pricing</h1><p>Words</p></main>';

  test('an element whose text sits in the file once is editable, with the stamp and the target the write needs', () => {
    const check = checkPick({ viewing: false, probe: probe(), source: file(html) });
    assert.deepEqual(check, {
      editable: true,
      base: 'a'.repeat(64),
      target: { tag: 'h1', id: null, text: 'Simple pricing', sameIndex: 0, sameCount: 1 },
      before: 'Simple pricing',
      dir: 'ltr',
    });
  });

  test('the editor text is the decoded, whitespace-collapsed source, not the frame text', () => {
    const source = file('<p>\n  Tom &amp;   Jerry\n&mdash; <3 </p>'.replace('<3', '&lt;3'));
    const check = checkPick({ viewing: false, probe: probe({ tag: 'p', text: 'Tom & Jerry — <3' }), source });
    assert.equal(check.editable, true);
    assert.equal(check.editable ? check.before : '', 'Tom & Jerry — <3');
  });

  test('right-to-left is passed through', () => {
    const check = checkPick({ viewing: false, probe: probe({ dir: 'rtl' }), source: file(html) });
    assert.equal(check.editable ? check.dir : 'ltr', 'rtl');
  });

  test('order: viewing outranks everything, then no file, link, size, encoding, then the locator', () => {
    const big = file('x'.repeat(SOURCE_TEXT_MAX + 1), { link: true, utf8: false });
    assert.equal(refused(checkPick({ viewing: true, probe: probe(), source: file(html) })), 'viewing');
    assert.equal(refused(checkPick({ viewing: false, probe: probe(), source: { ok: false, kind: 'no-file', message: 'x' } })), 'no-file');
    assert.equal(refused(checkPick({ viewing: false, probe: probe(), source: big })), 'link');
    assert.equal(refused(checkPick({ viewing: false, probe: probe(), source: file('x'.repeat(SOURCE_TEXT_MAX + 1), { utf8: false }) })), 'file-too-large');
    assert.equal(refused(checkPick({ viewing: false, probe: probe(), source: file(html, { utf8: false }) })), 'not-utf8');
    assert.equal(refused(checkPick({ viewing: false, probe: probe({ text: 'Not there' }), source: file(html) })), 'not-in-source');
  });

  test('a failed read names what went wrong; a frame that did not answer is a failed read too', () => {
    const failed = checkPick({ viewing: false, probe: probe(), source: { ok: false, kind: 'failed', message: 'The service did not answer.' } });
    assert.equal(failed.editable, false);
    assert.equal(failed.editable ? '' : failed.reason, 'loading-failed');
    assert.match(failed.editable ? '' : reasonSentence(failed.reason, failed.detail), /^Couldn't read this file\. The service did not answer\.$/);
    assert.equal(refused(checkPick({ viewing: false, probe: null, source: file(html) })), 'loading-failed');
  });

  test('formatted, ambiguous, unclear and too long come from the locator', () => {
    assert.equal(refused(checkPick({ viewing: false, probe: probe({ leaf: false }), source: file(html) })), 'formatted');
    assert.equal(refused(checkPick({ viewing: false, probe: probe({ truncated: true }), source: file(html) })), 'too-long');
    const twice = '<a>Learn more</a><a>Learn more</a>';
    assert.equal(refused(checkPick({ viewing: false, probe: probe({ tag: 'a', text: 'Learn more', sameIndex: 0, sameCount: 3 }), source: file(twice) })), 'ambiguous');
    // An end tag the browser implies (`<p>Hello` closes at the end of the file): nothing safe to splice.
    assert.equal(refused(checkPick({ viewing: false, probe: probe({ tag: 'p', text: 'Hello' }), source: file('<p>Hello') })), 'unclear');
  });

  test('two same-text elements are told apart by order when the frame and the file agree on the count', () => {
    const twice = '<a>Learn more</a><a>Learn more</a>';
    const check = checkPick({ viewing: false, probe: probe({ tag: 'a', text: 'Learn more', sameIndex: 1, sameCount: 2 }), source: file(twice) });
    assert.equal(check.editable, true);
  });
});

describe('the sentences, exactly as the design says them (§3.3)', () => {
  const table: [EditReason, string][] = [
    ['not-in-source', "This text is made by the page's script. Ask the agent to change it."],
    ['formatted', 'This has formatting inside. Ask the agent to change it.'],
    ['ambiguous', "This text appears more than once and the exact one can't be found. Ask the agent to change it."],
    ['viewing', "You're viewing an old version."],
    ['file-too-large', 'This file is too large to edit here.'],
    ['too-long', "That's too long to edit here. Ask the agent instead."],
    ['not-utf8', "This file isn't plain UTF-8 text, so it can't be edited here. Ask the agent instead."],
    ['unclear', "Design Chamber can't find this text in the file exactly. Ask the agent to change it."],
    ['no-file', 'Nothing to edit until the agent writes this screen.'],
    ['link', "This file is a link, so Design Chamber can't edit it here. Ask the agent instead."],
  ];
  for (const [reason, sentence] of table) {
    test(reason, () => assert.equal(reasonSentence(reason), sentence));
  }
  test('none of them has an em dash', () => {
    for (const [, sentence] of table) assert.equal(sentence.includes('—'), false);
    for (const line of [CLICK_AWAY_LINE, AGENT_WORKING_LINE, STALE_TEXT]) assert.equal(line.includes('—'), false);
  });
});

describe('normalizeTyped and saveDecision', () => {
  test('runs of ASCII whitespace, pasted line breaks included, become one space; the ends are trimmed', () => {
    assert.equal(normalizeTyped('  Solo \t plan\r\n for  one\n'), 'Solo plan for one');
  });

  test('a non-breaking space is the author’s and stays, at the ends too', () => {
    assert.equal(normalizeTyped(' Solo plan '), ' Solo plan ');
  });

  test('stray control characters are dropped', () => {
    assert.equal(normalizeTyped('So\u0000lo\u0007 plan\u007f'), 'Solo plan');
  });

  test('words that match the file after normalising are a no-op: no write, no version', () => {
    assert.deepEqual(saveDecision('Solo plan', '  Solo   plan '), { kind: 'unchanged' });
  });

  test('changed words are sent normalised', () => {
    assert.deepEqual(saveDecision('Solo plan', ' Solo  businesses\n'), { kind: 'save', after: 'Solo businesses' });
  });

  test('empty text is allowed', () => {
    assert.deepEqual(saveDecision('Solo plan', '   '), { kind: 'save', after: '' });
  });

  test('over the limit is refused, at exactly the limit it is sent', () => {
    assert.deepEqual(saveDecision('x', 'a'.repeat(TEXT_EDIT_MAX)), { kind: 'save', after: 'a'.repeat(TEXT_EDIT_MAX) });
    assert.deepEqual(saveDecision('x', 'a'.repeat(TEXT_EDIT_MAX + 1)), { kind: 'too-long', length: TEXT_EDIT_MAX + 1 });
  });

  test('hasChange follows the same rule, so click-away and Enter agree', () => {
    assert.equal(hasChange('Solo plan', ' Solo   plan'), false);
    assert.equal(hasChange('Solo plan', 'Solo plans'), true);
  });
});

describe('the character counter', () => {
  test('hidden under 4 500, plain from 4 500, an error past 5 000', () => {
    assert.equal(counterState(4499), 'none');
    assert.equal(counterState(4500), 'near');
    assert.equal(counterState(TEXT_EDIT_MAX), 'near');
    assert.equal(counterState(TEXT_EDIT_MAX + 1), 'over');
  });

  test('the text says the count, or the limit once past it', () => {
    assert.match(counterText(4812, 'near'), /^4.812 \/ 5.000$/);
    assert.match(counterText(5200, 'over'), /^5.000 characters at most$/);
  });

  test('a screen reader hears it when it crosses a line, not on every key', () => {
    assert.equal(counterAnnouncement('none', 'none'), null);
    assert.equal(counterAnnouncement('near', 'near'), null);
    assert.notEqual(counterAnnouncement('none', 'near'), null);
    assert.notEqual(counterAnnouncement('near', 'over'), null);
    assert.equal(counterAnnouncement('over', 'near'), null);
  });
});

describe('refusalOf: what a refused save says', () => {
  test('a stale file says the exact sentence and offers Reload and try again', () => {
    assert.deepEqual(refusalOf({ code: 'stale', message: 'whatever the service said', status: 409 }), { text: 'This file changed while you were editing. Nothing was saved.', stale: true, askAgent: false });
  });

  test('a file the service will not edit keeps its sentence and offers Ask agent', () => {
    const tooBig = refusalOf({ code: 'too-large', message: 'This file is too large to edit here. Ask the agent instead.', status: 413 });
    assert.equal(tooBig.text, 'This file is too large to edit here. Ask the agent instead.');
    assert.equal(tooBig.askAgent, true);
    assert.equal(refusalOf({ code: 'invalid', message: "This file is a link, so Design Chamber can't edit it here. Ask the agent instead.", status: 422 }).askAgent, true);
  });

  test('other service sentences go through as written, with no extra way out', () => {
    assert.deepEqual(refusalOf({ code: 'not-found', message: 'That design is no longer in your Designs folder.', status: 404 }), { text: 'That design is no longer in your Designs folder.', stale: false, askAgent: false });
  });

  test('a write that failed on the disk or in the service says the text is still in the box', () => {
    assert.equal(refusalOf({ code: 'internal', message: 'Something went wrong, so nothing was changed.', status: 500 }).text, 'Something went wrong, so nothing was changed. Your text is still here.');
    assert.equal(refusalOf({ code: 'conflict', message: 'Another program is using this file. Close it and try again.', status: 409 }).text, 'Another program is using this file. Close it and try again. Your text is still here.');
  });

  test('a service that did not answer says so and that the text is still here', () => {
    const down = refusalOf({ code: 'HOST_TIMEOUT', message: 'The Design Chamber service took too long to answer. Try again.' });
    assert.equal(down.text, "Couldn't save your change. The Design Chamber service took too long to answer. Try again. Your text is still here.");
    assert.equal(down.stale, false);
  });
});

describe('reloadOutcome: Reload and try again', () => {
  const editable = (before: string): PickCheck => ({ editable: true, base: 'b'.repeat(64), target: { tag: 'h1', id: null, text: before, sameIndex: 0, sameCount: 1 }, before, dir: 'ltr' });

  test('the element is still there with the same words: adopt the new stamp, say nothing', () => {
    const outcome = reloadOutcome('Solo plan', editable('Solo plan'));
    assert.equal(outcome.kind, 'ready');
    assert.equal(outcome.kind === 'ready' ? outcome.fileNowSays : 'x', null);
  });

  test('the file changed the element’s words: say what it reads now', () => {
    const outcome = reloadOutcome('Solo plan', editable('Solo businesses'));
    assert.equal(outcome.kind === 'ready' ? outcome.fileNowSays : null, 'Solo businesses');
  });

  test('the element is gone: the reason sentence replaces the hint', () => {
    const outcome = reloadOutcome('Solo plan', { editable: false, reason: 'not-in-source' });
    assert.equal(outcome.kind, 'gone');
    assert.equal(outcome.kind === 'gone' ? outcome.sentence : '', reasonSentence('not-in-source'));
  });
});

describe('small copy and rules', () => {
  test('the toolbar is named for its element: the tag and the first 40 characters', () => {
    assert.equal(toolbarName('h1', 'Simple pricing'), "Actions for h1 'Simple pricing'");
    assert.equal(toolbarName('p', 'a'.repeat(60)), `Actions for p '${'a'.repeat(39)}…'`);
    assert.equal(toolbarName('img', '  \n '), 'Actions for img');
    assert.equal(toolbarName('p', 'Two\n  lines'), "Actions for p 'Two lines'");
  });

  test('the agent-working hint shows for working, writing and retrying only', () => {
    for (const phase of ['working', 'writing', 'retrying'] as const) assert.equal(agentIsWorking(phase), true);
    for (const phase of ['hidden', 'done', 'failed', 'offline', 'question', 'permission', 'stalled'] as const) assert.equal(agentIsWorking(phase), false);
  });

  test('labels give way to icons under 300 px of stage', () => {
    assert.equal(toolbarLabels(299), false);
    assert.equal(toolbarLabels(300), true);
  });

  test('answerSource: a missing screen and a failed read are different, and it never rejects', async () => {
    const reject = (code: string, message: string) => async (): Promise<SourceResponse> => {
      throw Object.assign(new Error(message), { code });
    };
    assert.deepEqual(await answerSource(reject('no-html', 'x.html is not written yet.')), { ok: false, kind: 'no-file', message: 'x.html is not written yet.' });
    assert.equal((await answerSource(reject('not-found', 'gone'))).ok, false);
    const failed = await answerSource(reject('HOST_TIMEOUT', 'Too slow.'));
    assert.deepEqual(failed, { ok: false, kind: 'failed', message: 'Too slow.' });
    const plain = await answerSource(async () => {
      throw 'a string';
    });
    assert.equal(plain.ok, false);
  });
});

describe('placement', () => {
  const stage = { w: 1000, h: 700 };
  const size = { w: 280, h: 34 };

  test('the toolbar sits above the element, left edges aligned', () => {
    const place = placeToolbar({ x: 200, y: 300, w: 400, h: 60 }, size, stage);
    assert.deepEqual(place, { left: 200, top: 300 - 34 - 6, below: false });
  });

  test('within 48 px of the top edge it flips below the element', () => {
    const place = placeToolbar({ x: 200, y: 40, w: 400, h: 60 }, size, stage);
    assert.equal(place.below, true);
    assert.equal(place.top, 40 + 60 + 6);
  });

  test('a taller toolbar (the reason line) flips earlier, so it never leaves the viewer', () => {
    const place = placeToolbar({ x: 200, y: 70, w: 400, h: 60 }, { w: 280, h: 80 }, stage);
    assert.equal(place.below, true);
  });

  test('it stays inside the stage on every side', () => {
    assert.equal(placeToolbar({ x: -50, y: 300, w: 400, h: 60 }, size, stage).left, 8);
    assert.equal(placeToolbar({ x: 950, y: 300, w: 400, h: 60 }, size, stage).left, 1000 - 280 - 8);
    assert.equal(placeToolbar({ x: 200, y: 700, w: 400, h: 60 }, size, stage).top, 700 - 34 - 8);
  });

  test('page editor width follows the element between 260 and 480; the rail editor is the element, at least 240, inside the stage', () => {
    assert.equal(editorWidth({ surface: 'page', boxWidth: 120, stageWidth: 1400 }), 260);
    assert.equal(editorWidth({ surface: 'page', boxWidth: 700, stageWidth: 1400 }), 480);
    assert.equal(editorWidth({ surface: 'page', boxWidth: 333.4, stageWidth: 1400 }), 333);
    assert.equal(editorWidth({ surface: 'rail', boxWidth: 100, stageWidth: 420 }), 240);
    assert.equal(editorWidth({ surface: 'rail', boxWidth: 600, stageWidth: 420 }), 404);
    assert.equal(editorWidth({ surface: 'rail', boxWidth: 100, stageWidth: 320 }), 240);
  });

  test('the editor is at the element’s top edge; on the rail it is pinned to the left margin', () => {
    assert.deepEqual(placeEditor({ x: 300, y: 200, w: 400, h: 60 }, { w: 400, h: 120 }, stage, 'page'), { left: 300, top: 200 });
    assert.deepEqual(placeEditor({ x: 300, y: 200, w: 400, h: 60 }, { w: 400, h: 120 }, { w: 420, h: 700 }, 'rail'), { left: 8, top: 200 });
    assert.equal(placeEditor({ x: 300, y: 650, w: 400, h: 60 }, { w: 400, h: 120 }, stage, 'page').top, 700 - 120 - 8);
  });
});
