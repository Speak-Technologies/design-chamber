// Visual scenario for saved page data (Phase 2 feature 19, U5): page 1400 and rail 320 and 480, dark and light.
// Per variant, on the invoice page (a page whose HTML keeps one checkbox in localStorage; fake-docs.ts `savedTick`):
// the ⋯ menu with nothing saved (no entry); a tick pressed inside the frame reaching the service (the fake store counts
// the PATCH); the entry "Clear saved page data" after Copy path; its confirm (title, body, Clear in the destructive
// style, Cancel doing nothing); a Clear the service refuses (the words, the dialog stays); a real Clear (the frame
// reloads empty, the notice "Saved page data cleared.", the entry gone); an old version on show (the entry off with its
// reason, the live data untouched); the service refusing a write over the cap (the 1 MB notice); another surface
// clearing the data (the "was cleared" notice); and a design that opens while the service cannot be read (the "can't be
// saved right now" notice). Then the coffee canvas with data seeded: its menu entry and a Clear across its screens.
// DC_PAGE_DATA_ONLY=<tag regex> limits the variants while iterating.

const VARIANTS = [
  ['page', 1400, 'dark'],
  ['page', 1400, 'light'],
  ['rail', 320, 'dark'],
  ['rail', 320, 'light'],
  ['rail', 480, 'dark'],
  ['rail', 480, 'light'],
];

const PAGE = 'invoice-template';
const CANVAS = 'coffee-subscription';
const MENU = '.dc-popup[role="menu"]';
const CLEAR = 'Clear saved page data';

