// Visual scenario for the Checks badge (feat/checks-badge): the badge in each header, the findings
// popover (page) or sheet (rail), every state, the keyboard path, a rendering run, Ask the agent
// to fix, and the badge going away while an old version is on show.
// `helpers` is what the other scenarios use: openPage, check, listReady, thumbsReady, wallReady,
// menuItem, scaleLabel, sleep, outDir.

const BADGE = '.dc-checks-badge';

export const run = async (helpers) => {
  for (const theme of ['dark', 'light']) {
    for (const width of [320, 480]) await scenario(helpers, { surface: 'panel', width, theme });
    await scenario(helpers, { surface: 'page', width: 1400, theme });
  }
};

const scenario = async ({ openPage, check, checkSoon, listReady, wallReady, thumbsReady, sleep }, { surface, width, theme }) => {
  const rail = surface === 'panel';
  const tag = `checks-${rail ? 'rail' : 'page'}-${width}-${theme}`;
  const p = await openPage({ width, height: rail ? 780 : 900, surface, theme, label: tag });
  console.log(tag);
  await listReady(p);
  await thumbsReady(p);

  const tone = () => p.guest(`return doc.querySelector('${BADGE}')?.dataset.tone ?? 'neutral'`);
  // In the rail the badge shows a number, so states are matched on the accessible name, which carries the words everywhere.
  const badgeIs = (text) => {
    const name = text === 'Checks' ? 'Checks: didn’t load' : `Checks: ${text}`;
    return p.waitFor(`return (doc.querySelector('${BADGE}')?.getAttribute('aria-label') ?? '').startsWith(${JSON.stringify(name)})`, `badge "${text}"`);
  };
  const panelSel = rail ? '.dc-sheet[data-variant="full"]' : '.dc-pop';
  const openDesign = async (slug, ready = 1) => {
    await p.click(rail ? `.dc-row[data-slug="${slug}"] .dc-row-main` : `.dc-card[data-slug="${slug}"] .dc-card-main`);
    await wallReady(p, ready);
    await p.waitFor(`return !!doc.querySelector('${BADGE}')`, 'the badge');
    await p.settle(500);
  };
  const back = async () => {
    await p.click(rail ? '.dc-toolbar-compact .dc-iconbtn[aria-label="Back to designs"]' : '.dc-toolbar .oc-sdk-btn', rail ? {} : { text: 'Library' });
    await listReady(p);
  };
  const openPanel = async () => {
    await p.click(BADGE);
    await p.waitFor(`return !!doc.querySelector('${panelSel} .dc-checks-panel')`, 'the findings');
    await p.settle(250);
  };
  const closePanel = async () => {
    await p.key('Escape');
    await p.waitFor(`return !doc.querySelector('${panelSel} .dc-checks-panel')`, 'the findings to close');
  };
  const fits = () =>
    p.guest(`
      const r = doc.querySelector('${panelSel}')?.getBoundingClientRect();
      const b = doc.querySelector('${BADGE}')?.getBoundingClientRect();
      const t = doc.querySelector('.dc-title-text, .dc-title-input')?.getBoundingClientRect();
      const row = [...doc.querySelectorAll('.dc-toolbar-compact .dc-toolbar-row:first-child > *, .dc-toolbar-compact .dc-compact-actions > *')].filter((n) => n.getClientRects().length);
      const rowInside = row.every((n) => { const q = n.getBoundingClientRect(); return q.left >= 0 && q.right <= win.innerWidth; });
      return { rowInside, overflow: doc.documentElement.scrollWidth > doc.documentElement.clientWidth, panelInside: !r || (r.left >= 0 && r.right <= win.innerWidth && r.bottom <= win.innerHeight), badgeInside: !!b && b.right <= win.innerWidth && b.left >= 0, titleWidth: t ? Math.round(t.width) : null };`);

  // ---- a canvas with errors, a warning and older rendering findings
  await openDesign('coffee-subscription', 2);
  await badgeIs('3 issues');
  check((await tone()) === 'error', `${tag}: errors make the badge red (tone ${await tone()})`);
  check(await p.guest(`return doc.querySelector('${BADGE}').getAttribute('aria-label') === 'Checks: 3 issues'`), `${tag}: the badge has an accessible name with the count`);
  const where = await p.guest(`return doc.querySelector('${BADGE}').closest('${rail ? '.dc-compact-actions' : '.dc-status-slot'}') !== null`);
  check(where, `${tag}: the badge sits in the ${rail ? 'compact actions' : 'status slot'}`);
  let size = await fits();
  check(!size.overflow && size.badgeInside, `${tag}: the header does not overflow with the badge`);
  if (rail) check(size.rowInside, `${tag}: back, title, Comments, Versions, Checks and the menu all sit inside the rail`);
  if (rail) check(size.titleWidth >= 100, `${tag}: the title keeps room beside the badge (${size.titleWidth}px)`);
  await p.shot(`${tag}-1-badge-issues`);

  await openPanel();
  check(await p.guest(`const d = doc.querySelector('${panelSel}'); return (d.getAttribute('role') ?? d.querySelector('[role=dialog]')?.getAttribute('role')) === 'dialog' && !!(d.getAttribute('aria-labelledby') ?? d.querySelector('[role=dialog]')?.getAttribute('aria-labelledby'))`), `${tag}: the findings are a labelled dialog`);
  check(await p.guest(`return doc.activeElement?.textContent.includes('Ask the agent to fix') ?? false`), `${tag}: focus lands on Ask the agent to fix`);
  check(await p.guest(`return doc.querySelector('${BADGE}').getAttribute('aria-expanded') === 'true'`), `${tag}: the badge says the dialog is open`);
  check(
    (await p.guest(`return [...doc.querySelectorAll('${panelSel} .dc-checks-group-title')].map((n) => n.textContent.trim()).join('|')`)) === 'Needs fixing · 2|Worth a look · 1|Notes · 1|From before your latest changes · 2',
    `${tag}: groups read Needs fixing, Worth a look, Notes and the older findings`,
  );
  check(await p.guest(`return doc.querySelector('${panelSel} .dc-checks-render')?.textContent === 'Rendering was checked before your latest changes.'`), `${tag}: the rendering line says the check is old`);
  size = await fits();
  check(size.panelInside && !size.overflow, `${tag}: the findings fit the window`);
  await p.shot(`${tag}-2-findings`);
  await p.guest(`for (const d of doc.querySelectorAll('${panelSel} details')) d.open = true; const body = doc.querySelector('${panelSel} .dc-pop-body, ${panelSel} .dc-sheet-body'); if (body) body.scrollTop = 9999;`);
  await p.settle(200);
  await p.shot(`${tag}-3-findings-expanded`);

  // a refetch repaints the findings in place: a focused disclosure keeps focus and stays open
  await p.guest(`const s = [...doc.querySelectorAll('${panelSel} summary.dc-checks-group-title')].find((n) => n.textContent.startsWith('Notes')); s.parentElement.open = true; s.focus();`);
  const getsBefore = await p.host('window.frames[0].__dcFake.checks.gets("coffee-subscription")');
  await p.host('window.frames[0].__dcFake.checks.touch("coffee-subscription")');
  await sleep(1600);
  check((await p.host('window.frames[0].__dcFake.checks.gets("coffee-subscription")')) > getsBefore, `${tag}: a checks event made the badge ask again`);
  check(await p.guest(`const a = doc.activeElement; return a?.tagName === 'SUMMARY' && a.textContent.startsWith('Notes') && a.parentElement.open`), `${tag}: focus stays on the Notes disclosure, still open, across a refresh`);
  check(await p.guest(`return [...doc.querySelectorAll('${panelSel} .dc-checks-render')].every((n) => !n.hasAttribute('role') && !n.hasAttribute('aria-live'))`), `${tag}: the rendering line is not a live region`);
  check(await p.guest(`const f = [...doc.querySelectorAll('${panelSel} .dc-checks-actions .oc-sdk-btn')].filter((n) => n.dataset.emphasis === 'primary').map((n) => n.textContent.trim()); return f.length === 1 && f[0] === 'Ask the agent to fix'`), `${tag}: with issues, Ask the agent to fix is the filled button`);
  // what a screen reader is told is counted from here on
  await p.guest(`win.__said = []; const live = doc.querySelector('.dc-checks .dc-sr-only'); new win.MutationObserver(() => win.__said.push(live.textContent)).observe(live, { childList: true, characterData: true, subtree: true });`);

  // keyboard: Tab wraps inside, Escape closes and gives focus back to the badge.
  await p.key('Tab', { focus: `${panelSel} .dc-checks-actions .oc-sdk-btn:last-child` });
  check(await p.guest(`return !!doc.activeElement?.closest('${panelSel}')`), `${tag}: Tab from the last control stays inside the dialog`);
  await closePanel();
  check(await p.guest(`return doc.activeElement === doc.querySelector('${BADGE}')`), `${tag}: Escape closes the findings and focus goes back to the badge`);

  // a rendering run: busy, then the result is counted and announced
  await p.host('window.frames[0].__dcFake.checks.setRunMs(6500)');
  await openPanel();
  await p.click(`${panelSel} .dc-checks-actions .oc-sdk-btn`, { text: 'Check again' });
  await badgeIs('Checking');
  check(await p.guest(`return doc.querySelector('${panelSel} .dc-checks-actions .oc-sdk-btn[data-loading="true"]') !== null`), `${tag}: the run button shows it is working`);
  check(await p.guest(`return doc.querySelector('${panelSel} .dc-checks-render').textContent === 'Checking the rendering…'`), `${tag}: the rendering line says it is checking`);
  await p.settle(250);
  await p.shot(`${tag}-4-running`);
  await badgeIs('5 issues');
  await sleep(1500);
  const said = await p.guest('return win.__said');
  check(JSON.stringify(said) === JSON.stringify(['Checking the rendering…', 'Rendering check finished. 5 issues.']), `${tag}: a run is announced twice, start and end, and nothing else (${JSON.stringify(said)})`);
  await checkSoon(
    async () => (await p.guest(`return [...doc.querySelectorAll('${panelSel} .dc-checks-group-title')].map((n) => n.textContent.trim()).join('|')`)) === 'Needs fixing · 4|Worth a look · 1|Notes · 1',
    `${tag}: after the run the new findings are counted and the old group is gone`,
  );
  await p.shot(`${tag}-5-after-run`);

  // Ask the agent to fix: the shared delivery. The harness has another chat selected, so the request
  // goes through the outbox and the linked chat is opened (the rail sends it); one message, not a composer append.
  await p.host('window.__host.composes.length = 0; window.__host.sessionsOpened.length = 0; window.__host.toasts.length = 0');
  await p.click(`${panelSel} .dc-checks-actions .oc-sdk-btn`, { text: 'Ask the agent to fix' });
  await p.waitFor(`return !doc.querySelector('${panelSel} .dc-checks-panel')`, 'the findings to close after asking');
  await checkSoon(() => p.host('window.__host.sessionsOpened.includes("ses_coffee")'), `${tag}: the request went to the linked chat (opened through the outbox)`);
  await checkSoon(() => p.host('JSON.stringify(window.__host.toasts.map((t) => t.message)) === JSON.stringify(["Opening the linked chat to send it."])'), `${tag}: one toast, saying the chat is opening`);
  check(await p.host('window.__host.composes.length === 0'), `${tag}: nothing was appended to the composer on top of it`);
  await p.shot(`${tag}-6-asked`);

  // an old version on show hides the badge
  if (rail) {
    await p.click('.dc-compact-actions .dc-versions-btn');
  } else await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Versions' });
  await p.waitFor('return !!doc.querySelector(".dc-version")', 'versions');
  await p.click('.dc-version .oc-sdk-btn', { text: 'Compare', nth: 2 });
  await p.waitFor('return !!doc.querySelector(".dc-viewing")', 'the viewing banner');
  await checkSoon(() => p.guest(`const b = doc.querySelector('${BADGE}'); return !b || b.closest('.dc-checks').hidden`), `${tag}: the badge is hidden while an old version is on show`);
  await p.click('.dc-viewing .oc-sdk-btn', { text: 'Back to current' });
  await checkSoon(() => p.guest(`const b = doc.querySelector('${BADGE}'); return !!b && !b.closest('.dc-checks').hidden`), `${tag}: the badge is back on the current design`);
  await back();

  // ---- a page that passes with the rendering checked
  await openDesign('northwind-pricing');
  await badgeIs('No issues');
  check((await tone()) === 'success', `${tag}: a checked pass is green`);
  await p.shot(`${tag}-7-pass`);
  await openPanel();
  check(await p.guest(`return doc.querySelector('${panelSel} .dc-checks-summary').textContent === 'No errors or warnings.'`), `${tag}: the pass panel says no errors or warnings`);
  check(await p.guest(`return doc.querySelector('${panelSel} .dc-checks-render').textContent.startsWith('Rendered 1 artboard')`), `${tag}: the rendering line says when it was checked`);
  check(await p.guest(`const b = [...doc.querySelectorAll('${panelSel} .dc-checks-actions .oc-sdk-btn')].find((n) => n.textContent.includes('Ask the agent to fix')); return !!b && b.disabled && b.title === 'Nothing to fix'`), `${tag}: Ask the agent to fix is off, with the reason`);
  check(await p.guest(`const f = [...doc.querySelectorAll('${panelSel} .dc-checks-actions .oc-sdk-btn')].filter((n) => n.dataset.emphasis === 'primary').map((n) => n.textContent.trim()); return f.length === 1 && f[0] === 'Check again'`), `${tag}: with nothing to fix, Check again is the filled button`);
  await p.shot(`${tag}-8-pass-panel`);
  await closePanel();
  await back();

  // ---- files fine, rendering never checked: neutral, with the next step
  await openDesign('invoice-template');
  await badgeIs('1 issue');
  check((await tone()) === 'warning', `${tag}: a warning makes the badge amber`);
  await openPanel();
  check(await p.guest(`return doc.querySelector('${panelSel} .dc-checks-render').textContent === 'Rendering hasn’t been checked yet.'`), `${tag}: the panel says the rendering was never checked`);
  await p.shot(`${tag}-9-never-checked`);
  await closePanel();
  await back();

  // ---- no browser: nothing more to learn, so a pass is green; no Check rendering button
  await openDesign('habit-tracker', 2);
  await badgeIs('No issues');
  check((await tone()) === 'success', `${tag}: with no browser a pass is green`);
  await openPanel();
  check(await p.guest(`return doc.querySelector('${panelSel} .dc-checks-render').textContent.startsWith('No Chrome, Edge or Chromium was found')`), `${tag}: the panel says no browser was found`);
  check(await p.guest(`return ![...doc.querySelectorAll('${panelSel} .dc-checks-actions .oc-sdk-btn')].some((n) => !n.hidden && n.textContent.includes('Check'))`), `${tag}: there is no Check rendering button without a browser`);
  await p.shot(`${tag}-10-no-browser`);
  await closePanel();
  await back();

  // ---- screens the agent has not written yet are errors, until it writes them
  await openDesign('onboarding-flow', 0).catch(() => undefined);
  await badgeIs('3 issues');
  await openPanel();
  await p.shot(`${tag}-11-unwritten`);
  await closePanel();
  await back();

  // ---- the service does not answer: the badge says so and the panel offers Try again
  await p.host('window.frames[0].__dcFake.checks.setFail(true)');
  await openDesign('launch-announcement');
  await badgeIs('Checks');
  check((await tone()) === 'neutral', `${tag}: a failed load is neutral`);
  await openPanel();
  check(await p.guest(`return doc.querySelector('${panelSel} .dc-checks-panel .oc-sdk-banner-title')?.textContent === 'Checks didn’t load'`), `${tag}: the panel says what happened`);
  await p.shot(`${tag}-12-error`);
  await p.host('window.frames[0].__dcFake.checks.setFail(false)');
  await p.click(`${panelSel} .dc-checks-panel .oc-sdk-btn`, { text: 'Try again' });
  await badgeIs('No issues');
  check(await p.guest(`return !doc.querySelector('${panelSel} .dc-checks-panel .oc-sdk-banner')`), `${tag}: Try again clears the error`);
  check((await tone()) === 'neutral', `${tag}: clean files with an unchecked rendering stay neutral, not green`);
  check(await p.guest(`return doc.querySelector('${BADGE}').getAttribute('aria-label').includes('Rendering hasn’t been checked yet')`), `${tag}: the neutral pass says what is missing`);
  await p.settle(200);
  await p.shot(`${tag}-13-neutral-pass`);
  await closePanel();
  void sleep;
  await p.close();
};
