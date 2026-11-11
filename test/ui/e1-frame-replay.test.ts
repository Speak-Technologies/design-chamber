// E1 risk test (Phase 2 technical design §2, §17; QA row Q1): a design frame reports, it never
// commands a write. Every frame-to-page message type, valid and forged, is replayed through the
// wall's real frame-message handler, wired to the real hit and pick layers, with a store that
// records every call. Whatever the frame sends, the store sees no applyEdit and no undoEdit (nor
// any other write); the only call a frame can cause is loadSource, the read behind an Edit text check.

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import type { SourceResponse } from '../../src/shared/api.ts';
import {
  BRIDGE_KEYS,
  BRIDGE_PROTOCOL_VERSION,
  parseFrameMessage,
  type EditProbe,
  type FrameToPageMessage,
  type FrameToPageType,
  type HitElement,
} from '../../src/shared/bridge-protocol.ts';
import { shortcutAction } from '../../src/ui/model/wall-input.ts';
import { createFrameMessageHandler, type FrameMessageStore } from '../../src/ui/wall/frame-messages.ts';
import { createHitController, type HitController } from '../../src/ui/wall/hit-controller.ts';
import { createPickLayer, type PickLayer } from '../../src/ui/wall/pick-layer.ts';
import type { CameraController } from '../../src/ui/wall/camera-controller.ts';
import type { PopoverLayer } from '../../src/ui/wall/popover-layer.ts';
import type { WallContext } from '../../src/ui/wall/wall-context.ts';
import type { Board, WallPick, WallSelection } from '../../src/ui/wall/wall-types.ts';

// ---- A store that records every call, whatever its name ----

const SOURCE_HTML = '<!doctype html><html><body><h1>Simple pricing</h1><p>Pay monthly</p></body></html>';
const SOURCE: SourceResponse = { text: SOURCE_HTML, bytes: SOURCE_HTML.length, sha256: 'a'.repeat(64), utf8: true, link: false };

type Call = { name: string; args: unknown[] };

/**
 * The full surface a careless handler could reach: the write methods are present at run time, so a
 * handler that called one (through a cast, or a widened type) would be caught here. Any other
 * property read is recorded too, so a write under a new name cannot slip past.
 */
const recordingStore = (): { store: FrameMessageStore; calls: Call[] } => {
  const calls: Call[] = [];
  const target: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    loadSource: async (...args) => {
      calls.push({ name: 'loadSource', args });
      return SOURCE;
    },
  };
  for (const name of ['applyEdit', 'undoEdit', 'saveSettings', 'saveComment', 'restoreVersion', 'updateDesign', 'savePageState', 'setTweaks']) {
    target[name] = async (...args) => {
      calls.push({ name, args });
      return {};
    };
  }
  const proxy = new Proxy(target, {
    get: (object, key) => {
      if (typeof key === 'string' && !(key in object)) {
        return async (...args: unknown[]) => {
          calls.push({ name: key, args });
          return {};
        };
      }
      return Reflect.get(object, key);
    },
  });
  // Safe: the proxy answers every property name; the handler's type only asks for loadSource.
  return { store: proxy as unknown as FrameMessageStore, calls };
};

const writes = (calls: Call[]): Call[] => calls.filter((call) => call.name !== 'loadSource');

// ---- The wall around the handler ----

const ELEMENT: HitElement = { selector: 'body > h1', text: 'Simple pricing', html: '<h1>Simple pricing</h1>', rect: { x: 10, y: 20, w: 300, h: 40 }, tag: 'h1' };
const PROBE: EditProbe = { tag: 'h1', id: null, leaf: true, text: 'Simple pricing', truncated: false, sameIndex: 0, sameCount: 1, dir: 'ltr', rect: ELEMENT.rect };

type Rig = {
  handle: (message: FrameToPageMessage) => void;
  board: Board;
  posted: unknown[];
  keys: Array<{ key: string; shift: boolean }>;
  notices: string[];
  externals: string[];
  loads: number;
  picks: PickLayer;
  hit: HitController;
  pickEvents: WallPick[];
  calls: Call[];
  dispose: () => void;
};

