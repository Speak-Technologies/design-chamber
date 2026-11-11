// Visual scenario for directions (Phase 2 feature 11, U4): page 1400 and rail 320 and 480, dark and light.
// Per variant, on the coffee canvas (three screens, linked to the chat), with Pricing marked as having three
// directions (A and B written, C not yet): the row (Current first, then A, B, C at one size; one line on the page,
// the 2×2 grid on the rail), its header ("Pricing · 3 directions", Show at, ⋯), the board names, Keep this one
// (a button on the page, the ⋯ menu's entry on the rail), C's Keep off with its reason, Try 3 directions off with
// its reason, Show at (another size, kept), a Keep that is refused (the words, the wall refreshed), Keep B with its
// notice and Undo, Keep the current one, an old version on show (no Keep, the layout stays), and two and four directions.
// DC_DIRECTIONS_ONLY=<tag regex> limits the variants while iterating.

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

export const run = async (helpers) => {
  const { openPage, check, checkSoon, listReady, thumbsReady, wallReady, sleep } = helpers;
  const only = process.env.DC_DIRECTIONS_ONLY ? new RegExp(process.env.DC_DIRECTIONS_ONLY) : null;

  for (const [kind, width, theme] of VARIANTS) {
    const tag = `${kind}-${width}-${theme}-directions`;
    if (only && !only.test(tag)) continue;
    console.log(tag);
    const rail = kind === 'rail';
    const p = await openPage({ width, height: rail ? 780 : 900, surface: rail ? 'panel' : 'page', theme, label: tag });

    await p.send('Page.navigate', { url: `${await p.host('location.href')}&session=ses_coffee` });
    await sleep(700);
    await p.waitFor('return !!doc.querySelector(".dc-app")', 'the app to mount');
    await listReady(p);
    await thumbsReady(p);
    await p.click(rail ? `.dc-row[data-slug="${SLUG}"] .dc-row-main` : `.dc-card[data-slug="${SLUG}"] .dc-card-main`);
    await wallReady(p, rail ? 2 : 6);
    await p.settle(500);

    const q = (selector) => JSON.stringify(selector);
    const text = (selector) => p.guest(`return doc.querySelector(${q(selector)})?.textContent?.trim() ?? null`);
    const visible = (selector) => p.guest(`const n = doc.querySelector(${q(selector)}); return !!n && !n.hidden && n.getClientRects().length > 0`);
    const count = (selector) => p.guest(`return [...doc.querySelectorAll(${q(selector)})].filter((n) => !n.hidden && n.getClientRects().length > 0).length`);
    const noOverflow = () => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');
    const noticeText = () => text('.dc-notices .oc-sdk-banner-title');
    const board = (id, viewport = 'laptop') => `.dc-board[data-board="${id}@${viewport}"]`;
    const box = (selector) => p.guest(`const n = doc.querySelector(${q(selector)}); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }`);
    const inWall = (selector) =>
      p.guest(`const n = doc.querySelector(${q(selector)}); const w = doc.querySelector('.dc-wall').getBoundingClientRect(); if (!n || n.hidden) return false; const r = n.getBoundingClientRect(); return r.width > 0 && r.left >= w.left - 1 && r.right <= w.right + 1 && r.top >= w.top - 1 && r.bottom <= w.bottom + 1`);
    const names = () => p.guest(`return [...doc.querySelectorAll('.dc-label:not(.dc-direction-head) .dc-label-text')].map((n) => n.title).join('|')`);
    const keepBtn = (name) => `.dc-label-keep[aria-label^="Keep this one: ${name}"]`;
    const menuOf = (label) => `.dc-label-menu[aria-label^="Actions for ${label}"]`;
    // The build strip's pill floats over the top label for a few seconds after a turn: let it go first.
    await p.waitFor('return (doc.querySelector(".dc-build")?.dataset.phase ?? "hidden") === "hidden"', 'the build strip to clear', 15000).catch(() => undefined);

    // 1. the agent marks three directions of Pricing: A and B written, C not yet
    check((await count('.dc-direction-head')) === 0, `${tag}: no header before there are directions`);
    await p.guest(`win.__dcFake.addDirections(${q(SLUG)}, 'pricing', 3, 2)`);
    await checkSoon(() => visible('.dc-direction-head'), `${tag}: the row's header appears when the agent marks directions`);
    await p.settle(500);
    check((await text('.dc-direction-title')) === 'Pricing · 3 directions', `${tag}: the header reads "Pricing · 3 directions" (${await text('.dc-direction-title')})`);
    check((await count('.dc-board[data-board^="pricing"]')) === 4, `${tag}: Current and three directions are four boards`);
    check(!(await box(board('pricing', 'phone'))), `${tag}: the row shows one size, not one board per size`);
    check(!(await box(board('pricing-a', 'phone'))), `${tag}: a direction has no phone board either`);
    const shown = (await names()).split('|');
    check(['Current · Laptop 1280×800', 'A · Bold', 'B · Editorial', 'C · Cards'].every((name) => shown.includes(name)), `${tag}: the boards are named Current, A · Bold, B · Editorial, C · Cards (${shown.join('|')})`);
    // layout: one line on the page, Current/A over B/C on the rail
    const cur = await box(board('pricing'));
    const a = await box(board('pricing-a'));
    const b = await box(board('pricing-b'));
    const c = await box(board('pricing-c'));
    if (rail) {
      check(Math.abs(cur.y - a.y) < 1 && Math.abs(b.y - c.y) < 1 && b.y > cur.y + cur.h, `${tag}: the rail lays them out as a 2×2 grid (Current, A over B, C)`);
      check(Math.abs(cur.x - b.x) < 1 && Math.abs(a.x - c.x) < 1 && a.x > cur.x + cur.w, `${tag}: the columns line up`);
    } else {
      check(Math.abs(cur.y - a.y) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(b.y - c.y) < 1, `${tag}: the page keeps them in one row`);
      check(a.x > cur.x && b.x > a.x && c.x > b.x, `${tag}: Current, A, B, C left to right`);
    }
    for (const [name, selector] of [['Current', board('pricing')], ['A', board('pricing-a')], ['B', board('pricing-b')], ['C', board('pricing-c')]]) {
      check(await inWall(selector), `${tag}: ${name} is on the wall after Fit (every direction at once)`);
    }
    check(await inWall('.dc-direction-head'), `${tag}: the header is on the wall`);
    check(await p.guest(`const h = doc.querySelector('.dc-direction-head').getBoundingClientRect(); const l = doc.querySelector('.dc-direction-head ~ .dc-label, .dc-label:not(.dc-direction-head)'); return h.bottom <= doc.querySelector(${q(board('pricing'))}).getBoundingClientRect().top`), `${tag}: the header sits above the row`);
    check(await p.guest(`const h = doc.querySelector('.dc-direction-head').getBoundingClientRect(); const prev = doc.querySelector(${q(board('home'))}).getBoundingClientRect(); return h.top >= prev.bottom - 1`), `${tag}: it does not cover the row above (Home)`);
    check(await p.guest(`const r = doc.querySelector('.dc-direction-select .oc-sdk-trigger'); return !!r && r.textContent.trim() === 'Laptop'`), `${tag}: Show at is drawn in the header and says Laptop`);
    check((await text('.dc-direction-select .oc-sdk-field-label')) === 'Show at', `${tag}: it has a visible label, "Show at"`);
    check(await noOverflow(), `${tag}: no horizontal overflow`);
    await p.shot(`${tag}-1-row`);

    // 2. Keep this one: a button in each written board's label on the page; the ⋯ menu's entry on the rail
    if (!rail) {
      check((await count('.dc-label-keep')) === 4, `${tag}: all four boards carry Keep this one, Current included`);
      check((await text('.dc-label-keep')) === 'Keep this one', `${tag}: it says what it does`);
      check(await p.guest(`return doc.querySelector(${q(keepBtn('direction C'))}).disabled`), `${tag}: C is not written yet, so its Keep is off`);
      check((await p.guest(`return doc.querySelector(${q(keepBtn('direction C'))}).getAttribute('aria-label')`)).includes('Not written yet.'), `${tag}: and its name says why`);
      check(await p.guest(`return !doc.querySelector(${q(keepBtn('direction A'))}).disabled && !doc.querySelector(${q(keepBtn('direction B'))}).disabled && !doc.querySelector(${q(keepBtn('the current'))}).disabled`), `${tag}: Current, A and B can be kept`);
      check((await count('.dc-label-menu:not([aria-label^="Actions for screen"])')) === 0, `${tag}: no ⋯ in a direction's label on the page`);
      check(await p.guest(`const l = doc.querySelector(${q(keepBtn('direction A'))}).closest('.dc-label'); const k = doc.querySelector(${q(keepBtn('direction A'))}).getBoundingClientRect(); const r = l.getBoundingClientRect(); return k.right <= r.right + 1 && k.left >= r.left`), `${tag}: the button sits inside its label`);
    } else {
      check((await count('.dc-label-keep')) === 0, `${tag}: the rail has no Keep button (its labels are too small); Keep is in the ⋯ menu`);
      check((await count('.dc-label-menu:not([aria-label^="Actions for screen"])')) === 4, `${tag}: each direction board has its own ⋯`);
      await p.click(menuOf('A · Bold'));
      await p.waitFor(`return !!doc.querySelector(${q(MENU)})`, 'the menu of A');
      const entries = await p.guest(`return [...doc.querySelectorAll('${MENU} [role=menuitem]')].map((n) => n.querySelector('.oc-sdk-option-label').textContent).join('|')`);
      check(entries === 'Keep this one', `${tag}: A's menu holds Keep this one (${entries})`);
      check(await p.guest(`return doc.querySelector('${MENU} [role=menuitem]').getAttribute('aria-disabled') !== 'true'`), `${tag}: it is on for a written board`);
      await p.shot(`${tag}-2-menu`);
      await p.key('Escape', { focus: MENU });
      await checkSoon(async () => !(await visible(MENU)), `${tag}: Escape closes the menu`);
      check(await p.guest(`return doc.activeElement === doc.querySelector(${q(menuOf('A · Bold'))})`), `${tag}: focus goes back to the ⋯ button`);
      // C is not written: the reason is inside the option, reachable by the arrows, Enter does nothing
      await p.click(menuOf('C · Cards'));
      await p.waitFor(`return !!doc.querySelector(${q(MENU)})`, 'the menu of C');
      check(await p.guest(`const r = doc.querySelector('${MENU} [role=menuitem]'); return r.getAttribute('aria-disabled') === 'true' && r.querySelector('.dc-menu-reason')?.textContent === 'Not written yet.'`), `${tag}: C's Keep says "Not written yet." inside the option`);
      await p.key('Enter', { focus: MENU });
      check(await visible(MENU), `${tag}: Enter on it does nothing and the menu stays open`);
      await p.shot(`${tag}-2-menu-unwritten`);
      await p.key('Escape', { focus: MENU });
      await checkSoon(async () => !(await visible(MENU)), `${tag}: Escape closes it`);
    }

    // 3. the row's own menu (in the header): Try 3 directions is off with its reason inside the option
    await p.click(`.dc-direction-head .dc-label-menu`);
    await p.waitFor(`return !!doc.querySelector(${q(MENU)})`, 'the row menu');
    check(await p.guest(`const r = doc.querySelector('${MENU} [role=menuitem][id$="-directions"]'); return r.getAttribute('aria-disabled') === 'true' && r.querySelector('.dc-menu-reason')?.textContent === 'This screen already has directions. Keep one first.'`), `${tag}: Try 3 directions says "This screen already has directions. Keep one first."`);
    check(await p.guest(`const r = doc.querySelector('${MENU} [role=menuitem][id$="-down"]'); return r.getAttribute('aria-disabled') !== 'true'`), `${tag}: Move down skips the directions (Checkout is the next row)`);
    await p.shot(`${tag}-3-row-menu`);
    await p.key('Escape', { focus: MENU });
    await checkSoon(async () => !(await visible(MENU)), `${tag}: Escape closes the row menu`);

    // 4. Show at: another size, laid out again and fitted, then back
    const openShowAt = async () => {
      await p.click('.dc-direction-select .oc-sdk-trigger');
      await p.waitFor(`return !!doc.querySelector('.oc-sdk-popup [role=option]')`, 'the Show at options');
    };
    await openShowAt();
    const options = await p.guest(`return [...doc.querySelectorAll('.oc-sdk-popup [role=option]')].map((n) => n.textContent.trim()).join('|')`);
    check(options === 'Laptop|Phone', `${tag}: Show at offers the original's sizes (${options})`);
    await p.shot(`${tag}-4-show-at`);
    await p.click('.oc-sdk-popup [role=option]', { text: 'Phone' });
    await checkSoon(async () => !!(await box(board('pricing-a', 'phone'))), `${tag}: Show at Phone shows the directions at Phone`);
    check(!(await box(board('pricing-a'))), `${tag}: and no longer at Laptop`);
    check((await names()).split('|').includes('Current · Phone 390×844'), `${tag}: the names follow (${await names()})`);
    for (const [name, id] of [['Current', 'pricing'], ['A', 'pricing-a'], ['B', 'pricing-b'], ['C', 'pricing-c']]) {
      check(await inWall(board(id, 'phone')), `${tag}: ${name} is on the wall after Fit at Phone`);
    }
    check(await inWall('.dc-direction-head'), `${tag}: the header is still on the wall at Phone`);
    check(await noOverflow(), `${tag}: no horizontal overflow at Phone`);
    await p.shot(`${tag}-4-phone`);
    await p.retry(
      async () => {
        if (!(await visible('.oc-sdk-popup [role=option]'))) await openShowAt();
        await p.click('.oc-sdk-popup [role=option]', { text: 'Laptop' });
      },
      async () => !!(await box(board('pricing-a'))),
      'Show at back to Laptop',
    );
    await checkSoon(async () => !!(await box(board('pricing-a'))), `${tag}: back to Laptop`);

    // 5. a Keep that is refused: the words, the user's place kept, the wall refreshed
    await p.route('POST /designs/:slug/edits', { status: 409, delayMs: 1200, body: { error: 'stale', message: 'The screen list changed while you were working. Nothing was changed.' } });
    const press = async (label) => {
      if (rail) {
        await p.click(menuOf(label));
        await p.click(`${MENU} [role=menuitem]`, { text: 'Keep this one' });
      } else await p.click(keepBtn(label.startsWith('A') ? 'direction A' : label.startsWith('B') ? 'direction B' : 'the current'));
    };
    await press('A · Bold');
    await p.settle(350);
    if (!rail) {
      check(await p.guest(`return doc.querySelector(${q(keepBtn('direction A'))}).getAttribute('aria-busy') === 'true'`), `${tag}: the pressed button shows it is busy`);
      check(await p.guest(`return doc.querySelector(${q(keepBtn('direction B'))}).disabled && doc.querySelector(${q(keepBtn('the current'))}).disabled`), `${tag}: every other Keep is off while it runs`);
    } else {
      check(await p.guest(`return doc.querySelector(${q(menuOf('B · Editorial'))}).getAttribute('aria-disabled') === 'true' && doc.querySelector('.dc-direction-head .dc-label-menu').getAttribute('aria-disabled') === 'true'`), `${tag}: the other menus and the row's menu are off while it runs`);
    }
    check(await visible('.dc-label .dc-status-spin'), `${tag}: the board's label shows it is working`);
    await p.shot(`${tag}-5-keeping`);
    await checkSoon(async () => (await text('.dc-notices .oc-sdk-banner-title')) === 'Couldn’t keep direction A', `${tag}: a refusal says what did not happen (${await noticeText()})`);
    check((await text('.dc-notices .oc-sdk-banner-body'))?.includes('Nothing was changed.') ?? false, `${tag}: with the service's sentence`);
    check((await count('.dc-board[data-board^="pricing"]')) === 4, `${tag}: the row is still there`);
    check(await p.guest(`return !doc.querySelector('.dc-label-keep[aria-busy=true]') && !doc.querySelector('.dc-label .dc-status-spin')`), `${tag}: the buttons come back`);
    await p.shot(`${tag}-5-refused`);
    await p.click('.dc-notices .oc-sdk-btn', { text: 'Dismiss' });
    await p.clearRoutes();

    // 6. Keep B: a normal row again, the notice with Undo
    await press('B · Editorial');
    await checkSoon(async () => (await count('.dc-direction-head')) === 0, `${tag}: keeping B takes the header away`);
    check((await count('.dc-board[data-board^="pricing-"]')) === 0, `${tag}: the other directions are gone from the wall`);
    check(!!(await box(board('pricing'))) && !!(await box(board('pricing', 'phone'))), `${tag}: Pricing is a normal row again, at both sizes`);
    check((await count('.dc-label-keep')) === 0, `${tag}: no Keep buttons any more`);
    await checkSoon(async () => (await noticeText()) === 'Kept B for Pricing. The others are in the trash.', `${tag}: the notice says "Kept B for Pricing. The others are in the trash." (${await noticeText()})`);
    check(await p.guest(`return [...doc.querySelectorAll('.dc-notices .dc-edit-notice .oc-sdk-btn')].some((b) => b.textContent.trim() === 'Undo')`), `${tag}: the notice offers Undo`);
    check(await p.guest(`return doc.querySelector('.dc-notices').getAttribute('aria-live') === 'polite'`), `${tag}: it sits in the live region`);
    await p.shot(`${tag}-6-kept`);
    await p.click('.dc-notices .dc-edit-notice .oc-sdk-btn', { text: 'Undo' });
    await checkSoon(async () => (await count('.dc-direction-head')) === 1 && (await count('.dc-board[data-board^="pricing"]')) === 4, `${tag}: Undo brings the row back`);
    await checkSoon(async () => (await noticeText()) === 'Undone', `${tag}: Undone is announced`);

    // 7. an old version on show: no Keep, the row keeps its layout
    await p.click(rail ? '.dc-compact-actions [aria-label="Versions"]' : '.dc-toolbar .oc-sdk-btn', rail ? {} : { text: 'Versions' });
    await p.waitFor('return !!doc.querySelector(".dc-version-actions .oc-sdk-btn")', 'the versions list');
    await p.click('.dc-version-actions .oc-sdk-btn', { text: 'View' });
    await p.settle(500);
    check((await count('.dc-label-keep')) === 0 && (await count('.dc-label-menu:not([aria-label^="Actions for screen"])')) === 0, `${tag}: no Keep while an old version is on show`);
    check((await count('.dc-board[data-board^="pricing"]')) === 4 && (await count('.dc-direction-head')) === 1, `${tag}: the row keeps its layout`);
    await p.shot(`${tag}-7-viewing`);
    if (!rail) await p.click('.dc-viewing .oc-sdk-btn', { text: 'Back to current' });
    else {
      await p.click('.dc-viewing .oc-sdk-btn', { text: 'Back to current' });
    }
    await checkSoon(async () => (await count('.dc-viewing')) === 0, `${tag}: back to the current design`);
    if (rail) await p.settle(300);

    // 8. Keep the current one: the directions go to the trash
    await press('Current · Laptop');
    await checkSoon(async () => (await count('.dc-direction-head')) === 0, `${tag}: keeping Current takes the header away`);
    await checkSoon(async () => (await noticeText()) === 'Kept the current Pricing. The directions are in the trash.', `${tag}: the notice says so (${await noticeText()})`);
    await p.click('.dc-notices .dc-edit-notice .oc-sdk-btn', { text: 'Undo' });
    await checkSoon(async () => (await count('.dc-direction-head')) === 1, `${tag}: Undo brings the row back`);

    // 9. two and four directions on other screens: the layout holds on both surfaces
    await p.guest(`win.__dcFake.addDirections(${q(SLUG)}, 'home', 2, 2)`);
    await p.guest(`win.__dcFake.addDirections(${q(SLUG)}, 'checkout', 4, 4)`);
    // Zoomed far out a header may give way (it is hidden), so the rows are counted in the wall, not on screen.
    await checkSoon(async () => (await p.guest(`return doc.querySelectorAll('.dc-direction-head').length`)) === 3, `${tag}: three rows have directions`);
    await p.settle(500);
    await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Fit' });
    await p.settle(400);
    const titles = await p.guest(`return [...doc.querySelectorAll('.dc-direction-title')].map((n) => n.textContent).join('|')`);
    check(titles.split('|').sort().join('|') === 'Checkout · 4 directions|Home · 2 directions|Pricing · 3 directions', `${tag}: each row counts its own directions (${titles})`);
    const d = await box(board('checkout-d'));
    const ch = await box(board('checkout'));
    check(!!d && (rail ? d.y > ch.y + ch.h && Math.abs(d.x - ch.x) < 1 : Math.abs(d.y - ch.y) < 1 && d.x > ch.x), `${tag}: four directions: ${rail ? 'D starts a third line, left-aligned' : 'D is the fifth board in the row'}`);
    check(await noOverflow(), `${tag}: no horizontal overflow with three rows`);
    await p.shot(`${tag}-9-three-rows`);
    await p.close();
  }
};
