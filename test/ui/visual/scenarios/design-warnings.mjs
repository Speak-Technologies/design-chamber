// Visual scenario for the design-warnings band (Phase 2.6, QA-F finding 1): the rail viewer at 320 and 480 px and the
// page, light and dark. A design whose agent asked for folders that do not exist (one name, two names), one where the
// folders did not load, one whose design system choice failed; the band comes in after a `comments` change with no
// reload, goes away when the list is empty, folds past two lines behind "Show N more", never takes focus and never
// moves the wall. `helpers`: openPage, check, checkSoon, listReady, wallReady.

const FAKE = 'window.frames[0].__dcFake';
const COFFEE = 'coffee-subscription';

const ONE = "The agent asked to add this design to Q4, but there's no folder with that name.";
const TWO = "The agent asked to add this design to Q4 and Launch, but there are no folders with those names.";
const WAITING = "Folders couldn't load, so the agent's request wasn't applied.";
const CHOICE = `design.json asks for the design system "Tidepool", which isn't a Ready system in this Designs folder.`;

const warning = (code, message) => ({ code, message });
const set = (p, list) => p.host(`${FAKE}.setWarnings(${JSON.stringify(COFFEE)}, ${JSON.stringify(list)})`);
const lines = (p) => p.guest('return [...doc.querySelectorAll(".dc-warnings .dc-warnings-text")].filter((n) => n.closest(".dc-warnings-line") && !n.closest(".dc-warnings-line").hidden).map((n) => n.textContent)');
const bandShown = (p) => p.guest('const b = doc.querySelector(".dc-warnings"); return !!b && !b.hidden && b.getBoundingClientRect().height > 0');
const wallBox = (p) => p.guest('const r = doc.querySelector(".dc-wall").getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width), Math.round(r.height)].join(",")');
const noOverflow = (p) => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');

const scenario = async (h, { surface, width, theme }) => {
  const tag = `${surface === 'page' ? 'page' : 'rail'}-${width}-${theme}-warnings`;
  const p = await h.openPage({ width, height: surface === 'page' ? 900 : 780, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await p.click(surface === 'page' ? `.dc-card[data-slug="${COFFEE}"] .dc-card-main` : `.dc-row[data-slug="${COFFEE}"] .dc-row-main`);
  await h.wallReady(p, 2);
  await p.settle(500);

  // No warnings: no band, and no space for one.
  h.check(!(await bandShown(p)), `${tag}: no band while the design has no warnings`);
  h.check((await p.guest('const b = doc.querySelector(".dc-warnings"); return !!b && b.getAttribute("role") === "status" && b.getAttribute("aria-live") === "polite"')) === true, `${tag}: the live region is in the page from the start`);
  h.check(await p.guest('return doc.querySelector(".dc-design").children[1]?.classList.contains("dc-warnings")'), `${tag}: the band sits right under the toolbar`);
  const idleWall = await wallBox(p);

  // Unknown folder name: appears with no reload.
  await set(p, [warning('folder-request-unknown', ONE)]);
  await h.checkSoon(() => bandShown(p), `${tag}: the band appears after a comments change`);
  h.check(JSON.stringify(await lines(p)) === JSON.stringify([ONE]), `${tag}: it shows the unknown-folder sentence exactly`);
  await p.settle(300);
  await p.shot(`${tag}-1-unknown`);
  h.check(await p.guest('return !doc.querySelector(".dc-warnings").contains(doc.activeElement)'), `${tag}: the band does not take focus`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow`);

  // Two unknown names.
  await set(p, [warning('folder-request-unknown', TWO)]);
  await h.checkSoon(async () => (await lines(p))[0] === TWO, `${tag}: two names read as one sentence`);

  // Folders did not load.
  await set(p, [warning('folder-request-waiting', WAITING)]);
  await h.checkSoon(async () => JSON.stringify(await lines(p)) === JSON.stringify([WAITING]), `${tag}: the waiting sentence shows exactly`);
  await p.shot(`${tag}-2-waiting`);

  // Design system choice problem plus a folder one: two lines, no toggle.
  await set(p, [warning('invalid-system-choice', CHOICE), warning('folder-request-unknown', ONE)]);
  await h.checkSoon(async () => (await lines(p)).length === 2, `${tag}: a system choice problem and a folder one show as two lines`);
  h.check(JSON.stringify(await lines(p)) === JSON.stringify([CHOICE, ONE]), `${tag}: both sentences are exact`);
  h.check(await p.guest('return doc.querySelector(".dc-warnings-more").hidden'), `${tag}: two lines need no "Show more"`);
  await p.settle(200);
  await p.shot(`${tag}-3-system-choice`);

  // The wall is not pushed sideways, and it survives zoom and mode changes.
  const withBand = await wallBox(p);
  h.check(idleWall.split(',')[0] === withBand.split(',')[0] && idleWall.split(',')[1] === withBand.split(',')[1], `${tag}: the band does not change the wall's width (${idleWall} → ${withBand})`);
  await p.click(surface === 'page' ? '.dc-toolbar .oc-sdk-btn' : '.dc-toolbar-compact .dc-zoom-label', surface === 'page' ? { text: 'Fit' } : {});
  await p.click('.dc-toolbar [role=tab]', { text: 'Play' });
  await p.settle(300);
  h.check(await bandShown(p), `${tag}: it stays through zoom and a mode change`);
  await p.click('.dc-toolbar [role=tab]', { text: 'Edit' });

  // More than two: folds, expands, keeps focus on the toggle.
  await set(p, [warning('a', 'First problem.'), warning('b', 'Second problem.'), warning('c', 'Third problem.'), warning('d', 'Fourth problem.')]);
  await h.checkSoon(async () => (await lines(p)).length === 2 && (await p.guest('return doc.querySelector(".dc-warnings-more")?.textContent')) === 'Show 2 more', `${tag}: four warnings fold to two lines and "Show 2 more"`);
  await p.shot(`${tag}-4-folded`);
  await p.click('.dc-warnings-more');
  await h.checkSoon(async () => (await lines(p)).length === 4, `${tag}: "Show 2 more" shows every line`);
  h.check((await p.guest('return doc.querySelector(".dc-warnings-more").getAttribute("aria-expanded")')) === 'true', `${tag}: the toggle reports it is expanded`);
  await p.shot(`${tag}-5-expanded`);
  // A refetch with the same sentences leaves it as the user set it.
  await set(p, [warning('a', 'First problem.'), warning('b', 'Second problem.'), warning('c', 'Third problem.'), warning('d', 'Fourth problem.')]);
  await p.settle(500);
  h.check((await lines(p)).length === 4, `${tag}: an unchanged refetch keeps it expanded`);

  // Clearing: the band goes and the wall is back where it was.
  await set(p, []);
  await h.checkSoon(async () => !(await bandShown(p)), `${tag}: the band goes when the list is empty`);
  await p.settle(300);
  h.check((await wallBox(p)) === idleWall, `${tag}: the wall is back to its size (${idleWall})`);
  await p.close();
};

export const run = async (h) => {
  for (const config of [
    { surface: 'panel', width: 320, theme: 'light' },
    { surface: 'panel', width: 320, theme: 'dark' },
    { surface: 'panel', width: 480, theme: 'light' },
    { surface: 'panel', width: 480, theme: 'dark' },
    { surface: 'page', width: 1400, theme: 'light' },
  ]) await scenario(h, config);
};