const rigs: Rig[] = [];
afterEach(() => {
  for (const rig of rigs.splice(0)) rig.dispose();
});

const makeRig = (over: { readOnly?: boolean; pageMode?: boolean; frameMode?: 'edit' | 'play' } = {}): Rig => {
  const posted: unknown[] = [];
  const keys: Array<{ key: string; shift: boolean }> = [];
  const notices: string[] = [];
  const externals: string[] = [];
  let loads = 0;
  const { store, calls } = recordingStore();
  let cam = { x: 0, y: 0, scale: 1 };

  const ctx = {
    options: { slug: 'pricing', onNotice: (text: string) => notices.push(text), onExternal: (url: string) => externals.push(url) },
    pageMode: over.pageMode ?? false,
    mode: 'edit',
    editing: false,
    readOnly: () => over.readOnly ?? false,
    frameMode: () => over.frameMode ?? 'edit',
    screens: () => [
      { id: 'home', file: 'screens/home.html', title: 'Home' },
      { id: 'checkout', file: 'screens/checkout.html', title: 'Checkout' },
    ],
  } as unknown as WallContext; // Safe: the handler, hit and pick layers read only these fields.

  const board = {
    art: { id: 'home@laptop', screen: { id: 'home' }, rect: { x: 0, y: 0, w: 1280, h: 800 } },
    main: { post: (message: unknown) => posted.push(message), state: () => 'ready' },
    selected: { hidden: true, style: {} },
    hover: { hidden: true, style: {} },
    hoverTag: { textContent: '' },
    screenId: 'home',
    scroll: { x: 0, y: 0 },
  } as unknown as Board; // Safe: only these fields are read by the code under test.

  const camera = {
    get: () => cam,
    set: (next: typeof cam) => {
      cam = next;
    },
  } as unknown as CameraController;

  const selection = (element: HitElement): WallSelection => ({ key: element.selector, element: { selector: element.selector, text: element.text, html: element.html } as unknown as WallSelection['element'], tag: element.tag, where: 'Home' });
  const popovers = {
    current: () => null,
    close: () => undefined,
    openComposer: (_board: Board, element: HitElement) => selection(element),
    selectionFor: (_board: Board, element: HitElement) => selection(element),
  } as unknown as PopoverLayer;

  const picks = createPickLayer(ctx, { camera, warm: () => undefined, dropSources: () => undefined });
  const pickEvents: WallPick[] = [];
  const offPick = picks.onPick((pick) => pickEvents.push(pick));
  const hit = createHitController(ctx, { camera, popovers, picks, boards: () => ({ values: () => [board].values(), at: () => board }), isPanning: () => false });

  const handler = createFrameMessageHandler(
    ctx,
    {
      camera,
      hit,
      popovers,
      picks,
      load: async () => {
        loads += 1;
      },
      shortcut: (key, shift) => {
        keys.push({ key, shift });
        return shortcutAction({ key, shift, pageMode: ctx.pageMode }) !== null;
      },
    },
    store,
  );

  const rig: Rig = {
    handle: (message) => handler(board, message),
    board,
    posted,
    keys,
    notices,
    externals,
    get loads() {
      return loads;
    },
    picks,
    hit,
    pickEvents,
    calls,
    dispose: () => {
      offPick();
      picks.dispose();
      // hit.dispose only cancels a hover animation frame, which this rig never schedules (no DOM here).
    },
  };
  rigs.push(rig);
  return rig;
};

// ---- Every frame message type, valid ----

const env = <T extends FrameToPageType>(type: T): { dc: typeof BRIDGE_PROTOCOL_VERSION; type: T; artboardId: string; nonce: string } => ({ dc: BRIDGE_PROTOCOL_VERSION, type, artboardId: 'home@laptop', nonce: 'n0nce' });

