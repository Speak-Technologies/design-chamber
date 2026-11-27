// Visual scenario for system-builder-depth T21 (pins on the board): the rail at 320 and 480 px and the page at 1400 px, dark
// and light. Harbor's fake comments (fake-system-comments.ts): two pins drawn, one comment on an entry that's gone listed and
// not drawn. Comment mode, a click on an entry, the composer, a draft kept across Escape, Add comment, a pin opened from
// the keyboard (Tab, Enter, Escape back to the pin), Resolve, Send comments (N) and the sent state, and pins back on their
// entries after the board reloads and after a scheme switch. Once on the page: loading, a failed load with Try again, the
// damaged-file banner, the empty list, and a failed send that keeps the comments.
// DC_SYSCOMMENTS_ONLY=<tag regex> limits the variants.

const FAKE = 'window.frames[0].__dcFake';
const surfaceName = (surface) => (surface === 'panel' ? 'rail' : 'page');
const text = (p, selector) => p.guest(`return (doc.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);
const shownPins = (p) => p.guest('return [...doc.querySelectorAll(".dc-bc-pin:not(.dc-temp-pin)")].filter((n) => !n.hidden && n.getClientRects().length).map((n) => n.textContent)');
const listRows = (p) => p.guest('return [...doc.querySelectorAll(".dc-bc-list .dc-comment")].map((n) => n.querySelector(".dc-comment-where")?.textContent ?? "")');
const noOverflow = (p) => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');
/** Enter as a keyboard sends it, with its text, so a focused button presses (the shared helper sends the key alone). */
const pressEnter = async (p, focus) => {
  await p.guest(`doc.querySelector(${JSON.stringify(focus)}).focus()`);
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await p.settle(120);
};
/** Enter at whatever has focus now (no refocus first): what a user's next key press does. */
const enterHere = async (p) => {
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await p.settle(150);
};
const escapeHere = async (p) => {
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await p.settle(150);
};
const inCard = (p) => p.guest('return !!doc.activeElement?.closest(".dc-bc-card")');
const focusOnBody = (p) => p.guest('return doc.activeElement === doc.body || doc.activeElement === null');
const cardOpen = (p) => p.guest('return !!doc.querySelector(".dc-bc-card")');
const current = async (p, id) => JSON.parse(await p.host(`JSON.stringify(${FAKE}.systemComments.current(${JSON.stringify(id)}))`));

/** Evaluate in one DevTools target over its own socket (the board frame is sandboxed and runs out of process). */
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

/** Where an entry is inside the board frame (frame pixels), scrolled into view first; read through the frame's own target. */
const entryInFrame = async (h, entry) => {
  const targets = await (await fetch(`http://127.0.0.1:${h.debugPort}/json/list`)).json();
  const expression = `(() => { const n = document.querySelector('[data-dc-entry="${entry}"]'); if (!n) return null; n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 40), y: r.top + Math.min(r.height / 2, 20) }; })()`;
  for (const target of targets.filter((candidate) => candidate.type === 'iframe' && candidate.webSocketDebuggerUrl)) {
    const found = await evaluateIn(target.webSocketDebuggerUrl, expression).catch(() => null);
    if (found) return found;
  }
  return null;
};

