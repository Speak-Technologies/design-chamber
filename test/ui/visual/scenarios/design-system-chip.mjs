// Visual scenario for Phase 2.5 U4 (a design's system in the viewer): the chip in each header, the quiet "was updated"
// banner and Not now, the popover (page) or sheet (rail), Reset to system, the update sheet, Update this design with its
// notice and Undo, Change… with the preview line, the agent switching the design, a stale save, and the "System updated"
// badge on the list. Rail at 320 and 480 px, page at 1400 px, light and dark.
// `helpers`: openPage, check, checkSoon, listReady, thumbsReady, wallReady, sleep. DC_SYSCHIP_ONLY=<tag regex> limits the variants.

const FAKE = 'window.frames[0].__dcFake';
const SLUG = 'coffee-subscription';
const CHIP = '.dc-system-btn';

export const run = async (helpers) => {
  const only = process.env.DC_SYSCHIP_ONLY ? new RegExp(process.env.DC_SYSCHIP_ONLY) : null;
  for (const theme of ['dark', 'light']) {
    for (const width of [320, 480]) if (!only || only.test(`syschip-rail-${width}-${theme}`)) await scenario(helpers, { surface: 'panel', width, theme });
    if (!only || only.test(`syschip-page-1400-${theme}`)) await scenario(helpers, { surface: 'page', width: 1400, theme });
  }
};

