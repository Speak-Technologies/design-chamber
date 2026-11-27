// Visual scenario for system-builder-depth T8 (the panel shows the new fields): the page at 1400 px and the rail at 320 and 480 px,
// light and dark. Tidepool is a core system with colour pairs, component sizes and two left-out topics; Harbor is a full system;
// Juniper is an older one with none of the new fields. Per system: the summary line (depth and left-out count), the Overview's
// scope block, the Pairs group under Colours (ratio, "Measured by the check", the too-low word, the automatic ones), the Sizes
// chips beside Variants and States, and the new pattern and brand kind labels. DC_SYSDEPTH_ONLY=<tag regex> limits the variants.

const text = (p, selector) => p.guest(`return (doc.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);
const count = (p, selector) => p.guest(`return doc.querySelectorAll(${JSON.stringify(selector)}).length`);
const noOverflow = (p) => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');
const surfaceName = (surface) => (surface === 'panel' ? 'rail' : 'page');
const reveal = async (p, selector) => {
  await p.guest(`doc.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'start' }); return true`);
  await p.settle(150);
};
const ROW = (section) => `.dc-syspg-row[data-focus-key="row:${section}"]`;

const openSystem = async (h, p, surface, id, tag) => {
  if (surface === 'panel') await p.click('.dc-rail-head .dc-iconbtn[aria-label="Design systems"]');
  else await p.click('.dc-library-bar .oc-sdk-btn', { text: 'Design systems' });
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the list is up`);
  await p.click(`.dc-sys[data-id="${id}"] .dc-sys-main`);
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg[data-state=\\"ready\\"]")'), `${tag}: the system page loads`);
  await p.settle(500);
};

