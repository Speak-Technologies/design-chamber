// The wheel a design frame forwards, replayed through the wall's real frame-message handler:
// on the wall it pans the camera (Edit mode included, so the design never scrolls under a wheel),
// Ctrl zooms around the cursor, and a page keeps scrolling the design instead. The pure decision
// is `frameWheelRoute` (model/wall-input.ts, table-tested in wall-input-model.test.ts); this file
// pins what the handler does with the answer: which camera math runs and what reaches the frame.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { screenToWorld, wheelZoom, type Camera } from '../../src/guest/camera.ts';
import { BRIDGE_PROTOCOL_VERSION, type FrameToPageMessage } from '../../src/shared/bridge-protocol.ts';
import { frameToScreen } from '../../src/ui/model/wall-model.ts';
import { createFrameMessageHandler, type FrameMessageStore } from '../../src/ui/wall/frame-messages.ts';
import type { CameraController } from '../../src/ui/wall/camera-controller.ts';
import type { HitController } from '../../src/ui/wall/hit-controller.ts';
import type { PickLayer } from '../../src/ui/wall/pick-layer.ts';
import type { PopoverLayer } from '../../src/ui/wall/popover-layer.ts';
import type { WallContext } from '../../src/ui/wall/wall-context.ts';
import type { Board } from '../../src/ui/wall/wall-types.ts';

type Rig = {
  handle: (message: FrameToPageMessage) => void;
  posted: Array<{ type: string; dx?: number; dy?: number }>;
  camera: () => Camera;
};

const makeRig = (over: { pageMode?: boolean; mode?: 'edit' | 'play'; readOnly?: boolean } = {}): Rig => {
  const posted: Rig['posted'] = [];
  let cam: Camera = { x: 100, y: 50, scale: 1 };

  const ctx = {
    options: { slug: 'coffee', onNotice: () => undefined, onExternal: () => undefined },
    pageMode: over.pageMode ?? false,
    mode: over.mode ?? 'edit',
    version: null,
    compare: false,
    readOnly: () => over.readOnly ?? false,
    screens: () => [],
  } as unknown as WallContext; // Safe: the wheel case reads only these fields.

  const board = {
    art: { id: 'home@laptop', rect: { x: 0, y: 0, w: 1280, h: 800 } },
    main: { post: (message: { type: string; dx?: number; dy?: number }) => posted.push(message) },
  } as unknown as Board; // Safe: the wheel case reads only the art rect and posts to main.

  const camera = {
    get: () => cam,
    set: (next: Camera) => {
      cam = next;
    },
  } as unknown as CameraController; // Safe: the wheel case only gets and sets.

  // The wheel case never touches hit, popovers or picks; the handler still asks for them at build time.
  const unused = {} as unknown as HitController & PopoverLayer & PickLayer;
  const store = {} as FrameMessageStore; // Safe: no wheel route reads a source.
  const handler = createFrameMessageHandler(
    ctx,
    { camera, hit: unused, popovers: unused, picks: unused, load: async () => undefined, shortcut: () => false, storage: () => undefined },
    store,
  );
  return { handle: (message) => handler(board, message), posted, camera: () => cam };
};

const wheel = (over: { deltaX?: number; deltaY?: number; x?: number; y?: number; ctrl?: boolean } = {}): FrameToPageMessage => ({
  dc: BRIDGE_PROTOCOL_VERSION,
  type: 'wheel',
  artboardId: 'home@laptop',
  nonce: 'n0nce',
  deltaX: over.deltaX ?? 0,
  deltaY: over.deltaY ?? 40,
  x: over.x ?? 10,
  y: over.y ?? 10,
  ctrl: over.ctrl ?? false,
});

const scrollBys = (rig: Rig): Array<{ type: string; dx?: number; dy?: number }> => rig.posted.filter((message) => message.type === 'scroll-by');

