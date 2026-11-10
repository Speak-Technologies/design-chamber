// Visual scenario for "keep your place" and "open from Work Status" in the rail (Phase 1.5 §3.2, §3.8):
// a reload of the frame (what an extension update does) reopens the design that was open, goes back to
// the list when the design is gone or the user had gone back, and an open request wins over the
// remembered design; an open request with intent "comment" starts the design in Edit with Comment pressed.
// The frame reload keeps the host page, so the host's storage survives it, as the real host's does.
// `helpers` is what the other scenarios use: openPage, check, listReady, wallReady, thumbsReady, sleep.

const PLACE = 'place:panel';

export const run = async (helpers) => {
  await reload(helpers);
  await storedStates(helpers);
  await openRequests(helpers);
};

const inViewer = (p) => p.guest('return !!doc.querySelector(".dc-toolbar-compact") && doc.querySelector(".dc-list-view")?.hidden === true');
const title = (p) => p.guest('return doc.querySelector(".dc-toolbar-compact .dc-title-text")?.textContent?.trim() ?? null');
const reloadFrame = async (p) => {
  await p.host('document.getElementById("g").contentWindow.location.reload()');
  await p.settle(300);
  await p.waitFor('return !!doc.querySelector(".dc-app")', 'the app to mount again');
};

const reload = async ({ openPage, check, checkSoon, listReady, wallReady }) => {
  const tag = 'rail-place-reload-360-dark';
  const p = await openPage({ width: 360, height: 700, surface: 'panel', theme: 'dark', label: tag });
  console.log(tag);
  await listReady(p);
  check(!(await inViewer(p)), `${tag}: it starts on the list when nothing was open`);
  await p.click('.dc-row[data-slug="northwind-pricing"] .dc-row-main');
  await wallReady(p, 1);
  await checkSoon(async () => (await p.host('JSON.stringify(window.__host.storageGet("place:panel"))')) === '{"slug":"northwind-pricing"}', `${tag}: opening a design remembers it`);

  await reloadFrame(p);
  await p.waitFor('return !!doc.querySelector(".dc-toolbar-compact .dc-title-text")', 'the design to reopen');
  check((await title(p)) !== null && (await inViewer(p)), `${tag}: a reload reopens the design that was open (${await title(p)})`);

  await p.click('.dc-toolbar-compact .dc-iconbtn[aria-label="Back to designs"]');
  await checkSoon(async () => (await p.host('window.__host.storageGet("place:panel")')) === null, `${tag}: going back to the list forgets it`);
  await reloadFrame(p);
  await listReady(p);
  check(!(await inViewer(p)), `${tag}: a reload after going back stays on the list`);
  await p.close();
};

const storedStates = async ({ openPage, check, listReady, wallReady }) => {
  const gone = 'rail-place-gone-320-light';
  const p = await openPage({ width: 320, height: 700, surface: 'panel', theme: 'light', label: gone, storage: { [PLACE]: { slug: 'long-gone-design' } } });
  console.log(gone);
  await listReady(p);
  await p.settle(500);
  check(!(await inViewer(p)), `${gone}: a design that is gone leaves you on the list`);
  check(await p.guest('return !doc.querySelector("[role=alert]") && !doc.body.textContent.includes("gone")'), `${gone}: and says nothing`);
  check((await p.host('window.__host.toasts.length')) === 0, `${gone}: no toast`);
  check((await p.host('window.__host.storageGet("place:panel")')) === null, `${gone}: the stale place is forgotten`);
  await p.close();

  const here = 'rail-place-restore-480-dark';
  const q = await openPage({ width: 480, height: 700, surface: 'panel', theme: 'dark', label: here, storage: { [PLACE]: { slug: 'coffee-subscription' } } });
  console.log(here);
  await q.waitFor('return !!doc.querySelector(".dc-toolbar-compact .dc-title-text")', 'the remembered design to open');
  await wallReady(q, 2);
  check((await inViewer(q)) && (await title(q)) === 'Coffee subscription', `${here}: the remembered canvas opens on start (${await title(q)})`);
  await q.close();
};

const openRequests = async ({ openPage, check, checkSoon, wallReady }) => {
  const request = (slug, intent) => ({ 'DELETE /open-request': { status: 200, body: { request: { slug, intent, created: new Date().toISOString() } } } });

  const tag = 'rail-place-request-360-dark';
  const p = await openPage({ width: 360, height: 700, surface: 'panel', theme: 'dark', label: tag, storage: { [PLACE]: { slug: 'coffee-subscription' } }, routes: request('northwind-pricing', 'comment') });
  console.log(tag);
  await p.waitFor('return !!doc.querySelector(".dc-toolbar-compact .dc-title-text")', 'a design to open');
  await wallReady(p, 1);
  await p.settle(500);
  check((await title(p)) === 'Northwind pricing page', `${tag}: an open request wins over the remembered design (${await title(p)})`);
  check(await p.guest('return [...doc.querySelectorAll(".dc-toolbar-compact [aria-pressed=true]")].some((n) => (n.textContent || "").includes("Comment"))'), `${tag}: intent "comment" opens a page with Comment pressed`);
  await p.shot(tag);
  await checkSoon(async () => (await p.host('JSON.stringify(window.__host.storageGet("place:panel"))')) === '{"slug":"northwind-pricing"}', `${tag}: the requested design is the one remembered`);
  await p.close();

  const view = 'rail-place-request-view-360-dark';
  const v = await openPage({ width: 360, height: 700, surface: 'panel', theme: 'dark', label: view, routes: request('northwind-pricing', 'view') });
  console.log(view);
  await v.waitFor('return !!doc.querySelector(".dc-toolbar-compact .dc-title-text")', 'a design to open');
  await wallReady(v, 1);
  check(await v.guest('return ![...doc.querySelectorAll(".dc-toolbar-compact [aria-pressed=true]")].some((n) => (n.textContent || "").includes("Comment"))'), `${view}: intent "view" keeps a page in Play`);
  await v.close();
};
