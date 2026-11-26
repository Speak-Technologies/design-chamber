// Visual scenario for the canvas wall's wheel (fix/canvas-wheel-scroll): in Edit mode a wheel
// over an artboard pans the wall by exactly the wheel delta, the same as over empty wall, and the
// design inside never scrolls; Ctrl/⌘ + wheel (pinch) zooms around the cursor without scrolling
// the design; in Play mode the wheel scrolls the design and the wall stays put. The design frames
// are sandboxed OOPIFs, so their scroll is observed through the bridge's own `scroll` / `ready`
// reports to the guest window (the same reports the wall places pins from). The page viewer's
// wheel routing is table-tested in test/ui/wall-input-model.test.ts and test/ui/wall-wheel.test.ts.

export const run = async ({ openPage, check, listReady, thumbsReady, wallReady }) => {
  const tag = 'page-1400-dark-canvas-wheel';
  const p = await openPage({ width: 1400, height: 900, surface: 'page', theme: 'dark', label: tag });
  console.log(tag);
  await listReady(p);
  await thumbsReady(p);

  // Record every frame's bridge reports before the design opens.
  await p.guest(`win.__wheelObs = {}; win.addEventListener('message', (e) => { const d = e.data; if (!d || d.dc !== 1 || typeof d.artboardId !== 'string') return; const o = win.__wheelObs[d.artboardId] || (win.__wheelObs[d.artboardId] = { y: 0, h: 0 }); if (d.type === 'scroll') o.y = d.y; if ((d.type === 'ready' || d.type === 'size') && typeof d.docHeight === 'number') o.h = d.docHeight; }); return true`);
  const obs = (id) => p.guest(`return win.__wheelObs[${JSON.stringify(id)}] ?? { y: 0, h: 0 }`);

  await p.click('.dc-card[data-slug="coffee-subscription"] .dc-card-main');
  await wallReady(p, 6);
  await p.settle(700);

  const transform = () => p.guest(`const t = doc.querySelector('.dc-wall-world').style.transform; const m = t.match(/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\) scale\\(([-\\d.]+)\\)/); return m ? { x: +m[1], y: +m[2], s: +m[3] } : null`);
  const boards = () => p.guest(`return [...doc.querySelectorAll('.dc-board[data-state="ready"]')].map((b) => { const f = b.querySelector('.dc-frame'); const r = f.getBoundingClientRect(); return { id: b.dataset.board, x: r.left, y: r.top, w: r.width, h: r.height }; })`);
  const wallBox = () => p.guest(`const r = doc.querySelector('.dc-wall').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }`);
  const fit = async () => {
    await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Fit' });
    await p.settle(600);
  };

  const all = await boards();
  const board = all.find((b) => b.id.endsWith('@laptop')) ?? all[0];
  const t = await transform();
  const info = await obs(board.id);
  check(info.h > board.h / t.s, `${tag}: the design document is taller than its frame (${info.h} > ${Math.round(board.h / t.s)})`);

  // Edit mode: a wheel over the artboard pans the wall; the design does not scroll.
  const before = await transform();
  const scrollBefore = await obs(board.id);
  await p.wheel(board.x + board.w / 2, board.y + board.h / 2, 0, 120);
  const after = await transform();
  const scrollAfter = await obs(board.id);
  check(Math.abs(after.x - before.x) < 0.01 && Math.abs(after.y - (before.y - 120)) < 0.01 && after.s === before.s, `${tag}: Edit wheel over the artboard pans the wall by the delta (${JSON.stringify({ before, after })})`);
  check(scrollAfter.y === scrollBefore.y, `${tag}: Edit wheel over the artboard does not scroll the design (scrollY ${scrollBefore.y} -> ${scrollAfter.y})`);

  // Parity: the same wheel over empty wall pans by the same delta.
  const wall = await wallBox();
  const moved = await boards();
  const inside = (x, y) => moved.some((b) => x >= b.x - 4 && x <= b.x + b.w + 4 && y >= b.y - 4 && y <= b.y + b.h + 4);
  let empty = null;
  for (const cand of [[wall.x + wall.w - 15, wall.y + wall.h - 15], [wall.x + wall.w - 15, wall.y + 30], [wall.x + 15, wall.y + wall.h - 15]]) {
    if (!inside(cand[0], cand[1])) { empty = cand; break; }
  }
  check(empty !== null, `${tag}: found an empty wall point`);
  if (empty) {
    const t0 = await transform();
    await p.wheel(empty[0], empty[1], 0, 120);
    const t1 = await transform();
    check(Math.abs(t1.x - t0.x) < 0.01 && Math.abs(t1.y - (t0.y - 120)) < 0.01, `${tag}: wheel over empty wall pans identically (${JSON.stringify({ t0, t1 })})`);
  }

  // Ctrl/pinch over the artboard zooms around the cursor; the design still does not scroll.
  await fit();
  const zoomBoard = (await boards()).find((b) => b.id === board.id);
  const z0 = await transform();
  const s0 = await obs(board.id);
  await p.wheel(zoomBoard.x + zoomBoard.w / 2, zoomBoard.y + zoomBoard.h / 2, 0, -120, { ctrl: true });
  const z1 = await transform();
  const s1 = await obs(board.id);
  check(z1.s > z0.s, `${tag}: Edit Ctrl+wheel over the artboard zooms in (${z0.s} -> ${z1.s})`);
  check(s1.y === s0.y, `${tag}: Edit Ctrl+wheel does not scroll the design`);

  // Play mode: the wheel scrolls the design, the wall stays put.
  await p.click('.dc-mode [role=tab]', { text: 'Play' });
  await fit();
  const playBoard = (await boards()).find((b) => b.id === board.id);
  const p0 = await transform();
  const ps0 = await obs(board.id);
  await p.wheel(playBoard.x + playBoard.w / 2, playBoard.y + playBoard.h / 2, 0, 240);
  await p.settle(300);
  const p1 = await transform();
  const ps1 = await obs(board.id);
  check(ps1.y > ps0.y, `${tag}: Play wheel over the artboard scrolls the design (scrollY ${ps0.y} -> ${ps1.y})`);
  check(Math.abs(p1.x - p0.x) < 0.01 && Math.abs(p1.y - p0.y) < 0.01 && p1.s === p0.s, `${tag}: Play wheel does not move the wall`);
  await p.close();
};
