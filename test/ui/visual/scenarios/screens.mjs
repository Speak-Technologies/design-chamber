// Visual scenario for screen management (Phase 2 feature 10, U3): page 1400 and rail 320 and 480, dark and light.
// Per variant, on the coffee canvas (three screens, linked to the chat): the "+ Screen" board and the ⋯ button on
// each row's first label; the screen menu (Duplicate, Move up, Move down, Move to trash, Try 3 directions…) with a
// disabled reason inside the option and the arrow keys still reaching it; the agent-working hint; the "+ Screen" box
// (counter, sending, failed with the words kept, sent); Move up with its notice and Undo; Duplicate; Move to trash
// and the drawer's "Screen removed" group; the cap (no board, the foot note); and, on the page only, dragging a label
// (the chip, the line, Escape, drop). The fake backend answers the three screen ops in memory.
// DC_SCREENS_ONLY=<tag regex> limits the variants while iterating.

const VARIANTS = [
  ['page', 1400, 'dark'],
  ['page', 1400, 'light'],
  ['rail', 320, 'dark'],
  ['rail', 320, 'light'],
  ['rail', 480, 'dark'],
  ['rail', 480, 'light'],
];

const SLUG = 'coffee-subscription';
const MENU = '.dc-popup[role="menu"]';
const BOX = '.dc-ask-pop';

