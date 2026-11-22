// Visual scenario for Phase 2.6 E2 (the New design system sheet's Existing design system start): the rail at 320 px
// and the page at 1400 px, light and dark. The four starts with Existing fourth, discovery (running, candidates with
// marks and counts, the Complete badge, the registered one with Open, none found), the location field and its errors
// (a web address, outside the project, gone), the found-vs-missed column with the real Files read count, the register
// choice preselected with Recommended, the disabled agent field, Make beside it, the incomplete-contract line, the
// nudge from Project code (Start from it, Dismiss once), and a register that opens the system's page.
// `helpers`: openPage, check, checkSoon, listReady.

const FAKE = 'window.frames[0].__dcFake';
const noOverflow = (p) => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');
const text = (p, selector) => p.guest(`return (doc.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);
const toastTexts = (p) => p.host('JSON.stringify(window.__host.toasts.map((t) => t.message))');
const surfaceName = (surface) => (surface === 'panel' ? 'rail' : 'page');
const CHECK = '.dc-newsys-head .oc-sdk-check';
const LOC_INPUT = '.dc-newsys-g-where input[data-mono="true"]';
const LOC_NOTE = '.dc-newsys-g-where .oc-sdk-field-note';
const PRIMARY = '.dc-sheet-foot .oc-sdk-btn[data-emphasis="primary"]';

const openList = async (p, surface) => {
  if (surface === 'panel') await p.click('.dc-rail-head .dc-iconbtn[aria-label="Design systems"]');
  else await p.click('.dc-library-bar .oc-sdk-btn', { text: 'Design systems' });
};

const openSheet = async (p) => {
  await p.click('.oc-sdk-btn', { text: 'New design system' });
  await p.waitFor('return !!doc.querySelector(".dc-newsys")', 'the New design system sheet');
  await p.settle(300);
};

const tickExisting = async (p, tag) => {
  await p.click(CHECK, { text: 'Existing design system' });
  await p.waitFor('return !doc.querySelector(".dc-newsys-g-where").hidden', 'the Existing column');
};

// At the rail's width the read column sits under the options, below the fold: scroll it into view for the picture.
const reveal = async (p, surface, selector, block = 'start') => {
  if (surface === 'panel') await p.guest(`doc.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: ${JSON.stringify(block)} })`);
  await p.settle(120);
};

const waitCandidates = (p, tag) => p.waitFor('return doc.querySelectorAll(".dc-newsys-cand").length >= 4', `${tag}: the candidates`);

/** One column at the rail's width, three at the page's: the where column sits under (rail) or beside (page) the options. */
const checkLayout = async (h, p, tag, wide) => {
  const layout = await p.guest(`
    const opts = doc.querySelector('.dc-newsys-g-opts').getBoundingClientRect();
    const where = doc.querySelector('.dc-newsys-g-where').getBoundingClientRect();
    const result = doc.querySelector('.dc-newsys-g-result').getBoundingClientRect();
    return { stacked: where.top >= opts.bottom - 1, beside: where.left >= opts.right - 1 && result.left >= where.right - 1 };`);
  if (wide) h.check(layout.beside && !layout.stacked, `${tag}: three columns at laptop width (start / location / what was read)`);
  else h.check(layout.stacked && !layout.beside, `${tag}: one column at this width`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow`);
};

