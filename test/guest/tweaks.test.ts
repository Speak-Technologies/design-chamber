// The Tweaks controller (Phase 2 technical design §4.4, §4.5; feature 09), against a fake client
// and fake host.storage with a fake clock: live preview values, the unsaved mirror that survives a
// closed frame, the stale-tokens.css banner (Apply to the new file / Discard), Reset, and Save
// through the tokens edit route.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { JsonValue } from '@openchamber/sdk';

import type { EditResponse, TokensResponse } from '../../src/shared/api.ts';
import type { TokenVar } from '../../src/shared/bridge-protocol.ts';
import type { Tweak } from '../../src/shared/types.ts';
import {
  createTweaksController,
  TWEAKS_SAVED_SENTENCE,
  tweaksMirrorKey,
  type TweaksNotice,
} from '../../src/guest/tweaks.ts';
import { ServiceError, type ServiceClient } from '../../src/guest/service-client.ts';

const SLUG = 'demo';

const RADIUS: Tweak = { var: '--radius', label: 'Corner radius', kind: 'number', min: 0, max: 24, step: 2, unit: 'px' };
const DENSITY: Tweak = {
  var: '--density',
  label: 'Density',
  kind: 'choice',
  options: [
    { label: 'Compact', value: '0.85' },
    { label: 'Comfortable', value: '1' },
    { label: 'Roomy', value: '1.2' },
  ],
};
const TWEAKS: Tweak[] = [RADIUS, DENSITY];

const okTokens = (sha: string): TokensResponse => ({
  exists: true,
  editable: true,
  sha256: sha,
  knobs: [
    { var: '--radius', state: 'ok', value: 8, fileUnit: 'px', alsoSet: [] },
    { var: '--density', state: 'ok', value: '1', fileUnit: null, alsoSet: [] },
  ],
});

