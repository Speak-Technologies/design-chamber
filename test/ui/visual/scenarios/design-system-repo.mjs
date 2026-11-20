// Visual scenario for Phase 2.5 U6 (a repo-backed design system): the page at 1400 px, the rail at 320 and 480 px, the re-sync
// sheet at 390 px, light and dark. The repo page is read only (one quiet line, no editor), has the repo header line and Reveal;
// the living-page card shows each state with its sentence and buttons; banners stack two at most with "+N more"; a tampered
// snapshot and an unreadable repo say so; the repo re-sync sheet lists what changed and applies once; the living-page preview
// opens the staged page in a frame and closes; a system still being built shows its own page. DC_SYSREPO_ONLY=<tag regex>
// limits the variants. `helpers`: openPage, check, checkSoon, listReady, sleep.

const FAKE = 'window.frames[0].__dcFake';
const text = (p, selector) => p.guest(`return (doc.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);
const count = (p, selector) => p.guest(`return doc.querySelectorAll(${JSON.stringify(selector)}).length`);
const noOverflow = (p) => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');
const buttons = (p, selector) => p.guest(`return [...doc.querySelectorAll(${JSON.stringify(selector)})].map((b) => b.textContent.trim()).join("|")`);
const pageLog = async (p) => JSON.parse(await p.host(`JSON.stringify(${FAKE}.systems.pageLog())`));
const revealLog = async (p) => JSON.parse(await p.host(`JSON.stringify(${FAKE}.systems.revealLog())`));
const set = (p, code) => p.host(`${FAKE}.systems.${code}`);

const openSystem = async (h, p, surface, id, tag) => {
  if (surface === 'panel') await p.click('.dc-rail-head .dc-iconbtn[aria-label="Design systems"]');
  else await p.click('.dc-library-bar .oc-sdk-btn', { text: 'Design systems' });
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the list is up`);
  await p.click(`.dc-sys[data-id="${id}"] .dc-sys-main`);
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg[data-state=\\"ready\\"]")'), `${tag}: the system page loads`);
  await p.settle(500);
};