const sheetFlow = async (h, surface, width, theme) => {
  const tag = `existing-${surfaceName(surface)}-${width}-${theme}`;
  const p = await h.openPage({ width, height: surface === 'panel' ? 900 : 1000, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openList(p, surface);
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the list is up`);
  await openSheet(p);

  // The four starts, Existing fourth, each hint saying what Design Chamber does and what the agent does.
  const labels = await p.guest('return [...doc.querySelectorAll(".dc-newsys-source .oc-sdk-check-label")].map((n) => n.textContent)');
  h.check(JSON.stringify(labels) === '["Project code","Brand files","A description","Existing design system"]', `${tag}: the four starts in order (${labels.join(', ')})`);
  h.check((await text(p, '.dc-newsys-source[data-source="existing"] .oc-sdk-check-desc')).includes('the agent reads its page, docs and components'), `${tag}: the Existing hint says what the agent reads`);
  await p.host(`${FAKE}.systems.slowScan(6)`);
  await tickExisting(p, tag);
  await h.checkSoon(() => p.guest('return (doc.querySelector(".dc-newsys-discovery")?.textContent ?? "").includes("Looking for a design system in ember-oak")'), `${tag}: discovery says it is looking through the project`);
  h.check(await p.guest('return [...doc.querySelectorAll(".dc-newsys-discovery .oc-sdk-btn")].some((b) => b.textContent.includes("Cancel scan"))'), `${tag}: discovery can be cancelled`);
  await checkLayout(h, p, tag, surface === 'page');
  await p.shot(`${tag}-1-discovering`);

  await waitCandidates(p, tag);
  await p.settle(300);
  h.check((await text(p, '.dc-newsys-pick-head')).includes('Looks like a design system') && (await text(p, '.dc-newsys-pick-note')) === '6 places found', `${tag}: the heading counts every place found`);
  const first = await text(p, '.dc-newsys-cand');
  h.check(first.includes('design-system/') && first.includes('Complete') && first.includes('system.json, page, tokens, 3 docs') && first.includes('24 colours · 29 tokens'), `${tag}: the contract candidate carries its marks, counts and the Complete badge (${first})`);
  const badges = await p.guest('return [...doc.querySelectorAll(".dc-newsys-cand")].map((c) => !!c.querySelector(".dc-newsys-cand-badge"))');
  h.check(JSON.stringify(badges) === '[true,false,false,false]', `${tag}: Complete only on the contract folder`);
  const registered = await text(p, '.dc-newsys-cand:nth-child(2)');
  h.check(registered.includes('apps/web/design-system/') && registered.includes('Already in Design Chamber as Juniper') && registered.includes('Open'), `${tag}: the registered candidate says so and offers Open`);
  h.check((await text(p, '.dc-newsys-cands')).includes('and 2 more. Type a folder below to use another.'), `${tag}: the more line points at the field`);
  h.check((await text(p, '.dc-newsys-g-where')).includes('Where does it live?') && (await text(p, LOC_NOTE)) === 'A folder inside ember-oak. Design Chamber only reads it.', `${tag}: the location field says what it reads`);
  h.check(await p.guest(`return doc.querySelector('${PRIMARY}').textContent.trim() === 'Make design system'`), `${tag}: before a location is read the button is Make design system`);
  await p.shot(`${tag}-2-candidates`);

  // The kit's select popup opens under its trigger inside the sheet (fixed popups, no layout containment).
  await p.click('.dc-newsys-g-where .oc-sdk-trigger');
  await p.waitFor('return !!doc.querySelector(".oc-sdk-popup")', 'the project select popup');
  const placed = await p.guest(`
    const t = doc.querySelector('.dc-newsys-g-where .oc-sdk-trigger').getBoundingClientRect();
    const pop = doc.querySelector('.oc-sdk-popup').getBoundingClientRect();
    return Math.abs(pop.left - t.left) <= 2 && Math.abs(pop.top - (t.bottom + 4)) <= 6;`);
  h.check(placed, `${tag}: the project select popup sits under its trigger`);
  await p.shot(`${tag}-2b-select-open`);
  await p.key('Escape');
  await p.settle(150);

  // One action: pick the candidate, the field fills and the folder is read.
  await p.click('.dc-newsys-cand-path-label', { text: 'design-system/' });
  await h.checkSoon(() => p.guest(`return doc.querySelector('${LOC_INPUT}').value === 'design-system'`), `${tag}: picking a candidate fills the field`);
  await p.waitFor('return !!doc.querySelector(".dc-newsys-found-line")', 'the location read');
  await p.settle(300);
  h.check(await p.guest('return doc.querySelector(".dc-newsys-cand input").checked'), `${tag}: the picked candidate stays ticked`);
  const read = await text(p, '.dc-newsys-g-result');
  h.check(read.includes('What Design Chamber read') && read.includes('In design-system/'), `${tag}: the read column is scoped to the folder`);
  h.check((await text(p, '.dc-newsys-found-line')) === 'Found 24 colours, 2 type styles, 3 shadows, 1 font file in 4 files.', `${tag}: the found sentence`);
  h.check(read.includes('It saw 1 page and 14 component files.'), `${tag}: the missed line says what was seen but never parsed`);
  h.check(read.includes('Left for the agent: design-system/index.html, 3 docs and 14 component files.'), `${tag}: what is left for the agent is named`);
  h.check(read.includes("Skipped bundle.css. It's larger than 1 MB, so it wasn't read."), `${tag}: the skipped file is named with its reason`);
  h.check((await text(p, '.dc-newsys-g-result details summary')) === 'Files read (6)', `${tag}: Files read counts the real read, not the files with values`);
  h.check(read.includes('Font: Speak Sans 400') && read.includes('Check you’re allowed to use these fonts in designs.'), `${tag}: the location's font is ticked with the licence note`);

  // Register it as it is: preselected, Recommended, Make beside it; the agent field is off with its reason.
  h.check(await p.guest('return doc.querySelector(".dc-newsys-choice[data-choice=register] input").checked && !doc.querySelector(".dc-newsys-choice[data-choice=make] input").checked'), `${tag}: Register it as it is is preselected`);
  h.check((await text(p, '.dc-newsys-choice[data-choice="register"]')).includes('Recommended'), `${tag}: Register carries Recommended`);
  h.check((await text(p, '.dc-newsys-choice[data-choice="register"]')).includes('Nothing is written to ember-oak and the agent isn’t asked.'), `${tag}: the register hint names the project and what it does not do`);
  h.check((await text(p, '.dc-newsys-choice[data-choice="make"]')).includes('Make a new system from it'), `${tag}: Make a new system from it sits beside it`);
  h.check(await p.guest(`return doc.querySelector('${PRIMARY}').textContent.trim() === 'Register design system'`), `${tag}: the primary reads Register design system`);
  h.check((await text(p, '.dc-newsys-repo-note')) === 'Your repository stays exactly as it is.', `${tag}: the footer keeps the repository promise`);
  h.check(await p.guest('return [...doc.querySelectorAll(".dc-newsys-agent [role=tab]")].every((t) => t.getAttribute("aria-disabled") === "true")'), `${tag}: Agent works in is disabled while registering`);
  h.check((await text(p, '.dc-newsys-agent .oc-sdk-field-note')) === 'Only needed when the agent writes the system. Registering it sends no request.', `${tag}: the disabled agent field says why`);
  h.check(await p.guest('return doc.querySelector(".dc-newsys-g-name input").value === "ember-oak"'), `${tag}: the project's name is suggested`);
  await checkLayout(h, p, tag, surface === 'page');
  await reveal(p, surface, '.dc-newsys-g-result');
  await p.shot(`${tag}-3-found-register`);

  // The disclosure lists the files with values, then the rest of the read.
  await p.click('.dc-newsys-g-result details summary');
  await p.settle(200);
  const files = await text(p, '.dc-newsys-g-result details');
  h.check(files.includes('tokens.css') && files.includes('18 values') && files.includes('and 2 more with no values.'), `${tag}: the disclosure lists values first, then the rest of the read`);
  await reveal(p, surface, '.dc-newsys-g-result details', 'center');
  await p.shot(`${tag}-4-files-read`);

  // Make beside it: the primary follows the choice and the agent field comes back.
  await p.click('.dc-newsys-choice[data-choice="make"] input');
  await h.checkSoon(() => p.guest(`return doc.querySelector('${PRIMARY}').textContent.trim() === 'Make design system'`), `${tag}: choosing Make swaps the primary`);
  h.check(await p.guest('return [...doc.querySelectorAll(".dc-newsys-agent [role=tab]")].every((t) => t.getAttribute("aria-disabled") === "false")'), `${tag}: the agent field is back for Make`);
  await p.click('.dc-newsys-choice[data-choice="register"] input');
  await h.checkSoon(() => p.guest(`return doc.querySelector('${PRIMARY}').textContent.trim() === 'Register design system'`), `${tag}: choosing Register swaps it back`);

  // A stale read: typing another folder after a read drops the stale read, so the footer cannot Register the old scan.
  await p.type(LOC_INPUT, 'style-guide');
  await h.checkSoon(() => p.guest(`return doc.querySelector('${PRIMARY}').textContent.trim() === 'Make design system'`), `${tag}: a different folder typed after a read puts the primary back to Make design system`);
  h.check(await p.guest('return !doc.querySelector(".dc-newsys-choice")'), `${tag}: the register choice is gone while the typed folder is unread`);
  h.check((await text(p, '.dc-newsys-g-result')).includes('This folder hasn’t been read yet. Press Read this folder to see what is in it.'), `${tag}: the read column says the typed folder has not been read`);
  h.check(!(await text(p, '.dc-newsys-g-result')).includes('In design-system/'), `${tag}: the read column no longer names the old folder`);
  h.check(await p.guest(`return doc.querySelector('${LOC_INPUT}').value === 'style-guide'`), `${tag}: what was typed is kept`);
  await reveal(p, surface, '.dc-newsys-g-result');
  await p.shot(`${tag}-3b-stale-read`);
  // Back to the complete folder and read it: the choice returns for that path, Register preselected.
  await p.type(LOC_INPUT, 'design-system');
  await p.click('.dc-newsys-g-where .oc-sdk-btn', { text: 'Read this folder' });
  await p.waitFor('return !!doc.querySelector(".dc-newsys-choice")', 'the register choice after reading again');
  h.check(await p.guest('return doc.querySelector(".dc-newsys-choice[data-choice=register] input").checked'), `${tag}: reading the complete folder again preselects Register`);
  h.check(await p.guest(`return doc.querySelector('${PRIMARY}').textContent.trim() === 'Register design system'`), `${tag}: the primary reads Register design system again`);

  // Register: a name edit, one press, a toast, and the system's page opens.
  await p.type('.dc-newsys-g-name input', 'Speak UI');
  await p.click(PRIMARY);
  await h.checkSoon(async () => (await toastTexts(p)).includes('Registered Speak UI from ember-oak. Review it, then mark it ready.'), `${tag}: the register toast says what to do next`);
  await h.checkSoon(() => p.guest('return !doc.querySelector(".dc-newsys")'), `${tag}: the sheet closes`);
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg")'), `${tag}: the registered system's page opens`);
  const log = JSON.parse(await p.host(`JSON.stringify(${FAKE}.systems.registerLog())`));
  h.check(log.length === 1 && log[0].name === 'Speak UI' && log[0].rel === 'design-system', `${tag}: one register of the location scan`);
  h.check(Number(await p.host('window.__host.sessionsStarted.length')) === 0, `${tag}: registering asks the agent nothing`);
  await p.settle(400);
  await p.shot(`${tag}-5-registered`);
  await p.close();
};

const errorsFlow = async (h, surface, width, theme) => {
  const tag = `existing-errors-${surfaceName(surface)}-${width}-${theme}`;
  const p = await h.openPage({ width, height: surface === 'panel' ? 900 : 1000, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openList(p, surface);
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the list is up`);
  await openSheet(p);
  await tickExisting(p, tag);
  await waitCandidates(p, tag);

  const readError = async (input, expected) => {
    await p.type(LOC_INPUT, input);
    await p.click('.dc-newsys-g-where .oc-sdk-btn', { text: 'Read this folder' });
    await h.checkSoon(() => p.guest(`return (doc.querySelector('${LOC_NOTE}')?.textContent ?? '').includes(${JSON.stringify(expected)})`), `${tag}: "${input}" is refused with the service's sentence`);
    h.check(await p.guest(`return doc.querySelector('${LOC_INPUT}').value === ${JSON.stringify(input)}`), `${tag}: what was typed is kept`);
  };
  await readError('https://example.com/design-system', 'Use the folder on this machine, not a web address.');
  await p.shot(`${tag}-1-url`);
  await readError('../../elsewhere', 'Pick a folder inside ember-oak.');
  await readError('gone-folder', "Design Chamber can't read gone-folder. It doesn't exist.");
  await p.shot(`${tag}-2-gone`);

  // An incomplete contract: Make only, with the line that says why.
  await p.type(LOC_INPUT, 'style-guide');
  await p.click('.dc-newsys-g-where .oc-sdk-btn', { text: 'Read this folder' });
  await p.waitFor('return !!doc.querySelector(".dc-newsys-contract-problem")', 'the incomplete contract line');
  h.check((await text(p, '.dc-newsys-contract-problem')) === 'This folder has a system.json but tokens.css is missing or holds no token values, so it can’t be registered as it is. Make a new system from it instead.', `${tag}: the incomplete contract names what is missing`);
  h.check(await p.guest('return !doc.querySelector(".dc-newsys-choice")'), `${tag}: no register choice for an incomplete contract`);
  h.check(await p.guest(`return doc.querySelector('${PRIMARY}').textContent.trim() === 'Make design system'`), `${tag}: the primary stays Make design system`);
  await reveal(p, surface, '.dc-newsys-g-result');
  await p.shot(`${tag}-3-incomplete`);

  // A folder with no token files: the agent can still write the system.
  await p.type(LOC_INPUT, 'docs/design');
  await p.click('.dc-newsys-g-where .oc-sdk-btn', { text: 'Read this folder' });
  await h.checkSoon(() => p.guest('return (doc.querySelector(".dc-newsys-g-result")?.textContent ?? "").includes("Design Chamber didn’t find token files in docs/design/")'), `${tag}: nothing found says the agent can still write it`);
  await reveal(p, surface, '.dc-newsys-g-result');
  await p.shot(`${tag}-4-nothing`);

  // The nudge from Project code: once per sheet, Start from it keeps the name and reads the folder.
  await p.key('Escape');
  await p.settle(200);
  await openSheet(p);
  await p.type('.dc-newsys-g-name input', 'Nudge test');
  await p.click(CHECK, { text: 'A description' });
  await p.click(CHECK, { text: 'Project code' });
  await p.waitFor('return !!doc.querySelector(".dc-newsys-nudge")', 'the nudge');
  h.check((await text(p, '.dc-newsys-nudge')).includes('This project already has a design system in design-system/. Start from it instead?'), `${tag}: the nudge names the strongest candidate`);
  await p.shot(`${tag}-5-nudge`);
  await p.click('.dc-newsys-nudge .oc-sdk-btn', { text: 'Dismiss' });
  await h.checkSoon(() => p.guest('return !doc.querySelector(".dc-newsys-nudge")'), `${tag}: Dismiss puts the nudge away`);
  // Read the project again (untick, tick): the nudge stays away for this sheet session.
  await p.click(CHECK, { text: 'Project code' });
  await p.click(CHECK, { text: 'Project code' });
  await p.waitFor('return !!doc.querySelector(".dc-newsys-found")', 'the scan again');
  h.check(!(await p.guest('return !!doc.querySelector(".dc-newsys-nudge")')), `${tag}: the nudge stays dismissed for the sheet session`);
  await p.key('Escape');
  await p.settle(200);
  await openSheet(p);
  await p.type('.dc-newsys-g-name input', 'Nudge test');
  await p.click(CHECK, { text: 'A description' });
  await p.click(CHECK, { text: 'Project code' });
  await p.waitFor('return !!doc.querySelector(".dc-newsys-nudge")', 'the nudge in a fresh sheet');
  await p.click('.dc-newsys-nudge .oc-sdk-btn', { text: 'Start from it' });
  await h.checkSoon(() => p.guest('return doc.querySelector(".dc-newsys-source[data-source=existing] .oc-sdk-check").getAttribute("aria-checked") === "true" && doc.querySelector(".dc-newsys-source[data-source=code] .oc-sdk-check").getAttribute("aria-checked") === "false"'), `${tag}: Start from it ticks Existing and unticks Project code`);
  await h.checkSoon(() => p.guest(`return doc.querySelector('${LOC_INPUT}').value === 'design-system'`), `${tag}: Start from it fills the location`);
  await p.waitFor('return !!doc.querySelector(".dc-newsys-found-line")', 'the location read from the nudge');
  h.check(await p.guest('return doc.querySelector(".dc-newsys-g-name input").value === "Nudge test"'), `${tag}: the name is kept`);
  await p.shot(`${tag}-6-from-nudge`);

  // No candidates: point at a folder yourself, or start from the code.
  await p.key('Escape');
  await p.settle(200);
  await p.host(`${FAKE}.systems.setNextScan({ candidates: [], candidatesMore: 0 })`);
  await openSheet(p);
  await tickExisting(p, tag);
  await h.checkSoon(() => p.guest('return (doc.querySelector(".dc-newsys-discovery")?.textContent ?? "").includes("No existing design system found in this project.")'), `${tag}: no candidates says what to do instead`);
  await p.shot(`${tag}-7-no-candidates`);

  // Open the registered candidate: the system's page opens, the sheet closes.
  await p.host(`${FAKE}.systems.setNextScan(null)`);
  await p.click(CHECK, { text: 'Existing design system' });
  await p.click(CHECK, { text: 'Existing design system' });
  await waitCandidates(p, tag);
  await p.click('.dc-newsys-cand .oc-sdk-btn', { text: 'Open' });
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg") && (doc.querySelector(".dc-syspg-h1")?.textContent ?? "").includes("Juniper")'), `${tag}: Open opens the registered system`);
  await p.shot(`${tag}-8-open-registered`);
  await p.close();
};

export const run = async (h) => {
  for (const theme of ['dark', 'light']) {
    await sheetFlow(h, 'page', 1400, theme);
    await sheetFlow(h, 'panel', 320, theme);
  }
  await sheetFlow(h, 'panel', 480, 'light');
  await errorsFlow(h, 'page', 1400, 'dark');
  await errorsFlow(h, 'panel', 320, 'light');
};
