// Visual scenario for Phase 2.5 U3 (the compact system view in the rail): the rail at 320 and 480 px, light and dark.
// A ready system (Harbor) and a draft one (Acme), a repo-backed system with each kind of living page state, and the load
// states (loading, error, gone). The rail never shows a value editor:
// it has the board, the sections with their review buttons, Mark ready, Continue in chat, the ask bar and a line pointing at the
// full-screen page. `helpers`: openPage, check, checkSoon, listReady, sleep. DC_SYSRAIL_ONLY=<tag regex> limits the variants.

const FAKE = 'window.frames[0].__dcFake';
const text = (p, selector) => p.guest(`return (doc.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);
const noOverflow = (p) => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');
const count = (p, selector) => p.guest(`return doc.querySelectorAll(${JSON.stringify(selector)}).length`);
const ROW = (section) => `.dc-syspg-row[data-focus-key="row:${section}"]`;

const openList = (p) => p.click('.dc-rail-head .dc-iconbtn[aria-label="Design systems"]');

const openSystem = async (h, p, id, tag) => {
  await openList(p);
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the list is up`);
  await p.click(`.dc-sys[data-id="${id}"] .dc-sys-main`);
};

const ready = async (h, p, id, tag) => {
  await openSystem(h, p, id, tag);
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg[data-state=\\"ready\\"]")'), `${tag}: the system loads`);
  await h.checkSoon(() => p.guest('return doc.querySelector(".dc-sys-board")?.dataset.state === "ready"'), `${tag}: the board is drawn`);
  await p.settle(400);
};

/** What the rail must never have, whatever the system. */
const noEditor = async (h, p, tag) => {
  h.check((await count(p, '.dc-sp-input, .dc-syspg-editbar, .dc-sp-section, .dc-sp-value')) === 0, `${tag}: no value editor in the rail`);
  h.check(await noOverflow(p), `${tag}: nothing scrolls sideways`);
};

