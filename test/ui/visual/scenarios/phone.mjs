// Visual scenario for the phone shell (documentation/specs/native-extras.md §2.2, U3) on a 390 x 844 phone, dark
// and light: the full-screen page on a phone is the rail app (list, a canvas, a page, Settings), with no footer
// hint and no first-run tip, at most two live frames, and no Reveal, Export or Copy path in its menus; the
// on-screen keyboard lifts the content and the sheets above it. The phone's panel tab keeps a hint and a tip in
// the phone's words. A desktop rail (no device) keeps every entry: the main rail and page walks in shoot.mjs
// shoot the desktop unchanged. The keyboard part at the end is a 375 x 667 phone (and 390 x 844) with the comment
// card or the text box open: the text box and its buttons stay on screen above the keyboard.

const CANVAS = 'coffee-subscription';
const PAGE = 'northwind-pricing';
const COMPUTER_ONLY = ['Reveal in folder', 'Export ZIP', 'Export single-file HTML', 'Export screen as HTML…', 'Copy path'];

const menuLabels = (p) => p.guest('return [...doc.querySelectorAll(".dc-popup [role=\\"menuitem\\"]")].map((n) => n.querySelector(".oc-sdk-option-label")?.textContent ?? "")');
const closeMenu = async (p) => {
  await p.key('Escape');
  await p.waitFor('return !doc.querySelector(".dc-popup")', 'the menu to close', 4000);
};
const back = async (p, listReady) => {
  await p.click('.dc-toolbar-compact .dc-iconbtn[aria-label="Back to designs"]');
  await listReady(p);
};

// A short phone with no home indicator (375 x 667), and the tall one with a tall keyboard (390 x 844).
const SHORT = { width: 375, height: 667, device: { formFactor: 'phone', pointer: 'coarse', insets: { top: 0, right: 0, bottom: 0, left: 0 }, keyboard: 0 } };

