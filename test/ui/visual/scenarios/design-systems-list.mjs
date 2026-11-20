// Visual scenario for Phase 2.5 U1 (the design systems list and the New design system sheet): the rail at 320 and 480 px
// and the page, light and dark. Rows with every badge and the "+N" fold, the shared-repo line, the row menu (Make
// default says why it is off for a draft), rename and delete with their sentences, the empty list and its three
// starts, the skeleton, the unreadable system, the list that didn't load; and the sheet: validation on press, a code scan
// (running, cancel, done with fonts and logos ticked, failed with the input kept), brand files by drop with each refused
// file named, a description, a make that works, one with a refused file, and an agent request that fails and is tried
// again. `helpers`: openPage, check, checkSoon, listReady.

const FAKE = 'window.frames[0].__dcFake';
const noOverflow = (p) => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');
const toastTexts = (p) => p.host('JSON.stringify(window.__host.toasts.map((t) => t.message))');
const text = (p, selector) => p.guest(`return (doc.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);
const log = async (p) => JSON.parse(await p.host(`JSON.stringify(${FAKE}.systems.log())`));
const row = (id) => `.dc-sys[data-id="${id}"]`;
const CHECK = '.dc-newsys-head .oc-sdk-check';
const MAKE = '.dc-sheet-foot .oc-sdk-btn';

/** The harness's toasts sit over the bottom of the frame; clear them before reaching for a row there. */
const clearToasts = (p) => p.host("document.querySelectorAll('.toast').forEach((n) => n.remove())");

const surfaceName = (surface) => (surface === 'panel' ? 'rail' : 'page');

/** Open the systems list from the surface's own header. */
const openList = async (p, surface) => {
  if (surface === 'panel') await p.click('.dc-rail-head .dc-iconbtn[aria-label="Design systems"]');
  else await p.click('.dc-library-bar .oc-sdk-btn', { text: 'Design systems' });
};

const openSheetFromList = async (p) => {
  await p.click('.oc-sdk-btn', { text: 'New design system' });
  await p.waitFor('return !!doc.querySelector(".dc-newsys")', 'the New design system sheet');
  await p.settle(350);
};

/** Drop synthetic files on the sheet's drop zone, as a person dropping from a file manager does. */
const dropFiles = (p, files) =>
  p.guest(`
    const dt = new win.DataTransfer();
    for (const [name, size] of ${JSON.stringify(files)}) dt.items.add(new win.File([new Uint8Array(size)], name));
    const zone = doc.querySelector('.dc-newsys-drop');
    if (!zone) return false;
    const fire = (type) => zone.dispatchEvent(new win.DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    fire('dragenter');
    fire('dragover');
    const over = zone.dataset.drop === 'over';
    fire('drop');
    return over;`);

const listFlow = async (h, surface, width, theme) => {
  const tag = `systems-${surfaceName(surface)}-${width}-${theme}`;
  const p = await h.openPage({ width, height: surface === 'panel' ? 820 : 900, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openList(p, surface);
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the list shows the five systems`);
  await p.settle(350);

  // ---- rows, badges, folding
  const names = await p.guest('return [...doc.querySelectorAll(".dc-sys .dc-sys-title")].map((n) => n.textContent)');
  h.check(JSON.stringify(names) === '["Tidepool","Acme","Harbor","Field notes","Juniper"]', `${tag}: one row per system, newest change first (${names.join(', ')})`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow`);
  const tidepool = await text(p, `${row('tidepool')} .dc-sys-line`);
  h.check(tidepool.includes('Repo · tidepool-web') && tidepool.includes('Changes to review') && tidepool.includes('Default'), `${tag}: Tidepool shows its home, Changes to review and Default`);
  h.check((await text(p, `${row('tidepool')} .dc-sys-more`)).startsWith('+1') && (await p.guest(`return doc.querySelector('${row('tidepool')} .dc-sys-more').title === 'Pinned for shop'`)), `${tag}: a third badge folds into +1 with its tooltip (Pinned for shop)`);
  h.check((await p.guest(`return doc.querySelector('${row('tidepool')} .dc-sys-main').getAttribute('aria-label')`)).includes('Pinned for shop'), `${tag}: the row's accessible name still lists the folded badge`);
  h.check((await text(p, `${row('acme')} .dc-sys-line`)).includes('Being built') && (await text(p, `${row('acme')} .dc-sys-notice`)).includes('tidepool-web already has a repo-backed system (Tidepool).'), `${tag}: a repo-backed draft says it is being built and names the shared repo`);
  h.check((await text(p, `${row('acme')} .dc-sys-name`)).includes('Draft') && (await text(p, `${row('harbor')} .dc-sys-name`)).includes('Ready'), `${tag}: Draft and Ready are said in words`);
  const harbor = await text(p, `${row('harbor')} .dc-sys-line`);
  h.check(harbor.includes('In Design Chamber') && harbor.includes('Pinned for shop'), `${tag}: an internal system reads In Design Chamber, a single pin names its project`);
  h.check((await text(p, `${row('juniper')} .dc-sys-line`)).includes('Living page out of date'), `${tag}: the living page state shows when it needs a look`);
  const harborMeta = await text(p, `${row('harbor')} .dc-sys-meta`);
  h.check(harborMeta.includes('From brand files') && harborMeta.includes('Used by 2 designs'), `${tag}: the meta line says what it was made from and who uses it`);
  h.check((await text(p, `${row('acme')} .dc-sys-meta`)).includes('Not used by a design yet'), `${tag}: an unused system says so`);
  h.check(await p.guest('return [...doc.querySelectorAll(".dc-sys-line")].every((l) => l.querySelectorAll(".dc-sys-badge").length <= 3)'), `${tag}: never more than the home line and two badges`);
  await p.shot(`${tag}-1-list`);

  // ---- the row menu
  await p.hover(row('acme'));
  await p.click(`${row('acme')} .dc-iconbtn`);
  const items = await p.guest('return [...doc.querySelectorAll(".dc-popup [role=menuitem]")].map((n) => n.textContent.replace(/\\s+/g, " ").trim())');
  h.check(items.join('|') === 'Open|Make defaultMark it ready first.|Reveal in folder|Rename|Delete…', `${tag}: the menu is Open, Make default (off, with its reason), Reveal, Rename, Delete (${items.join(' | ')})`);
  await p.shot(`${tag}-2-menu`);
  await p.key('Escape');
  await p.hover(row('tidepool'));
  await p.click(`${row('tidepool')} .dc-iconbtn`);
  h.check(await p.guest('return [...doc.querySelectorAll(".dc-popup [role=menuitem]")].some((n) => n.textContent === "Remove as default")'), `${tag}: the default system offers Remove as default`);
  await p.key('Escape');

  // Make default on a ready system: said in a toast and drawn on the row once the service confirms.
  await p.hover(row('harbor'));
  await p.click(`${row('harbor')} .dc-iconbtn`);
  await p.click('.dc-popup [role="menuitem"]', { text: 'Make default' });
  await h.checkSoon(async () => (await toastTexts(p)).includes('Harbor is now the default for new designs.'), `${tag}: Make default says what happened`);
  await h.checkSoon(() => p.guest(`return doc.querySelector('${row('harbor')} .dc-sys-line').textContent.includes('Default')`), `${tag}: the row shows Default after the service confirms`);

  // ---- rename: validation next to the field, the service's last word, the row follows
  await p.hover(row('field-notes'));
  await p.click(`${row('field-notes')} .dc-iconbtn`);
  await p.click('.dc-popup [role="menuitem"]', { text: 'Rename' });
  await p.waitFor('return !!doc.querySelector(".dc-sheet[data-variant=dialog] input")', 'the rename dialog');
  await p.type('.dc-sheet input', 'harbor');
  await h.checkSoon(() => p.guest('return /You already have a system called Harbor\\./.test(doc.querySelector(".dc-sheet")?.textContent ?? "")'), `${tag}: a name taken in any case is refused beside the field`);
  await p.type('.dc-sheet input', 'Field journal');
  await p.click('.dc-sheet .oc-sdk-btn', { text: 'Rename' });
  await h.checkSoon(() => p.guest(`return doc.querySelector('${row('field-notes')} .dc-sys-title')?.textContent === 'Field journal'`), `${tag}: the row shows the new name`);

  // ---- delete: a confirm that says where it goes and what keeps working
  await p.hover(row('field-notes'));
  await p.click(`${row('field-notes')} .dc-iconbtn`);
  await p.click('.dc-popup [role="menuitem"]', { text: 'Delete…' });
  await p.waitFor('return !!doc.querySelector(".dc-confirm-body")', 'the delete confirm');
  h.check((await text(p, '.dc-confirm-body')) === 'It moves to the trash. The design that uses it keeps its copy.', `${tag}: Delete says it moves to the trash and what the design that uses it keeps`);
  await p.shot(`${tag}-3-delete`);
  await p.click('.dc-sheet .oc-sdk-btn', { text: 'Delete design system' });
  await h.checkSoon(() => p.guest(`return !doc.querySelector('${row('field-notes')}')`), `${tag}: the row is gone`);

  // ---- a row opens the system (U2 draws the page; until then it says so, it is not a dead click)
  await p.click(`${row('harbor')} .dc-sys-main`);
  await h.checkSoon(async () => /design system page/.test(await toastTexts(p)), `${tag}: a row click is answered`);

  // ---- an unreadable system and a refresh that fails
  await p.host(`${FAKE}.systems.addUnreadable()`);
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-sys[data-state=unreadable]")'), `${tag}: a system whose files can't be read shows its reason`);
  h.check((await text(p, '.dc-sys[data-state=unreadable] .dc-sys-reason')).startsWith('Design Chamber can’t read this design system.'), `${tag}: the reason is the service's sentence`);
  h.check(await p.guest('return doc.querySelector(".dc-sys[data-state=unreadable] .dc-sys-main").tagName !== "BUTTON"'), `${tag}: an unreadable row is not a button that opens nothing`);
  await clearToasts(p);
  await p.hover('.dc-sys[data-state=unreadable]');
  await p.click('.dc-sys[data-state=unreadable] .dc-iconbtn');
  h.check((await p.guest('return [...doc.querySelectorAll(".dc-popup [role=menuitem]")].map((n) => n.textContent).join("|")')) === 'Reveal in folder|Delete…', `${tag}: it can still be revealed and deleted`);
  await p.key('Escape');
  await p.shot(`${tag}-4-unreadable`);
  await p.host(`${FAKE}.systems.failLoads(true)`);
  await p.host(`${FAKE}.systems.setDefaultId('harbor')`);
  await h.checkSoon(() => p.guest('return /Couldn.t refresh the list/.test(doc.querySelector(".dc-sys-notices")?.textContent ?? "")'), `${tag}: a failed refresh keeps the rows and says so with Try again`);
  h.check(await p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 4'), `${tag}: the rows stay while the refresh failed`);
  await p.host(`${FAKE}.systems.failLoads(false)`);
  await p.click('.dc-sys-notices .oc-sdk-btn', { text: 'Try again' });
  await h.checkSoon(() => p.guest('return doc.querySelector(".dc-sys-notices").hidden'), `${tag}: Try again clears the notice`);

  // ---- back
  if (surface === 'panel') await p.click('.dc-rail-head .dc-iconbtn[aria-label="Back to designs"]');
  else await p.click('.dc-sys-bar .oc-sdk-btn', { text: 'Library' });
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-row[data-slug], .dc-card[data-slug]")'), `${tag}: Back returns to the designs list`);
  h.check(await p.guest(`return (doc.activeElement?.getAttribute('aria-label') ?? doc.activeElement?.textContent ?? '').includes('Design systems')`), `${tag}: focus returns to the Design systems button`);
  await p.close();
};

// ---------------------------------------------------------------- the other states of the list

const statesFlow = async (h, surface, width, theme) => {
  const tag = `systems-states-${surfaceName(surface)}-${width}-${theme}`;
  const height = surface === 'panel' ? 760 : 820;
  console.log(tag);

  // loading: the answer is held, so the skeleton is on screen and matches the rows
  let p = await h.openPage({ width, height, surface, theme, label: `${tag}-loading`, routes: { 'GET /systems': { status: 200, body: { systems: [], total: 0, max: 50 }, delayMs: 2500 } } });
  await h.listReady(p);
  await openList(p, surface);
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys-skeleton").length === 4 && doc.querySelector(".dc-sys-list").getAttribute("aria-busy") === "true"'), `${tag}: a skeleton of four rows shows while the list loads`);
  await p.shot(`${tag}-1-loading`);
  await p.close();

  // empty: what goes here and the three ways to start
  p = await h.openPage({ width, height, surface, theme, label: `${tag}-empty`, routes: { 'GET /systems': { status: 200, body: { systems: [], total: 0, max: 50 } } } });
  await h.listReady(p);
  await openList(p, surface);
  await p.waitFor('return !!doc.querySelector(".dc-sys-empty")', 'the empty state');
  await p.settle(300);
  const empty = await text(p, '.dc-sys-empty');
  h.check(empty.includes('No design systems yet') && empty.includes('Make one from a project’s code'), `${tag}: the empty list says what goes here`);
  h.check((await p.guest('return [...doc.querySelectorAll(".dc-sys-empty-actions .oc-sdk-btn")].map((b) => b.textContent.trim()).join("|")')) === 'From code…|From brand files…|Describe…', `${tag}: the three ways to start`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow`);
  await p.shot(`${tag}-2-empty`);
  const starts = [
    ['From code…', [['code', true], ['brand', false], ['description', false]]],
    ['From brand files…', [['code', false], ['brand', true], ['description', false]]],
    ['Describe…', [['code', false], ['brand', false], ['description', true]]],
  ];
  for (const [action, expected] of starts) {
    await p.click('.dc-sys-empty-actions .oc-sdk-btn', { text: action });
    await p.waitFor('return !!doc.querySelector(".dc-newsys")', `the sheet from ${action}`);
    h.check(await p.guest(`const c = [...doc.querySelectorAll(".dc-newsys-source")].map((s) => [s.dataset.source, !s.querySelector(".dc-newsys-body").hidden]); return JSON.stringify(c) === ${JSON.stringify(JSON.stringify(expected))}`), `${tag}: ${action} opens the sheet with only its source ticked`);
    if (action === 'From code…') {
      await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-newsys-found")'), `${tag}: From code… reads the current project at once`);
      h.check(await p.guest('return doc.querySelector(".dc-newsys-form > div:first-child input").value === "ember-oak"'), `${tag}: and suggests its name for the empty Name field`);
    }
    await p.key('Escape');
    await p.settle(150);
  }
  await p.close();

  // the list did not load
  p = await h.openPage({ width, height, surface, theme, label: `${tag}-failed`, routes: { 'GET /systems': { status: 500, body: { error: 'internal', message: 'The design systems folder could not be read.' } } } });
  await h.listReady(p);
  await openList(p, surface);
  await p.waitFor('return !!doc.querySelector(".dc-sys-message .oc-sdk-banner")', 'the failure');
  await p.settle(300);
  const failed = await text(p, '.dc-sys-message');
  h.check(failed.includes('Your design systems didn’t load') && failed.includes('The design systems folder could not be read.'), `${tag}: the failure says what happened`);
  h.check(await p.guest('return [...doc.querySelectorAll(".dc-sys-message .oc-sdk-btn")].some((b) => b.textContent.trim() === "Try again")'), `${tag}: it offers Try again`);
  await p.shot(`${tag}-3-failed`);
  await p.close();
};

// ---------------------------------------------------------------- the sheet

const sheetFlow = async (h, surface, width, theme) => {
  const tag = `systems-sheet-${surfaceName(surface)}-${width}-${theme}`;
  const p = await h.openPage({ width, height: surface === 'panel' ? 900 : 1000, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openList(p, surface);
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the list is up`);
  await openSheetFromList(p);

  const sources = () => p.guest('return JSON.stringify([...doc.querySelectorAll(".dc-newsys-source")].map((s) => [s.dataset.source, !s.querySelector(".dc-newsys-body").hidden]))');
  h.check((await sources()) === '[["code",false],["brand",false],["description",true]]', `${tag}: the header button opens with a description ticked`);
  h.check((await text(p, '.dc-sheet-title')) === 'New design system', `${tag}: titled New design system`);
  h.check(await p.guest('const primary = [...doc.querySelectorAll(".dc-newsys .oc-sdk-btn[data-emphasis=primary]")]; return primary.length === 1 && primary[0].textContent.trim() === "Make design system"'), `${tag}: one primary action, Make design system`);
  h.check(await p.guest('return !!doc.querySelector(".dc-newsys .oc-sdk-field-label")'), `${tag}: fields have visible labels, not placeholders`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow`);
  await p.shot(`${tag}-1-sheet`);

  // Validation on press, not a greyed-out button: the name first, then the description.
  await p.click(MAKE, { text: 'Make design system' });
  await h.checkSoon(() => p.guest('return /Give the design system a name\\./.test(doc.querySelector(".dc-newsys")?.textContent ?? "")'), `${tag}: Make with no name says so beside the Name field`);
  h.check(await p.guest('return doc.activeElement?.tagName === "INPUT" && doc.activeElement.closest(".dc-newsys-form") !== null'), `${tag}: focus moves to the field that needs fixing`);
  await p.type('.dc-newsys-form > div:first-child input', 'harbor');
  await p.click(MAKE, { text: 'Make design system' });
  await h.checkSoon(() => p.guest('return /You already have a system called Harbor\\./.test(doc.querySelector(".dc-newsys")?.textContent ?? "")'), `${tag}: a name taken in any case is refused (You already have a system called Harbor.)`);
  await p.type('.dc-newsys-form > div:first-child input', 'Orchard');
  await p.click(MAKE, { text: 'Make design system' });
  await h.checkSoon(() => p.guest('return /Describe the look you want, pick a style preset, or untick A description\\./.test(doc.querySelector(".dc-newsys")?.textContent ?? "")'), `${tag}: an empty description is named too`);
  h.check((await log(p)).created.length === 0, `${tag}: nothing was made while the form had problems`);
  await p.shot(`${tag}-2-problems`);

  // ---- project code: the scan runs, can be cancelled, and reads back what it found
  await p.host(`${FAKE}.systems.slowScan(8)`);
  await p.click(CHECK, { text: 'Project code' });
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-newsys-running")'), `${tag}: ticking Project code reads the current project and shows it working`);
  await p.shot(`${tag}-3-scanning`);
  await p.click('.dc-newsys .oc-sdk-btn', { text: 'Cancel scan' });
  await h.checkSoon(async () => (await log(p)).cancelled >= 1, `${tag}: Cancel scan stops the scan on the service`);
  h.check(!(await p.guest('return !!doc.querySelector(".dc-newsys-running")')), `${tag}: the scan line is gone after Cancel`);
  await p.host(`${FAKE}.systems.slowScan(1)`);
  await p.click('.dc-newsys-scan .oc-sdk-btn', { text: 'Read ember-oak' });
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-newsys-found")'), `${tag}: a cancelled scan can be started again from Read ember-oak`);
  await p.settle(300);
  const found = await text(p, '.dc-newsys-found');
  h.check(found === 'Found 48 colours, 9 type styles, 12 spacing values, 4 corner radii, 3 shadows, 3 font files, 2 logo files in 14 files.', `${tag}: the scan sentence counts what it found (${found})`);
  h.check((await p.guest('return doc.querySelectorAll(".dc-newsys-assets .oc-sdk-check").length')) === 5, `${tag}: every font and logo found is listed with a tick`);
  h.check((await text(p, '.dc-newsys-assets')).includes('Check you’re allowed to use these fonts in designs.'), `${tag}: the font licence note is there`);
  h.check((await text(p, '.dc-newsys-scan')).includes('2 files Design Chamber doesn’t run. The agent will read them.'), `${tag}: files for the agent are named`);
  h.check(await p.guest('return doc.querySelector(".dc-newsys-form > div:first-child input").value === "Orchard"'), `${tag}: the name the user typed is kept (a project's name is only suggested into an empty field)`);
  h.check(!(await p.guest('return /Pick the project to read/.test(doc.querySelector(".dc-newsys")?.textContent ?? "")')), `${tag}: the pick-a-project line goes away once the scan is done`);
  await p.shot(`${tag}-4-scanned`);

  // A folder the service refuses keeps what was typed and says why.
  await p.click('.dc-newsys-source[data-source=code] .oc-sdk-trigger');
  await p.click('.oc-sdk-option', { text: 'Other folder…' });
  await p.type('.dc-newsys-source[data-source=code] .dc-newsys-other input', 'C:\\Users\\you\\Documents\\Designs');
  await p.key('Enter', { focus: '.dc-newsys-source[data-source=code] .dc-newsys-other input' });
  await h.checkSoon(() => p.guest('return /Pick your app.s folder, not the Designs folder\\./.test(doc.querySelector(".dc-newsys-scan")?.textContent ?? "")'), `${tag}: the Designs folder is refused with the service's sentence`);
  h.check(await p.guest('return doc.querySelector(".dc-newsys-source[data-source=code] .dc-newsys-other input").value.includes("Designs")'), `${tag}: the path the user typed is kept`);
  await p.shot(`${tag}-5-folder-refused`);
  await p.type('.dc-newsys-source[data-source=code] .dc-newsys-other input', 'C:\\Users\\you\\work\\shop');
  await p.key('Enter', { focus: '.dc-newsys-source[data-source=code] .dc-newsys-other input' });
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-newsys-found")'), `${tag}: another folder reads fine`);
  await p.click('.dc-newsys-assets .oc-sdk-check', { text: 'Inter 700' });
  // Make from the scan alone: untick the description first.
  await p.click(CHECK, { text: 'A description' });
  await p.type('.dc-newsys-form > div:first-child input', 'Orchard');
  await p.click(MAKE, { text: 'Make design system' });
  await h.checkSoon(async () => (await log(p)).created.length === 1, `${tag}: Make design system creates it`);
  const made = (await log(p)).created[0];
  h.check(made.name === 'Orchard' && made.body.code?.assets.length === 4 && !made.body.description && !made.body.brand, `${tag}: it was made from the scan with the 4 ticked files (Inter 700 unticked), no description`);
  await h.checkSoon(async () => /Made Orchard\. It’s a draft; the agent is writing it now\./.test(await toastTexts(p)), `${tag}: a toast says it is a draft and the agent is on it`);
  await h.checkSoon(() => p.guest('return !doc.querySelector(".dc-newsys")'), `${tag}: the sheet closes when everything went through`);
  await h.checkSoon(() => p.guest('return [...doc.querySelectorAll(".dc-sys-title")].some((n) => n.textContent === "Orchard")'), `${tag}: Orchard is in the list`);
  h.check(Number(await p.host('window.__host.sessionsStarted.length')) === 1, `${tag}: a new chat was started for the agent`);
  await p.close();
};

const brandFlow = async (h, surface, width, theme) => {
  const tag = `systems-brand-${surfaceName(surface)}-${width}-${theme}`;
  const p = await h.openPage({ width, height: surface === 'panel' ? 900 : 1000, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openList(p, surface);
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the list is up`);
  await openSheetFromList(p);
  await p.click(CHECK, { text: 'A description' });
  await p.click(CHECK, { text: 'Brand files' });
  await p.waitFor('return !!doc.querySelector(".dc-newsys-drop")', 'the drop zone');
  const zone = await text(p, '.dc-newsys-drop');
  h.check(zone.includes('Drop files here') && zone.includes('Fonts (woff2, woff, ttf, otf)'), `${tag}: the drop zone says what goes in and which types`);

  const over = await dropFiles(p, [
    ['Mark.svg', 3000],
    ['Inter-Bold.woff2', 90000],
    ['broken.png', 2000],
    ['brand.key', 400],
    ['huge.woff2', 5400000],
    ['empty.txt', 0],
  ]);
  h.check(over === true, `${tag}: dragging files over marks the zone as the target`);
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-newsys-file").length === 3'), `${tag}: three files are kept`);
  const refusedTexts = await p.guest('return [...doc.querySelectorAll(".dc-newsys-refused li")].map((n) => n.textContent)');
  h.check(refusedTexts.includes('brand.key isn’t a file type design systems use.') && refusedTexts.includes('huge.woff2 is too large (the limit is 5 MB).') && refusedTexts.includes('empty.txt is empty.'), `${tag}: each refused file is named with its reason (${refusedTexts.join(' | ')})`);
  const picked = await text(p, '.dc-newsys-picked');
  h.check(picked.includes('Logo') && picked.includes('Font'), `${tag}: each kept file says what it is and its size`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow`);
  await p.shot(`${tag}-1-files`);

  // Take one out, put it back, add a folder, then Make.
  await p.click('.dc-newsys-file .dc-iconbtn[aria-label="Remove Mark.svg"]');
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-newsys-file").length === 2'), `${tag}: a file can be taken out again`);
  await dropFiles(p, [['Mark.svg', 3000]]);
  await p.click('.dc-newsys .oc-sdk-btn', { text: 'Add from a folder…' });
  await p.type('.dc-newsys-source[data-source=brand] .dc-newsys-other input', 'brand');
  await p.type('.dc-newsys-form > div:first-child input', 'Orchard brand');
  await p.click(MAKE, { text: 'Make design system' });
  await h.checkSoon(() => p.guest('return /Use the full path of the folder/.test(doc.querySelector(".dc-newsys")?.textContent ?? "")'), `${tag}: a relative folder path is refused beside the field`);
  await p.type('.dc-newsys-source[data-source=brand] .dc-newsys-other input', 'C:\\Brand');
  await p.click(MAKE, { text: 'Make design system' });

  // One file the service refuses (broken.png) and one the folder refuses: the system is made, and the result names both.
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-newsys-result")'), `${tag}: with files refused, the sheet shows a result instead of closing`);
  await p.settle(300);
  const result = await text(p, '.dc-newsys-result');
  h.check(result.includes('2 files weren’t added.'), `${tag}: the headline says how many weren't added (${result.slice(0, 90)})`);
  h.check(result.includes('broken.png isn’t a real PNG file.') && result.includes('notes.key isn’t a file type design systems use.'), `${tag}: each file that was refused is named with its reason`);
  const l = await log(p);
  h.check(l.uploads.length >= 2 && l.uploads.every((u) => u.encoding === 'base64'), `${tag}: files went up as base64 uploads (${l.uploads.length})`);
  h.check(l.assets.map((a) => a.kind).sort().join(',') === 'font,logo', `${tag}: fonts and logos kept their kinds (${l.assets.map((a) => `${a.name}:${a.kind}`).join(', ')})`);
  await p.shot(`${tag}-2-result`);
  await p.click('.dc-sheet-foot .oc-sdk-btn', { text: 'Done' });
  await h.checkSoon(() => p.guest('return !doc.querySelector(".dc-newsys")'), `${tag}: Done closes the sheet`);
  await p.close();
};

const agentFlow = async (h, surface, width, theme) => {
  const tag = `systems-agent-${surfaceName(surface)}-${width}-${theme}`;
  const height = surface === 'panel' ? 900 : 1000;
  const p = await h.openPage({ width, height, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openList(p, surface);
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the list is up`);

  // The request can't reach the agent: the system still exists, and the sheet says what to do.
  await p.host(`${FAKE}.systems.failPrompt('The agent chat is not available right now.')`);
  await openSheetFromList(p);
  await p.type('.dc-newsys-form > div:first-child input', 'Meadow');
  await p.type('.dc-newsys textarea', 'Calm and confident, deep green, a serif for headings.');
  await p.click(MAKE, { text: 'Make design system' });
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-newsys-result")'), `${tag}: a request that did not reach the agent shows a result`);
  await p.settle(300);
  const result = await text(p, '.dc-newsys-result');
  h.check(result.includes('The agent wasn’t asked.') && result.includes('Couldn’t ask the agent') && result.includes('The agent chat is not available right now.'), `${tag}: it says Meadow exists and why the agent wasn't asked (${result.slice(0, 100)})`);
  h.check((await p.guest('return [...doc.querySelectorAll(".dc-newsys-result .oc-sdk-btn")].map((b) => b.textContent.trim()).join("|")')) === 'Try again', `${tag}: Try again is offered (Copy request only when there is a request to copy)`);
  await h.checkSoon(() => p.guest('return [...doc.querySelectorAll(".dc-sys-title")].some((n) => n.textContent === "Meadow")'), `${tag}: Meadow is in the list as a draft`);
  await p.shot(`${tag}-1-not-sent`);
  await p.host(`${FAKE}.systems.failPrompt(null)`);
  await p.click('.dc-newsys-result .oc-sdk-btn', { text: 'Try again' });
  await h.checkSoon(async () => /Asked the agent to write Meadow\./.test(await toastTexts(p)), `${tag}: Try again reaches the agent`);
  await h.checkSoon(() => p.guest('return !doc.querySelector(".dc-newsys")'), `${tag}: the sheet closes`);

  // The current chat: the request is attached and waits in the composer.
  await openSheetFromList(p);
  await p.type('.dc-newsys-form > div:first-child input', 'Lantern');
  await p.type('.dc-newsys textarea', 'Warm paper, ink blue.');
  await p.click('.dc-newsys [role=tab]', { text: 'Current chat' });
  await p.click(MAKE, { text: 'Make design system' });
  await h.checkSoon(async () => /The request is waiting in the chat composer\./.test(await toastTexts(p)), `${tag}: with Current chat the request waits in the composer`);
  h.check(Number(await p.host('window.__host.attached.length')) === 1 && Number(await p.host('window.__host.composes.length')) === 1, `${tag}: the system chip was attached and the request composed`);
  await p.close();
};

export const run = async (h) => {
  for (const theme of ['dark', 'light']) {
    for (const width of [320, 480]) {
      await listFlow(h, 'panel', width, theme);
      await statesFlow(h, 'panel', width, theme);
      await sheetFlow(h, 'panel', width, theme);
    }
    await listFlow(h, 'page', 1400, theme);
    await statesFlow(h, 'page', 1400, theme);
    await sheetFlow(h, 'page', 1400, theme);
  }
  // The long flows once per surface; the matrix above covers size and theme.
  await brandFlow(h, 'panel', 320, 'dark');
  await brandFlow(h, 'page', 1400, 'light');
  await agentFlow(h, 'panel', 480, 'light');
  await agentFlow(h, 'page', 1400, 'dark');
};