/** Tidepool: core, pairs, sizes, left out. */
const coreFlow = async (h, surface, width, theme) => {
  const rail = surface === 'panel';
  const tag = `sysdepth-core-${surfaceName(surface)}-${width}-${theme}`;
  const p = await h.openPage({ width, height: 900, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openSystem(h, p, surface, 'tidepool', tag);

  const line = await text(p, '.dc-syspg-home');
  h.check(line.includes('Core system'), `${tag}: the summary line says the depth (${line})`);
  h.check(line.includes('3 topics left out'), `${tag}: it counts the topics left out (${line})`);
  h.check(!/[—–]/.test(line), `${tag}: no dash in the line`);
  const fits = await p.guest('const n = doc.querySelector(".dc-syspg-home"); return n.scrollHeight <= n.clientHeight + 1');
  h.check(fits, `${tag}: the summary line isn't cut off`);
  h.check(await noOverflow(p), `${tag}: nothing scrolls sideways`);
  await p.shot(`${tag}-1-open`);

  if (!rail) {
    await p.click(ROW('overview'));
    await p.settle(250);
    const scope = await text(p, '.dc-sp-scope');
    h.check(scope.includes('Core system') && scope.includes('Left out on purpose'), `${tag}: the Overview shows the scope (${scope.slice(0, 80)})`);
    h.check(scope.includes('Motion') && scope.includes('Marketing') && scope.includes('Data display'), `${tag}: it names each topic in words (${scope})`);
    await reveal(p, '.dc-sp-scope');
    await p.shot(`${tag}-2-overview`);

    await p.click(ROW('colours'));
    await p.settle(250);
    h.check((await count(p, '.dc-sp-entry[data-entry^="pair:"]')) === 6, `${tag}: Colours lists six pairs`);
    const pairs = await text(p, '.dc-sp-group[aria-label="Pairs"]');
    h.check(/\d+\.\d\d:1/.test(pairs), `${tag}: a pair shows its ratio`);
    h.check(pairs.includes('Measured by the check'), `${tag}: a pair Node can't read says the check measures it`);
    h.check(pairs.includes('Too low'), `${tag}: a low ratio says so in words`);
    h.check((pairs.match(/Found from the token names/g) ?? []).length === 2, `${tag}: the two automatic pairs say how they were found`);
    h.check((await count(p, '.dc-sp-pair-ground')) === 12, `${tag}: each pair has a light and a dark ground`);
    await reveal(p, '.dc-sp-group[aria-label="Pairs"]');
    await p.shot(`${tag}-3-pairs`);

    await p.click('.dc-syspg-area[data-area="components"] .dc-syspg-area-head');
    await p.click(ROW('components'));
    await p.settle(250);
    const chips = await p.guest('return [...doc.querySelectorAll(".dc-sp-entry[data-entry=\\"component:button\\"] .dc-sp-chips")].map((n) => n.textContent.replace(/\\s+/g, " ").trim()).join("|")');
    h.check(chips.startsWith('VariantsFilledOutlineGhost|SizesSmallMediumLarge|StatesHoverDisabledLoading'), `${tag}: Sizes sit between Variants and States (${chips})`);
    h.check(!(await text(p, '.dc-sp-entry[data-entry="component:card"]')).includes('Sizes'), `${tag}: a component without sizes shows no empty Sizes`);
    await reveal(p, '.dc-sp-entry[data-entry="component:button"]');
    await p.shot(`${tag}-4-sizes`);

    await p.click('.dc-syspg-area[data-area="patterns"] .dc-syspg-area-head');
    await p.click(ROW('patterns'));
    await p.settle(250);
    const kinds = await p.guest('return [...doc.querySelectorAll(".dc-sp-entry .dc-sp-entry-head .dc-muted")].map((n) => n.textContent).join("|")');
    h.check(kinds === 'Forms|Navigation', `${tag}: pattern kinds read as words (${kinds})`);

    await p.click('.dc-syspg-area[data-area="brand"] .dc-syspg-area-head');
    await p.click(ROW('brand'));
    await p.settle(250);
    const brandKinds = await p.guest('return [...doc.querySelectorAll(".dc-sp-entry .dc-sp-entry-head .dc-muted")].map((n) => n.textContent).join("|")');
    h.check(brandKinds.includes('Brand colour'), `${tag}: brand kinds read as words (${brandKinds})`);
  }

  h.check(await noOverflow(p), `${tag}: nothing scrolls sideways at the end`);
  await p.close();
};

/** Harbor: full, nothing left out. */
const fullFlow = async (h, surface, width, theme) => {
  const rail = surface === 'panel';
  const tag = `sysdepth-full-${surfaceName(surface)}-${width}-${theme}`;
  const p = await h.openPage({ width, height: 900, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openSystem(h, p, surface, 'harbor', tag);
  const line = await text(p, '.dc-syspg-home');
  h.check(line.includes('Full system') && !line.includes('left out'), `${tag}: the line says Full system and nothing about topics left out (${line})`);
  await p.shot(`${tag}-1-open`);
  if (!rail) {
    await p.click(ROW('overview'));
    await p.settle(250);
    const scope = await text(p, '.dc-sp-scope');
    h.check(scope.includes('Full system') && !scope.includes('Left out on purpose'), `${tag}: the scope block has no empty "Left out" chips (${scope.slice(0, 80)})`);
    await p.click('.dc-syspg-area[data-area="patterns"] .dc-syspg-area-head');
    await p.click(ROW('patterns'));
    await p.settle(250);
    const kinds = await p.guest('return [...doc.querySelectorAll(".dc-sp-entry .dc-sp-entry-head .dc-muted")].map((n) => n.textContent).join("|")');
    h.check(kinds === 'Overlays|Empty, loading and error|Data display', `${tag}: the new pattern kinds read as words (${kinds})`);
    await reveal(p, '.dc-sp-section');
    await p.shot(`${tag}-2-patterns`);
  }
  await p.close();
};

/** Juniper: a system written before the new fields. Nothing new shows, nothing is empty or broken. */
const olderFlow = async (h, surface, width, theme) => {
  const rail = surface === 'panel';
  const tag = `sysdepth-older-${surfaceName(surface)}-${width}-${theme}`;
  const p = await h.openPage({ width, height: 900, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openSystem(h, p, surface, 'juniper', tag);
  const line = await text(p, '.dc-syspg-home');
  h.check(!/system|left out|Tokens only/i.test(line.replace(/design system/gi, '')), `${tag}: the line has no depth or left-out text (${line})`);
  if (!rail) {
    await p.click(ROW('overview'));
    await p.settle(250);
    h.check((await count(p, '.dc-sp-scope')) === 0, `${tag}: the Overview has no scope block`);
    await p.click(ROW('colours'));
    await p.settle(250);
    h.check((await count(p, '.dc-sp-group[aria-label="Pairs"]')) === 0, `${tag}: Colours has no Pairs heading`);
    await p.click('.dc-syspg-area[data-area="components"] .dc-syspg-area-head');
    await p.click(ROW('components'));
    await p.settle(250);
    const labels = await p.guest('return [...doc.querySelectorAll(".dc-sp-chips .dc-sp-label")].map((n) => n.textContent).join("|")');
    h.check(!labels.includes('Sizes'), `${tag}: no Sizes chips (${labels})`);
  }
  await p.shot(`${tag}-1`);
  h.check(await noOverflow(p), `${tag}: nothing scrolls sideways`);
  await p.close();
};

export const run = async (h) => {
  const only = process.env.DC_SYSDEPTH_ONLY ? new RegExp(process.env.DC_SYSDEPTH_ONLY) : null;
  const go = (tag, fn) => (only && !only.test(tag) ? Promise.resolve() : fn());
  for (const theme of ['light', 'dark']) {
    await go(`core-page-1400-${theme}`, () => coreFlow(h, 'page', 1400, theme));
    for (const width of [320, 480]) await go(`core-rail-${width}-${theme}`, () => coreFlow(h, 'panel', width, theme));
  }
  await go('full-page-1400-light', () => fullFlow(h, 'page', 1400, 'light'));
  await go('full-rail-320-dark', () => fullFlow(h, 'panel', 320, 'dark'));
  await go('older-page-1400-dark', () => olderFlow(h, 'page', 1400, 'dark'));
  await go('older-rail-320-light', () => olderFlow(h, 'panel', 320, 'light'));
};