/** The comment card, the text box and the header buttons with the keyboard up. */
const keyboardCases = async ({ PHONE, openPage, check, checkSoon, listReady, thumbsReady, wallReady }, theme) => {
  for (const { name, size, surface, keyboards } of [
    { name: 'phone-375-panel', size: SHORT, surface: 'panel', keyboards: [260, 300] },
    { name: 'phone-375-page', size: SHORT, surface: 'page', keyboards: [260, 300] },
    { name: 'phone-390-page', size: PHONE, surface: 'page', keyboards: [320] },
  ]) {
    const tag = `${name}-${theme}-keyboard`;
    const p = await openPage({ ...size, surface, theme, label: tag });
    console.log(tag);
    await listReady(p);
    await thumbsReady(p);
    const keyboard = async (px) => {
      await p.host(`window.__host.setDevice(${JSON.stringify({ ...size.device, keyboard: px })})`);
      await p.settle(700);
    };
    const shown = (selector) => p.guest(`const n = doc.querySelector(${JSON.stringify(selector)}); return !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden'`);
    /** Whole, above the keyboard, and what a finger in its middle would land on. */
    const usable = (code, px) =>
      p.guest(`const n = ${code}; if (!n) return 'missing'; const r = n.getBoundingClientRect(); const w = doc.querySelector('.dc-wall').getBoundingClientRect();
        if (r.height < 28 || r.top < w.top - 1 || r.bottom > w.bottom + 1 || r.bottom > win.innerHeight - ${px} + 1) return 'cut ' + JSON.stringify([Math.round(r.top), Math.round(r.bottom), Math.round(w.top), Math.round(w.bottom), win.innerHeight - ${px}]);
        const hit = doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        // A disabled button (a thread's Save before any edit) lets the press through to its own row.
        return hit === n || n.contains(hit) || (n.disabled && hit === n.parentElement) ? 'ok' : 'covered by ' + (hit?.className ?? 'nothing')`);
    const button = (card, label) => `[...doc.querySelectorAll('${card} button')].find((b) => b.textContent.trim() === '${label}')`;
    const inside = async (px, when, card, labels) => {
      const area = await usable(`doc.querySelector('${card} textarea')`, px);
      check(area === 'ok', `${tag}: ${when}, the text box is on screen (${area})`);
      for (const label of labels) {
        const state = await usable(button(card, label), px);
        check(state === 'ok', `${tag}: ${when}, ${label} is on screen (${state})`);
      }
    };

    await p.click(`.dc-row[data-slug="${CANVAS}"] .dc-row-main`);
    await wallReady(p, 1);
    await p.settle(1200);

    // Header buttons: a finger 21 px from the middle, any way, still lands on them.
    for (const selector of ['.dc-checks-badge', '.dc-system-btn']) {
      const reach = await p.guest(`const n = doc.querySelector('${selector}'); if (!n || !n.getClientRects().length) return 'missing'; const r = n.getBoundingClientRect(); const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
        return [[0, -21], [0, 21], [-21, 0], [21, 0]].filter(([dx, dy]) => { const hit = doc.elementFromPoint(x + dx, y + dy); return !(hit === n || n.contains(hit)); }).map(([dx, dy]) => dx + ',' + dy).join(' ') || 'ok'`);
      check(reach === 'ok', `${tag}: ${selector} takes a 44 px tap (${reach})`);
    }
    check(await p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth'), `${tag}: no horizontal overflow`);
    const fitTitle = await p.guest('return [...doc.querySelectorAll("button")].find((b) => b.textContent.trim() === "Fit")?.title ?? null');
    check(fitTitle === 'Fit everything on screen', `${tag}: the Fit tooltip names no shortcut (${fitTitle})`);

    // A tap on a loaded screen opens the comment card. A few points, since one can fall between elements or off the wall.
    const board = '.dc-board[data-state="ready"][data-board$="@laptop"] .dc-frame';
    for (const [fx, fy] of [[0.3, 0.3], [0.15, 0.45], [0.5, 0.2], [0.8, 0.3], [0.2, 0.7], [0.85, 0.75], [0.6, 0.6]]) {
      const [frame, wall] = [await p.rect(board), await p.rect('.dc-wall')];
      const [x, y] = [frame.x + frame.w * fx, frame.y + frame.h * fy];
      if (y > wall.y + wall.h - 8 || y < wall.y + 8) continue;
      // A pin takes a tap that lands near it (a finger is wide), and opens its thread; the last part checks that.
      if (await p.guest(`return [...doc.querySelectorAll('.dc-pin')].some((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && Math.hypot(r.left + r.width / 2 - ${x}, r.top + r.height / 2 - ${y}) < 34; })`)) continue;
      await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0 }] });
      await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await p.settle(500);
      if (await shown('.dc-composer')) break;
    }
    await p.waitFor('return !!doc.querySelector(".dc-composer")', 'the comment card');
    await p.settle(300);
    check(await shown('.dc-bottom-dock'), `${tag}: with the keyboard down the ask bar stays`);

    for (const px of keyboards) {
      await keyboard(px);
      await inside(px, `keyboard ${px}`, '.dc-composer', ['Cancel', 'Add comment']);
      check(!(await shown('.dc-bottom-dock')) && !(await shown('.dc-hint')), `${tag}: keyboard ${px}, the ask bar and the footer give the card their room`);
      // The heading and the quote are either whole or put away, never cut.
      const heading = await p.guest(`const w = doc.querySelector('.dc-wall').getBoundingClientRect(); return ['.dc-composer .dc-pop-head', '.dc-composer .dc-pop-snippet'].every((s) => { const n = doc.querySelector(s); if (!n || !n.getClientRects().length) return true; const r = n.getBoundingClientRect(); return r.top >= w.top - 1 && r.bottom <= w.bottom + 1; })`);
      check(heading, `${tag}: keyboard ${px}, the heading and quote are whole or put away`);
      if (size === PHONE) check((await shown('.dc-composer .dc-pop-head')) && (await shown('.dc-composer .dc-pop-snippet')), `${tag}: keyboard ${px}, a tall phone has room to keep them`);
      await p.shot(`${tag}-${px}-card`);
    }
    await p.type('.dc-composer textarea', 'Typed above the keyboard');
    await p.settle(400);
    await inside(keyboards.at(-1), 'while typing', '.dc-composer', ['Cancel', 'Add comment']);
    await keyboard(0);
    check((await shown('.dc-bottom-dock')) && (await p.guest('return doc.querySelector(".dc-composer textarea")?.value')) === 'Typed above the keyboard', `${tag}: the keyboard goes and the ask bar is back, the words kept`);

    // The ask bar stays when the keyboard is up for the ask bar itself.
    await p.guest('doc.querySelector(".dc-ask-input").focus(); return true');
    await keyboard(keyboards[0]);
    check(await shown('.dc-ask-input'), `${tag}: typing in the ask bar keeps it, card open or not`);
    await keyboard(0);

    // A pin's thread, the same way.
    await p.click('.dc-composer .oc-sdk-btn', { text: 'Cancel' });
    await checkSoon(() => p.guest('return !doc.querySelector(".dc-composer")'), `${tag}: Cancel closes the card`);
    const pin = await p.rect('.dc-pin:not(.dc-temp-pin):not(.dc-pin-cluster)');
    if (pin) {
      await p.clickAt(pin.x + pin.w / 2, pin.y + pin.h / 2);
      await p.waitFor('return !!doc.querySelector(".dc-thread")', 'the thread');
      const px = keyboards.at(-1);
      await keyboard(px);
      await inside(px, `a pin's thread, keyboard ${px}`, '.dc-thread', ['Save']);
      check(await shown('.dc-thread [aria-label="Close comment"]'), `${tag}: the thread keeps its close button`);
      await p.shot(`${tag}-${px}-thread`);
      await p.click('.dc-thread [aria-label="Close comment"]');
      await keyboard(0);
    }
    await p.close();

    // A page: the keyboard resizes the design under the card, which must not take the card with it.
    const q = await openPage({ ...size, surface, theme, label: `${tag}-page-design` });
    await listReady(q);
    await thumbsReady(q);
    await q.click(`.dc-row[data-slug="${PAGE}"] .dc-row-main`);
    await wallReady(q, 1);
    await q.settle(900);
    await q.guest(`[...doc.querySelectorAll('button')].find((n) => n.textContent.trim() === 'Comment').dataset.keyboardTarget = 'comment'; return true`);
    await q.click('[data-keyboard-target="comment"]', { wait: 500 });
    const frame = await q.rect('.dc-board .dc-frame');
    await q.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: frame.x + 60, y: frame.y + 40, id: 0 }] });
    await q.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await q.waitFor('return !!doc.querySelector(".dc-composer")', 'the comment card on a page');
    await q.settle(400);
    for (const px of keyboards) {
      await q.host(`window.__host.setDevice(${JSON.stringify({ ...size.device, keyboard: px })})`);
      await q.settle(900);
      const states = await q.guest(`const w = doc.querySelector('.dc-wall').getBoundingClientRect(); const c = doc.querySelector('.dc-composer'); if (!c) return 'the card closed';
        return [c.querySelector('textarea'), ...c.querySelectorAll('.dc-pop-foot button')].map((n) => { const r = n.getBoundingClientRect(); return r.top >= w.top - 1 && r.bottom <= w.bottom + 1 && r.bottom <= win.innerHeight - ${px} + 1; }).every(Boolean) ? 'ok' : 'cut'`);
      check(states === 'ok', `${tag}: on a page, keyboard ${px}, the card, its text box and buttons stay (${states})`);
      await q.shot(`${tag}-${px}-page-design`);
    }
    await q.close();
  }
};