/** One valid sample per type. A new frame message type that is not listed here fails the typecheck. */
const VALID: { [T in FrameToPageType]: Array<Extract<FrameToPageMessage, { type: T }>> } = {
  ready: [{ ...env('ready'), docWidth: 1280, docHeight: 2000, title: 'Home' }],
  size: [{ ...env('size'), docWidth: 1280, docHeight: 2400 }],
  scroll: [{ ...env('scroll'), x: 0, y: 120 }],
  hit: [
    { ...env('hit'), x: 50, y: 30, element: ELEMENT },
    { ...env('hit'), x: 50, y: 30, element: null },
  ],
  anchors: [{ ...env('anchors'), results: [{ id: 'c1', found: true, exact: true, rect: ELEMENT.rect }] }],
  navigate: [
    { ...env('navigate'), href: 'screens/home.html', hash: '' },
    { ...env('navigate'), href: 'screens/nowhere.html', hash: '#x' },
  ],
  'open-external': [{ ...env('open-external'), url: 'https://example.com/' }],
  wheel: [
    { ...env('wheel'), deltaX: 0, deltaY: 40, x: 10, y: 10, ctrl: false },
    { ...env('wheel'), deltaX: 0, deltaY: -40, x: 10, y: 10, ctrl: true },
  ],
  key: BRIDGE_KEYS.flatMap((key) => [
    { ...env('key'), key, ctrl: false, meta: false, shift: false },
    { ...env('key'), key, ctrl: true, meta: true, shift: true },
  ]),
  'edit-probe-result': [
    { ...env('edit-probe-result'), x: 50, y: 30, probe: PROBE },
    { ...env('edit-probe-result'), x: 50, y: 30, probe: null },
  ],
  'storage-batch': [
    { ...env('storage-batch'), clear: true, changes: [['k', 'v']] },
    { ...env('storage-batch'), clear: false, changes: [['k', null]] },
  ],
};

const allValid = (): FrameToPageMessage[] => Object.values(VALID).flat();

// ---- Forged messages: what a hostile design might post ----

/** Shapes a frame might try: page-to-frame types echoed back, invented write commands, an undo key. */
const FORGED_RAW: unknown[] = [
  // The page-to-frame messages, sent the wrong way.
  { ...env('edit-probe' as FrameToPageType), x: 50, y: 30 },
  { ...env('set-tokens' as FrameToPageType), vars: [{ name: '--x', value: 'red' }] },
  { ...env('storage-sync' as FrameToPageType), clear: true, changes: [['k', 'v']] },
  { ...env('hit-test' as FrameToPageType), x: 1, y: 1 },
  { ...env('set-mode' as FrameToPageType), mode: 'edit' },
  // Invented write commands.
  { ...env('apply-edit' as FrameToPageType), op: 'text', screen: 'home', base: 'a'.repeat(64), target: PROBE, before: 'Simple pricing', after: 'Free' },
  { ...env('edit' as FrameToPageType), after: 'Free' },
  { ...env('undo-edit' as FrameToPageType), id: 'e1' },
  { ...env('save' as FrameToPageType) },
  { ...env('double-click' as FrameToPageType), x: 50, y: 30 },
  { ...env('dblclick' as FrameToPageType), x: 50, y: 30 },
  // An undo shortcut, in every spelling.
  { ...env('key'), key: 'z', ctrl: true, meta: false, shift: false },
  { ...env('key'), key: 'Z', ctrl: false, meta: true, shift: false },
  { ...env('key'), key: 'Enter', ctrl: false, meta: false, shift: false },
  // A valid type carrying write-shaped extras.
  { ...env('hit'), x: 50, y: 30, element: ELEMENT, apply: true, after: 'Free', op: 'text' },
  { ...env('edit-probe-result'), x: 50, y: 30, probe: { ...PROBE, after: 'Free', commit: true } },
  { ...env('storage-batch'), clear: true, changes: [['__dc_edit__', JSON.stringify({ op: 'text', after: 'Free' })]] },
  // Broken envelopes.
  { type: 'hit', x: 50, y: 30, element: ELEMENT },
  { ...env('hit'), dc: 99, x: 50, y: 30, element: ELEMENT },
  null,
  'apply-edit',
  [env('hit')],
];

