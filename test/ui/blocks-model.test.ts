// Chat blocks as data (documentation/specs/phase-1-5-sdk-2-7.md §U7, §U8): the answer a tile writes
// and reads back, the preview rule (only checked base64 reaches an <img>), the card's lines and
// check badge, and the two controllers that talk to the service and the host, with fakes that
// count every call (only reads before a click; one answer, and only from a pick).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChecksSummary, DesignDetailResponse, ThumbnailResponse } from '../../src/shared/api.ts';
import { BLOCK_SCREEN_TITLE_MAX, BLOCK_TITLE_MAX, THUMB_DATA_TEXT_MAX, THUMB_RETRY_DELAYS_MS } from '../../src/shared/limits.ts';
import type { DesignJson, Screen } from '../../src/shared/types.ts';
import { ServiceError } from '../../src/guest/service-client.ts';
import { createPicker, readCard, type CardClient } from '../../src/ui/blocks/block-data.ts';
import type { DirectionOption } from '../../src/ui/model/block-args.ts';
import { answeredOption, answerText, cardView, pickerView, previewOf, thumbSrc } from '../../src/ui/model/block-view-model.ts';
import { badgeOf } from '../../src/ui/model/checks-model.ts';

// ---------------------------------------------------------------- answeredOption

test('answeredOption: our own prefix marks that tile, whatever follows it', () => {
  assert.equal(answeredOption('B: Editorial (pricing-b)', 3), 1);
  assert.equal(answeredOption('B: Editorial (renamed)', 3), 1);
  assert.equal(answeredOption('A: x', 2), 0);
  assert.equal(answeredOption('D: Last one (d)', 4), 3);
});

test('answeredOption: anything else is a note', () => {
  assert.equal(answeredOption('D: x', 3), 'note', 'a letter past the last option');
  assert.equal(answeredOption('b: lower', 3), 'note');
  assert.equal(answeredOption('neither, try red', 3), 'note');
  assert.equal(answeredOption('', 3), 'note');
  assert.equal(answeredOption('B:no space', 3), 'note');
  assert.equal(answeredOption(' B: leading space', 3), 'note');
  assert.equal(answeredOption('E: five', 4), 'note');
});

test('answeredOption: no answer yet is null', () => {
  assert.equal(answeredOption(null, 3), null);
});

test('answerText writes "<letter>: <label> (<slug>)", which answeredOption reads back', () => {
  const option: DirectionOption = { letter: 'B', label: 'Editorial', slug: 'pricing-b' };
  assert.equal(answerText(option), 'B: Editorial (pricing-b)');
  assert.equal(answeredOption(answerText(option), 2), 1);
});

// ---------------------------------------------------------------- thumbnails

const ready = (png: unknown): ThumbnailResponse => ({ state: 'ready', key: 'k', png: png as string, width: 320, height: 200 });

