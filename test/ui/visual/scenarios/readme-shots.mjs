// README pictures: the built UI on the REAL built service, pointed at a scratch designs root. Not a check, only
// a camera; it does nothing unless the service's port and token are in the environment.
//
//   DC_LIVE_PORT=<port> DC_LIVE_TOKEN=<token> \
//   DC_LIVE_REWRITE='{"<scratch root>":"/home/you/Documents/Designs"}' \
//   node test/ui/visual/shoot.mjs readme-shots --out <scratch folder>
//
// The scratch root holds the fake designs the README shows (a canvas with pins, a page, a dashboard and two
// design systems). `README_ONLY=<regex>` limits the pictures. The live proxy is in shoot.mjs (`/live/*`); the
// page's `?live=1` switches fake-host.ts from the fake backend to it.

const SESSION = 'ses_coffee';
const only = process.env.README_ONLY ? new RegExp(process.env.README_ONLY) : null;

export const run = async (h) => {
  if (!process.env.DC_LIVE_PORT || !process.env.DC_LIVE_TOKEN) {
    console.log('readme-shots: DC_LIVE_PORT and DC_LIVE_TOKEN are not set, skipping');
    return;
  }
  const open = (width, height, surface, theme, label) => h.openPage({ width, height, surface, theme, label, query: `&live=1&session=${SESSION}` });
  const wants = (name) => !only || only.test(name);
  const listReady = (p) => p.waitFor('return doc.querySelectorAll(".dc-row[data-slug], .dc-card[data-slug]").length >= 3', 'the list');

  const openDesign = async (p, slug, boards) => {
    await listReady(p);
    await h.thumbsReady(p);
    await p.click(`.dc-card[data-slug="${slug}"] .dc-card-main, .dc-row[data-slug="${slug}"] .dc-row-main`);
    await h.wallReady(p, boards);
    await p.settle(900);
  };

  // 1. the wall with pins and the Comments drawer, dark, full screen
  if (wants('hero-wall-pins')) {
    console.log('hero-wall-pins');
    const p = await open(1400, 900, 'page', 'dark', 'hero');
    await openDesign(p, 'brewline-app', 6);
    await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Fit' });
    await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Comments' });
    await p.waitFor('return !!doc.querySelector(".dc-comment")', 'the comments drawer');
    await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Fit' });
    await p.settle(500);
    // Zoom in on the first two rows (the pins read better) and keep the third row cut off, as a real wall would be.
    const plans = await p.rect('.dc-board[data-board="plans@laptop"]');
    await p.wheel(plans.x + plans.w / 2, plans.y, 0, -110, { ctrl: true });
    await p.wheel(plans.x + plans.w / 2, plans.y, 0, -150);
    await p.settle(900);
    await p.shot('hero-wall-pins');
    await p.close();
  }

  // 2. the rail list, 400 px, dark
  if (wants('rail-list')) {
    console.log('rail-list');
    const p = await open(400, 780, 'panel', 'dark', 'rail-list');
    await listReady(p);
    await h.thumbsReady(p);
    await p.settle(400);
    await p.shot('rail-list-dark');
    await p.close();
  }

  // 3. the compact viewer in the rail, 400 px, light
  if (wants('rail-viewer')) {
    console.log('rail-viewer');
    const p = await open(400, 780, 'panel', 'light', 'rail-viewer');
    await openDesign(p, 'ledger-dashboard', 2);
    await p.shot('rail-viewer-light');
    await p.close();
  }

  // 4. the library: projects and folders in the sidebar
  if (wants('library')) {
    console.log('library');
    const p = await open(1400, 900, 'page', 'dark', 'library');
    await listReady(p);
    await h.thumbsReady(p);
    await p.settle(500);
    await p.shot('library-dark');
    await p.close();
  }

  // 5. a page and its Export menu, light
  if (wants('page-export')) {
    console.log('page-export');
    const p = await open(1400, 900, 'page', 'light', 'page-export');
    await openDesign(p, 'wanderly-landing', 1);
    await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Export' });
    await p.settle(300);
    await p.shot('page-export-menu');
    await p.close();
  }

  // 6. versions: compare an earlier version with the current design
  if (wants('versions')) {
    console.log('versions');
    const p = await open(1400, 900, 'page', 'dark', 'versions');
    await openDesign(p, 'brewline-app', 6);
    await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Versions' });
    await p.waitFor('return !!doc.querySelector(".dc-version")', 'the versions drawer');
    await p.settle(300);
    const count = await p.guest('return doc.querySelectorAll(".dc-version").length');
    await p.click('.dc-version .oc-sdk-btn', { text: 'Compare', nth: Math.max(0, count - 1) });
    await p.waitFor('return !!doc.querySelector(".dc-viewing")', 'the viewing banner');
    await h.wallReady(p, 6);
    await p.settle(1200);
    await p.shot('versions-compare');
    await p.close();
  }

  // 7. the ask bar with an element picked, and the build strip while the agent works
  if (wants('ask-build')) {
    console.log('ask-build');
    const p = await open(1400, 900, 'page', 'dark', 'ask-build');
    await openDesign(p, 'brewline-app', 6);
    const board = await p.rect('.dc-board[data-board="home@laptop"]');
    await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Fit' });
    await p.wheel(board.x + board.w / 2, board.y + board.h / 2, 0, -130, { ctrl: true });
    await p.wheel(board.x + board.w / 2, board.y + board.h / 2, 0, -90);
    await p.settle(600);
    const zoomed = await p.rect('.dc-board[data-board="home@laptop"]');
    const pick = [zoomed.x + zoomed.w * 0.2, zoomed.y + zoomed.h * 0.3];
    await p.move(...pick);
    await p.settle(300);
    await p.clickAt(...pick);
    await p.waitFor('return !!doc.querySelector(".dc-ask-chip:not([hidden])")', 'the ask bar chip');
    await p.key('Escape', { focus: '.dc-composer textarea' });
    await p.type('.dc-ask-input', 'Make this headline shorter and warmer');
    await p.host(`window.__host.setActivity("${SESSION}", "running")`);
    await p.waitFor('return doc.querySelector(".dc-build")?.dataset.phase === "working"', 'the build strip');
    await p.settle(1400);
    await p.shot('ask-bar-build-strip');
    await p.close();
  }

  // 8. the design systems list, then a system's page with its specimen board
  if (wants('systems')) {
    console.log('systems');
    const p = await open(1400, 900, 'page', 'light', 'systems');
    await listReady(p);
    await p.click('.dc-library-bar .oc-sdk-btn', { text: 'Design systems' });
    await p.waitFor('return doc.querySelectorAll(".dc-sys[data-id]").length >= 2', 'the systems list');
    await p.settle(600);
    await p.shot('systems-list');
    await p.click('.dc-sys[data-id="brewline"] .dc-sys-main');
    await p.waitFor('return !!doc.querySelector(".dc-syspg[data-state=\\"ready\\"]")', 'the system page');
    await p.waitFor('return doc.querySelector(".dc-sys-board")?.dataset.state === "ready"', 'the board', 30000);
    await p.click('.dc-syspg-area-name', { text: 'Components' });
    await p.click('.dc-syspg-row[data-focus-key="row:components"]');
    await p.settle(1500);
    await p.shot('system-page');
    await p.close();
  }

  // 9. settings
  if (wants('settings')) {
    console.log('settings');
    const p = await open(1400, 900, 'page', 'dark', 'settings');
    await listReady(p);
    await p.click('.dc-library-bar .dc-iconbtn[aria-label="Settings"]');
    await p.waitFor('return !!doc.querySelector(".dc-settings .dc-code")', 'settings');
    await p.settle(2000);
    await p.shot('settings');
    await p.close();
  }

  // 10. Tweaks: the knobs the agent declared, live on the wall
  if (wants('tweaks')) {
    console.log('tweaks');
    const p = await open(1400, 900, 'page', 'light', 'tweaks');
    await openDesign(p, 'brewline-app', 6);
    await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Fit' });
    await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Tweaks' });
    await p.settle(900);
    await p.shot('tweaks');
    await p.close();
  }

  // 11. Edit mode: click an element, get the comment box and the selection toolbar
  if (wants('edit-toolbar')) {
    console.log('edit-toolbar');
    const p = await open(1400, 900, 'page', 'light', 'edit-toolbar');
    await openDesign(p, 'brewline-app', 6);
    const board = await p.rect('.dc-board[data-board="home@laptop"]');
    await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Fit' });
    await p.wheel(board.x + board.w / 2, board.y + board.h / 2, 0, -130, { ctrl: true });
    await p.wheel(board.x + board.w / 2, board.y + board.h / 2, 0, -90);
    await p.settle(700);
    const zoomed = await p.rect('.dc-board[data-board="home@laptop"]');
    const pick = [zoomed.x + zoomed.w * 0.2, zoomed.y + zoomed.h * 0.3];
    await p.move(...pick);
    await p.settle(300);
    await p.clickAt(...pick);
    await p.waitFor('return !!doc.querySelector(".dc-composer")', 'the comment box');
    await p.settle(500);
    await p.shot('edit-toolbar');
    await p.close();
  }

  // 12. The chat blocks, on the fake service (a block frame has no designs folder of its own)
  if (wants('chat-blocks')) {
    console.log('chat-blocks');
    const card = await h.openPage({ width: 640, height: 300, surface: 'block', theme: 'dark', label: 'block-card', block: { name: 'DesignCard', args: { slug: 'coffee-subscription' } } });
    await card.waitFor('return !!doc.querySelector(".dcb-card[data-state=ready] .dcb-preview[data-state=ready], .dcb-card[data-state=ready] .dcb-preview[data-state=note]")', 'the card');
    await card.settle(500);
    await card.shot('chat-block-design-card');
    await card.close();
    const pick = await h.openPage({ width: 640, height: 330, surface: 'block', theme: 'dark', label: 'block-pick', block: { name: 'DirectionPick', args: { question: 'Which direction should the pricing page take?', options: 'Warm and editorial|Clean product grid|Habit-style cards', slugs: 'coffee-subscription|northwind-pricing|habit-tracker' }, answered: null } });
    await pick.waitFor('return doc.querySelectorAll(".dcb-pick-tile, [role=radio]").length >= 3', 'the pick tiles').catch(() => undefined);
    await pick.settle(900);
    await pick.shot('chat-block-direction-pick');
    await pick.close();
  }
};