const openSystem = async (h, p, surface, id, tag) => {
  if (surface === 'panel') await p.click('.dc-rail-head .dc-iconbtn[aria-label="Design systems"]');
  else await p.click('.dc-library-bar .oc-sdk-btn', { text: 'Design systems' });
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the list is up`);
  await p.click(`.dc-sys[data-id="${id}"] .dc-sys-main`);
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg[data-state=\\"ready\\"]")'), `${tag}: the system page loads`);
  await h.checkSoon(() => p.guest('return doc.querySelector(".dc-sys-board")?.dataset.state === "ready"'), `${tag}: the board is drawn`);
  await p.settle(500);
};

const flow = async (h, surface, width, theme) => {
  const tag = `syscomments-${surfaceName(surface)}-${width}-${theme}`;
  const p = await h.openPage({ width, height: surface === 'panel' ? 900 : 860, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openSystem(h, p, surface, 'harbor', tag);

  // ---- the pins and the list
  // The rail's board is short: the Button entry (pin 1) is under the fold until scrolled to.
  if (surface === 'page') await h.checkSoon(async () => (await shownPins(p)).join(',') === '1,2', `${tag}: two pins are drawn, 1 and 2`);
  else await h.checkSoon(async () => (await shownPins(p)).join(',') === '2', `${tag}: pin 2 is on the --brand swatch, the only entry in view`);
  h.check((await p.guest('return doc.querySelectorAll(".dc-bc-pin:not(.dc-temp-pin)").length')) === 3, `${tag}: three pins exist; the gone entry's comment has one that is never shown`);
  h.check(await p.guest('return [...doc.querySelectorAll(".dc-bc-pin:not(.dc-temp-pin)")].find((n) => n.getAttribute("aria-label").startsWith("Comment 3 "))?.hidden === true'), `${tag}: the comment on a gone entry is not drawn`);
  const rows = await listRows(p);
  h.check(rows.length === 3, `${tag}: the list has all three comments (${rows.join(' | ')})`);
  h.check(rows.some((row) => row.startsWith('On an entry that’s gone')), `${tag}: the comment on a gone entry is listed`);
  h.check((await text(p, '.dc-bc-count')) === '2 open · 1 sent', `${tag}: the head counts open and sent`);
  h.check((await text(p, '.dc-bc-foot .oc-sdk-btn')) === 'Send comments (2)', `${tag}: Send comments (2)`);
  h.check(await p.guest('return doc.querySelector(".dc-sys-board iframe")?.getAttribute("sandbox") === "allow-scripts"'), `${tag}: the board frame stays allow-scripts only`);
  h.check(await noOverflow(p), `${tag}: nothing scrolls sideways`);
  await p.shot(`${tag}-1-pins`);

  // ---- comment mode, a click on an entry, the composer, a kept draft
  await p.click('.dc-bc-toggle');
  h.check((await p.guest('return doc.querySelector(".dc-bc-toggle")?.getAttribute("aria-pressed")')) === 'true', `${tag}: the Comment switch is on`);
  h.check((await text(p, '.dc-bc-hint')).startsWith('Click an entry'), `${tag}: the hint says what to do`);
  const card = await entryInFrame(h, 'component:card');
  h.check(card !== null, `${tag}: the probe found the Card entry`);
  if (card === null) return p.close();
  await p.settle(300);
  const again = (await entryInFrame(h, 'component:card')) ?? card;
  const frame = await p.rect('.dc-sys-board iframe');
  await p.clickAt(frame.x + again.x, frame.y + again.y);
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-bc-card.dc-composer")'), `${tag}: a click on an entry opens the composer`);
  h.check((await text(p, '.dc-bc-card .dc-pop-snippet')) === 'Card', `${tag}: the composer names the entry`);
  await p.type('.dc-bc-card textarea', 'Card corners feel sharp next to the buttons.');
  await p.shot(`${tag}-2-composer`);
  await p.key('Escape', { focus: '.dc-bc-card textarea' });
  await h.checkSoon(() => p.guest('return !doc.querySelector(".dc-bc-card")'), `${tag}: Escape closes the card`);
  await p.settle(200);
  const back = (await entryInFrame(h, 'component:card')) ?? again;
  const frame2 = await p.rect('.dc-sys-board iframe');
  await p.clickAt(frame2.x + back.x, frame2.y + back.y);
  await h.checkSoon(() => p.guest('return doc.querySelector(".dc-bc-card textarea")?.value === "Card corners feel sharp next to the buttons."'), `${tag}: the half-typed words come back`);
  await p.click('.dc-bc-card .oc-sdk-btn', { text: 'Add comment' });
  await h.checkSoon(async () => (await shownPins(p)).includes('4'), `${tag}: the new comment gets pin 4`);
  h.check((await current(p, 'harbor')).length === 4, `${tag}: the service has it`);
  h.check(await p.guest('const a = doc.activeElement; return !!a && (a.classList.contains("dc-bc-pin") || a.dataset.focusKey === "row:c_new101")'), `${tag}: after Add comment focus is on the new pin (or its row)`);
  await p.click('.dc-bc-toggle');
  await p.shot(`${tag}-3-added`);

  // ---- a pin from the keyboard: Tab to it, Enter opens, Escape closes and gives focus back
  await p.guest('doc.querySelector(".dc-bc-toggle").focus()');
  await p.key('Tab', { focus: '.dc-bc-toggle' });
  h.check((await p.guest('return doc.activeElement?.classList.contains("dc-bc-pin") ? doc.activeElement.textContent : null')) === '1', `${tag}: Tab goes from the switch to pin 1`);
  await pressEnter(p, '.dc-bc-pin:not(.dc-temp-pin)');
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-bc-card.dc-thread")'), `${tag}: Enter opens the comment`);
  h.check((await p.guest('return doc.activeElement?.tagName')) === 'TEXTAREA', `${tag}: focus goes into the card`);
  await p.shot(`${tag}-4-thread`);
  await p.key('Escape', { focus: '.dc-bc-card textarea' });
  await h.checkSoon(() => p.guest('return !doc.querySelector(".dc-bc-card") && doc.activeElement?.classList.contains("dc-bc-pin")'), `${tag}: Escape closes it and focus is back on the pin`);

  // ---- focus stays in the card after Save, Resolve, Reopen and Send this, and Escape still closes it (browser test #2)
  const statusOf = async (cid) => (await current(p, 'harbor')).find((entry) => entry.id === cid);
  const openRow = async (cid, what) => {
    await p.click(`.dc-comment-main[data-focus-key="row:${cid}"]`);
    await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-bc-card.dc-thread") && doc.activeElement?.tagName === "TEXTAREA"'), `${tag}: ${what}: the row opens the comment with focus in it`);
  };
  const escapeCloses = async (what) => {
    await escapeHere(p);
    await h.checkSoon(async () => !(await cardOpen(p)), `${tag}: ${what}: Escape closes the card`);
    h.check(!(await focusOnBody(p)), `${tag}: ${what}: focus is not dropped on the page after Escape`);
  };
  await openRow('c_harbor01', 'save');
  await p.type('.dc-bc-card textarea', 'The primary button reads heavy. Try the softer radius.');
  await p.click('.dc-bc-card .oc-sdk-btn', { text: 'Save' });
  await h.checkSoon(async () => (await statusOf('c_harbor01'))?.body === 'The primary button reads heavy. Try the softer radius.' && (await inCard(p)), `${tag}: after Save focus stays in the card`);
  await p.shot(`${tag}-4b-saved`);
  await escapeCloses('save');
  await openRow('c_harbor01', 'resolve');
  await p.click('.dc-bc-card .oc-sdk-btn', { text: 'Resolve' });
  await h.checkSoon(async () => (await statusOf('c_harbor01'))?.status === 'resolved' && (await inCard(p)), `${tag}: after Resolve focus stays in the card`);
  await p.click('.dc-bc-card .oc-sdk-btn', { text: 'Reopen' });
  await h.checkSoon(async () => (await statusOf('c_harbor01'))?.status === 'open' && (await inCard(p)), `${tag}: after Reopen focus stays in the card`);
  await escapeCloses('resolve');
  await openRow('c_harbor01', 'send this');
  await p.click('.dc-bc-card .oc-sdk-btn', { text: 'Send this' });
  await h.checkSoon(async () => (await statusOf('c_harbor01'))?.status === 'sent' && (await inCard(p)), `${tag}: after Send this focus stays in the card (the button hides)`);
  await p.shot(`${tag}-4c-sent-one`);
  await escapeCloses('send this');

  // ---- resolve from the list
  await p.click('.dc-bc-list .dc-iconbtn[aria-label="Mark comment 2 resolved"]');
  await h.checkSoon(async () => (await current(p, 'harbor')).find((entry) => entry.id === 'c_harbor02')?.status === 'resolved', `${tag}: comment 2 is resolved`);
  await h.checkSoon(() => p.guest('return [...doc.querySelectorAll(".dc-bc-pin")].some((n) => n.getAttribute("aria-label")?.startsWith("Comment 2 ") && n.textContent === "✓")'), `${tag}: its pin shows a check`);

  // ---- send
  await p.click('.dc-bc-foot .oc-sdk-btn', { text: 'Send comments' });
  await h.checkSoon(async () => (await current(p, 'harbor')).filter((entry) => entry.status === 'open').length === 0, `${tag}: every open comment is marked sent`);
  const marked = JSON.parse(await p.host(`JSON.stringify(${FAKE}.systemComments.marked())`));
  h.check(marked.at(-2)?.join(',') === 'c_harbor01' && marked.at(-1)?.join(',') === 'c_new101', `${tag}: mark-sent named exactly what went each time (${JSON.stringify(marked)})`);
  await h.checkSoon(async () => (await text(p, '.dc-bc-count')) === '3 sent · 1 resolved', `${tag}: the list says they were sent`);
  await p.shot(`${tag}-5-sent`);

  // ---- delete: focus moves to a neighbour, never to the page (browser test #2)
  await openRow('c_harbor03', 'delete');
  await p.click('.dc-bc-card .oc-sdk-btn', { text: 'Delete' });
  await p.click('.dc-bc-card .oc-sdk-btn', { text: 'Delete comment?' });
  await h.checkSoon(async () => (await statusOf('c_harbor03')) === undefined && !(await cardOpen(p)), `${tag}: delete removes the comment and the card`);
  h.check(!(await focusOnBody(p)), `${tag}: after Delete focus is on a neighbour, not the page (${await p.guest('return doc.activeElement?.getAttribute("aria-label") ?? doc.activeElement?.textContent')})`);

  // ---- the keyboard reaches any entry of a section, not only the first (browser test #5)
  await p.click('.dc-syspg-row', { text: 'Colours' });
  await p.settle(300);
  await pressEnter(p, '.dc-bc-chooser .oc-sdk-trigger');
  await h.checkSoon(() => p.guest('return [...doc.querySelectorAll("[role=listbox] [role=option]")].length > 3'), `${tag}: Enter opens the entry list with every colour`);
  await p.send('Input.insertText', { text: '--danger' });
  await p.settle(150);
  await enterHere(p);
  await h.checkSoon(async () => (await text(p, '.dc-bc-chooser .oc-sdk-trigger-value')) === '--danger', `${tag}: a later colour, --danger, is chosen from the keyboard`);
  await pressEnter(p, '.dc-bc-on .oc-sdk-btn');
  await h.checkSoon(async () => (await text(p, '.dc-bc-card .dc-pop-snippet')) === '--danger' && (await p.guest('return doc.activeElement?.tagName')) === 'TEXTAREA', `${tag}: Write comment opens the card on --danger with focus in it`);
  await p.shot(`${tag}-5b-keyboard-entry`);
  await escapeCloses('keyboard entry');

  // ---- the board reloads (an agent turn), then the scheme switches: the pins come back on their entries
  await p.host(`${FAKE}.systems.redrawScreens('harbor')`);
  await p.settle(900);
  // Bring the Button entry into the frame's view: its pin (1) shows only once the reloaded board has told where it is.
  const onButton = async () => (await entryInFrame(h, 'component:button')) !== null && (await shownPins(p)).includes('1');
  await h.checkSoon(onButton, `${tag}: after a reload pin 1 is on the Button entry again`);
  await p.host(`window.__host.setTheme(${JSON.stringify(theme === 'dark' ? 'light' : 'dark')})`);
  await p.settle(900);
  await h.checkSoon(onButton, `${tag}: after a scheme switch it is back too`);
  await p.shot(`${tag}-6-scheme`);

  // ---- a damaged file with nothing readable: the banner shows, however the list is folded (browser test #1)
  await p.host(`${FAKE}.systemComments.seed('harbor', [], true)`);
  const bannerSeen = () => p.guest('const b = doc.querySelector(".dc-bc-damaged .dc-banner"); if (!b) return false; const r = b.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= win.innerHeight');
  await h.checkSoon(bannerSeen, `${tag}: the damaged banner is on screen with no comment readable`);
  h.check((await text(p, '.dc-bc-count')) === 'File damaged', `${tag}: the head says the file is damaged, not "None yet"`);
  await p.shot(`${tag}-7-damaged-empty`);
  if ((await p.guest('return doc.querySelector(".dc-bc-headbtn").getAttribute("aria-expanded")')) === 'true') await p.click('.dc-bc-headbtn');
  await h.checkSoon(bannerSeen, `${tag}: folded, the banner still shows`);
  await p.close();
};