export const run = async (helpers) => {
  const { openPage, check, checkSoon, listReady, thumbsReady, wallReady, sleep } = helpers;
  const only = process.env.DC_PAGE_DATA_ONLY ? new RegExp(process.env.DC_PAGE_DATA_ONLY) : null;

  for (const [kind, width, theme] of VARIANTS) {
    const tag = `${kind}-${width}-${theme}-page-data`;
    if (only && !only.test(tag)) continue;
    console.log(tag);
    const rail = kind === 'rail';
    const p = await openPage({ width, height: rail ? 780 : 900, surface: rail ? 'panel' : 'page', theme, label: tag });
    await listReady(p);
    await thumbsReady(p);

    const q = (selector) => JSON.stringify(selector);
    const text = (selector) => p.guest(`return doc.querySelector(${q(selector)})?.textContent?.trim() ?? null`);
    const visible = (selector) => p.guest(`const n = doc.querySelector(${q(selector)}); return !!n && !n.hidden && n.getClientRects().length > 0`);
    const noOverflow = () => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');
    const fake = (code) => p.guest(`return win.__dcFake.pageState.${code}`);
    const saved = (slug) => fake(`items(${q(slug)}).length`);
    const noticeTitles = () => p.guest(`return [...doc.querySelectorAll('.dc-notices .oc-sdk-banner')].map((n) => n.querySelector('.oc-sdk-banner-title')?.textContent?.trim()).join('|')`);
    const noticeTones = () => p.guest(`return [...doc.querySelectorAll('.dc-notices .oc-sdk-banner')].map((n) => n.dataset.tone).join('|')`);
    const noticeBody = () => text('.dc-notices .oc-sdk-banner-body');
    const MORE = '.dc-iconbtn[aria-label="More actions"]';
    const dialog = '.dc-sheet[data-variant="dialog"]';

    const openDesign = async (slug, boards) => {
      await p.click(rail ? `.dc-row[data-slug="${slug}"] .dc-row-main` : `.dc-card[data-slug="${slug}"] .dc-card-main`);
      await wallReady(p, boards);
      await p.settle(500);
    };
    const backToList = async () => {
      await p.click(rail ? '.dc-toolbar-row .dc-iconbtn[aria-label="Back to designs"]' : '.dc-toolbar .oc-sdk-btn', rail ? {} : { text: 'Library' });
      await listReady(p);
    };
    const openMenu = async () => {
      await p.click(MORE);
      await checkSoon(() => visible(MENU), `${tag}: the ⋯ menu opens`);
    };
    const menuLabels = () => p.guest(`return [...doc.querySelectorAll(${q(MENU + ' [role=menuitem]')})].map((n) => n.querySelector('.dc-option-title')?.textContent.trim() ?? n.textContent.trim())`);
    const closeMenu = async () => {
      await p.key('Escape');
      await checkSoon(async () => !(await visible(MENU)), `${tag}: the menu closes`);
    };
    const frameDoc = () => p.guest(`return doc.querySelector('.dc-frame')?.getAttribute('src') ?? null`);
    const boardState = () => p.guest(`return doc.querySelector('.dc-board')?.dataset.state ?? null`);
    // The checkbox the design shows is drawn by the frame's own script: once it exists and a round trip through the frame's
    // layout has finished, the frame is the live document and its storage shim is listening.
    const liveFrameAnswers = async () => {
      await p.waitFor(`const f = doc.querySelector('.dc-frame'); return !!f && f.offsetWidth > 0 && f.getBoundingClientRect().height > 0 && !!f.getAttribute('src')`, 'the live frame to be laid out', 10000);
      await sleep(400);
    };
    // The control the design keeps pinned bottom-left of its frame; the frame is scaled on a narrow rail.
    const pressTick = async () => {
      const spot = await p.guest(`const f = doc.querySelector('.dc-frame'); const r = f.getBoundingClientRect(); const s = r.width / f.offsetWidth; return { x: r.left + 70 * s, y: r.bottom - 38 * s }`);
      await p.clickAt(spot.x, spot.y);
    };

    // ---------------------------------------------------------------- the page design
    await openDesign(PAGE, 1);
    // The page opens in Play; a canvas would open in Edit and the click would pick instead of tick.
    await openMenu();
    check(!(await menuLabels()).includes(CLEAR), `${tag}: no "${CLEAR}" while nothing is saved`);
    await closeMenu();

    // 1. a tick inside the design reaches the service (one PATCH, a second after the write at most)
    const before = await fake('patches()');
    await pressTick();
    await checkSoon(async () => (await fake('patches()')) > before && (await saved(PAGE)) === 1, `${tag}: a tick in the design is saved (the fake service holds one key)`, 9000);
    check((await p.guest(`return win.__dcFake.pageState.items(${q(PAGE)})[0]?.[0]`)) === 'paid', `${tag}: under the key the design used`);

    // 2. the entry, after Copy path
    await openMenu();
    const labels = await menuLabels();
    check(labels.includes(CLEAR), `${tag}: "${CLEAR}" is in the menu now (${labels.join(' · ')})`);
    check(labels.indexOf(CLEAR) === labels.indexOf('Copy path') + (rail ? 2 : 1), `${tag}: it follows Copy path${rail ? ' and Reveal in folder' : ''}, before Rename`);
    check(labels[labels.indexOf(CLEAR) + 1] === 'Rename', `${tag}: and Rename comes next`);
    await p.shot(`${tag}-1-menu`);

    // 3. the confirm
    await p.click(`${MENU} [role=menuitem]`, { text: CLEAR });
    await checkSoon(() => visible(dialog), `${tag}: the confirm opens`);
    check((await text(`${dialog} .dc-sheet-title`)) === 'Clear saved page data for Invoice template?', `${tag}: it names the design ("${await text(`${dialog} .dc-sheet-title`)}")`);
    check((await text(`${dialog} .dc-confirm-body`)) === "Ticks, toggles and filters this design saved will be reset. This can't be undone.", `${tag}: and says what resets`);
    check(await p.guest(`const b = [...doc.querySelectorAll(${q(dialog + ' .dc-sheet-foot .oc-sdk-btn')})]; return b.length === 2 && b[0].textContent.trim() === 'Cancel' && b[1].textContent.trim() === 'Clear' && b[1].dataset.variant === 'destructive'`), `${tag}: Cancel, then Clear in the destructive style`);
    check(await noOverflow(), `${tag}: no horizontal overflow with the confirm open`);
    await p.shot(`${tag}-2-confirm`);

    // 4. Cancel does nothing
    await p.click(`${dialog} .dc-sheet-foot .oc-sdk-btn`, { text: 'Cancel' });
    await checkSoon(async () => !(await visible(dialog)), `${tag}: Cancel closes it`);
    check((await saved(PAGE)) === 1, `${tag}: and the saved data is still there`);

    // 5. the service refuses the Clear: the words, the dialog stays, nothing is lost
    await p.route('DELETE /designs/:slug/page-state', { status: 500, body: { error: 'internal', message: 'The local service didn’t answer.' } });
    await openMenu();
    await p.click(`${MENU} [role=menuitem]`, { text: CLEAR });
    await checkSoon(() => visible(dialog), `${tag}: the confirm opens again`);
    await p.click(`${dialog} .dc-sheet-foot .oc-sdk-btn`, { text: 'Clear' });
    await checkSoon(async () => (await text(`${dialog} .dc-form-error`))?.startsWith('Couldn’t clear the saved page data.'), `${tag}: a refusal says "Couldn’t clear the saved page data." and why`);
    check(await visible(dialog), `${tag}: the dialog stays open`);
    check((await saved(PAGE)) === 1, `${tag}: and nothing was cleared`);
    await p.shot(`${tag}-3-confirm-failed`);
    await p.clearRoutes();

    // 6. Clear for real: the dialog closes, the frame reloads empty, the notice says so
    await p.click(`${dialog} .dc-sheet-foot .oc-sdk-btn`, { text: 'Clear' });
    await checkSoon(async () => !(await visible(dialog)), `${tag}: Clear closes the dialog`);
    await checkSoon(async () => (await saved(PAGE)) === 0, `${tag}: the saved data is gone`);
    await checkSoon(async () => (await noticeTitles()).includes('Saved page data cleared.'), `${tag}: the notice says "Saved page data cleared."`);
    check((await noticeTones()).split('|').includes('success'), `${tag}: in the success tone`);
    await wallReady(p, 1);
    await p.settle(600);
    check(await noOverflow(), `${tag}: no horizontal overflow after the clear`);
    await p.shot(`${tag}-4-cleared`);
    await openMenu();
    check(!(await menuLabels()).includes(CLEAR), `${tag}: the entry is gone again with nothing saved`);
    await closeMenu();

    // 7. an old version on show: the entry is off with its reason; the live data is not touched
    await pressTick();
    await checkSoon(async () => (await saved(PAGE)) === 1, `${tag}: ticked again`, 9000);
    await p.click(rail ? '.dc-versions-btn' : '.dc-toolbar .oc-sdk-btn', rail ? {} : { text: 'Versions' });
    await p.click('.dc-sheet .oc-sdk-btn', { text: 'View' }).catch(() => undefined);
    await checkSoon(() => visible('.dc-viewing'), `${tag}: an old version is on show`, 8000);
    await openMenu();
    const versionState = await p.guest(`const n = [...doc.querySelectorAll(${q(MENU + ' [role=menuitem]')})].find((o) => o.textContent.includes(${q(CLEAR)})); return n ? { inert: n.getAttribute('aria-disabled') === 'true' || n.disabled, text: n.textContent.trim() } : null`);
    check(versionState?.inert === true, `${tag}: the entry is off while a version is on show (${JSON.stringify(versionState)})`);
    check(versionState?.text.includes('Not while viewing a version') === true, `${tag}: and says why`);
    await p.shot(`${tag}-5-version-menu`);
    await closeMenu();
    check((await saved(PAGE)) === 1, `${tag}: the live data is untouched`);
    const versionDoc = await frameDoc();
    await p.click('.dc-viewing .oc-sdk-btn', { text: 'Back to current' });
    await checkSoon(async () => !(await visible('.dc-viewing')), `${tag}: back on the current design`);

    // 8. the service refuses a write: over the cap
    await p.route('PATCH /designs/:slug/page-state', { status: 413, body: { error: 'too-large', message: "This design tried to save more than 1 MB of page data. The extra wasn't saved." } });
    // A board is "ready" before the live frame has reloaded (the old version's frame still counts), and a tick pressed inside
    // that frame never reaches the service (a version's frame holds no saved data and posts no write). So wait for a new
    // document (a new blob address) in a ready board, and then for the live frame itself to answer the page.
    await checkSoon(async () => {
      const now = await frameDoc();
      return now !== null && now !== versionDoc && (await boardState()) === 'ready';
    }, `${tag}: the live frame reloaded`, 15000);
    await liveFrameAnswers();
    await pressTick();
    await pressTick();
    await checkSoon(async () => (await noticeTitles()).includes("This design tried to save more than 1 MB of page data. The extra wasn't saved."), `${tag}: the cap notice shows`, 9000);
    check((await noticeTones()).split('|').includes('warning'), `${tag}: in the warning tone`);
    await p.shot(`${tag}-6-cap`);
    await p.clearRoutes();

    // 9. another surface clears the data
    await p.guest(`win.__dcFake.pageState.clearElsewhere(${q(PAGE)})`);
    await checkSoon(async () => (await noticeTitles()).includes('Saved page data was cleared.'), `${tag}: a Clear elsewhere says "Saved page data was cleared."`, 9000);
    await p.shot(`${tag}-7-cleared-elsewhere`);

    // 10. the saved data cannot be read when the design opens: it runs unsaved, and says so
    await backToList();
    await p.route('GET /designs/:slug/page-state', { status: 500, body: { error: 'internal', message: 'The local service didn’t answer.' } });
    await openDesign(PAGE, 1);
    await checkSoon(async () => (await noticeTitles()).includes("Page data can't be saved right now."), `${tag}: the "can't be saved" notice shows`, 9000);
    check((await noticeBody()) === 'Changes last until you close this design.', `${tag}: with what that means ("${await noticeBody()}")`);
    check((await noticeTones()).split('|').includes('warning'), `${tag}: in the warning tone`);
    const patchesBefore = await fake('patches()');
    await pressTick();
    await sleep(1800);
    check((await fake('patches()')) === patchesBefore, `${tag}: and a tick is not sent to the service`);
    await openMenu();
    check(!(await menuLabels()).includes(CLEAR), `${tag}: there is nothing to clear from an unsaved view`);
    await closeMenu();
    await p.shot(`${tag}-8-unsaved`);
    await p.clearRoutes();
    await backToList();

    // ---------------------------------------------------------------- a canvas: one store for every screen
    await p.guest(`win.__dcFake.pageState.seed(${q(CANVAS)}, [['paid', '1']])`);
    await openDesign(CANVAS, rail ? 2 : 6);
    await openMenu();
    const canvasLabels = await menuLabels();
    check(canvasLabels.includes(CLEAR), `${tag}: a canvas with saved data offers the entry too`);
    await p.shot(`${tag}-9-canvas-menu`);
    await p.click(`${MENU} [role=menuitem]`, { text: CLEAR });
    await checkSoon(() => visible(dialog), `${tag}: the canvas confirm opens`);
    check((await text(`${dialog} .dc-sheet-title`)) === 'Clear saved page data for Coffee subscription?', `${tag}: it names the canvas ("${await text(`${dialog} .dc-sheet-title`)}")`);
    await p.click(`${dialog} .dc-sheet-foot .oc-sdk-btn`, { text: 'Clear' });
    await checkSoon(async () => (await saved(CANVAS)) === 0, `${tag}: the canvas's data is gone`);
    await checkSoon(async () => (await noticeTitles()).includes('Saved page data cleared.'), `${tag}: with the notice`);
    await wallReady(p, rail ? 2 : 6);
    await p.settle(500);
    await p.shot(`${tag}-10-canvas-cleared`);
    await p.close();
  }
};