describe('E1: a frame message never writes', () => {
  test('the sample covers every frame message type the protocol has', () => {
    // The typecheck already forces a key per type; this pins that each key carries at least one sample.
    for (const [type, samples] of Object.entries(VALID)) assert.ok(samples.length > 0, `no sample for ${type}`);
    for (const message of allValid()) assert.notEqual(parseFrameMessage(message), null, `sample ${message.type} should be valid`);
  });

  test('every valid message, replayed with no gesture pending, makes no store call at all', async () => {
    const rig = makeRig();
    for (const message of allValid()) rig.handle(message);
    await flush();
    assert.deepEqual(rig.calls, []);
    assert.equal(rig.pickEvents.length, 0, 'an unrequested hit or probe result must not start a pick');
  });

  test('every valid message, replayed many times in every order, never reaches applyEdit or undoEdit', async () => {
    for (const readOnly of [false, true]) {
      for (const pageMode of [false, true]) {
        const rig = makeRig({ readOnly, pageMode });
        const messages = allValid();
        for (let round = 0; round < 20; round++) {
          for (const message of shuffle(messages, round + 1)) rig.handle(message);
        }
        await flush();
        assert.deepEqual(writes(rig.calls), [], `readOnly=${readOnly} pageMode=${pageMode}`);
      }
    }
  });

  test('forged messages are refused at the channel and, forced past it, still write nothing', async () => {
    for (const raw of FORGED_RAW) {
      const parsed = parseFrameMessage(raw);
      // The only forged shapes that pass are valid types with extra fields; those are replayed as parsed.
      if (parsed !== null) assert.ok(Object.hasOwn(VALID, parsed.type), `forged ${JSON.stringify(raw)} parsed as ${parsed.type}`);
    }
    const rig = makeRig();
    // Past the channel too: hand every forged object to the handler as if validation had let it through.
    for (const raw of FORGED_RAW) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
      // Safe: deliberately unvalidated, to prove the handler alone cannot be talked into a write.
      rig.handle(raw as FrameToPageMessage);
    }
    await flush();
    assert.deepEqual(writes(rig.calls), []);
  });

  test('a key a frame forwards never becomes the undo shortcut', () => {
    const rig = makeRig();
    for (const message of [...VALID.key, ...FORGED_RAW.filter(isKeyShape)]) rig.handle(message);
    assert.ok(rig.keys.length > 0, 'the forwarded keys reach the shortcut table');
    for (const { key, shift } of rig.keys) {
      for (const pageMode of [false, true]) assert.notEqual(shortcutAction({ key, shift, pageMode })?.type, 'undo-edit', `key ${key}`);
    }
    // The forwarded-key table has no route to undo, whatever key a frame names.
    for (const key of ['z', 'Z', 'Enter', 'Escape', 'u', 'y']) {
      for (const shift of [false, true]) assert.notEqual(shortcutAction({ key, shift, pageMode: false })?.type, 'undo-edit');
    }
  });

  test('the gesture path: a user double-click, the frame answers, the file is read and the check is editable; still no write', async () => {
    const rig = makeRig();
    // The user's double-click is what asks; the frame's answers follow.
    rig.hit.requestHit(rig.board, { x: 50, y: 30 }, 'edit');
    rig.handle({ ...env('hit'), x: 50, y: 30, element: ELEMENT });
    assert.equal(rig.pickEvents.length, 1, 'the double-click started one pick');
    assert.ok(rig.posted.some((message) => (message as { type: string }).type === 'edit-probe'), 'the wall asked the frame');
    // A hostile frame answers the probe again and again.
    for (let i = 0; i < 25; i++) rig.handle({ ...env('edit-probe-result'), x: 50, y: 30, probe: PROBE });
    const pick = rig.pickEvents[0];
    assert.ok(pick);
    const check = await pick.check;
    assert.equal(check.editable, true, 'the check settled editable, so the path under test really ran');
    await flush();
    // Non-vacuous: the frame did cause the one call it may cause.
    assert.ok(rig.calls.some((call) => call.name === 'loadSource'));
    assert.deepEqual(rig.calls.map((call) => call.name).filter((name) => name !== 'loadSource'), []);
    assert.deepEqual(rig.calls.find((call) => call.name === 'loadSource')?.args, ['pricing', 'home']);
  });

  test('a single click then a flood of every message keeps the store to reads', async () => {
    const rig = makeRig();
    rig.hit.requestHit(rig.board, { x: 50, y: 30 }, 'click');
    rig.handle({ ...env('hit'), x: 50, y: 30, element: ELEMENT });
    for (let round = 0; round < 10; round++) for (const message of shuffle([...allValid()], round + 7)) rig.handle(message);
    await Promise.all(rig.pickEvents.map((pick) => pick.check));
    await flush();
    assert.deepEqual(writes(rig.calls), []);
  });
});