/** Once: loading, a failed load and Try again, the damaged banner, the empty list, a failed send. */
const states = async (h) => {
  const tag = 'syscomments-states';
  const p = await h.openPage({ width: 1400, height: 860, surface: 'page', theme: 'dark', label: tag });
  console.log(tag);
  await h.listReady(p);
  await p.host(`${FAKE}.route('GET /systems/:id/comments', { body: { comments: [] }, delayMs: 2500 })`);
  await p.click('.dc-library-bar .oc-sdk-btn', { text: 'Design systems' });
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the list is up`);
  await p.click('.dc-sys[data-id="harbor"] .dc-sys-main');
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-bc .dc-loading")'), `${tag}: loading says so`);
  await p.shot(`${tag}-1-loading`);
  await h.checkSoon(async () => (await text(p, '.dc-bc-empty')).startsWith('No comments yet'), `${tag}: an empty list says how to add one`);
  await p.shot(`${tag}-2-empty`);

  await p.host(`${FAKE}.route('GET /systems/:id/comments', { status: 500, body: { error: 'internal', message: 'The comments file couldn’t be read.' } })`);
  await p.click('.dc-syspg-top .oc-sdk-btn', { text: 'Design systems' });
  await p.click('.dc-sys[data-id="harbor"] .dc-sys-main');
  await h.checkSoon(async () => (await text(p, '.dc-bc')).includes('Comments didn’t load'), `${tag}: a failed load says so`);
  await p.shot(`${tag}-3-error`);
  await p.host(`${FAKE}.clearRoutes()`);
  await p.click('.dc-bc .oc-sdk-btn', { text: 'Try again' });
  await h.checkSoon(async () => (await listRows(p)).length === 3, `${tag}: Try again loads the comments`);

  await p.host(`${FAKE}.systemComments.seed('harbor', ${JSON.stringify([{ id: 'c_saved01', entry: 'component:button', body: 'Kept from the damaged file.', status: 'open', created: '2026-11-27T09:00:00.000Z', sentAt: null }])}, true)`);
  await h.checkSoon(async () => (await text(p, '.dc-bc')).includes('Some comments couldn’t be read'), `${tag}: the comments event brings the damaged banner`);
  await p.shot(`${tag}-4-damaged`);

  await p.host(`${FAKE}.route('POST /systems/:id/prompt', { status: 500, body: { error: 'internal', message: 'The service stopped answering.' } })`);
  await p.click('.dc-bc-foot .oc-sdk-btn', { text: 'Send comments' });
  await h.checkSoon(async () => (await text(p, '.dc-bc-foot .dc-form-error')).includes('Your comments are still here'), `${tag}: a failed send says so and keeps the comments`);
  h.check((await current(p, 'harbor')).every((entry) => entry.status === 'open'), `${tag}: nothing was marked sent`);
  await p.shot(`${tag}-5-send-failed`);
  await p.close();
};

export const run = async (h) => {
  const only = process.env.DC_SYSCOMMENTS_ONLY ? new RegExp(process.env.DC_SYSCOMMENTS_ONLY) : null;
  for (const theme of ['dark', 'light']) {
    for (const [surface, width] of [['panel', 320], ['panel', 480], ['page', 1400]]) {
      if (only && !only.test(`${surfaceName(surface)}-${width}-${theme}`)) continue;
      await flow(h, surface, width, theme);
    }
  }
  if (!only || only.test('states')) await states(h);
};