/** Opens Tidepool as a repo-backed system after `before` has set up what the fake answers. */
const withRepo = async (h, { tag, surface = 'page', width = 1400, height = 900, theme, state = 'fresh', before = '' }, fn) => {
  const p = await h.openPage({ width, height, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await set(p, `setRepoHome('tidepool', ${JSON.stringify(state)})`);
  if (before) await p.host(before);
  await openSystem(h, p, surface, 'tidepool', tag);
  await fn(p);
  await p.close();
};

const showCard = async (p) => {
  await p.guest('const s = doc.querySelector(".dc-syspg-scroll"); if (s) s.scrollTop = s.scrollHeight; return true');
  await p.settle(200);
};

const menuItem = (p, label) => p.click('.dc-popup [role="menuitem"]', { text: label });

// ---------------------------------------------------------------- the page
const pageFlow = async (h, theme) => {
  const tag = `sysrepo-page-1400-${theme}`;
  await withRepo(h, { tag, theme }, async (p) => {
    await h.checkSoon(() => p.guest('return doc.querySelector(".dc-sys-board")?.dataset.state === "ready"'), `${tag}: the board is drawn`);
    h.check((await text(p, '.dc-syspg-readonly')) === 'Tidepool lives in tidepool-web. Change the values there, or ask the agent here.', `${tag}: the one quiet line (${await text(p, '.dc-syspg-readonly')})`);
    h.check((await count(p, '.dc-syspg-readonly')) === 1, `${tag}: said once`);
    h.check((await count(p, '.dc-syspg-editbar, .dc-sp-input, .dc-sp-add, .dc-sp-remove, .dc-sp-pencil')) === 0, `${tag}: no editor, no Save or Reset bar`);
    const body = await text(p, '.dc-syspg');
    h.check(!body.includes('Click a value to edit it'), `${tag}: no edit hint`);
    h.check(!/Save|Reset/.test(await buttons(p, '.dc-syspg .oc-sdk-btn')), `${tag}: no Save or Reset button`);
    const line = await p.guest('const n = doc.querySelector(".dc-syspg-home"); return n ? n.textContent + "||" + (n.title || "") : ""');
    h.check(line.startsWith('Repo · tidepool-web · design-system/'), `${tag}: the header line (${line})`);
    const tools = await buttons(p, '.dc-syspg-tools .oc-sdk-btn');
    h.check(tools.includes('Reveal') && tools.includes('Versions'), `${tag}: Reveal and Versions are in the header (${tools})`);
    h.check((await count(p, '.dc-syspg-titlewrap .dc-iconbtn[aria-label^="Rename"]')) === 1, `${tag}: the rename pencil is in the header`);
    h.check(await p.guest('return !!doc.querySelector(".dc-syspg-tools .dc-iconbtn[aria-label=\\"More\\"]")'), `${tag}: More is in the header`);
    h.check((await count(p, '.dc-ask')) >= 1, `${tag}: the ask bar stays`);
    h.check((await text(p, '.dc-living')).includes('Living page'), `${tag}: the living-page card is in the Overview`);
    h.check(await noOverflow(p), `${tag}: nothing scrolls sideways`);
    await p.shot(`${tag}-1-open`);

    await p.click('.dc-syspg-tools .oc-sdk-btn', { text: 'Reveal' });
    await h.checkSoon(async () => (await revealLog(p)).some((r) => r.target === 'repo'), `${tag}: Reveal asks the service for the repo`);

    // the review controls stay; Needs work goes to the system chat
    await p.click('.dc-syspg-row[data-focus-key="row:typography"]');
    await p.settle(200);
    h.check((await text(p, '.dc-syspg-review')).includes('Looks good'), `${tag}: review stays on a repo system`);
    await p.click('.dc-syspg-review .oc-sdk-btn', { text: 'Needs work' });
    await p.type('.dc-syspg-note', 'The heading is too tight.');
    await p.click('.dc-syspg-review .oc-sdk-btn', { text: 'Send to the agent' });
    await h.checkSoon(async () => (await pageLog(p)).asks.some((a) => a.purpose === 'review'), `${tag}: Needs work reaches the agent`);
    await p.settle(300);

    // the versions drawer: no Restore
    await p.click('.dc-syspg-tools .oc-sdk-btn', { text: 'Versions' });
    await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-version").length >= 3'), `${tag}: the drawer lists the versions`);
    await p.settle(300);
    const drawer = await buttons(p, '.dc-version .oc-sdk-btn');
    h.check(!drawer.includes('Restore') && drawer.includes('View'), `${tag}: versions have no Restore (${drawer})`);
    h.check((await text(p, '.dc-versions-foot')) === 'Repo changes are undone in tidepool-web’s history, not here.', `${tag}: the footer says where undo lives (${await text(p, '.dc-versions-foot')})`);
    await p.shot(`${tag}-2-versions`);
  });
};

// ---------------------------------------------------------------- the living-page card, one state at a time
const STATES = [
  ['fresh', 'Up to date', 'Preview living page'],
  ['out-of-date', 'Out of date', 'Ask the agent to update it'],
  ['missing', 'Not in tidepool-web yet', 'Ask the agent to update it'],
  ['changed', 'Changed in tidepool-web', 'Ask the agent to update it'],
  ['reformatted', 'Reformatted', 'Preview living page'],
  ['unsafe', 'Can’t check as safe', 'Ask the agent to update it'],
  ['unreadable', 'Can’t read', 'Reveal living page'],
];

const livingFlow = async (h, theme) => {
  for (const [state, label, first] of STATES) {
    const tag = `sysrepo-living-${state}-1400-${theme}`;
    await withRepo(h, { tag, theme, state }, async (p) => {
      h.check((await p.guest('return doc.querySelector(".dc-living")?.dataset.kind')) === state, `${tag}: the card is in the ${state} state`);
      h.check((await text(p, '.dc-living-badge')) === label, `${tag}: the badge reads "${label}" (${await text(p, '.dc-living-badge')})`);
      const actions = await buttons(p, '.dc-living-actions .oc-sdk-btn');
      h.check(actions.split('|')[0] === first || actions.includes(first), `${tag}: the buttons include ${first} (${actions})`);
      h.check(await noOverflow(p), `${tag}: nothing scrolls sideways`);
      if (state === 'fresh' || state === 'unsafe' || state === 'missing') {
        await showCard(p);
        await p.shot(tag);
      }
    });
  }

  // a build problem, a secret on a page for developers, a font left out, and the Embed fonts switch
  const tag = `sysrepo-living-extras-1400-${theme}`;
  await withRepo(h, {
    tag,
    theme,
    before: `${FAKE}.systems.patchLiving('tidepool', { staged: { fonts: 'fallback', secrets: [{ kind: 'aws-key', where: 'brand/press' }], omitted: [{ what: 'font', name: 'Inter-Black.woff2', reason: 'too-large' }] } })`,
  }, async (p) => {
    h.check((await text(p, '.dc-living-secret')).includes('shaped like a secret'), `${tag}: a secret shape gets its warning (${await text(p, '.dc-living-secret')})`);
    h.check((await text(p, '.dc-living')).includes('1 font wasn’t embedded: too large.'), `${tag}: a left-out font is said`);
    h.check((await count(p, '.dc-living-fonts .oc-sdk-switch, .dc-living-fonts [role="switch"], .dc-living-fonts input')) >= 1, `${tag}: the Embed fonts switch shows`);
    await showCard(p);
    await p.shot(tag);
  });

  const dev = `sysrepo-living-dev-1400-${theme}`;
  await withRepo(h, { tag: dev, theme, before: `${FAKE}.systems.patchDetail('tidepool', { build: { mode: 'fix', dark: true, calls: [], access: 'dev', round: 'done', applied: null } })` }, async (p) => {
    h.check((await count(p, '.dc-living-fonts')) === 0, `${dev}: a page for developers has no Embed fonts switch`);
  });

  const problem = `sysrepo-living-problem-1400-${theme}`;
  await withRepo(h, { tag: problem, theme, before: `${FAKE}.systems.patchLiving('tidepool', { staged: { problem: 'too-large' } })` }, async (p) => {
    h.check((await p.guest('return doc.querySelector(".dc-living")?.dataset.kind')) === 'problem', `${problem}: a staged problem is its own state`);
    h.check((await buttons(p, '.dc-living-actions .oc-sdk-btn')).includes('Ask the agent to fix it'), `${problem}: it offers Ask the agent to fix it`);
    await showCard(p);
    await p.shot(problem);
  });
};

// ---------------------------------------------------------------- banners
const bannerFlow = async (h, theme) => {
  const tag = `sysrepo-banners-1400-${theme}`;
  const stale = "{ snapshot: { at: new Date(Date.now() - 86400000).toISOString(), by: 'agent', tampered: true, treeHash: 'tree-1' }, buildProblem: 'The agent stopped before it finished.', landed: { proposal: 'p_1', matches: false, differ: ['--brand'], unclaimed: [], sentence: 'The commit also changed --accent, which the proposal didn’t include.' } }";
  await withRepo(h, { tag, theme, before: `${FAKE}.systems.patchDetail('tidepool', ${stale})` }, async (p) => {
    const shown = await count(p, '.dc-notices > .dc-banner');
    const all = await text(p, '.dc-notices');
    h.check(all.includes('snapshot was changed outside Design Chamber') && all.includes('Re-sync'), `${tag}: the tampered snapshot says so and offers Re-sync (${all.slice(0, 120)})`);
    h.check((await text(p, '.dc-banner-more-toggle')) === '+2 more', `${tag}: the third banner sits under "+2 more" (${await text(p, '.dc-banner-more-toggle')})`);
    h.check(shown >= 2, `${tag}: two banners show (${shown})`);
    h.check(!(await text(p, '.dc-notices')).includes('Click a value'), `${tag}: no edit hint`);
    h.check((await p.guest('return doc.querySelector(".dc-banner-more-body")?.hidden')) === true, `${tag}: the rest is folded`);
    await p.shot(`${tag}-1-two`);
    await p.click('.dc-banner-more-toggle');
    await p.settle(200);
    h.check((await p.guest('return doc.querySelector(".dc-banner-more-body")?.hidden')) === false, `${tag}: "+2 more" opens the rest`);
    await p.shot(`${tag}-2-more`);
  });

  const plus2 = `sysrepo-banners-more2-1400-${theme}`;
  const four = "{ snapshot: { at: new Date(Date.now() - 86400000).toISOString(), by: 'agent', tampered: true, treeHash: 'tree-1' }, buildProblem: 'The agent stopped before it finished.', landed: { proposal: 'p_1', matches: false, differ: ['--brand'], unclaimed: [], sentence: 'The commit also changed --accent.' }, changesToReview: true }";
  await withRepo(h, { tag: plus2, theme, state: 'unsafe', before: `${FAKE}.systems.patchDetail('tidepool', ${four})` }, async (p) => {
    h.check((await text(p, '.dc-banner-more-toggle')).startsWith('+'), `${plus2}: the extra banners fold (${await text(p, '.dc-banner-more-toggle')})`);
    h.check((await count(p, '.dc-syspg-readonly')) === 1, `${plus2}: the read-only line is never a banner`);
    await p.shot(plus2);
  });

  const unread = `sysrepo-banners-unreadable-1400-${theme}`;
  await withRepo(h, { tag: unread, theme, before: `${FAKE}.systems.patchDetail('tidepool', { home: { readable: false, problem: 'tidepool-web isn’t at C:/work/tidepool-web any more.' } })` }, async (p) => {
    const banner = await text(p, '.dc-notices');
    h.check(banner.includes('The repo can’t be read.') && banner.includes('Choose another folder…'), `${unread}: the repo banner offers another folder (${banner.slice(0, 100)})`);
    const resync = await p.guest('return [...doc.querySelectorAll(".dc-syspg-tools .oc-sdk-btn, .dc-living-actions .oc-sdk-btn")].filter((b) => /Re-sync|update it/.test(b.textContent)).every((b) => b.disabled)');
    h.check(resync, `${unread}: living-page ask is off while the repo can’t be read`);
    await p.shot(unread);
    await p.click('.dc-notices .oc-sdk-btn', { text: 'Choose another folder…' });
    await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-resync")'), `${unread}: Choose another folder opens the re-sync sheet`);
    h.check((await count(p, '.dc-resync input, .dc-resync .oc-sdk-input')) >= 1, `${unread}: the sheet asks for the folder`);
    await p.shot(`${unread}-sheet`);
  });
};

// ---------------------------------------------------------------- the uncovered area
const uncoveredFlow = async (h, theme) => {
  const tag = `sysrepo-uncovered-1400-${theme}`;
  await withRepo(h, { tag, theme, before: `${FAKE}.systems.setCoverage('tidepool', ['foundations', 'components'])` }, async (p) => {
    const areas = await p.guest('return [...doc.querySelectorAll(".dc-syspg-area-name")].map((n) => n.textContent).join("|")');
    h.check(areas === 'Foundations|Components|Patterns & voice|Brand & marketing', `${tag}: the four areas (${areas})`);
    await p.click('.dc-syspg-area[data-area="patterns"] .dc-syspg-area-head');
    await p.click('.dc-syspg-row[data-focus-key="row:patterns"]');
    await p.settle(250);
    h.check((await text(p, '.dc-syspg-panel')).includes('Not covered by this system.') || (await text(p, '.dc-sp-section')).includes('Not covered by this system.'), `${tag}: an uncovered area says so`);
    h.check((await count(p, '.dc-syspg-review')) === 0, `${tag}: no review buttons`);
    await p.shot(tag);
  });
};

// ---------------------------------------------------------------- drift and what landed
const driftFlow = async (h, theme) => {
  const tag = `sysrepo-drift-1400-${theme}`;
  const drift = "{ codeDrift: { at: new Date().toISOString(), mode: 'fix', differ: 3, names: ['--brand', '--accent', '--space-8'], partial: false, unread: [] }, landed: { proposal: 'p_1', matches: false, differ: ['--brand'], unclaimed: [], sentence: 'The commit also changed --accent, which the proposal didn’t include.' } }";
  await withRepo(h, { tag, theme, before: `${FAKE}.systems.patchDetail('tidepool', ${drift})` }, async (p) => {
    const body = await text(p, '.dc-syspg-repo');
    h.check(body.includes('3 tokens differ'), `${tag}: the drift count is said (${body.slice(-220)})`);
    h.check((await buttons(p, '.dc-syspg-drift .dc-syspg-drift-actions .oc-sdk-btn')) === 'Ask the agent to reconcile', `${tag}: Ask the agent to reconcile (${await buttons(p, '.dc-syspg-drift .dc-syspg-drift-actions .oc-sdk-btn')})`);
    h.check(!(await text(p, '.dc-notices')).includes('tokens differ'), `${tag}: code drift is not a banner`);
    await showCard(p);
    await p.shot(tag);
    await p.click('.dc-syspg-drift .dc-syspg-drift-actions .oc-sdk-btn', { text: 'Ask the agent to reconcile' });
    await h.checkSoon(async () => (await pageLog(p)).asks.some((a) => a.purpose === 'reconcile'), `${tag}: it asks the agent to reconcile`);
  });

  const unread = `sysrepo-drift-unread-1400-${theme}`;
  await withRepo(h, { tag: unread, theme, before: `${FAKE}.systems.patchDetail('tidepool', { codeDrift: { at: new Date().toISOString(), mode: 'fix', differ: 0, names: [], partial: false, unread: ['tokens/brand.json'] } })` }, async (p) => {
    const body = await text(p, '.dc-syspg-repo');
    h.check(!/matches/i.test(body) && body.includes('can’t check tokens/brand.json'), `${unread}: zero with an unread file never says "matches" (${body.slice(0, 120)})`);
  });
};

// ---------------------------------------------------------------- the preview frame
const previewFlow = async (h, surface, width, theme) => {
  const tag = `sysrepo-preview-${surface === 'panel' ? 'rail' : 'page'}-${width}-${theme}`;
  await withRepo(h, { tag, surface, width, theme }, async (p) => {
    const label = surface === 'panel' ? '.dc-syspg-railliving .oc-sdk-btn' : '.dc-living-actions .oc-sdk-btn';
    await p.click(label, { text: 'Preview living page' });
    await h.checkSoon(() => p.guest('return doc.querySelector(".dc-lpv") && !doc.querySelector(".dc-lpv").hidden'), `${tag}: the preview opens`);
    await h.checkSoon(() => p.guest('return doc.querySelector(".dc-lpv-frame")?.dataset.state === "ready" || !!doc.querySelector(".dc-lpv iframe")'), `${tag}: the frame is there`);
    await p.settle(700);
    h.check((await p.guest('return doc.querySelector(".dc-lpv iframe")?.getAttribute("sandbox") ?? ""')).includes('allow-scripts'), `${tag}: the frame is sandboxed`);
    h.check(!(await p.guest('return doc.querySelector(".dc-lpv iframe")?.getAttribute("sandbox") ?? ""')).includes('allow-same-origin'), `${tag}: never with allow-same-origin`);
    h.check((await text(p, '.dc-lpv-note')) === 'This is the page Design Chamber generated. The copy in tidepool-web may differ.', `${tag}: the note says it may differ (${await text(p, '.dc-lpv-note')})`);
    h.check(await noOverflow(p), `${tag}: nothing scrolls sideways`);
    await p.shot(tag);
    await p.click('.dc-lpv-top .dc-iconbtn');
    await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-lpv")?.hidden'), `${tag}: the close button returns to the board`);
  });
};

// A proposal waits: the preview is the proposal's page and the band says so.
const proposalPreviewFlow = async (h, theme) => {
  const tag = `sysrepo-preview-proposal-1400-${theme}`;
  const before = `${FAKE}.systems.patchDetail('tidepool', { proposal: { id: 'p_7', state: 'current' } }); ${FAKE}.systems.patchLiving('tidepool', { staged: { preview: { proposal: 'p_7', problem: null } } })`;
  await withRepo(h, { tag, theme, before }, async (p) => {
    await p.click('.dc-living-actions .oc-sdk-btn', { text: 'Preview living page' });
    await h.checkSoon(() => p.guest('return doc.querySelector(".dc-lpv") && !doc.querySelector(".dc-lpv").hidden'), `${tag}: the preview opens`);
    await p.settle(600);
    h.check((await text(p, '.dc-lpv-band')).includes('Preview of proposal p_7'), `${tag}: the band names the proposal (${await text(p, '.dc-lpv-band')})`);
    await p.shot(tag);
  });
};

// ---------------------------------------------------------------- being built in chat
const builtFlow = async (h, theme) => {
  const tag = `sysrepo-built-1400-${theme}`;
  const before = `${FAKE}.systems.patchDetail('tidepool', { snapshot: null, building: true, build: { mode: 'fix', dark: true, calls: [], access: null, round: 1, applied: null }, proposal: { id: 'p_7', state: 'current' } }); ${FAKE}.systems.patchLiving('tidepool', { staged: { preview: { proposal: 'p_7', problem: null } } })`;
  await withRepo(h, { tag, theme, before }, async (p) => {
    const body = await text(p, '.dc-syspg-built');
    h.check(body.includes('Being built in chat'), `${tag}: the page says it is being built in chat (${body.slice(0, 80)})`);
    h.check(body.includes('The agent is waiting for your answer in chat.'), `${tag}: a waiting proposal says the agent is waiting`);
    const actions = await buttons(p, '.dc-syspg-built-actions .oc-sdk-btn');
    h.check(actions === 'Continue in chat|Re-sync|Preview living page', `${tag}: Continue in chat, Re-sync and Preview living page (${actions})`);
    await p.shot(tag);
  });
};

// ---------------------------------------------------------------- the repo re-sync sheet
const resyncFlow = async (h, width, theme) => {
  const tag = `sysrepo-resync-${width}-${theme}`;
  await withRepo(h, { tag, width, height: 800, theme }, async (p) => {
    await p.click('.dc-syspg-tools .dc-iconbtn[aria-label="More"]');
    await menuItem(p, 'Re-sync from tidepool-web');
    await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-resync .dc-resync-group")'), `${tag}: the review is drawn`);
    await p.settle(400);
    const sheet = await text(p, '.dc-resync');
    h.check(sheet.includes('Re-sync Tidepool from tidepool-web'), `${tag}: the title names the repo (${sheet.slice(0, 80)})`);
    const titles = await p.guest('return [...doc.querySelectorAll(".dc-resync-title")].map((n) => n.firstChild.textContent).join("|")');
    h.check(titles === 'Changed|New|No longer in the repo|Files' || titles.startsWith('Changed'), `${tag}: plain lists (${titles})`);
    h.check((await count(p, '.dc-resync input[type="checkbox"], .dc-resync .oc-sdk-check')) === 0, `${tag}: no ticks, it is all or nothing`);
    h.check((await buttons(p, '.dc-resync-foot .oc-sdk-btn, .dc-sheet-foot .oc-sdk-btn')).includes('Apply'), `${tag}: Apply is in the footer`);
    const pinned = await p.guest('const f = doc.querySelector(".dc-resync-foot, .dc-sheet-foot"); if (!f) return false; const r = f.getBoundingClientRect(); return r.bottom <= window.innerHeight + 1 && r.top > 0');
    h.check(pinned, `${tag}: the footer stays on screen`);
    h.check(await noOverflow(p), `${tag}: nothing scrolls sideways`);
    const box = await p.guest('const r = (s) => { const b = doc.querySelector(s).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)].join(":"); }; return `app ${r(".dc-app")} sheet ${r(".dc-resync")} panel ${r(".dc-resync .dc-sheet-panel")} syspg ${r(".dc-syspg")} scroll ${doc.querySelector(".dc-app").scrollLeft}/${doc.querySelector(".dc-app").scrollWidth} wide ${[...doc.querySelectorAll(".dc-app *")].filter((n) => n.getBoundingClientRect().width > 316).slice(0, 4).map((n) => n.className).join(",")} view ${window.innerWidth}`');
    const inside = await p.guest('const b = doc.querySelector(".dc-resync .dc-sheet-panel").getBoundingClientRect(); return b.left >= 0 && b.right <= window.innerWidth + 1');
    h.check(inside, `${tag}: the sheet sits inside the window (${box})`);
    await p.shot(`${tag}-1-review`);
    await p.click('.dc-resync .oc-sdk-btn', { text: 'Apply' });
    await h.checkSoon(async () => (await pageLog(p)).resyncs.length === 1, `${tag}: Apply posts once`);
    const post = (await pageLog(p)).resyncs[0];
    h.check(typeof post.scanId === 'string' && typeof post.stamp === 'string' && !('tokens' in post), `${tag}: it sends the scan and the stamp, never a value (${JSON.stringify(post)})`);
    await h.checkSoon(async () => /Read|read|re-synced|Re-synced|matches/.test(await text(p, '.dc-notices')), `${tag}: a notice follows`);
    h.check(!(await buttons(p, '.dc-notices .oc-sdk-btn')).includes('Undo'), `${tag}: a repo re-sync has no Undo`);
    await p.shot(`${tag}-2-applied`);
  });

  if (width === 390) {
    const none = `sysrepo-resync-matches-${width}-${theme}`;
    await withRepo(h, { tag: none, width, height: 800, theme, before: `${FAKE}.systems.setRepoResync({ kind: 'repo', directory: 'C:/work/tidepool-web', directoryChanged: false, folderFound: true, tokens: { changed: [], added: [], removed: [], totals: { changed: 0, added: 0, removed: 0 } }, files: { changed: [], added: [], removed: [] }, livingPageFound: true, refused: 0, skipped: [] })` }, async (p) => {
      await p.click('.dc-syspg-tools .dc-iconbtn[aria-label="More"]');
      await menuItem(p, 'Re-sync from tidepool-web');
      await h.checkSoon(async () => (await text(p, '.dc-resync')).includes('matches what Design Chamber shows'), `${none}: nothing changed says tidepool-web matches`);
      h.check((await buttons(p, '.dc-resync .oc-sdk-btn')).includes('Close'), `${none}: the footer offers Close (${await buttons(p, '.dc-resync .oc-sdk-btn')})`);
      h.check(!(await buttons(p, '.dc-resync .oc-sdk-btn')).includes('Apply'), `${none}: no Apply when nothing changed`);
      await p.shot(none);
    });
  }
};

// ---------------------------------------------------------------- an open request names the preview or the board
const openRequestFlow = async (h, surface, width, theme) => { // the rail only: the page never takes open requests
  const tag = `sysrepo-request-${surface === 'panel' ? 'rail' : 'page'}-${width}-${theme}`;
  const p = await h.openPage({ width, height: 900, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await set(p, `setRepoHome('tidepool', 'fresh')`);
  await p.host(`${FAKE}.requestSystemOpen('tidepool', 'preview')`);
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg[data-state=\\"ready\\"]")'), `${tag}: a preview request opens the system page`);
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-lpv") && !doc.querySelector(".dc-lpv").hidden'), `${tag}: and the living page preview frame`);
  h.check(await noOverflow(p), `${tag}: nothing scrolls sideways`);
  await p.settle(600);
  const clear = await p.guest('const frame = doc.querySelector(".dc-lpv-frame").getBoundingClientRect(); const ask = doc.querySelector(".dc-syspg-stage > .dc-ask").getBoundingClientRect(); return ask.top >= frame.bottom - 1');
  h.check(clear, `${tag}: the ask bar sits under the frame, not on it`);
  await p.shot(`${tag}-1-preview`);
  // The same system is already open: a board request brings the board back and closes the preview.
  await p.host(`${FAKE}.requestSystemOpen('tidepool', 'board')`);
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-lpv")?.hidden'), `${tag}: a board request closes the preview`);
  h.check((await count(p, '.dc-syspg')) === 1, `${tag}: still one system page`);
  await p.shot(`${tag}-2-board`);
  await p.close();
};

export const run = async (h) => {
  const only = process.env.DC_SYSREPO_ONLY ? new RegExp(process.env.DC_SYSREPO_ONLY) : null;
  const go = (tag, fn) => (only && !only.test(tag) ? Promise.resolve() : fn());
  for (const theme of ['light', 'dark']) {
    await go(`page-${theme}`, () => pageFlow(h, theme));
    await go(`living-${theme}`, () => livingFlow(h, theme));
    await go(`banners-${theme}`, () => bannerFlow(h, theme));
    await go(`uncovered-${theme}`, () => uncoveredFlow(h, theme));
    await go(`drift-${theme}`, () => driftFlow(h, theme));
    await go(`preview-page-${theme}`, () => previewFlow(h, 'page', 1400, theme));
    await go(`preview-proposal-${theme}`, () => proposalPreviewFlow(h, theme));
    await go(`preview-rail-${theme}`, () => previewFlow(h, 'panel', 320, theme));
    await go(`request-rail-${theme}`, () => openRequestFlow(h, 'panel', 320, theme));
    await go(`built-${theme}`, () => builtFlow(h, theme));
    await go(`resync-1400-${theme}`, () => resyncFlow(h, 1400, theme));
    await go(`resync-320-${theme}`, () => resyncFlow(h, 320, theme));
    await go(`resync-390-${theme}`, () => resyncFlow(h, 390, theme));
  }
};