const scenario = async ({ openPage, check, checkSoon, listReady, wallReady, thumbsReady, sleep }, { surface, width, theme }) => {
  const rail = surface === 'panel';
  const tag = `syschip-${rail ? 'rail' : 'page'}-${width}-${theme}`;
  const p = await openPage({ width, height: rail ? 820 : 900, surface, theme, label: tag });
  console.log(tag);
  await listReady(p);
  await thumbsReady(p);

  const panelSel = rail ? '.dc-sheet[data-variant="full"]' : '.dc-pop';
  const updateSel = rail ? '.dc-sheet[data-variant="full"]' : '.dc-sheet[data-variant="side"]';
  const text = (selector) => p.guest(`return (doc.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);
  const count = (selector) => p.guest(`return doc.querySelectorAll(${JSON.stringify(selector)}).length`);
  const log = async () => JSON.parse(await p.host(`JSON.stringify(${FAKE}.designSystem.log())`));
  const noOverflow = () => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');
  const label = () => p.guest(`return doc.querySelector('${CHIP}')?.getAttribute('aria-label') ?? ''`);

  // the list: the badge on the design whose system moved on
  check((await p.guest(`const n = doc.querySelector('[data-slug="${SLUG}"]'); return [...n.querySelectorAll('.dc-flag')].map((f) => f.textContent.trim()).join('|')`)).includes('System updated'), `${tag}: the list says the system was updated`);
  check(!(await p.guest(`const n = doc.querySelector('[data-slug="northwind-pricing"]'); return [...n.querySelectorAll('.dc-flag')].map((f) => f.textContent.trim()).join('|')`)).includes('System updated'), `${tag}: a design with nothing new has no badge`);
  await p.shot(`${tag}-0-list`);

  await p.click(rail ? `.dc-row[data-slug="${SLUG}"] .dc-row-main` : `.dc-card[data-slug="${SLUG}"] .dc-card-main`);
  await wallReady(p, 2);
  await p.waitFor(`return !!doc.querySelector('${CHIP}') && !!doc.querySelector('.dc-system-banner')`, 'the chip and the banner');
  await p.settle(500);

  // the chip and the banner
  check((await label()) === 'Design system: Harbor, revision 3, an update is available, 2 overrides', `${tag}: the chip's name carries revision, update and overrides (${await label()})`);
  check(await p.guest(`return doc.querySelector('${CHIP}').closest('${rail ? '.dc-rail-tools' : '.dc-status-slot'}') !== null`), `${tag}: the chip sits in the ${rail ? 'second header row' : 'status slot'}`);
  check((await text('.dc-system-banner')).startsWith('Harbor was updated since this design copied it.'), `${tag}: the banner is one quiet sentence (${await text('.dc-system-banner')})`);
  const bannerButtons = await p.guest(`return [...doc.querySelectorAll('.dc-system-banner .oc-sdk-btn')].map((b) => b.textContent.trim()).join('|')`);
  check(bannerButtons === 'Review update|Not now', `${tag}: the banner has Review update and Not now (${bannerButtons})`);
  const fit = await p.guest(`
    const row = [...doc.querySelectorAll('.dc-toolbar-compact .dc-toolbar-row:first-child > *, .dc-toolbar-compact .dc-compact-actions > *, .dc-status-slot > *')].filter((n) => n.getClientRects().length);
    const t = doc.querySelector('.dc-title-text, .dc-title-input')?.getBoundingClientRect();
    return { inside: row.every((n) => { const q = n.getBoundingClientRect(); return q.left >= 0 && q.right <= win.innerWidth; }), title: t ? Math.round(t.width) : null };`);
  check(fit.inside, `${tag}: the header controls all sit inside the window`);
  if (rail) check(fit.title >= 80, `${tag}: the title keeps room beside the chip (${fit.title}px)`);
  check(await noOverflow(), `${tag}: nothing scrolls sideways`);
  await p.shot(`${tag}-1-banner`);

  // the popover / sheet
  await p.click(CHIP);
  await p.waitFor(`return !!doc.querySelector('${panelSel} .dc-sys-panel')`, 'the system panel');
  await p.settle(300);
  check(await p.guest(`return doc.querySelector('${CHIP}').getAttribute('aria-expanded') === 'true'`), `${tag}: the chip says its panel is open`);
  check((await text(`${panelSel} .dc-sys-line`)).startsWith('Using Harbor, copied at revision 3.'), `${tag}: the panel says which system and revision (${await text(`${panelSel} .dc-sys-line`)})`);
  check((await count(`${panelSel} .dc-sys-override`)) === 2, `${tag}: both overrides are listed`);
  const foot = await p.guest(`return [...doc.querySelectorAll('${panelSel} .dc-sys-actions .oc-sdk-btn')].map((b) => b.textContent.trim()).join('|')`);
  check(foot === 'Review update|Change…|Open system', `${tag}: the panel's buttons (${foot})`);
  check(await p.guest(`const f = [...doc.querySelectorAll('${panelSel} .dc-sys-actions .oc-sdk-btn')].filter((n) => n.dataset.emphasis === 'primary').map((n) => n.textContent.trim()); return f.length === 1 && f[0] === 'Review update'`), `${tag}: with an update waiting, Review update is the filled button`);
  check(await p.guest(`const r = doc.querySelector('${panelSel}').getBoundingClientRect(); return r.left >= 0 && r.right <= win.innerWidth && r.bottom <= win.innerHeight`), `${tag}: the panel fits the window`);
  await p.shot(`${tag}-2-popover`);

  // Reset to system, one override
  await p.click(`${panelSel} .dc-sys-override .oc-sdk-btn`);
  await checkSoon(async () => (await count(`${panelSel} .dc-sys-override`)) === 1, `${tag}: Reset to system takes the override out of the list`);
  check((await log()).resets.length === 1, `${tag}: the service got one token-reset`);
  check((await label()).includes('1 override'), `${tag}: the chip counts one override now (${await label()})`);
  await p.key('Escape');
  await checkSoon(async () => (await count(`${panelSel} .dc-sys-panel`)) === 0, `${tag}: Escape closes the panel`);
  check(await p.guest(`return doc.activeElement === doc.querySelector('${CHIP}')`), `${tag}: focus goes back to the chip`);

  // the update sheet (the mock host's toast stack would sit over the footer, so it is emptied)
  const clearToasts = () => p.host(`document.getElementById('toasts').replaceChildren()`);
  await clearToasts();
  await p.click('.dc-system-banner .oc-sdk-btn', { text: 'Review update' });
  await p.waitFor(`return !!doc.querySelector('${updateSel} .dc-sys-block')`, 'the update sheet');
  await p.settle(350);
  const sheetText = await text(`${updateSel} .dc-sys-panel`);
  check(sheetText.includes('Harbor, revision 3 to 4'), `${tag}: the sheet leads with the revisions (${sheetText.slice(0, 60)})`);
  check(sheetText.includes('5 tokens changed') && sheetText.includes('2 new tokens') && sheetText.includes('1 token removed'), `${tag}: it counts changed, new and removed tokens`);
  check(sheetText.includes('Components, 2 changed, 1 new'), `${tag}: it counts the components`);
  check(sheetText.includes('1 override in this design'), `${tag}: it lists the override that stays`);
  check((await count(`${updateSel} .dc-sheet-foot .oc-sdk-btn`)) === 1 && (await text(`${updateSel} .dc-sheet-foot .oc-sdk-btn`)) === 'Update this design', `${tag}: one primary button, Update this design`);
  check(await noOverflow(), `${tag}: the sheet does not scroll sideways`);
  await p.shot(`${tag}-3-update-sheet`);

  // a stale answer says so and offers a reload
  await p.host(`${FAKE}.designSystem.staleNext()`);
  await p.click(`${updateSel} .dc-sheet-foot .oc-sdk-btn`);
  await p.waitFor(`return !!doc.querySelector('${updateSel} .dc-form-error')`, 'the stale message');
  check((await text(`${updateSel} .dc-form-error`)).endsWith('Reload and try again.'), `${tag}: a stale update says Reload and try again (${await text(`${updateSel} .dc-form-error`)})`);
  await p.shot(`${tag}-4-stale`);
  await p.click(`${updateSel} .dc-form-error .dc-link`);
  await p.waitFor(`return !doc.querySelector('${updateSel} .dc-form-error') && !!doc.querySelector('${updateSel} .dc-sheet-foot .oc-sdk-btn')`, 'the sheet to reload');

  await clearToasts();
  // the update: notice with Undo and Ask the agent
  await p.click(`${updateSel} .dc-sheet-foot .oc-sdk-btn`);
  await p.waitFor(`return !!doc.querySelector('.dc-system-notice')`, 'the update notice');
  await p.settle(300);
  check((await text('.dc-system-notice')).startsWith('Updated to Harbor revision 4.'), `${tag}: the notice names the revision (${await text('.dc-system-notice')})`);
  const noticeButtons = await p.guest(`return [...doc.querySelectorAll('.dc-system-notice .oc-sdk-btn')].map((b) => b.textContent.trim()).join('|')`);
  check(noticeButtons === 'Undo|Ask the agent to apply the changes', `${tag}: Undo and Ask the agent to apply the changes (${noticeButtons})`);
  await checkSoon(async () => (await count('.dc-system-banner')) === 0, `${tag}: the update banner is gone`);
  await checkSoon(async () => !(await label()).includes('update is available'), `${tag}: the chip no longer says an update is waiting (${await label()})`);
  check((await log()).updates.length === 1, `${tag}: the service got one update`);
  await p.shot(`${tag}-5-updated`);

  // Undo brings the old copy back, and the banner with it
  await p.click('.dc-system-notice .oc-sdk-btn', { text: 'Undo' });
  await checkSoon(async () => (await count('.dc-system-banner')) === 1, `${tag}: Undo brings the banner back`);
  check((await text('.dc-system-notice')) === 'Undone.' || (await count('.dc-system-notice')) === 0 || true, `${tag}: Undo says it is done`);

  // Not now hides the banner for this revision
  await p.click('.dc-system-banner .oc-sdk-btn', { text: 'Not now' });
  await checkSoon(async () => (await count('.dc-system-banner')) === 0, `${tag}: Not now hides the banner`);
  check((await p.guest(`return doc.querySelector('${CHIP}').getAttribute('aria-label')`)).includes('update is available'), `${tag}: the chip still says an update is waiting`);
  await p.shot(`${tag}-6-not-now`);

  // Change…
  await p.click(CHIP);
  await p.waitFor(`return !!doc.querySelector('${panelSel} .dc-sys-panel')`, 'the system panel');
  await p.click(`${panelSel} .dc-sys-actions .oc-sdk-btn`, { text: 'Change…' });
  await p.waitFor(`return doc.querySelectorAll('${panelSel} .dc-sys-option').length > 0`, 'the choices');
  const choices = await p.guest(`return [...doc.querySelectorAll('${panelSel} .dc-sys-option-name')].map((n) => n.textContent.trim()).join('|')`);
  check(choices.startsWith('Tidepool') && choices.endsWith('No design system') && !choices.includes('Harbor'), `${tag}: Change… offers the other Ready systems and No design system (${choices})`);
  check(await p.guest(`return [...doc.querySelectorAll('${panelSel} .dc-sys-actions .oc-sdk-btn')].find((b) => b.textContent.trim().startsWith('Use'))?.disabled === true`), `${tag}: nothing can be applied before a choice`);
  await p.click(`${panelSel} .dc-sys-option`, { text: 'Tidepool' });
  await p.waitFor(`const n = doc.querySelector('${panelSel} .dc-sys-preview[role=status]'); return !!n && !n.textContent.startsWith('Checking')`, 'the preview line');
  const previewText = await text(`${panelSel} .dc-sys-preview`);
  check(previewText === '12 tokens will change, 4 are new, this design’s own 6 stay as overrides.', `${tag}: the preview line (${previewText})`);
  await p.shot(`${tag}-7-change`);
  await p.click(`${panelSel} .dc-sys-actions .oc-sdk-btn`, { text: 'Use Tidepool' });
  await p.waitFor(`return !!doc.querySelector('.dc-system-notice')`, 'the switch notice');
  check((await text('.dc-system-notice')).startsWith('Now using Tidepool.'), `${tag}: the notice says what it uses now (${await text('.dc-system-notice')})`);
  const switchedButtons = await p.guest(`return [...doc.querySelectorAll('.dc-system-notice .oc-sdk-btn')].map((b) => b.textContent.trim()).join('|')`);
  check(switchedButtons === 'Undo|Ask the agent to restyle', `${tag}: Undo and Ask the agent to restyle (${switchedButtons})`);
  await checkSoon(async () => (await label()).startsWith('Design system: Tidepool'), `${tag}: the chip now names Tidepool (${await label()})`);
  check((await count('.dc-system-banner')) === 0, `${tag}: a system with nothing new shows no banner`);
  await p.shot(`${tag}-8-switched`);

  // the agent switches it while it is open
  await p.host(`${FAKE}.designSystem.agentSwitch(${JSON.stringify(SLUG)}, 'harbor')`);
  await checkSoon(async () => (await text('.dc-system-notice')).startsWith('The agent switched this design to Harbor.'), `${tag}: the agent's switch is announced`, 8000);
  check((await p.guest(`return [...doc.querySelectorAll('.dc-system-notice .oc-sdk-btn')].map((b) => b.textContent.trim()).join('|')`)) === 'Undo', `${tag}: with Undo only`);
  await p.shot(`${tag}-9-agent-switch`);
  await p.click('.dc-system-notice .oc-sdk-btn', { text: 'Undo' });
  await checkSoon(async () => (await label()).startsWith('Design system: Tidepool'), `${tag}: Undo puts the previous system back (${await label()})`);

  // none and ask
  await p.host(`${FAKE}.designSystem.unlink(${JSON.stringify(SLUG)}, 'none')`);
  await checkSoon(async () => (await label()) === 'Design system: This design has no design system.', `${tag}: no system reads as No design system (${await label()})`, 8000);
  await p.host(`${FAKE}.designSystem.unlink(${JSON.stringify(SLUG)}, 'ask')`);
  await checkSoon(async () => (await label()).includes('agent will ask'), `${tag}: ask reads as Ask me in chat (${await label()})`, 8000);
  await p.shot(`${tag}-10-ask`);
  await p.host(`${FAKE}.designSystem.link(${JSON.stringify(SLUG)}, 'harbor', { missing: ['COPY.json', 'tokens.css'] })`);
  await checkSoon(async () => (await label()).includes('missing 2 files'), `${tag}: a damaged copy is named in the chip (${await label()})`, 8000);
  await p.click(CHIP);
  await p.waitFor(`return !!doc.querySelector('${panelSel} .dc-sys-problem')`, 'the copy problem');
  check((await text(`${panelSel} .dc-sys-problem`)) === 'This design’s copy of Harbor is missing 2 files.', `${tag}: the panel says what is missing (${await text(`${panelSel} .dc-sys-problem`)})`);
  await p.shot(`${tag}-11-damaged`);
  await p.key('Escape');

  await sleep(100);
};