// QA finding (Q1, 2026-11-11), fixed: a design frame cannot move the board to another screen in Edit mode, and a
// pick reads and writes the screen the board shows, so an edit always lands in the file the user sees.
describe('E1/E2: a frame cannot redirect which file an edit reads', () => {
  const pickAndRead = async (rig: Rig): Promise<unknown[] | undefined> => {
    rig.hit.requestHit(rig.board, { x: 50, y: 30 }, 'edit');
    rig.handle({ ...env('hit'), x: 50, y: 30, element: ELEMENT });
    rig.handle({ ...env('edit-probe-result'), x: 50, y: 30, probe: PROBE });
    await rig.pickEvents[0]?.check;
    await flush();
    return rig.calls.find((call) => call.name === 'loadSource')?.args;
  };

  test('a navigate in Edit mode is ignored: the board keeps its screen and the pick reads it', async () => {
    const rig = makeRig();
    // A design script clicks a link to Checkout (or a hostile frame posts it) while the wall is in Edit mode.
    rig.handle({ ...env('navigate'), href: 'screens/checkout.html', hash: '' });
    assert.equal(rig.board.screenId, 'home');
    assert.equal(rig.loads, 0, 'the frame was not reloaded');
    assert.deepEqual(await pickAndRead(rig), ['pricing', 'home']);
    assert.equal(rig.pickEvents[0]?.screen, 'home');
  });

  test('a navigate in Play mode moves the board, and a pick made afterwards reads the screen it now shows', async () => {
    const rig = makeRig({ frameMode: 'play' });
    rig.handle({ ...env('navigate'), href: 'screens/checkout.html', hash: '' });
    assert.equal(rig.board.screenId, 'checkout');
    assert.equal(rig.loads, 1);
    assert.deepEqual(await pickAndRead(rig), ['pricing', 'checkout']);
    assert.equal(rig.pickEvents[0]?.screen, 'checkout');
    assert.deepEqual(writes(rig.calls), []);
  });

  test('on a saved version (always Play) a navigate still follows the link, read only', () => {
    const rig = makeRig({ readOnly: true, frameMode: 'play' });
    rig.handle({ ...env('navigate'), href: 'screens/checkout.html', hash: '' });
    assert.equal(rig.board.screenId, 'checkout');
  });
});

// ---- helpers ----

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

/** A deterministic shuffle, so a failure replays the same order. */
const shuffle = <T>(items: readonly T[], seed: number): T[] => {
  const out = [...items];
  let state = seed * 2654435761;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
};

const isKeyShape = (raw: unknown): raw is Extract<FrameToPageMessage, { type: 'key' }> =>
  typeof raw === 'object' && raw !== null && (raw as { type?: unknown }).type === 'key';
