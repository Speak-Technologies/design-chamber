// Visual scenario for "tell the service what is open" (use-the-project spec §2.4, T7): the rail and the page report
// the open design, its screen and viewport, the mode and the selected element to `PUT /view`, debounced to one report
// per change, `slug: null` going back, nothing the user can see when the service refuses a report. The fake backend
// records every body (`__dcFake.views()`).
// `helpers` is what the other scenarios use: openPage, check, checkSoon, listReady, wallReady, thumbsReady, sleep.

const COFFEE = 'coffee-subscription';
// The debounce is 500 ms (shared/view.ts); a report is looked for after twice that.
const SETTLE = 1200;

export const run = async (helpers) => {
  await page(helpers);
  await rail(helpers);
  await refused(helpers);
};

const viewsOf = async (p) => JSON.parse(await p.guest('return JSON.stringify(win.__dcFake.views())'));

/** Does something, waits past the debounce, and returns the reports it caused. */
const reportsFrom = async (p, action) => {
  const before = (await viewsOf(p)).length;
  await action();
  await p.settle(SETTLE);
  return (await viewsOf(p)).slice(before);
};

const dblclickLabel = (p, name) =>
  p.guest(
    `const label = [...doc.querySelectorAll('.dc-label')].find((n) => n.textContent.includes(${JSON.stringify(name)})); if (!label) return false; label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true;`,
  );

const page = async ({ openPage, check, listReady, wallReady, thumbsReady }) => {
  const tag = 'view-report-page-1400-light';
  const p = await openPage({ width: 1400, height: 900, surface: 'page', theme: 'light', label: tag });
  console.log(tag);
  await listReady(p);
  await thumbsReady(p);
  await p.settle(SETTLE);
  check((await viewsOf(p)).length === 0, `${tag}: the library reports nothing until a design opens`);

  const opened = await reportsFrom(p, async () => {
    await p.click('.dc-card[data-slug="coffee-subscription"] .dc-card-main');
    await wallReady(p, 6);
  });
  check(opened.length === 1, `${tag}: opening a design sends one report (${opened.length})`);
  check(
    JSON.stringify(opened.at(-1)) === JSON.stringify({ surface: 'page', slug: COFFEE, screen: null, viewport: null, mode: 'edit', selection: null }),
    `${tag}: it names the surface, the design and Edit mode (${JSON.stringify(opened.at(-1))})`,
  );

  const focused = await reportsFrom(p, async () => void (await dblclickLabel(p, 'Pricing')));
  check(focused.length === 1, `${tag}: focusing a screen sends one report (${focused.length})`);
  check(focused.at(-1)?.screen === 'pricing' && focused.at(-1)?.viewport === 'laptop', `${tag}: it names the screen and its viewport (${JSON.stringify(focused.at(-1))})`);

  // Zoom to Home and press on its headline: the composer opens, which is a selection.
  await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Fit' });
  const home = await p.rect('.dc-board[data-board="home@laptop"]');
  await p.wheel(home.x + home.w / 2, home.y + home.h / 2, 0, -130, { ctrl: true });
  await p.settle(500);
  const board = await p.rect('.dc-board[data-board="home@laptop"]');
  const pick = [board.x + board.w * 0.2, board.y + board.h * 0.22];
  await p.move(...pick);
  await p.settle(300);
  const selected = await reportsFrom(p, async () => {
    await p.clickAt(...pick);
    await p.waitFor('return !!doc.querySelector(".dc-composer")', 'the comment composer');
  });
  const chosen = selected.at(-1);
  check(selected.length === 1, `${tag}: selecting text sends one report (${selected.length})`);
  check(chosen?.screen === 'home' && chosen?.selection !== null && typeof chosen?.selection?.selector === 'string' && chosen.selection.selector !== '', `${tag}: it carries the screen and the element (${JSON.stringify(chosen?.selection)})`);
  check(JSON.stringify(Object.keys(chosen?.selection ?? {}).sort()) === '["selector","text"]', `${tag}: the selection is a selector and a text, nothing else`);
  check((chosen?.selection?.text ?? '').length <= 120 && (chosen?.selection?.selector ?? '').length <= 300, `${tag}: both are within their caps`);

  const cleared = await reportsFrom(p, async () => {
    await p.key('Escape', { focus: '.dc-composer textarea' });
    await p.waitFor('return !doc.querySelector(".dc-composer")', 'the composer to close');
  });
  check(cleared.length === 1 && cleared[0].selection === null, `${tag}: closing the composer reports no selection`);

  const played = await reportsFrom(p, () => p.click('.dc-mode [role=tab]', { text: 'Play' }));
  check(played.length === 1 && played[0].mode === 'play', `${tag}: switching to Play sends one report (${JSON.stringify(played.map((view) => view.mode))})`);

  const back = await reportsFrom(p, () => p.click('.dc-toolbar .oc-sdk-btn', { text: 'Library' }));
  check(back.length === 1 && JSON.stringify(back[0]) === JSON.stringify({ surface: 'page', slug: null }), `${tag}: back to the library sends slug null alone (${JSON.stringify(back)})`);

  // A page design: its view, not a screen.
  const pageDesign = await reportsFrom(p, async () => {
    await listReady(p);
    await p.click('.dc-card[data-slug="northwind-pricing"] .dc-card-main');
    await wallReady(p, 1);
  });
  check(
    pageDesign.length === 1 && pageDesign[0].slug === 'northwind-pricing' && pageDesign[0].screen === null && pageDesign[0].viewport === 'fill' && pageDesign[0].mode === 'play',
    `${tag}: a page reports Full width, Play and no screen (${JSON.stringify(pageDesign.at(-1))})`,
  );
  const commenting = await reportsFrom(p, () => p.click('.dc-toolbar .oc-sdk-btn', { text: 'Comment' }));
  check(commenting.length === 1 && commenting[0].mode === 'edit', `${tag}: Comment on a page switches the report to Edit`);
  await p.close();
};