export const run = async (helpers) => {
  const { openPage, check, checkSoon, listReady, thumbsReady, wallReady, sleep } = helpers;
  const only = process.env.DC_SCREENS_ONLY ? new RegExp(process.env.DC_SCREENS_ONLY) : null;

  for (const [kind, width, theme] of VARIANTS) {
    const tag = `${kind}-${width}-${theme}-screens`;
    if (only && !only.test(tag)) continue;
    console.log(tag);
    const rail = kind === 'rail';
    const p = await openPage({ width, height: rail ? 780 : 900, surface: rail ? 'panel' : 'page', theme, label: tag });

    // The coffee design is linked to this chat, so an ask goes straight to it.
    await p.send('Page.navigate', { url: `${await p.host('location.href')}&session=ses_coffee` });
    await sleep(700);
    await p.waitFor('return !!doc.querySelector(".dc-app")', 'the app to mount');
    await listReady(p);
    await thumbsReady(p);
    await p.click(rail ? `.dc-row[data-slug="${SLUG}"] .dc-row-main` : `.dc-card[data-slug="${SLUG}"] .dc-card-main`);
    await wallReady(p, rail ? 2 : 6);
    await p.settle(700);

    const q = (selector) => JSON.stringify(selector);
    const text = (selector) => p.guest(`return doc.querySelector(${q(selector)})?.textContent?.trim() ?? null`);
    const visible = (selector) => p.guest(`const n = doc.querySelector(${q(selector)}); return !!n && !n.hidden && n.getClientRects().length > 0`);
    const attr = (selector, name) => p.guest(`return doc.querySelector(${q(selector)})?.getAttribute(${q(name)}) ?? null`);
    const noOverflow = () => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');
    const prompts = async () => JSON.parse(await p.host('JSON.stringify(window.__host.prompts)'));
    const menuButton = (title) => `.dc-label-menu[aria-label="Actions for screen ${title}"]`;
    /** Screen ids top to bottom, read from where the first-viewport boards sit. */
    const order = () =>
      p.guest(`return [...doc.querySelectorAll('.dc-board[data-board$="@laptop"]')].map((n) => [n.getBoundingClientRect().top, n.dataset.board.split('@')[0]]).sort((a, b) => a[0] - b[0]).map((e) => e[1]).join(',')`);
    const noticeText = () => text('.dc-notices .oc-sdk-banner-title');
    const reasonOf = (id) => p.guest(`const row = doc.querySelector('${MENU} [role=menuitem][id$="-${id}"]'); return row?.querySelector('.dc-menu-reason')?.textContent ?? null`);

    /** On screen: shown, and inside the wall's box (a ⋯ button can be shown and still be off the stage). */
    const onStage = (selector) =>
      p.guest(`const n = doc.querySelector(${q(selector)}); const w = doc.querySelector('.dc-wall').getBoundingClientRect(); if (!n || n.hidden || !n.getClientRects().length) return false; const r = n.getBoundingClientRect(); return r.left >= w.left && r.right <= w.right && r.top >= w.top && r.bottom <= w.bottom`);
    /** A box without `rect`'s scrollIntoView, which would scroll the wall's overflow-hidden stage out from under its labels. */
    const box = (selector) =>
      p.guest(`const n = doc.querySelector(${q(selector)}); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }`);
    /** Fit everything; when the label is still not on stage (a long canvas hides its labels at that zoom), zoom in on that screen's board. */
    const reach = async (title) => {
      if (await onStage(menuButton(title))) return true;
      await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Fit' });
      await p.settle(250);
      const id = title.toLowerCase().replace(/ /g, '-');
      for (let tries = 0; tries < 14 && !(await onStage(menuButton(title))); tries += 1) {
        const board = await box(`.dc-board[data-board="${id}@laptop"]`);
        if (!board) break;
        // Zooming at a point just above the board (in the gap its label sits in) pushes the board and its label down into view.
        const wall = await box('.dc-wall');
        await p.wheel(board.x + board.w / 2, Math.max(wall.y + 2, board.y - 30), 0, -260, { ctrl: true });
        await p.settle(200);
      }
      return onStage(menuButton(title));
    };
    const openMenuFor = async (title) => {
      // The build strip's pill floats over the top row's label for a few seconds after a turn ("Done"): let it go first.
      await p.waitFor('return (doc.querySelector(".dc-build")?.dataset.phase ?? "hidden") === "hidden"', 'the build strip to clear', 15000).catch(() => undefined);
      check(await reach(title), `${tag}: the ⋯ button of ${title} can be reached`);
      await p.click(menuButton(title));
      await p.waitFor(`return !!doc.querySelector(${q(MENU)})`, `the menu of ${title}`);
    };
    const closeMenu = async () => {
      await p.key('Escape', { focus: MENU });
      await checkSoon(async () => !(await visible(MENU)), `${tag}: Escape closes the menu`);
    };

    // 1. the wall: a ⋯ on each row's first label, and the "+ Screen" board after the last row
    check(await visible('.dc-ghost-add'), `${tag}: the "+ Screen" board is on the wall`);
    check((await text('.dc-ghost-add')) === 'Screen', `${tag}: the board reads "Screen" with its plus`);
    check((await attr('.dc-ghost-add', 'aria-label')) === 'Add a screen', `${tag}: the board has an accessible name`);
    check(
      await p.guest(`const gh = doc.querySelector('.dc-ghost-add').getBoundingClientRect(); const last = [...doc.querySelectorAll('.dc-board[data-board]')].map((n) => n.getBoundingClientRect().bottom); return gh.top >= Math.max(...last) - 1`),
      `${tag}: it sits below the last row`,
    );
    check((await p.guest(`return doc.querySelectorAll('.dc-label-menu:not([hidden])').length`)) === 3, `${tag}: one ⋯ per screen, on the first label of its row (not per viewport)`);
    check(await noOverflow(), `${tag}: no horizontal overflow`);
    await p.shot(`${tag}-1-wall`);

    // 2. the menu of the middle screen: five entries, text only, Move to trash and Try 3 directions apart
    await openMenuFor('Pricing');
    const entries = await p.guest(`return [...doc.querySelectorAll('${MENU} [role=menuitem]')].map((n) => n.querySelector('.oc-sdk-option-label').textContent).join('|')`);
    check(entries === 'Duplicate|Move up|Move down|Move to trash|Try 3 directions…', `${tag}: the menu lists Duplicate, Move up, Move down, Move to trash, Try 3 directions… (${entries})`);
    check(!(await p.guest(`return !!doc.querySelector('${MENU} svg')`)), `${tag}: the entries are text only`);
    check(await p.guest(`return doc.querySelectorAll('${MENU} [aria-disabled=true]').length === 0`), `${tag}: nothing is off for a middle screen`);
    check(!(await visible('.dc-menu-note')), `${tag}: no note lines while the agent is idle and the canvas is under the cap`);
    check(await p.guest(`const m = doc.querySelector(${q(MENU)}).getBoundingClientRect(); return m.left >= 0 && m.right <= window.innerWidth && m.top >= 0 && m.bottom <= window.innerHeight`), `${tag}: the menu stays inside the window`);
    await p.shot(`${tag}-2-menu`);
    await closeMenu();
    check(await p.guest(`return doc.activeElement === doc.querySelector(${q(menuButton('Pricing'))})`), `${tag}: focus goes back to the ⋯ button`);

    // 3. the last screen: Move down says why inside the option; the arrow keys reach it; Enter does nothing
    await openMenuFor('Checkout');
    check(await p.guest(`return doc.querySelector('${MENU} [role=menuitem][id$="-down"]').getAttribute('aria-disabled') === 'true'`), `${tag}: Move down is aria-disabled on the last screen`);
    check((await reasonOf('down')) === 'This is the last screen.', `${tag}: its reason is inside the option ("${await reasonOf('down')}")`);
    check(
      await p.guest(`const row = doc.querySelector('${MENU} [role=menuitem][id$="-down"]'); const reason = row.querySelector('.dc-menu-reason'); return row.getAttribute('aria-describedby') === reason.id && !row.disabled`),
      `${tag}: the option names its reason with aria-describedby and is not natively disabled`,
    );
    await p.key('ArrowDown', { focus: MENU }); // up (first live row) -> down
    await p.key('ArrowDown', { focus: MENU });
    check(await p.guest(`return doc.querySelector(${q(MENU)}).getAttribute('aria-activedescendant')?.endsWith('-down') ?? false`), `${tag}: the arrow keys reach the disabled option`);
    await p.shot(`${tag}-3-menu-last`);
    await p.key('Enter', { focus: MENU });
    check(await visible(MENU), `${tag}: Enter on it does nothing and the menu stays open`);
    check((await order()) === 'home,pricing,checkout', `${tag}: nothing moved`);
    await p.click(`${MENU} [role=menuitem]`, { text: 'Move down' });
    check(await visible(MENU), `${tag}: a click on it does nothing either`);
    await closeMenu();

    // the first screen: Move up says why; Duplicate on a screen with no file says why
    await openMenuFor('Home');
    check((await reasonOf('up')) === 'This is the first screen.', `${tag}: Move up on the first screen says so`);
    await closeMenu();
    await p.guest(`win.__dcFake.unwriteScreen(${q(SLUG)}, 'checkout')`);
    await p.settle(500);
    await openMenuFor('Checkout');
    check((await reasonOf('duplicate')) === 'Nothing to copy until the agent writes this screen.', `${tag}: Duplicate on an unwritten screen says so`);
    check((await reasonOf('trash')) === null, `${tag}: Move to trash still works on it`);
    await p.shot(`${tag}-3b-menu-unwritten`);
    await closeMenu();
    await p.guest(`win.__dcFake.writeFile(${q(SLUG)}, 'screens/checkout.html')`);
    await p.settle(500);

    // 4. the agent is working: its hint is the menu's first line
    await p.host('window.__host.setActivity("ses_coffee", "running")');
    await p.waitFor('return doc.querySelector(".dc-build")?.dataset.phase === "working"', 'the working phase', 8000);
    await openMenuFor('Pricing');
    check((await text('.dc-menu-note[data-kind="lead"]')) === 'The agent is working on this design. It may write over your edit.', `${tag}: the agent-working hint is the menu's lead line`);
    check(await p.guest(`const lead = doc.querySelector('.dc-menu-note[data-kind="lead"]'); const first = doc.querySelector('${MENU} [role=menuitem]'); return lead.getBoundingClientRect().bottom <= first.getBoundingClientRect().top`), `${tag}: it sits above the entries`);
    check(await p.guest(`return doc.querySelector(${q(MENU)}).getAttribute('aria-describedby')?.includes('-lead') ?? false`), `${tag}: the menu names it with aria-describedby`);
    await p.shot(`${tag}-4-menu-working`);
    await closeMenu();
    await p.host('window.__host.setActivity("ses_coffee", "idle")');

    // 5. "+ Screen": the box, the counter, sending, a failure that keeps the words, then sent
    await p.click('.dc-ghost-add');
    await p.waitFor(`return !!doc.querySelector(${q(BOX)})`, 'the "+ Screen" box');
    check((await text(`${BOX} .dc-pop-title`)) === 'What should the new screen show?', `${tag}: the box asks "What should the new screen show?"`);
    check(await p.guest(`return doc.activeElement === doc.querySelector('${BOX} textarea')`), `${tag}: the keyboard is in the box`);
    check(/^Goes to /.test((await text(`${BOX} .dc-pop-hint`)) ?? ''), `${tag}: it says where the message goes ("${await text(`${BOX} .dc-pop-hint`)}")`);
    check(await p.guest(`const b = [...doc.querySelectorAll('${BOX} .oc-sdk-btn')].find((n) => n.textContent.includes('Ask the agent')); return !!b && !b.disabled`), `${tag}: Ask the agent is the one filled action`);
    check(await p.guest(`const r = doc.querySelector(${q(BOX)}).getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight`), `${tag}: the box stays inside the window`);
    check(!(await visible(`${BOX} .dc-pop-count`)), `${tag}: no counter while there is plenty of room`);
    await p.shot(`${tag}-5-new-empty`);
    const words = 'A thank-you screen after checkout, with the invoice number and a link back to the dashboard.';
    await p.type(`${BOX} textarea`, words);
    await p.shot(`${tag}-5-new`);
    // the counter: quiet, then counting down, then over
    await p.type(`${BOX} textarea`, 'a'.repeat(11_700));
    await checkSoon(async () => /^\d+ left$/.test((await text(`${BOX} .dc-pop-count`)) ?? ''), `${tag}: the counter shows near the limit`);
    await p.shot(`${tag}-5-new-counter`);
    await p.type(`${BOX} textarea`, 'a'.repeat(12_100));
    await checkSoon(async () => /^\d+ over$/.test((await text(`${BOX} .dc-pop-count`)) ?? ''), `${tag}: past the limit it says by how many`);
    check(await p.guest(`const b = [...doc.querySelectorAll('${BOX} .oc-sdk-btn')].find((n) => n.textContent.includes('Ask the agent')); return b.disabled`), `${tag}: Ask the agent is off over the limit`);
    await p.shot(`${tag}-5-new-over`);
    await p.type(`${BOX} textarea`, words);
    // a send that fails: spinner and read-only while it runs, then the sentence with the words kept
    await p.route('POST /designs/:slug/prompt', { status: 500, delayMs: 1500, body: { error: 'internal', message: "The local service didn't answer." } });
    await p.click(`${BOX} .oc-sdk-btn`, { text: 'Ask the agent' });
    await p.settle(350);
    check(await p.guest(`return doc.querySelector('${BOX} textarea').readOnly === true`), `${tag}: the words are read-only while sending`);
    check(await p.guest(`return doc.querySelector('${BOX} .oc-sdk-btn[data-emphasis=primary]').getAttribute('aria-busy') === 'true'`), `${tag}: the button shows it is busy`);
    await p.shot(`${tag}-5-new-sending`);
    await checkSoon(async () => (await text(`${BOX} .dc-form-error`)) === "Couldn't send. The local service didn't answer. Your message is still here.", `${tag}: a failure says what happened and that the message is still there`);
    check((await p.guest(`return doc.querySelector('${BOX} textarea').value`)) === words, `${tag}: the typed words are kept`);
    check(await p.guest(`return !doc.querySelector('${BOX} .oc-sdk-btn[data-emphasis=primary]').disabled`), `${tag}: Ask the agent is ready again`);
    await p.shot(`${tag}-5-new-failed`);
    // Escape cancels and puts the keyboard back on the board
    await p.key('Escape', { focus: `${BOX} textarea` });
    await checkSoon(async () => !(await visible(BOX)), `${tag}: Escape closes the box`);
    check((await prompts()).length === 0, `${tag}: nothing was sent by a failed send or a cancel`);
    // and sent
    await p.clearRoutes();
    await p.click('.dc-ghost-add');
    await p.waitFor(`return !!doc.querySelector(${q(BOX)})`, 'the box again');
    await p.type(`${BOX} textarea`, words);
    await p.click(`${BOX} .oc-sdk-btn`, { text: 'Ask the agent' });
    await checkSoon(async () => !(await visible(BOX)), `${tag}: a sent ask closes the box`);
    const sent = (await prompts()).map((entry) => entry.text ?? '');
    check(sent.length === 1 && sent[0].includes('Add a new screen to the canvas "Coffee subscription" after "Checkout"') && sent[0].includes(words), `${tag}: the request names the canvas, the screen to follow and the words`);
    check((await order()) === 'home,pricing,checkout', `${tag}: asking writes nothing to the design`);

    // 6. Move up: the notice with Undo, the wall re-laid out, then Undo
    await openMenuFor('Checkout');
    await p.click(`${MENU} [role=menuitem]`, { text: 'Move up' });
    await checkSoon(async () => (await order()) === 'home,checkout,pricing', `${tag}: Move up puts Checkout above Pricing`);
    await checkSoon(async () => /^Moved /.test((await noticeText()) ?? ''), `${tag}: the notice says what moved ("${await noticeText()}")`);
    check(await p.guest(`return [...doc.querySelectorAll('.dc-notices .dc-edit-notice .oc-sdk-btn')].some((b) => b.textContent.trim() === 'Undo')`), `${tag}: the notice offers Undo`);
    check(await p.guest(`return doc.querySelector('.dc-notices').getAttribute('aria-live') === 'polite'`), `${tag}: the notice sits in the live region`);
    await p.shot(`${tag}-6-moved`);
    await p.click('.dc-notices .dc-edit-notice .oc-sdk-btn', { text: 'Undo' });
    await checkSoon(async () => (await order()) === 'home,pricing,checkout', `${tag}: Undo puts the order back`);
    await checkSoon(async () => (await noticeText()) === 'Undone', `${tag}: Undone is announced`);

    // 7. Duplicate
    await openMenuFor('Home');
    await p.click(`${MENU} [role=menuitem]`, { text: 'Duplicate' });
    await checkSoon(async () => (await order()) === 'home,home-copy,pricing,checkout', `${tag}: the copy sits right after the original (${await order()})`);
    await checkSoon(async () => (await noticeText()) === 'Duplicated Home', `${tag}: the notice says "Duplicated Home"`);
    check(await visible(menuButton('Home copy')) || (await reach('Home copy')), `${tag}: the copy has its own ⋯`);
    await p.shot(`${tag}-7-duplicated`);
    await p.click('.dc-notices .dc-edit-notice .oc-sdk-btn', { text: 'Undo' });
    await checkSoon(async () => (await order()) === 'home,pricing,checkout', `${tag}: Undo removes the copy`);

    // 8. Move to trash, Undo, and again; its comments stay in the drawer under "Screen removed"
    await openMenuFor('Pricing');
    await p.click(`${MENU} [role=menuitem]`, { text: 'Move to trash' });
    await checkSoon(async () => (await order()) === 'home,checkout', `${tag}: the screen leaves the wall`);
    await checkSoon(async () => (await noticeText()) === 'Moved Pricing to trash', `${tag}: the notice says "Moved Pricing to trash"`);
    check(await visible('.dc-ghost-add'), `${tag}: the "+ Screen" board is still there`);
    await p.click('.dc-notices .dc-edit-notice .oc-sdk-btn', { text: 'Undo' });
    await checkSoon(async () => (await order()) === 'home,pricing,checkout', `${tag}: Undo brings it back`);
    await openMenuFor('Pricing');
    await p.click(`${MENU} [role=menuitem]`, { text: 'Move to trash' });
    await checkSoon(async () => (await order()) === 'home,checkout', `${tag}: trashed again`);
    await p.click(rail ? '.dc-compact-actions .dc-comments-chip' : '.dc-toolbar .oc-sdk-btn', rail ? {} : { text: 'Comments' });
    await p.waitFor('return !!doc.querySelector(".dc-comments .dc-comment-group[data-removed=true]")', 'the Screen removed group');
    check((await text('.dc-comment-group[data-removed=true] .dc-group-title')) === 'pricing · Screen removed2'.replace('removed2', 'removed1'), `${tag}: the comment on it is grouped as "pricing · Screen removed"`);
    check(await p.guest(`return doc.querySelector('.dc-comment-group[data-removed=true] .dc-comment-main').disabled`), `${tag}: that comment has no pin to show, so its row does not pretend to`);
    await p.shot(`${tag}-8-removed`);

    if (!rail) {
      // 9. dragging a label (full-screen page only)
      await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Comments' }); // close the drawer
      await p.click('.dc-notices .dc-edit-notice .oc-sdk-btn', { text: 'Undo' }).catch(() => undefined);
      await checkSoon(async () => (await order()) === 'home,pricing,checkout', `${tag}: trash undone for the drag`);
      await p.settle(400);
      const drag = async (from, toY, { drop }) => {
        const label = await p.rect('.dc-label[data-draggable="true"] .dc-label-text', 0, from);
        const downX = label.x + 20;
        const downY = label.y + label.h / 2;
        await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: downX, y: downY });
        await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: downX, y: downY, button: 'left', buttons: 1, clickCount: 1 });
        for (let step = 1; step <= 6; step += 1) {
          await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: downX + step * 4, y: downY + ((toY - downY) * step) / 6, button: 'left', buttons: 1 });
        }
        await p.settle(150);
        if (!drop) return { x: downX + 24, y: toY };
        await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: downX + 24, y: toY, button: 'left', buttons: 0, clickCount: 1 });
        return null;
      };
      const pricing = await p.rect('.dc-board[data-board="pricing@laptop"]');
      check((await p.guest(`return doc.querySelectorAll('.dc-label[data-draggable="true"]').length`)) === 3, `${tag}: the first labels are draggable in Edit mode`);
      const held = await drag('Checkout', pricing.y + 8, { drop: false });
      check(await visible('.dc-drag-chip'), `${tag}: a chip follows the pointer`);
      check((await text('.dc-drag-chip')).includes('Checkout'), `${tag}: it names the screen`);
      check(await p.guest(`const l = doc.querySelector('.dc-drop'); return !!l && !l.hidden`), `${tag}: a line shows where it would land`);
      check(await p.guest(`const l = doc.querySelector('.dc-drop').getBoundingClientRect(); const a = doc.querySelector('.dc-board[data-board="home@laptop"]').getBoundingClientRect(); const b = doc.querySelector('.dc-board[data-board="pricing@laptop"]').getBoundingClientRect(); return l.top > a.bottom && l.top < b.top`), `${tag}: the line sits between Home and Pricing`);
      await p.shot(`${tag}-9-drag`);
      await p.key('Escape');
      await checkSoon(async () => !(await visible('.dc-drag-chip')), `${tag}: Escape cancels the drag`);
      await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: held.x, y: held.y, button: 'left', buttons: 0, clickCount: 1 });
      await p.settle(400);
      check((await order()) === 'home,pricing,checkout', `${tag}: nothing changed after Escape`);
      await drag('Checkout', pricing.y + 8, { drop: true });
      await checkSoon(async () => (await order()) === 'home,checkout,pricing', `${tag}: dropping puts Checkout above Pricing`);
      await checkSoon(async () => /^Moved /.test((await noticeText()) ?? ''), `${tag}: a drop says what moved`);
      await p.shot(`${tag}-9-dropped`);
      await p.click('.dc-notices .dc-edit-notice .oc-sdk-btn', { text: 'Undo' });
      await checkSoon(async () => (await order()) === 'home,pricing,checkout', `${tag}: Undo puts it back`);
      // a click on a label without movement is not a drag: the double-click still focuses the board
      const homeLabel = await p.rect('.dc-label[data-draggable="true"] .dc-label-text', 0, 'Home');
      await p.clickAt(homeLabel.x + 20, homeLabel.y + homeLabel.h / 2);
      await p.settle(200);
      check(!(await visible('.dc-drag-chip')), `${tag}: a plain click on a label starts no drag`);
    } else {
      // the rail does not drag: a press and a move on a label starts nothing
      await p.click('.dc-iconbtn[aria-label^="Close"]').catch(() => undefined);
      await p.settle(300);
      const label = await p.rect('.dc-label-text', 0, 'Home');
      if (label) {
        await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: label.x + 10, y: label.y + 6 });
        await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: label.x + 10, y: label.y + 6, button: 'left', buttons: 1, clickCount: 1 });
        for (let step = 1; step <= 5; step += 1) await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: label.x + 10, y: label.y + 6 + step * 14, button: 'left', buttons: 1 });
        check(!(await visible('.dc-drag-chip')), `${tag}: the rail's labels are not draggable`);
        await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: label.x + 10, y: label.y + 76, button: 'left', buttons: 0, clickCount: 1 });
      }
      check((await p.guest(`return doc.querySelectorAll('.dc-label[data-draggable="true"]').length`)) === 0, `${tag}: no label is marked draggable on the rail`);
    }

    // 10. the cap: no "+ Screen" board, and the foot note says why Duplicate and Try 3 directions are off
    await p.guest(`win.__dcFake.padScreens(${q(SLUG)}, 40)`);
    await p.settle(700);
    check(!(await visible('.dc-ghost-add')), `${tag}: at 40 screens the "+ Screen" board is gone`);
    // 40 screens do not fit the stage at the lowest zoom: take the one nearest the middle of what is shown.
    const middle = await p.guest(`const w = doc.querySelector('.dc-wall').getBoundingClientRect(); const c = (w.top + w.bottom) / 2; const ids = [...doc.querySelectorAll('.dc-board[data-board$="@laptop"]')].map((n) => [Math.abs(n.getBoundingClientRect().top - c), n.dataset.board.split('@')[0]]).sort((a, b) => a[0] - b[0]); return ids[0][1]`);
    const middleTitle = middle.replace(/^extra-(\d+)$/, 'Extra $1').replace(/^./, (c) => c.toUpperCase());
    await openMenuFor(middleTitle);
    check((await text('.dc-menu-note[data-kind="foot"]')) === 'A canvas holds up to 40 screens.', `${tag}: the foot note says "A canvas holds up to 40 screens."`);
    check(await p.guest(`const row = doc.querySelector('${MENU} [role=menuitem][id$="-duplicate"]'); const foot = doc.querySelector('.dc-menu-note[data-kind="foot"]'); return row.disabled && row.getAttribute('aria-describedby') === foot.id`), `${tag}: Duplicate is off and names the foot note`);
    check(await p.guest(`const row = doc.querySelector('${MENU} [role=menuitem][id$="-directions"]'); return row.disabled && !row.querySelector('.dc-menu-reason')`), `${tag}: so is Try 3 directions, with no reason of its own`);
    check((await p.guest(`return doc.querySelectorAll('${MENU} .dc-menu-reason').length`)) === 0, `${tag}: the cap is said once, in the foot note, not in each option`);
    await p.shot(`${tag}-10-cap`);
    await closeMenu();
    check(await noOverflow(), `${tag}: no horizontal overflow at the end`);
    await p.close();
  }
};