// ---- helpers ----

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const fakeClock = (start = 1_000_000) => {
  let at = start;
  const timers: { due: number; run: () => void; cancelled: boolean }[] = [];
  const schedule = (run: () => void, ms: number): (() => void) => {
    const timer = { due: at + ms, run, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  return {
    now: () => at,
    schedule,
    advance(ms: number): void {
      at += ms;
      for (const timer of [...timers]) {
        if (timer.cancelled || timer.due > at) continue;
        timer.cancelled = true;
        timer.run();
      }
    },
  };
};

const fakeTweaksService = () => {
  const state = { tokens: okTokens('sha1'), edits: [] as { op: string; base: string; values: { var: string; value: number | string }[] }[] };
  const handlers = {
    getTokens: async (): Promise<TokensResponse> => state.tokens,
    edit: async (body: { op: string; base: string; values: { var: string; value: number | string }[] }): Promise<EditResponse> => {
      state.edits.push(body);
      const newSha = `sha-saved-${state.edits.length}`;
      state.tokens = { ...state.tokens, sha256: newSha };
      return {
        edit: { id: 'e_test12345678', label: 'Tweaks saved to tokens.css', files: ['tokens.css'], undoable: true },
        version: null,
        coalesced: false,
        stamps: { tokens: newSha },
      };
    },
  };
  const call = async (key: string, ...args: unknown[]): Promise<unknown> => {
    const request = (args[0] ?? {}) as { body?: { op: string; base: string; values: { var: string; value: number | string }[] } };
    if (key === 'GET /designs/:slug/tokens') return handlers.getTokens();
    if (key === 'POST /designs/:slug/edits') return handlers.edit(request.body as { op: string; base: string; values: { var: string; value: number | string }[] });
    throw new Error(`unexpected route ${key}`);
  };
  const client = {
    call,
    upload: async () => {
      throw new Error('unused');
    },
    loadRender: async () => {
      throw new Error('unused');
    },
    thumbnail: async () => {
      throw new Error('unused');
    },
  } as unknown as ServiceClient;
  return { client, state, handlers };
};

const fakeStorage = () => {
  const map = new Map<string, JsonValue>();
  const sets: { key: string; value: JsonValue }[] = [];
  const deletes: string[] = [];
  return {
    map,
    sets,
    deletes,
    get: async (key: string): Promise<JsonValue | undefined> => map.get(key),
    set: async (key: string, value: JsonValue): Promise<void> => {
      sets.push({ key, value });
      map.set(key, value);
    },
    delete: async (key: string): Promise<void> => {
      deletes.push(key);
      map.delete(key);
    },
  };
};

const rig = () => {
  const fake = fakeTweaksService();
  const storage = fakeStorage();
  const clock = fakeClock();
  const previews: TokenVar[][] = [];
  const notices: TweaksNotice[] = [];
  const controller = createTweaksController({
    client: fake.client,
    slug: SLUG,
    tweaks: () => TWEAKS,
    storage,
    onPreview: (vars) => previews.push(vars),
    onNotice: (notice) => notices.push(notice),
    now: clock.now,
    schedule: clock.schedule,
  });
  return { controller, fake, storage, clock, previews, notices };
};

const filesEvent = (files?: string[]) => ({
  reset: false,
  epoch: 'e',
  seq: 1,
  events: [{ seq: 1, slug: SLUG, kind: 'files' as const, ...(files ? { files } : {}) }],
});

// ---- load and preview ----

test('load: reads the knobs, no pending values, empty preview', async () => {
  const r = rig();
  await r.controller.load();
  const state = r.controller.getState();
  assert.equal(state.status, 'ready');
  assert.equal(state.dirty, false);
  assert.equal(state.stale, false);
  assert.deepEqual(r.controller.preview(), []);
  assert.deepEqual(r.previews.at(-1), []);
});

test('setValue: clamps and rounds a number, previews it with the unit, mirrors after the debounce', async () => {
  const r = rig();
  await r.controller.load();
  r.controller.setValue('--radius', 9); // rounds to the step of 2 → 10
  assert.deepEqual(r.controller.preview(), [{ name: '--radius', value: '10px' }]);
  assert.equal(r.controller.getState().dirty, true);
  assert.equal(r.storage.sets.length, 0, 'mirror is debounced');
  r.clock.advance(300);
  await tick();
  assert.equal(r.storage.sets.length, 1);
  assert.equal(r.storage.sets[0]?.key, tweaksMirrorKey(SLUG));
  const stored = r.storage.sets[0]?.value as { sha256: string; values: { var: string; value: number }[] };
  assert.equal(stored.sha256, 'sha1');
  assert.deepEqual(stored.values, [{ var: '--radius', value: 10 }]);
});

test('setValue: a choice previews verbatim; a value back at the file is no longer pending', async () => {
  const r = rig();
  await r.controller.load();
  r.controller.setValue('--density', '1.2');
  assert.deepEqual(r.controller.preview(), [{ name: '--density', value: '1.2' }]);
  r.controller.setValue('--density', '1'); // the file's own value
  assert.deepEqual(r.controller.preview(), []);
  assert.equal(r.controller.getState().dirty, false);
});

test('setValue: a broken knob is ignored', async () => {
  const r = rig();
  r.fake.state.tokens = { ...okTokens('sha1'), knobs: [{ var: '--radius', state: 'missing', value: null, fileUnit: null, alsoSet: [] }, okTokens('sha1').knobs[1] as TokensResponse['knobs'][number]] };
  await r.controller.load();
  r.controller.setValue('--radius', 10);
  assert.deepEqual(r.controller.preview(), []);
  assert.equal(r.controller.getState().dirty, false);
});

// ---- the unsaved mirror survives a closed frame ----

test('a stored mirror restores the pending values on open (dot and Unsaved), previewed', async () => {
  const r = rig();
  r.storage.map.set(tweaksMirrorKey(SLUG), { sha256: 'sha1', values: [{ var: '--radius', value: 10 }], at: 0 });
  await r.controller.load();
  assert.equal(r.controller.getState().dirty, true);
  assert.deepEqual(r.controller.preview(), [{ name: '--radius', value: '10px' }]);
  assert.equal(r.controller.getState().stale, false, 'same hash, not stale');
});

test('a stored mirror whose knobs no longer exist drops them', async () => {
  const r = rig();
  r.storage.map.set(tweaksMirrorKey(SLUG), { sha256: 'sha1', values: [{ var: '--gone', value: 1 }, { var: '--radius', value: 10 }], at: 0 });
  await r.controller.load();
  assert.deepEqual(r.controller.preview(), [{ name: '--radius', value: '10px' }]);
});

test('a stored mirror made on an older hash restores as stale', async () => {
  const r = rig();
  r.storage.map.set(tweaksMirrorKey(SLUG), { sha256: 'sha0', values: [{ var: '--radius', value: 10 }], at: 0 });
  await r.controller.load();
  assert.equal(r.controller.getState().stale, true);
  assert.equal(r.controller.getState().dirty, true);
});

// ---- load failure ----

test('load: a failed read keeps the restored pending values, not previewed, with a Try again', async () => {
  const r = rig();
  r.storage.map.set(tweaksMirrorKey(SLUG), { sha256: 'sha1', values: [{ var: '--radius', value: 10 }], at: 0 });
  r.fake.handlers.getTokens = async () => {
    throw new ServiceError('NO_SERVICE', 'down');
  };
  await r.controller.load();
  const state = r.controller.getState();
  assert.equal(state.status, 'error');
  assert.ok(state.loadError);
  assert.equal(state.dirty, true, 'pending kept');
  assert.equal(state.pending.get('--radius'), 10);
  // Try again succeeds.
  r.fake.handlers.getTokens = async () => okTokens('sha1');
  await r.controller.retry();
  assert.equal(r.controller.getState().status, 'ready');
  assert.deepEqual(r.controller.preview(), [{ name: '--radius', value: '10px' }]);
});

// ---- Reset / Discard ----

test('reset: back to the file values, preview cleared, mirror deleted, no write', async () => {
  const r = rig();
  await r.controller.load();
  r.controller.setValue('--radius', 10);
  r.controller.reset();
  assert.deepEqual(r.controller.preview(), []);
  assert.equal(r.controller.getState().dirty, false);
  assert.ok(r.storage.deletes.includes(tweaksMirrorKey(SLUG)));
  assert.equal(r.fake.state.edits.length, 0, 'Reset never writes');
});

// ---- Save ----

test('save: writes the pending values through the tokens route, clears them, deletes the mirror, notices', async () => {
  const r = rig();
  await r.controller.load();
  r.controller.setValue('--radius', 10);
  r.controller.setValue('--density', '1.2');
  const answer = await r.controller.save();
  assert.equal(r.fake.state.edits.length, 1);
  const edit = r.fake.state.edits[0];
  assert.equal(edit?.op, 'tokens');
  assert.equal(edit?.base, 'sha1');
  assert.deepEqual(edit?.values, [{ var: '--radius', value: 10 }, { var: '--density', value: '1.2' }]);
  assert.equal(answer.stamps.tokens, 'sha-saved-1');
  assert.equal(r.controller.getState().dirty, false);
  assert.deepEqual(r.controller.preview(), []);
  assert.ok(r.storage.deletes.includes(tweaksMirrorKey(SLUG)));
  assert.deepEqual(r.notices, [{ id: 'tweaks', message: TWEAKS_SAVED_SENTENCE }]);
});

test('save: a refusal keeps the values and reports the sentence', async () => {
  const r = rig();
  await r.controller.load();
  r.controller.setValue('--radius', 10);
  r.fake.handlers.edit = async () => {
    throw new ServiceError('stale', 'tokens.css changed since you started.');
  };
  await assert.rejects(r.controller.save(), (error: unknown) => error instanceof ServiceError && error.code === 'stale');
  assert.equal(r.controller.getState().dirty, true, 'values kept');
  assert.ok(r.controller.getState().saveError);
  assert.equal(r.fake.state.edits.length, 0);
});

// ---- stale tokens.css (the banner) ----

test('an agent write to tokens.css under unsaved values raises the stale banner; the preview stays', async () => {
  const r = rig();
  await r.controller.load();
  r.controller.setValue('--radius', 10);
  r.fake.state.tokens = okTokens('sha2'); // the agent changed the file
  r.controller.applyChanges(filesEvent(['tokens.css']));
  r.clock.advance(300);
  await tick();
  const state = r.controller.getState();
  assert.equal(state.stale, true);
  assert.deepEqual(r.controller.preview(), [{ name: '--radius', value: '10px' }], 'preview stays on top of the new file');
});

test('a files event that does not name tokens.css does not refetch', async () => {
  const r = rig();
  await r.controller.load();
  r.controller.setValue('--radius', 10);
  r.fake.state.tokens = okTokens('sha2');
  r.controller.applyChanges(filesEvent(['screens/home.html']));
  r.clock.advance(300);
  await tick();
  assert.equal(r.controller.getState().stale, false);
});

test('applyToNewFile: writes onto the new hash, leaving out knobs that are no longer ok', async () => {
  const r = rig();
  await r.controller.load();
  r.controller.setValue('--radius', 10);
  r.controller.setValue('--density', '1.2');
  // The new file keeps --radius editable but loses --density.
  r.fake.state.tokens = {
    exists: true,
    editable: true,
    sha256: 'sha2',
    knobs: [
      { var: '--radius', state: 'ok', value: 8, fileUnit: 'px', alsoSet: [] },
      { var: '--density', state: 'missing', value: null, fileUnit: null, alsoSet: [] },
    ],
  };
  r.controller.applyChanges(filesEvent(['tokens.css']));
  r.clock.advance(300);
  await tick();
  assert.deepEqual(r.controller.getState().staleExcluded, ['--density']);
  await r.controller.applyToNewFile();
  const edit = r.fake.state.edits[0];
  assert.equal(edit?.base, 'sha2', 'the new file hash');
  assert.deepEqual(edit?.values, [{ var: '--radius', value: 10 }], 'the broken knob is left out');
  assert.equal(r.controller.getState().stale, false);
  assert.equal(r.controller.getState().dirty, false);
});

test('discard: drops the pending values and the preview', async () => {
  const r = rig();
  await r.controller.load();
  r.controller.setValue('--radius', 10);
  r.controller.discard();
  assert.deepEqual(r.controller.preview(), []);
  assert.equal(r.controller.getState().dirty, false);
  assert.ok(r.storage.deletes.includes(tweaksMirrorKey(SLUG)));
});

test("the view's own save echo does not raise the banner", async () => {
  const r = rig();
  await r.controller.load();
  r.controller.setValue('--radius', 10);
  await r.controller.save(); // adopts the stamp, clears pending
  // The pipeline's own files event arrives.
  r.controller.applyChanges({ reset: false, epoch: 'e', seq: 2, events: [{ seq: 2, slug: SLUG, kind: 'files', files: ['tokens.css'], origin: 'user' }] });
  r.clock.advance(300);
  await tick();
  assert.equal(r.controller.getState().stale, false);
});

// ---- design gone ----

test('a gone design keeps the pending values for display and writes nothing', async () => {
  const r = rig();
  r.storage.map.set(tweaksMirrorKey(SLUG), { sha256: 'sha1', values: [{ var: '--radius', value: 10 }], at: 0 });
  r.fake.handlers.getTokens = async () => {
    throw new ServiceError('not-found', 'That design is no longer in your Designs folder.');
  };
  await r.controller.load();
  const state = r.controller.getState();
  assert.equal(state.gone, true);
  assert.equal(state.pending.get('--radius'), 10);
  assert.equal(r.fake.state.edits.length, 0);
});