test('thumbSrc: base64 PNG text becomes a data URL', () => {
  assert.equal(thumbSrc(ready('iVBORw0KGgo=')), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(thumbSrc(ready('A+/9')), 'data:image/png;base64,A+/9');
});

test('thumbSrc: text that is not base64 never reaches src', () => {
  for (const png of ['iVBOR"><script>', 'abc def', 'abc\n', 'javascript:alert(1)', '', 'data:image/png;base64,AAAA', 42, null, undefined]) {
    assert.equal(thumbSrc(ready(png)), null, JSON.stringify(png));
  }
});

test('thumbSrc: over the size limit, or not ready, is refused', () => {
  assert.equal(thumbSrc(ready('A'.repeat(THUMB_DATA_TEXT_MAX))), `data:image/png;base64,${'A'.repeat(THUMB_DATA_TEXT_MAX)}`);
  assert.equal(thumbSrc(ready('A'.repeat(THUMB_DATA_TEXT_MAX + 1))), null);
  assert.equal(thumbSrc({ state: 'pending', key: null, png: 'AAAA' }), null);
});

test('previewOf: pending waits at each retry delay, then says the preview is not ready', () => {
  const pending: ThumbnailResponse = { state: 'pending', key: null };
  THUMB_RETRY_DELAYS_MS.forEach((delay, index) => {
    assert.deepEqual(previewOf({ answer: pending }, index + 1), { state: 'waiting', retryInMs: delay });
  });
  assert.deepEqual(previewOf({ answer: pending }, THUMB_RETRY_DELAYS_MS.length + 1), { state: 'note', reason: 'not-ready', text: 'Preview not ready yet' });
});

test('previewOf: every thumbnail state and read failure has its sentence', () => {
  assert.deepEqual(previewOf({ answer: ready('AAAA') }, 1), { state: 'image', src: 'data:image/png;base64,AAAA' });
  assert.deepEqual(previewOf({ answer: { state: 'unavailable', key: null } }, 1), { state: 'note', reason: 'no-chrome', text: 'No preview without Chrome' });
  assert.equal(previewOf({ answer: { state: 'failed', key: null } }, 1).state, 'note');
  assert.deepEqual(previewOf({ answer: ready('not base64!') }, 1), previewOf({ answer: { state: 'failed', key: null } }, 1));
  assert.deepEqual(previewOf({ error: new ServiceError('not-found', 'gone', 404) }, 1), { state: 'note', reason: 'missing', text: 'Not found' });
  assert.equal(previewOf({ error: new ServiceError('NO_SERVICE', 'down') }, 1).state, 'note');
});

// ---------------------------------------------------------------- the card

const screen = (id: string, title: string): Screen => ({ id, title, file: `screens/${id}.html` });
const design = (over: Partial<DesignJson> = {}): DesignJson => ({
  version: 1,
  kind: 'canvas',
  title: 'Pricing page',
  created: '2026-11-10T09:00:00.000Z',
  updated: '2026-11-10T10:00:00.000Z',
  brief: '',
  sessionId: null,
  projectDirectory: null,
  preset: null,
  entry: null,
  viewports: [
    { id: 'laptop', label: 'Laptop', width: 1280, height: 800 },
    { id: 'phone', label: 'Phone', width: 390, height: 844 },
  ],
  screens: [screen('welcome', 'Welcome'), screen('plans', 'Plans'), screen('checkout', 'Checkout')],
  designSystem: { confirmed: false },
  comments: [],
  ...over,
});
const detail = (over: Partial<DesignJson> = {}): DesignDetailResponse => ({ slug: 'pricing', path: '/d/pricing', design: design(over), pending: false, files: { screens: {} }, warnings: [] });
const summary = (errors: number, warnings: number, state: ChecksSummary['render']['state'], canRun = true): ChecksSummary => ({ counts: { errors, warnings, notes: 0 }, render: { state }, canRun });

test('cardView: a canvas lists its screens', () => {
  const view = cardView(detail(), null);
  assert.equal(view.title, 'Pricing page');
  assert.equal(view.kindLabel, 'Canvas');
  assert.equal(view.detailLine, 'Screens: Welcome, Plans, Checkout');
  assert.equal(view.badge, null, 'a failed or missing checks read hides the line');
});

test('cardView: a page lists its viewports', () => {
  const view = cardView(detail({ kind: 'page', screens: [], entry: 'index.html' }), null);
  assert.equal(view.kindLabel, 'Page');
  assert.equal(view.detailLine, 'Viewports: Laptop, Phone');
});

test('cardView: long titles and screen names are clipped, and screens past six say how many more', () => {
  const many = Array.from({ length: 9 }, (_, i) => screen(`s${i}`, i === 0 ? 'W'.repeat(BLOCK_SCREEN_TITLE_MAX + 5) : `Screen ${i}`));
  const view = cardView(detail({ title: 'T'.repeat(BLOCK_TITLE_MAX + 10), screens: many }), null);
  assert.equal(Array.from(view.title).length, BLOCK_TITLE_MAX);
  assert.ok(view.detailLine.endsWith(', +3 more'), view.detailLine);
  assert.equal(view.detailLine.split(', ').length, 7);
  assert.equal(Array.from(view.detailLine.split(', ')[0]?.replace('Screens: ', '') ?? '').length, BLOCK_SCREEN_TITLE_MAX);
});

test('cardView: a canvas with no screens yet says so; an empty title falls back to the folder name', () => {
  const view = cardView(detail({ screens: [], title: '  ' }), null);
  assert.equal(view.detailLine, 'No screens yet');
  assert.equal(view.title, 'pricing');
});

test('cardView: the check badge is the viewer badge, for every rendering state', () => {
  const states: ChecksSummary['render']['state'][] = ['none', 'fresh', 'stale', 'running', 'unavailable', 'failed'];
  for (const state of states) {
    for (const checks of [summary(0, 0, state), summary(2, 1, state), summary(0, 1, state, false)]) {
      assert.deepEqual(cardView(detail(), checks).badge, badgeOf(checks, null, false), `${state} ${JSON.stringify(checks.counts)}`);
    }
  }
  assert.equal(cardView(detail(), summary(0, 0, 'running')).badge?.label, 'Checking');
  assert.equal(cardView(detail(), summary(2, 1, 'fresh')).badge?.label, '3 issues');
  assert.equal(cardView(detail(), summary(0, 0, 'fresh')).badge?.tone, 'success');
  assert.equal(cardView(detail(), summary(0, 0, 'stale')).badge?.tone, 'neutral');
});

// ---------------------------------------------------------------- readCard: reads only

type Recorded = { key: string; slug: string | undefined };
const fakeClient = (answers: { detail?: () => unknown; checks?: () => unknown }): CardClient & { calls: Recorded[] } => {
  const calls: Recorded[] = [];
  const call = (async (key: string, request?: { params?: { slug?: string } }) => {
    calls.push({ key, slug: request?.params?.slug });
    if (key === 'GET /designs/:slug') return (answers.detail ?? (() => detail()))();
    if (key === 'GET /designs/:slug/checks') return (answers.checks ?? (() => summary(0, 0, 'fresh')))();
    throw new Error(`unexpected call ${key}`);
  }) as CardClient['call'];
  return { call, calls };
};

test('readCard: reads the design and its checks, nothing else', async () => {
  const client = fakeClient({});
  const read = await readCard(client, 'pricing');
  assert.equal(read.state, 'ready');
  assert.deepEqual(client.calls.map((c) => c.key).sort(), ['GET /designs/:slug', 'GET /designs/:slug/checks']);
  assert.ok(client.calls.every((c) => c.key.startsWith('GET ') && c.slug === 'pricing'), 'no POST, PUT or DELETE before a click');
});

test('readCard: a 404 is a design that is gone; a checks failure only hides the badge', async () => {
  const gone = await readCard(
    fakeClient({
      detail: () => {
        throw new ServiceError('not-found', 'That design is no longer in your Designs folder.', 404);
      },
    }),
    'pricing',
  );
  assert.equal(gone.state, 'gone');
  const noChecks = await readCard(
    fakeClient({
      checks: () => {
        throw new ServiceError('internal', 'boom', 500);
      },
    }),
    'pricing',
  );
  assert.ok(noChecks.state === 'ready' && noChecks.checks === null);
});

test('readCard: a service that does not answer is an error with a way to try again', async () => {
  const down = await readCard(
    fakeClient({
      detail: () => {
        throw new ServiceError('NO_SERVICE', 'The Design Chamber service is not running.');
      },
    }),
    'pricing',
  );
  assert.deepEqual(down, { state: 'error', paused: false });
  const paused = await readCard(
    fakeClient({
      detail: () => {
        throw new ServiceError('DISABLED', 'Design Chamber is paused.');
      },
    }),
    'pricing',
  );
  assert.deepEqual(paused, { state: 'error', paused: true });
});

// ---------------------------------------------------------------- the picker: one answer, from a pick

const OPTIONS: DirectionOption[] = [
  { letter: 'A', label: 'Calm', slug: 'pricing-a' },
  { letter: 'B', label: 'Editorial', slug: 'pricing-b' },
  { letter: 'C', label: 'Dense table', slug: 'pricing-c' },
];

const fakeAnswer = (fail: unknown = null) => {
  const texts: string[] = [];
  let release: (() => void) | null = null;
  const answer = (text: string): Promise<void> => {
    texts.push(text);
    if (fail !== null) return Promise.reject(fail);
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  return { answer, texts, release: () => release?.() };
};

test('picker: nothing is answered until a tile is picked', () => {
  const fake = fakeAnswer();
  const picker = createPicker(fake.answer, OPTIONS, () => undefined);
  picker.restore(null);
  assert.equal(fake.texts.length, 0);
  assert.equal(picker.state().phase, 'open');
});

test('picker: a pick answers once with the tile text; a second pick does nothing', async () => {
  const fake = fakeAnswer();
  const seen: string[] = [];
  const picker = createPicker(fake.answer, OPTIONS, (state) => seen.push(state.phase));
  const first = picker.pick(1);
  assert.equal(picker.state().phase, 'sending');
  void picker.pick(2);
  fake.release();
  assert.equal(await first, 'sent');
  assert.equal(await picker.pick(0), 'ignored');
  assert.deepEqual(fake.texts, ['B: Editorial (pricing-b)']);
  assert.deepEqual(picker.state(), { phase: 'answered', picked: 1, sending: null });
  assert.deepEqual(seen, ['sending', 'answered']);
});

test('picker: a refused answer opens the tiles again and says why', async () => {
  const refusal = new Error('This block already has its answer.');
  const fake = fakeAnswer(refusal);
  const picker = createPicker(fake.answer, OPTIONS, () => undefined);
  assert.deepEqual(await picker.pick(0), { error: refusal });
  assert.equal(picker.state().phase, 'open');
  assert.equal(fake.texts.length, 1);
});

test('picker: an answer replayed after a reload marks the tile or the note, and blocks a new pick', async () => {
  const fake = fakeAnswer();
  const picker = createPicker(fake.answer, OPTIONS, () => undefined);
  picker.restore('C: Dense table (pricing-c)');
  assert.deepEqual(picker.state(), { phase: 'answered', picked: 2, sending: null });
  assert.equal(await picker.pick(0), 'ignored');
  const noted = createPicker(fake.answer, OPTIONS, () => undefined);
  noted.restore('Mix A and C, please');
  assert.deepEqual(noted.state(), { phase: 'answered', picked: null, sending: null });
  assert.equal(fake.texts.length, 0);
});

test('pickerView: captions and tile states for each phase', () => {
  assert.deepEqual(pickerView({ phase: 'open', picked: null, sending: null }, OPTIONS), { caption: 'Pick one, or answer with a note below.', tiles: OPTIONS.map(() => ({ pressed: false, disabled: false, dimmed: false, busy: false })) });
  const sending = pickerView({ phase: 'sending', picked: null, sending: 1 }, OPTIONS);
  assert.deepEqual(
    sending.tiles.map((t) => [t.disabled, t.busy]),
    [
      [true, false],
      [true, true],
      [true, false],
    ],
  );
  const picked = pickerView({ phase: 'answered', picked: 1, sending: null }, OPTIONS);
  assert.equal(picked.caption, 'You picked B.');
  assert.deepEqual(
    picked.tiles.map((t) => [t.pressed, t.dimmed, t.disabled]),
    [
      [false, true, true],
      [true, false, true],
      [false, true, true],
    ],
  );
  const note = pickerView({ phase: 'answered', picked: null, sending: null }, OPTIONS);
  assert.equal(note.caption, 'You answered with a note.');
  assert.ok(note.tiles.every((t) => t.disabled && !t.pressed));
});
