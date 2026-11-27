// Visual scenario for the Settings "Your agent" section (use-the-project spec §2.6, T10): the line under the heading,
// the Built in row, "In every chat" in each of its three states (sent, pending, not saved), no Older copy row when
// there is no old copy, and the collapsed "Using an agent outside OpenChamber?" part with the guide row and the
// AGENTS.md lines (opens, stays open, Copy works). Rail at 320 and 480 px and the page at 1400 px, dark and light.
// `helpers` is what the other scenarios use: openPage, check, checkSoon, listReady. DC_AGENT_ONLY=<tag regex> limits the variants.

const FAKE = 'window.frames[0].__dcFake';
const SECTION = '[data-agent-built-in]';
const NOTE = '[data-agent-note]';
const OUTSIDE = '[data-agent-outside]';

export const run = async (helpers) => {
  const only = process.env.DC_AGENT_ONLY ? new RegExp(process.env.DC_AGENT_ONLY) : null;
  for (const theme of ['dark', 'light']) {
    for (const [surface, width] of [['panel', 320], ['panel', 480], ['page', 1400]]) {
      const tag = `agent-${surface === 'panel' ? 'rail' : 'page'}-${width}-${theme}`;
      if (only && !only.test(tag)) continue;
      await scenario(helpers, { surface, width, theme, tag });
    }
  }
};

const scenario = async ({ openPage, check, checkSoon, listReady }, { surface, width, theme, tag }) => {
  console.log(tag);
  const rail = surface === 'panel';
  const p = await openPage({ width, height: rail ? 820 : 900, surface, theme, label: tag, ...(rail ? {} : { storage: { 'library-view:page': 'tiles' } }) });
  await listReady(p);
  const text = (selector) => p.guest(`return (doc.querySelector(${JSON.stringify(selector)})?.innerText ?? '').replace(/\\s+/g, ' ').trim()`);
  const noOverflow = () => p.guest('const b = doc.querySelector(".dc-sheet-body, .dc-settings"); return !b || (b.scrollWidth <= b.clientWidth + 1 && doc.documentElement.scrollWidth <= doc.documentElement.clientWidth)');
  const outsideOpen = () => p.guest(`return doc.querySelector('${OUTSIDE}')?.open === true`);
  const visible = (selector) => p.guest(`const n = doc.querySelector(${JSON.stringify(selector)}); return !!n && n.checkVisibility()`);
  // Opening the sheet asks the service for the settings again, which is how a changed state shows up.
  const openSettings = async () => {
    await p.click(rail ? '.dc-rail-head .dc-iconbtn[aria-label="Settings"]' : '.dc-library-bar .dc-iconbtn[aria-label="Settings"]');
    await p.waitFor(`return !!doc.querySelector('${SECTION}')`, 'the Your agent section');
    await p.guest(`doc.querySelector('${SECTION}').closest('.dc-settings-section').scrollIntoView({ block: 'start' })`);
    await p.settle(300);
  };
  const closeSettings = async () => {
    await p.key('Escape');
    await p.waitFor('return !doc.querySelector(".dc-settings")', 'settings to close');
  };

  // ---- the section as it first reads
  await openSettings();
  check((await text('.dc-settings-section:has([data-agent-built-in]) .dc-settings-h')) === 'Your agent', `${tag}: the section is called Your agent`);
  check((await text('.dc-settings-section:has([data-agent-built-in]) > .dc-settings-p')) === 'Agents in OpenChamber know Design Chamber while it is on. Nothing to set up.', `${tag}: the line under it says there is nothing to set up`);
  check((await text(SECTION)) === 'Built in Design rules, the design-chamber skill, and the design_check, design_list and design_read tools.', `${tag}: Built in names the rules, the skill and the three tools (${await text(SECTION)})`);
  check((await text(NOTE)) === 'In every chat Sent Every chat gets a short note about Design Chamber.', `${tag}: In every chat reads Sent (${await text(NOTE)})`);
  check(await p.guest(`return !doc.querySelector('[data-skill-row]')`), `${tag}: no old copy means no Older copy row`);
  check(!(await outsideOpen()), `${tag}: the outside part starts collapsed`);
  check(!(await visible('.dc-more-body')), `${tag}: so the guide and the AGENTS.md lines are out of sight`);
  check((await text('.dc-more-summary')) === 'Using an agent outside OpenChamber?', `${tag}: its summary asks the question`);
  check(await noOverflow(), `${tag}: nothing scrolls sideways`);
  await p.shot(`${tag}-1-section`);

  // ---- the outside part: keyboard and pointer, stays open across a repaint, Copy works
  await p.key(' ', { code: 'Space', focus: '.dc-more-summary' });
  await checkSoon(outsideOpen, `${tag}: Space on the focused summary opens it`);
  check(await visible('.dc-more-body pre.dc-code'), `${tag}: the AGENTS.md lines are shown`);
  check((await text('.dc-more-body')).includes('Design Chamber keeps a guide for agents at'), `${tag}: with the guide row`);
  await p.guest(`doc.querySelector('${OUTSIDE}').scrollIntoView({ block: 'start' })`);
  await p.settle(250);
  await p.shot(`${tag}-2-outside-open`);
  await p.host('window.__host.clipboard.length = 0');
  await p.click(`${OUTSIDE} .oc-sdk-btn`, { text: 'Copy' });
  await checkSoon(async () => (await text(`${OUTSIDE} .dc-row-actions .oc-sdk-btn`)) === 'Copied', `${tag}: Copy says Copied`);
  check(await p.host('window.__host.clipboard.length === 1 && window.__host.clipboard[0].includes("Designs")'), `${tag}: the AGENTS.md lines are on the clipboard`);
  check(await outsideOpen(), `${tag}: the part stays open after Copy repaints the sheet`);
  check(await noOverflow(), `${tag}: nothing scrolls sideways with it open`);
  await p.guest(`doc.querySelector('.dc-more-summary').click()`);
  await checkSoon(async () => !(await outsideOpen()), `${tag}: a click on the summary closes it again`);
  await closeSettings();

  // ---- In every chat, each state
  await p.host(`${FAKE}.setInstructions('pending')`);
  await openSettings();
  await checkSoon(async () => (await text(NOTE)) === 'In every chat Pending Sent from the next message.', `${tag}: pending reads Sent from the next message`);
  await p.shot(`${tag}-3-pending`);
  await closeSettings();

  await p.host(`${FAKE}.setInstructions('not-saved')`);
  await openSettings();
  await checkSoon(async () => (await text(NOTE)) === 'In every chat Not saved OpenChamber didn’t save it. It is sent again when Design Chamber restarts.', `${tag}: not saved says what happened and what happens next`);
  check(await p.guest(`return doc.querySelector('${NOTE} [data-tone="warning"]') !== null`), `${tag}: and carries the warning tone`);
  check(await noOverflow(), `${tag}: the longer sentence wraps`);
  await p.shot(`${tag}-4-not-saved`);
  await closeSettings();

  await p.host(`${FAKE}.setInstructions('saved')`);
  await openSettings();
  await checkSoon(async () => (await text(NOTE)).startsWith('In every chat Sent'), `${tag}: back to Sent once the host kept it`);
  await closeSettings();
  await p.close();
};