const compactFlow = async (h, id, width, theme, name, status) => {
  const tag = `sysrail-${id}-${width}-${theme}`;
  const p = await h.openPage({ width, height: 900, surface: 'panel', theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await ready(h, p, id, tag);

  const head = await text(p, '.dc-syspg-head');
  h.check((await text(p, '.dc-syspg-h1')).startsWith(name), `${tag}: the name is the heading`);
  h.check(head.includes(status), `${tag}: the header says ${status} (${head.slice(0, 70)})`);
  h.check((await text(p, '.dc-syspg-home')).startsWith('In Design Chamber') || (await text(p, '.dc-syspg-home')).startsWith('Repo'), `${tag}: the home line is there (${await text(p, '.dc-syspg-home')})`);
  h.check((await count(p, '.dc-syspg-living')) === 0, `${tag}: an internal system has no living page pill`);
  h.check((await count(p, '.dc-syspg-area')) === 4, `${tag}: four areas`);
  const boardH = await p.guest('return Math.round(doc.querySelector(".dc-sys-board").getBoundingClientRect().height)');
  h.check(boardH > 150 && boardH <= 520, `${tag}: the board is shown at a rail height (${boardH}px)`);
  await noEditor(h, p, tag);
  await p.shot(`${tag}-1-open`);

  // a section: review, the rail's buttons and the line about the full-screen page
  await p.click(ROW('typography'));
  await p.settle(250);
  const buttons = await p.guest('return [...doc.querySelectorAll(".dc-syspg-railactions .oc-sdk-btn")].map((b) => b.textContent.trim()).join("|")');
  h.check(buttons === (status === 'Ready' ? 'Back to draft|Continue in chat' : 'Mark ready|Continue in chat'), `${tag}: the rail's two buttons (${buttons})`);
  const hint = await text(p, '.dc-syspg-railhint');
  h.check(hint.includes('Design Chamber full screen'), `${tag}: the hint sends editing to the full page (${hint})`);
  h.check((await count(p, '.dc-syspg-review')) === 1, `${tag}: the review controls are shown once`);
  h.check((await count(p, '.dc-ask')) >= 1, `${tag}: the ask bar is in the rail`);
  const small = await p.guest('return [...doc.querySelectorAll(".dc-syspg-railactions .oc-sdk-btn, .dc-syspg-review .oc-sdk-btn")].filter((b) => b.getBoundingClientRect().height < 24).length');
  h.check(small === 0, `${tag}: the buttons are not squeezed (${small} under 24px)`);
  await noEditor(h, p, tag);
  await p.shot(`${tag}-2-section`);

  await p.close();
};

// Juniper covers only foundations and components: the rail's buttons and hint stay under a section it doesn't cover.
const uncoveredFlow = async (h, width, theme) => {
  const tag = `sysrail-uncovered-${width}-${theme}`;
  const p = await h.openPage({ width, height: 900, surface: 'panel', theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await ready(h, p, 'juniper', tag);
  await p.click('.dc-syspg-area[data-area="patterns"] .dc-syspg-area-head');
  await p.click(ROW('patterns'));
  await p.settle(250);
  h.check((await text(p, ROW('patterns'))).includes('Not covered'), `${tag}: the section says it is not covered`);
  h.check((await count(p, '.dc-syspg-review')) === 0, `${tag}: no review on an uncovered section`);
  h.check((await count(p, '.dc-syspg-railactions')) === 1 && (await count(p, '.dc-syspg-railhint')) === 1, `${tag}: the rail's buttons and hint stay`);
  await noEditor(h, p, tag);
  await p.shot(`${tag}-1`);
  await p.close();
};

const LIVING = [
  ['fresh', 'Living page up to date'],
  ['out-of-date', 'Living page out of date'],
  ['missing', 'Living page not in tidepool-web yet'],
  ['changed', 'Living page changed in tidepool-web'],
  ['unsafe', 'Living page can’t be checked as safe'],
];

const repoFlow = async (h, width, theme) => {
  for (const [state, label] of LIVING) {
    const tag = `sysrail-repo-${state}-${width}-${theme}`;
    const p = await h.openPage({ width, height: 900, surface: 'panel', theme, label: tag });
    console.log(tag);
    await h.listReady(p);
    await p.host(`${FAKE}.systems.setRepoHome('tidepool', ${JSON.stringify(state)})`);
    await ready(h, p, 'tidepool', tag);
    const pill = await text(p, '.dc-syspg-living');
    h.check(pill === label, `${tag}: the pill reads "${label}" (${pill})`);
    h.check((await text(p, '.dc-syspg-home')).startsWith('Repo · tidepool-web'), `${tag}: the home line names the repo (${await text(p, '.dc-syspg-home')})`);
    h.check((await text(p, '.dc-syspg-readonly')).includes('lives in tidepool-web'), `${tag}: the read-only line says where the values live (${await text(p, '.dc-syspg-readonly')})`);
    h.check((await count(p, '.dc-syspg-railhint')) === 0, `${tag}: the rail does not say it twice`);
    h.check((await count(p, '.dc-syspg-repo, .dc-syspg-drift, .dc-living')) === 0, `${tag}: the compact view shows the home line and the living state only`);
    await noEditor(h, p, tag);
    if (state === 'fresh' || state === 'unsafe') await p.shot(tag);
    await p.close();
  }
};

const statesFlow = async (h, width, theme) => {
  const base = `sysrail-states-${width}-${theme}`;
  const withPage = async (tag, height, fn) => {
    const p = await h.openPage({ width, height, surface: 'panel', theme, label: tag });
    console.log(tag);
    await h.listReady(p);
    await fn(p);
    await p.close();
  };

  await withPage(`${base}-loading`, 700, async (p) => {
    await p.route('GET /systems/:id', { status: 200, body: {}, delayMs: 2500 });
    await openSystem(h, p, 'tidepool', base);
    await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg[data-state=\\"loading\\"]")'), `${base}: loading shows`);
    h.check((await text(p, '.dc-syspg')).includes('Loading the design system…'), `${base}: the panel says it is loading`);
    await p.shot(`${base}-1-loading`);
    await p.route('GET /systems/:id', null);
  });

  await withPage(`${base}-error`, 700, async (p) => {
    await p.host(`${FAKE}.systems.failDetail(true)`);
    await openSystem(h, p, 'tidepool', base);
    await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg[data-state=\\"error\\"]")'), `${base}: a failed load shows the error state`);
    h.check((await text(p, '.dc-sys-pagemsg')).includes('didn’t load'), `${base}: it says the system didn't load`);
    h.check(await noOverflow(p), `${base}: the error does not scroll sideways`);
    await p.shot(`${base}-2-error`);
    await p.host(`${FAKE}.systems.failDetail(false)`);
    await p.click('.dc-sys-pagemsg .oc-sdk-btn', { text: 'Try again' });
    await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg[data-state=\\"ready\\"]")'), `${base}: Try again loads it`);
  });

  await withPage(`${base}-gone`, 700, async (p) => {
    await p.route('GET /systems/:id', { status: 404, body: { error: 'not-found', message: 'Gone.' } });
    await openSystem(h, p, 'tidepool', base);
    await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg[data-state=\\"gone\\"]")'), `${base}: a missing system shows the gone state`);
    h.check((await text(p, '.dc-sys-pagemsg')).includes('is gone'), `${base}: it says the system is gone`);
    await p.shot(`${base}-3-gone`);
    await p.click('.dc-sys-pagemsg .oc-sdk-btn', { text: 'Back to design systems' });
    await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 1'), `${base}: Back returns to the list`);
  });
};

export const run = async (h) => {
  const only = process.env.DC_SYSRAIL_ONLY ? new RegExp(process.env.DC_SYSRAIL_ONLY) : null;
  const go = (tag, fn) => (only && !only.test(tag) ? Promise.resolve() : fn());
  for (const theme of ['light', 'dark']) {
    for (const width of [320, 480]) {
      await go(`ready-${width}-${theme}`, () => compactFlow(h, 'harbor', width, theme, 'Harbor', 'Ready'));
      await go(`draft-${width}-${theme}`, () => compactFlow(h, 'acme', width, theme, 'Acme', 'Draft'));
      await go(`uncovered-${width}-${theme}`, () => uncoveredFlow(h, width, theme));
      await go(`repo-${width}-${theme}`, () => repoFlow(h, width, theme));
      await go(`states-${width}-${theme}`, () => statesFlow(h, width, theme));
    }
  }
};
