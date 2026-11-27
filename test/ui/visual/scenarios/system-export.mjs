// Visual scenario for system-builder-depth T19u (token export): the rail at 320 and 480 px and the page at 1400 px, dark and
// light. The menu entry, the sheet's formats (Tailwind only for tidepool, whose project uses it), loading, a failed format
// check and a failed export with Try again, the export itself, the "Export saved" notice with the renamed names and Show in
// folder, and the empty system. Plus once each: no entry on a phone, and the entry off while a value is unsaved.
// DC_SYSEXPORT_ONLY=<tag regex> limits the variants.

const FAKE = 'window.frames[0].__dcFake';
const text = (p, selector) => p.guest(`return (doc.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);
const noOverflow = (p) => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth && [...doc.querySelectorAll(".dc-sheet-body, .dc-notices")].every((n) => n.scrollWidth <= n.clientWidth + 1)');
const surfaceName = (surface) => (surface === 'panel' ? 'rail' : 'page');
const menuRows = (p) => p.guest('return [...doc.querySelectorAll(".dc-popup [role=menuitem]")].map((n) => n.querySelector(".oc-sdk-option-label")?.textContent)');
const formats = (p) => p.guest('return [...doc.querySelectorAll(".dc-export-format")].map((n) => n.dataset.format).join(",")');
const sheetOpen = (p) => p.guest('return !!doc.querySelector(".dc-export")');
const exportLog = async (p) => JSON.parse(await p.host(`JSON.stringify(${FAKE}.systems.exportLog())`));

const openSystem = async (h, p, surface, id, tag) => {
  if (surface === 'panel') await p.click('.dc-rail-head .dc-iconbtn[aria-label="Design systems"]');
  else await p.click('.dc-library-bar .oc-sdk-btn', { text: 'Design systems' });
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the list is up`);
  await p.click(`.dc-sys[data-id="${id}"] .dc-sys-main`);
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg[data-state=\\"ready\\"]")'), `${tag}: the system page loads`);
  await p.settle(500);
};

const openMenu = async (p) => {
  await p.click('.dc-syspg-tools .dc-iconbtn[aria-label="More"]');
  await p.settle(150);
};

const openExport = async (p) => {
  await openMenu(p);
  await p.click('.dc-popup [role="menuitem"]', { text: 'Export tokens…' });
};