const rail = async ({ openPage, check, listReady, wallReady }) => {
  const tag = 'view-report-rail-320-dark';
  const p = await openPage({ width: 320, height: 720, surface: 'panel', theme: 'dark', label: tag });
  console.log(tag);
  await listReady(p);
  await p.settle(SETTLE);
  check((await viewsOf(p)).length === 0, `${tag}: the list reports nothing until a design opens`);

  const opened = await reportsFrom(p, async () => {
    await p.click('.dc-row[data-slug="coffee-subscription"] .dc-row-main');
    await wallReady(p, 1);
  });
  check(opened.length === 1 && opened[0].surface === 'rail' && opened[0].slug === COFFEE && opened[0].mode === 'edit', `${tag}: opening a design reports it for the rail (${JSON.stringify(opened.at(-1))})`);

  const focused = await reportsFrom(p, async () => void (await dblclickLabel(p, 'Pricing')));
  check(focused.length === 1 && focused[0].screen === 'pricing', `${tag}: focusing a screen sends one report (${JSON.stringify(focused.at(-1))})`);

  const played = await reportsFrom(p, () => p.click('.dc-mode [role=tab]', { text: 'Play' }));
  check(played.length === 1 && played[0].mode === 'play' && played[0].screen === 'pricing', `${tag}: Play keeps the screen and changes the mode`);

  const back = await reportsFrom(p, () => p.click('.dc-toolbar-compact .dc-iconbtn[aria-label="Back to designs"]'));
  check(back.length === 1 && JSON.stringify(back[0]) === JSON.stringify({ surface: 'rail', slug: null }), `${tag}: Back to designs sends slug null alone (${JSON.stringify(back)})`);

  // Two quick opens inside the debounce are one report: the last one.
  const quick = await reportsFrom(p, async () => {
    await p.click('.dc-row[data-slug="coffee-subscription"] .dc-row-main');
    await wallReady(p, 1);
    await p.click('.dc-toolbar-compact .dc-iconbtn[aria-label="Back to designs"]');
    await p.click('.dc-row[data-slug="northwind-pricing"] .dc-row-main');
    await wallReady(p, 1);
  });
  check(quick.at(-1)?.slug === 'northwind-pricing', `${tag}: the last design opened is the one reported`);
  await p.close();
};

/** The service refuses every report: nothing shows, and the design still works. */
const refused = async ({ openPage, check, listReady, wallReady }) => {
  const tag = 'view-report-refused-480-light';
  const p = await openPage({ width: 480, height: 720, surface: 'panel', theme: 'light', label: tag, routes: { 'PUT /view': { status: 500, body: { error: 'internal', message: 'The service could not save that.' } } } });
  console.log(tag);
  await listReady(p);
  await p.settle(500);
  await p.click('.dc-row[data-slug="coffee-subscription"] .dc-row-main');
  await wallReady(p, 1);
  await p.settle(SETTLE);
  const hits = await p.guest('return win.__dcFake.routeHits("PUT /view")');
  check(hits >= 1, `${tag}: the report was tried (${hits})`);
  check((await p.host('window.__host.toasts.length')) === 0, `${tag}: no toast`);
  // Only the open design's own area: the list behind it keeps its folder banners.
  const shown = await p.guest('return [...doc.querySelectorAll(".dc-design [role=alert], .dc-design .dc-banner")].filter((n) => n.textContent.trim() !== "").map((n) => n.className + ": " + n.textContent.trim().slice(0, 80))');
  check(shown.length === 0, `${tag}: no alert or banner in the design (${JSON.stringify(shown)})`);
  await p.click('.dc-mode [role=tab]', { text: 'Play' });
  await p.click('.dc-toolbar-compact .dc-iconbtn[aria-label="Back to designs"]');
  await listReady(p);
  check(await p.guest('return !!doc.querySelector(".dc-list-view") && doc.querySelector(".dc-list-view").hidden === false'), `${tag}: the design opened, switched mode and went back as usual`);
  await p.close();
};
