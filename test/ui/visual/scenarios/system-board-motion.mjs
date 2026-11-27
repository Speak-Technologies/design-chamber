// Visual scenario for the board's motion demos under the page's click layer (PR #42 browser test): the real board document
// (`buildBoardHtml`, with its own script) for the fake Harbor and its motion tokens, in the app's sandboxed frame. Hovering a demo's
// track plays it (the page reports the pointer; the board marks the demo `dc-playing`), moving off stops it, and a click on
// the same spot still selects the motion entry. Page 1400 and rail 320, 360 and 480 px, light and dark.
//
// The frame is sandboxed, so the page can't look inside it; the checks read its document through the frame's own DevTools
// target (it runs out of process), as a person's eyes would.

import { buildBoardHtml } from '../../../../src/service/systems/board-html.ts';
import { createFakeSystems } from '../fake-systems.ts';

const surfaceName = (surface) => (surface === 'panel' ? 'rail' : 'page');

const boardFor = (scheme) => {
  const book = createFakeSystems({ emit: () => undefined });
  const detail = book.handlers['GET /systems/:id']({ params: { id: 'harbor' } });
  return buildBoardHtml(detail, { scheme });
};

/** Evaluate in one DevTools target over its own socket (the board frame is sandboxed, so it runs in a process of its own). */
const evaluateIn = (url, expression) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.onerror = () => reject(new Error('probe socket failed'));
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      socket.close();
      resolve(message.result?.result?.value);
    };
  });

/** Run `expression` in the board frame's document: the iframe target whose document has a motion demo. */
const inBoard = async (h, expression) => {
  const targets = await (await fetch(`http://127.0.0.1:${h.debugPort}/json/list`)).json();
  for (const target of targets.filter((entry) => entry.type === 'iframe' && entry.webSocketDebuggerUrl)) {
    if ((await evaluateIn(target.webSocketDebuggerUrl, '!!document.querySelector(".dc-motion-demo")')) !== true) continue;
    return evaluateIn(target.webSocketDebuggerUrl, expression);
  }
  return undefined;
};

const flow = async (h, surface, width, theme) => {
  const tag = `sysmotion-${surfaceName(surface)}-${width}-${theme}`;
  const html = boardFor(theme);
  const p = await h.openPage({ width, height: 900, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await p.route('GET /systems/:id/board', { body: { key: `motion-${theme}`, chunks: 1, bytes: html.length, title: 'Harbor: specimen board', missing: [], blocked: [], external: [], warnings: [] } });
  await p.route('GET /systems/:id/board/chunk', { body: html });
  if (surface === 'panel') await p.click('.dc-rail-head .dc-iconbtn[aria-label="Design systems"]');
  else await p.click('.dc-library-bar .oc-sdk-btn', { text: 'Design systems' });
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the list is up`);
  await p.click('.dc-sys[data-id="harbor"] .dc-sys-main');
  await h.checkSoon(() => p.guest('return doc.querySelector(".dc-sys-board")?.dataset.state === "ready"'), `${tag}: the real board is drawn`);
  await p.settle(600);
  h.check(await p.guest('return doc.querySelector(".dc-sys-board iframe")?.getAttribute("sandbox") === "allow-scripts"'), `${tag}: the board frame is allow-scripts only`);

  // Bring the first demo into the frame's view and find it on the screen.
  const inside = await inBoard(h, '(() => { const d = document.querySelector(".dc-motion-demo"); d.scrollIntoView({ block: "center" }); const r = d.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()');
  h.check(inside !== undefined, `${tag}: the board has a motion demo the probe can reach`);
  if (inside === undefined) {
    await p.close();
    return;
  }
  await p.settle(300);
  const again = await inBoard(h, '(() => { const r = document.querySelector(".dc-motion-demo").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()');
  const frame = await p.rect('.dc-sys-board iframe');
  const x = frame.x + again.x;
  const y = frame.y + again.y;
  h.check(!(await inBoard(h, '!!document.querySelector(".dc-motion-demo.dc-playing")')), `${tag}: nothing plays before the pointer comes`);

  await p.move(x, y);
  await h.checkSoon(() => inBoard(h, 'document.querySelector(".dc-motion-demo") === document.querySelector(".dc-motion-demo.dc-playing")'), `${tag}: hovering the track plays its demo`);
  await p.settle(700);
  const left = await inBoard(h, 'getComputedStyle(document.querySelector(".dc-motion-demo .dc-motion-chip")).left');
  h.check(left !== '2px', `${tag}: the chip has moved along the track (${left})`);
  await p.shot(`${tag}-1-hover`);

  await p.move(frame.x + 4, frame.y + 4);
  await h.checkSoon(async () => (await inBoard(h, '!!document.querySelector(".dc-motion-demo.dc-playing")')) === false, `${tag}: moving off stops it`);

  // A click on the same spot still selects the motion entry, through the click layer.
  await p.clickAt(x, y);
  await h.checkSoon(async () => (await p.guest('return doc.querySelector(".dc-syspg-row[aria-current=\\"true\\"]")?.dataset.focusKey ?? ""')) === 'row:motion', `${tag}: a click on the demo selects Motion`);
  await p.close();
};

export const run = async (h) => {
  for (const [surface, width] of [['page', 1400], ['panel', 320], ['panel', 360], ['panel', 480]]) {
    for (const theme of ['light', 'dark']) await flow(h, surface, width, theme);
  }
};