const flow = async (h, surface, width, theme) => {
  const tag = `sysexport-${surfaceName(surface)}-${width}-${theme}`;
  const p = await h.openPage({ width, height: 800, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openSystem(h, p, surface, 'tidepool', tag);

  // ---- the menu
  await openMenu(p);
  h.check((await menuRows(p)).includes('Export tokens…'), `${tag}: the ⋯ menu offers Export tokens…`);
  await p.shot(`${tag}-1-menu`);
  await p.key('Escape');

  // ---- loading
  await p.host(`${FAKE}.route('GET /systems/:id/export', { body: { formats: ['dtcg', 'css', 'tailwind'] }, delayMs: 1500 })`);
  await openExport(p);
  await h.checkSoon(async () => (await text(p, '.dc-export .dc-sheet-body')).includes('Checking the formats'), `${tag}: loading says what it is doing`);
  await p.shot(`${tag}-2-loading`);
  await h.checkSoon(async () => (await formats(p)) === 'dtcg,css,tailwind', `${tag}: tidepool lists three formats, Tailwind among them`);
  h.check((await p.guest('return doc.querySelectorAll(".dc-export-format [aria-checked=\\"true\\"]").length')) === 3, `${tag}: all three are ticked`);
  h.check(await noOverflow(p), `${tag}: nothing scrolls sideways in the sheet`);
  await p.shot(`${tag}-3-formats`);
  await p.host(`${FAKE}.clearRoutes()`);

  // ---- nothing ticked: said on press, nothing sent
  for (const format of ['dtcg', 'css', 'tailwind']) await p.click(`.dc-export-format[data-format="${format}"] .oc-sdk-check`);
  h.check((await p.guest('return doc.querySelectorAll(".dc-export-format [aria-checked=\\"true\\"]").length')) === 0, `${tag}: a click unticks a format`);
  await p.click('.dc-export .dc-sheet-foot .oc-sdk-btn', { text: 'Export ZIP' });
  await h.checkSoon(async () => (await text(p, '.dc-export [role="alert"]')) === 'Pick at least one format.', `${tag}: with nothing ticked it says what is missing`);
  h.check((await exportLog(p)).length === 0, `${tag}: and sends nothing`);
  for (const format of ['dtcg', 'css']) await p.click(`.dc-export-format[data-format="${format}"] .oc-sdk-check`);

  // ---- a failed export keeps the ticks and offers Try again
  await p.host(`${FAKE}.route('POST /systems/:id/export', { status: 500, body: { error: 'internal', message: 'The export folder is read only.' } })`);
  await p.click('.dc-export .dc-sheet-foot .oc-sdk-btn', { text: 'Export ZIP' });
  await h.checkSoon(async () => (await text(p, '.dc-export [role="alert"]')).startsWith('Couldn’t export.'), `${tag}: a failed export says so`);
  h.check((await text(p, '.dc-export .dc-sheet-foot')).includes('Try again'), `${tag}: and offers Try again`);
  h.check((await p.guest('return doc.querySelectorAll(".dc-export-format [aria-checked=\\"true\\"]").length')) === 2, `${tag}: the ticks are kept`);
  await p.shot(`${tag}-4-export-failed`);

  // ---- exporting: busy, then the notice
  await p.host(`${FAKE}.route('POST /systems/:id/export', { body: { path: 'C:\\\\Users\\\\you\\\\Downloads\\\\tidepool-tokens.zip', bytes: 2048, formats: ['dtcg', 'css'], renamed: 2 }, delayMs: 1200 })`);
  await p.click('.dc-export .dc-sheet-foot .oc-sdk-btn', { text: 'Try again' });
  await h.checkSoon(async () => (await text(p, '.dc-export .dc-sheet-foot')).includes('Exporting…'), `${tag}: while it writes the button says Exporting…`);
  h.check(await p.guest('return [...doc.querySelectorAll(".dc-export .dc-sheet-foot .oc-sdk-btn")].every((b) => b.disabled)'), `${tag}: both buttons are off meanwhile`);
  await p.shot(`${tag}-5-exporting`);
  await h.checkSoon(async () => !(await sheetOpen(p)), `${tag}: the sheet closes when it is done`);
  await h.checkSoon(async () => (await text(p, '.dc-export-notice')).includes('tidepool-tokens.zip'), `${tag}: the notice says where the file went`);
  const notice = await text(p, '.dc-export-notice');
  h.check(notice.includes('2 names were changed'), `${tag}: and how many names were renamed (${notice})`);
  h.check(!/[—–]/.test(notice), `${tag}: no dash`);
  h.check(JSON.parse(await p.host('JSON.stringify(window.__host.toasts.map((t) => t.message))')).some((m) => m.startsWith('Saved to ')), `${tag}: a Saved to toast, as designs have`);
  h.check(await noOverflow(p), `${tag}: nothing scrolls sideways`);
  await p.shot(`${tag}-6-saved`);
  await p.host(`${FAKE}.clearRoutes()`);

  // ---- Show in folder reveals that file
  await p.click('.dc-export-notice .oc-sdk-btn', { text: 'Show in folder' });
  await h.checkSoon(async () => (await p.host(`JSON.stringify(${FAKE}.systems.revealLog())`)).includes('tidepool-tokens.zip'), `${tag}: Show in folder asks the service to reveal the ZIP`);

  // ---- the format check fails, then works on Try again
  await p.host(`${FAKE}.route('GET /systems/:id/export', { status: 500, body: { error: 'internal', message: 'The design system could not be read.' } })`);
  await openExport(p);
  await h.checkSoon(async () => (await text(p, '.dc-export [role="alert"]')).startsWith('Couldn’t check the formats.'), `${tag}: a failed format check says so`);
  await p.shot(`${tag}-7-formats-failed`);
  await p.host(`${FAKE}.clearRoutes()`);
  await p.click('.dc-export .dc-sheet-foot .oc-sdk-btn', { text: 'Try again' });
  await h.checkSoon(async () => (await formats(p)) === 'dtcg,css,tailwind', `${tag}: Try again loads the formats`);
  await p.key('Escape');
  await h.checkSoon(async () => !(await sheetOpen(p)), `${tag}: Escape closes the sheet`);
  await p.close();
};

// Harbor's project doesn't use Tailwind, and none of its names clash.
const noTailwind = async (h) => {
  const tag = 'sysexport-rail-320-dark-plain';
  const p = await h.openPage({ width: 320, height: 800, surface: 'panel', theme: 'dark', label: tag });
  console.log(tag);
  await h.listReady(p);
  await openSystem(h, p, 'panel', 'harbor', tag);
  await openExport(p);
  await h.checkSoon(async () => (await formats(p)) === 'dtcg,css', `${tag}: no Tailwind row when the service doesn't offer it`);
  await p.click('.dc-export .dc-sheet-foot .oc-sdk-btn', { text: 'Export ZIP' });
  await h.checkSoon(async () => (await text(p, '.dc-export-notice')).includes('harbor-tokens.zip'), `${tag}: the notice names the file`);
  h.check(!(await text(p, '.dc-export-notice')).includes('changed'), `${tag}: nothing about renames when none`);
  h.check(JSON.stringify(await exportLog(p)) === JSON.stringify([{ id: 'harbor', formats: ['dtcg', 'css'] }]), `${tag}: one request with both formats`);
  await p.shot(`${tag}-1-saved`);

  // empty: a system with no tokens
  await p.host(`${FAKE}.systems.patchDetail('harbor', { tokens: [] })`);
  await p.host(`${FAKE}.systems.redrawScreens('harbor')`);
  await p.settle(900);
  await openExport(p);
  await h.checkSoon(async () => (await text(p, '.dc-export .dc-sheet-body')).includes('no tokens to export yet'), `${tag}: an empty system says so`);
  h.check(!(await text(p, '.dc-export .dc-sheet-foot')).includes('Export'), `${tag}: and offers nothing to press but Close`);
  await p.shot(`${tag}-2-empty`);
  await p.close();
};

const offAndPhone = async (h) => {
  let tag = 'sysexport-page-1400-light-dirty';
  let p = await h.openPage({ width: 1400, height: 800, surface: 'page', theme: 'light', label: tag });
  console.log(tag);
  await h.listReady(p);
  await openSystem(h, p, 'page', 'tidepool', tag);
  await p.click('.dc-syspg-row[data-focus-key="row:colours"]');
  await p.click('.dc-sp-entry[data-entry="token:--brand"] .dc-sp-value[data-focus-key="token:--brand:light"]');
  await p.type('.dc-sp-entry[data-entry="token:--brand"] .dc-sp-input', '#a0301f');
  await p.key('Enter');
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg-editbar")'), `${tag}: a value is unsaved`);
  await openMenu(p);
  const row = await p.guest('const n = [...doc.querySelectorAll(".dc-popup [role=menuitem]")].find((x) => x.textContent.startsWith("Export tokens")); return n ? `${n.getAttribute("aria-disabled")}|${n.textContent}` : ""');
  h.check(row === 'true|Export tokens…Save or discard your changes first.', `${tag}: Export is off and says why (${row})`);
  await p.shot(`${tag}-1-menu`);
  await p.close();

  tag = 'sysexport-rail-360-dark-phone';
  p = await h.openPage({ width: 360, height: 800, surface: 'panel', theme: 'dark', label: tag, query: '&device=phone' });
  console.log(tag);
  await h.listReady(p);
  await openSystem(h, p, 'panel', 'tidepool', tag);
  await openMenu(p);
  const rows = await menuRows(p);
  h.check(rows.includes('Rename') && !rows.includes('Export tokens…'), `${tag}: no Export on a phone (${rows.join(', ')})`);
  await p.shot(`${tag}-1-menu`);
  await p.close();
};

export const run = async (h) => {
  const only = process.env.DC_SYSEXPORT_ONLY ? new RegExp(process.env.DC_SYSEXPORT_ONLY) : /./;
  const plan = [];
  for (const theme of ['dark', 'light']) {
    for (const width of [320, 480]) plan.push([`rail-${width}-${theme}`, () => flow(h, 'panel', width, theme)]);
    plan.push([`page-1400-${theme}`, () => flow(h, 'page', 1400, theme)]);
  }
  plan.push(['plain', () => noTailwind(h)]);
  plan.push(['phone', () => offAndPhone(h)]);
  for (const [name, step] of plan) if (only.test(name)) await step();
};