test('wall, Edit mode: a plain wheel pans the camera by the wheel deltas and never scrolls the design', () => {
  const rig = makeRig();
  rig.handle(wheel({ deltaX: 12, deltaY: 40 }));
  assert.deepEqual(rig.camera(), { x: 100 - 12, y: 50 - 40, scale: 1 }, 'the same pan a wheel over empty wall makes');
  assert.deepEqual(scrollBys(rig), [], 'the design inside the artboard does not scroll');
});

test('wall, Edit mode: Ctrl/pinch zooms around the cursor, keeping the world point under it fixed', () => {
  const rig = makeRig();
  const before = rig.camera();
  const cursor = frameToScreen(before, { x: 0, y: 0, w: 1280, h: 800 }, { x: 10, y: 10 });
  rig.handle(wheel({ deltaY: -120, ctrl: true }));
  const after = rig.camera();
  assert.ok(after.scale > before.scale, 'a pinch out (negative deltaY) zooms in');
  const was = screenToWorld(before, cursor);
  const now = screenToWorld(after, cursor);
  assert.ok(Math.abs(was.x - now.x) < 1e-9 && Math.abs(was.y - now.y) < 1e-9, 'the point under the cursor stays put');
  assert.deepEqual(scrollBys(rig), []);
});

test('wall: a forwarded wheel pans in Play mode and on a saved version too; Ctrl still zooms', () => {
  for (const over of [{ mode: 'play' as const }, { readOnly: true }, { mode: 'play' as const, readOnly: true }]) {
    const rig = makeRig(over);
    rig.handle(wheel({ deltaX: -7, deltaY: 25 }));
    assert.deepEqual(rig.camera(), { x: 107, y: 25, scale: 1 }, JSON.stringify(over));
    assert.deepEqual(scrollBys(rig), [], JSON.stringify(over));
    const zoomed = makeRig(over);
    zoomed.handle(wheel({ deltaY: -120, ctrl: true }));
    assert.ok(zoomed.camera().scale > 1, `Ctrl zooms: ${JSON.stringify(over)}`);
    assert.deepEqual(scrollBys(zoomed), [], JSON.stringify(over));
  }
});

test('wall: the zoom a forwarded Ctrl wheel makes is the same wheelZoom the surface uses', () => {
  const rig = makeRig();
  const before = rig.camera();
  const cursor = frameToScreen(before, { x: 0, y: 0, w: 1280, h: 800 }, { x: 300, y: 200 });
  rig.handle(wheel({ deltaY: 63, x: 300, y: 200, ctrl: true }));
  assert.deepEqual(rig.camera(), wheelZoom(before, 63, cursor));
});

test('page, Edit mode: a plain wheel still scrolls the design and leaves the camera alone', () => {
  const rig = makeRig({ pageMode: true });
  rig.handle(wheel({ deltaX: 3, deltaY: 90 }));
  assert.deepEqual(scrollBys(rig), [{ type: 'scroll-by', dx: 3, dy: 90 }]);
  assert.deepEqual(rig.camera(), { x: 100, y: 50, scale: 1 });
});

test('page: Ctrl wheel does nothing, and a plain wheel in Play mode or on a saved version does nothing', () => {
  const cases: Array<{ over: { pageMode: boolean; mode?: 'edit' | 'play'; readOnly?: boolean }; ctrl: boolean }> = [
    { over: { pageMode: true }, ctrl: true },
    { over: { pageMode: true, mode: 'play' }, ctrl: false },
    { over: { pageMode: true, readOnly: true }, ctrl: false },
  ];
  for (const { over, ctrl } of cases) {
    const rig = makeRig(over);
    rig.handle(wheel({ deltaY: 90, ctrl }));
    assert.deepEqual(rig.posted, [], JSON.stringify({ over, ctrl }));
    assert.deepEqual(rig.camera(), { x: 100, y: 50, scale: 1 }, JSON.stringify({ over, ctrl }));
  }
});