export const run = async (helpers) => {
  const { PHONE, openPage, check, listReady, thumbsReady, wallReady } = helpers;
  for (const theme of ['dark', 'light']) {
    // ---------------------------------------------------------------- the phone page (More → Design Chamber)
    {
      const tag = `phone-390-${theme}-page`;
      const p = await openPage({ ...PHONE, surface: 'page', theme, label: tag });
      console.log(tag);
      await listReady(p);
      await thumbsReady(p);
      await p.settle(500);
      check(await p.guest('return doc.querySelector(".dc-app")?.dataset.variant === "phone-page" && doc.documentElement.dataset.dcForm === "phone"'), `${tag}: the page on a phone mounts the rail layout`);
      check(await p.guest('return !doc.querySelector(".dc-card") && doc.querySelectorAll(".dc-row[data-slug]").length >= 5'), `${tag}: rows, not the 1400 px library cards`);
      check(await p.guest('const t = doc.querySelector(".dc-rail-tip"); return !t || t.hidden'), `${tag}: no first-run tip (it is already full screen)`);
      check(await p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth'), `${tag}: no horizontal overflow on the list`);
      check(await p.guest('const b = doc.querySelector(".dc-row-main").getBoundingClientRect(); return b.height >= 44'), `${tag}: a list row is at least 44 px tall`);
      check(await p.guest('const b = doc.querySelector(".dc-rail-head .dc-iconbtn").getBoundingClientRect(); return b.width >= 44 && b.height >= 44'), `${tag}: header icon buttons are 44 px`);
      check((await p.guest('return getComputedStyle(doc.querySelector(".dc-app")).paddingBottom')) === '34px', `${tag}: the page keeps clear of the home indicator (34 px)`);
      await p.shot(`${tag}-1-list`);

      // the row menu
      await p.click(`.dc-row[data-slug="${CANVAS}"] .dc-iconbtn`);
      await p.waitFor('return !!doc.querySelector(".dc-popup")', 'the row menu');
      const rowMenu = await menuLabels(p);
      check(!rowMenu.includes('Reveal in folder') && rowMenu.includes('Rename') && rowMenu.includes('Add to folder…'), `${tag}: the row menu has no Reveal (${rowMenu.join(', ')})`);
      await p.shot(`${tag}-2-row-menu`);
      await closeMenu(p);

      // a canvas
      await p.click(`.dc-row[data-slug="${CANVAS}"] .dc-row-main`);
      await wallReady(p, 1);
      await p.settle(1200);
      check(await p.guest('return !doc.querySelector(".dc-hint")'), `${tag}: no footer hint on the phone page`);
      const live = await p.guest('return [...doc.querySelectorAll(".dc-board")].filter((b) => b.dataset.state && b.dataset.state !== "idle").length');
      check(live <= 2, `${tag}: at most two live frames on a phone (${live})`);
      await p.shot(`${tag}-3-canvas`);
      await p.click('.dc-toolbar-compact .dc-iconbtn[aria-label="More actions"]');
      await p.waitFor('return !!doc.querySelector(".dc-popup")', 'the viewer menu');
      const canvasMenu = await menuLabels(p);
      check(COMPUTER_ONLY.every((label) => !canvasMenu.includes(label)) && canvasMenu.includes('Continue in chat') && canvasMenu.at(-1) === 'Delete…', `${tag}: the canvas menu hides Reveal, Export and Copy path (${canvasMenu.join(', ')})`);
      await p.shot(`${tag}-4-canvas-menu`);
      await closeMenu(p);

      // the on-screen keyboard lifts the view; a new `ready` reapplies it without a remount
      await p.host(`window.__host.setDevice(${JSON.stringify({ ...PHONE.device, keyboard: 300 })})`);
      await p.waitFor('return getComputedStyle(doc.querySelector(".dc-app")).paddingBottom === "334px"', 'the keyboard gap', 4000).catch(() => undefined);
      check((await p.guest('return getComputedStyle(doc.querySelector(".dc-app")).paddingBottom')) === '334px', `${tag}: the keyboard (300 px) and the inset lift the content`);
      check(await p.guest('return !!doc.querySelector(".dc-board")'), `${tag}: the canvas stays open through the keyboard`);
      const dock = await p.guest('const b = doc.querySelector(".dc-bottom-dock"); return b ? Math.round(b.getBoundingClientRect().bottom) : null');
      check(dock === null || dock <= 844 - 334, `${tag}: the ask bar dock ends above the keyboard (${dock})`);
      await p.shot(`${tag}-5-keyboard`);
      await p.host(`window.__host.setDevice(${JSON.stringify(PHONE.device)})`);
      await p.settle(300);
      await back(p, listReady);

      // a page
      await p.click(`.dc-row[data-slug="${PAGE}"] .dc-row-main`);
      await wallReady(p, 1);
      await p.settle(800);
      await p.shot(`${tag}-6-page`);
      await p.click('.dc-toolbar-compact .dc-iconbtn[aria-label="More actions"]');
      await p.waitFor('return !!doc.querySelector(".dc-popup")', 'the viewer menu');
      const pageMenu = await menuLabels(p);
      check(COMPUTER_ONLY.every((label) => !pageMenu.includes(label)) && pageMenu.includes('Copy HTML'), `${tag}: the page menu keeps Copy HTML, hides the rest (${pageMenu.join(', ')})`);
      await p.shot(`${tag}-7-page-menu`);
      await closeMenu(p);
      await back(p, listReady);

      // Settings
      await p.click('.dc-rail-head .dc-iconbtn[aria-label="Settings"]');
      await p.waitFor('return !!doc.querySelector(".dc-settings-where")', 'Settings with the computer line', 8000).catch(() => undefined);
      check((await p.guest('return doc.querySelector(".dc-settings-where")?.textContent ?? ""')) === 'This folder is on the computer that runs OpenChamber.', `${tag}: Settings says where the folder is`);
      check(await p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth'), `${tag}: no horizontal overflow in Settings`);
      await p.settle(300);
      await p.shot(`${tag}-8-settings`);
      await p.close();
    }

    // ---------------------------------------------------------------- the phone's panel tab (workspace drawer)
    {
      const tag = `phone-390-${theme}-panel`;
      const p = await openPage({ ...PHONE, surface: 'panel', theme, label: tag, query: '&tip=1' });
      console.log(tag);
      await listReady(p);
      await thumbsReady(p);
      await p.waitFor('const t = doc.querySelector(".dc-rail-tip"); return !!t && !t.hidden', 'the first-run tip', 6000).catch(() => undefined);
      check((await p.guest('return doc.querySelector(".dc-rail-tip")?.textContent ?? ""')).includes('In your chats list, open More and pick Design Chamber.'), `${tag}: the tip points at the More menu`);
      check((await p.guest('return getComputedStyle(doc.querySelector(".dc-app")).paddingBottom')) === '0px', `${tag}: the drawer tab adds no inset of its own`);
      await p.shot(`${tag}-1-list-tip`);
      await p.click(`.dc-row[data-slug="${CANVAS}"] .dc-row-main`);
      await wallReady(p, 1);
      await p.settle(800);
      check((await p.guest('return doc.querySelector(".dc-hint")?.textContent ?? ""')) === 'Full screen: chats list → More → Design Chamber', `${tag}: the footer hint says where the page is on a phone`);
      await p.shot(`${tag}-2-canvas`);
      await p.close();
    }

    // ---------------------------------------------------------------- a desktop rail keeps everything
    {
      const tag = `rail-320-${theme}-desktop-menus`;
      const p = await openPage({ width: 320, height: 780, surface: 'panel', theme, label: tag });
      console.log(tag);
      await listReady(p);
      await thumbsReady(p);
      await p.click(`.dc-row[data-slug="${CANVAS}"] .dc-row-main`);
      await wallReady(p, 1);
      await p.settle(600);
      check((await p.guest('return doc.querySelector(".dc-hint")?.textContent ?? ""')) === 'Full screen: sidebar → Extension pages → Design Chamber', `${tag}: the desktop hint is unchanged`);
      await p.click('.dc-toolbar-compact .dc-iconbtn[aria-label="More actions"]');
      await p.waitFor('return !!doc.querySelector(".dc-popup")', 'the viewer menu');
      const menu = await menuLabels(p);
      check(['Reveal in folder', 'Export ZIP', 'Copy path'].every((label) => menu.includes(label)), `${tag}: the desktop menu keeps Reveal, Export and Copy path`);
      check(await p.guest('const b = doc.querySelector(".dc-toolbar-compact .dc-iconbtn").getBoundingClientRect(); return b.width === 32'), `${tag}: desktop icon buttons stay 32 px`);
      await closeMenu(p);
      await p.close();
    }

    await keyboardCases(helpers, theme);
  }
};
