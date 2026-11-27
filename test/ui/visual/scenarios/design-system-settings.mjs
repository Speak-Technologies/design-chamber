// Visual scenario for Phase 2.5 U4 (design system choices): the Settings "Design systems" section (default for new
// designs, one pin per project, the one-time notices) and the New dialog's Design system field (preselected from the
// pin or the default, hides the style preset). Rail at 320 and 480 px, dark and light.
// `helpers`: openPage, check, checkSoon, listReady.

const DEFAULT = '[data-system-select="default"] .oc-sdk-trigger';
const PIN = '[data-system-select^="pin:"] .oc-sdk-trigger';
const FIELD = '.dc-system-field .oc-sdk-trigger';

export const run = async (helpers) => {
  for (const theme of ['dark', 'light']) for (const width of [320, 480]) await scenario(helpers, { width, theme });
  for (const theme of ['dark', 'light']) await staleBadgeFlow(helpers, theme);
};

// KI-37: the library stays open under the Settings sheet, and a settings save sends no change event, so the systems
// tile's Default badge only moves if Settings re-reads the list itself.
const staleBadgeFlow = async ({ openPage, check, checkSoon, listReady }, theme) => {
  const tag = `syssettings-page-1400-${theme}`;
  console.log(tag);
  const p = await openPage({ width: 1400, height: 900, surface: 'page', theme, label: tag, storage: { 'library-view:page': 'tiles' } });
  await listReady(p);
  const tileFlag = (id) => p.guest(`return (doc.querySelector('.dc-sys-tile[data-system-id="${id}"] .dc-flag')?.textContent ?? '').trim()`);
  await p.click('.dc-tabs [role=tab]', { text: 'Systems' });
  await checkSoon(async () => (await p.guest(`return doc.querySelectorAll('.dc-sys-tile').length`)) === 5, `${tag}: the Systems tab lists the five systems`);
  check((await tileFlag('field-notes')) === '', `${tag}: Field notes starts with no badge (${await tileFlag('field-notes')})`);

  await p.click('.dc-library-bar .dc-iconbtn[aria-label="Settings"]');
  await p.waitFor(`return !!doc.querySelector('${DEFAULT}')`, 'the design systems section');
  await p.click(DEFAULT);
  await p.waitFor(`return !!doc.querySelector('.oc-sdk-popup [role=option]')`, 'the default options');
  await p.click('.oc-sdk-popup [role=option]', { text: 'Field notes' });
  await checkSoon(async () => ((await p.guest(`return (doc.querySelector('${DEFAULT}')?.textContent ?? '').trim()`)) === 'Field notes'), `${tag}: Settings saves Field notes as the default`);
  await p.key('Escape');
  await p.waitFor('return !doc.querySelector(".dc-settings")', 'settings to close');
  await checkSoon(async () => (await tileFlag('field-notes')) === 'Default', `${tag}: the Field notes tile now says Default without a reload`);
  await p.shot(`${tag}-1-default-moved`);
};

const scenario = async ({ openPage, check, checkSoon, listReady }, { width, theme }) => {
  const tag = `syssettings-rail-${width}-${theme}`;
  console.log(tag);
  const p = await openPage({ width, height: 820, surface: 'panel', theme, label: tag });
  await listReady(p);
  const text = (selector) => p.guest(`return (doc.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);
  const noOverflow = () => p.guest('const b = doc.querySelector(".dc-sheet-body"); return !b || (b.scrollWidth <= b.clientWidth && doc.documentElement.scrollWidth <= doc.documentElement.clientWidth)');
  const options = () => p.guest(`return [...doc.querySelectorAll('.oc-sdk-popup [role=option]')].map((n) => n.textContent.trim()).join('|')`);
  const triggerText = (selector) => p.guest(`return (doc.querySelector(${JSON.stringify(selector)})?.textContent ?? '').trim()`);
  const presetShown = () => p.guest(`return [...doc.querySelectorAll('.dc-field')].some((f) => f.querySelector('.oc-sdk-field-label')?.textContent === 'Style preset' && !f.hidden)`);
  const pick = async (trigger, label) => {
    await p.click(trigger);
    await p.waitFor(`return !!doc.querySelector('.oc-sdk-popup [role=option]')`, 'the options');
    await p.click('.oc-sdk-popup [role=option]', { text: label });
    await p.settle(250);
  };
  const openSettings = async () => {
    await p.click('.dc-rail-head .dc-iconbtn[aria-label="Settings"]');
    await p.waitFor(`return !!doc.querySelector('${DEFAULT}')`, 'the design systems section');
  };
  const closeSettings = async () => {
    await p.key('Escape');
    await p.waitFor('return !doc.querySelector(".dc-settings")', 'settings to close');
  };
  const openNew = async () => {
    await p.click('.dc-rail-head .oc-sdk-btn', { text: 'New' });
    await p.click('.dc-popup [role="menuitem"]', { text: 'Canvas…' });
    await p.waitFor(`return !!doc.querySelector('.dc-system-field') && !doc.querySelector('.dc-system-field').hidden`, 'the Design system field');
    await p.settle(300);
  };
  const closeNew = async () => {
    await p.key('Escape');
    await p.waitFor('return !doc.querySelector(".dc-system-field")', 'the dialog to close');
  };

  // ---- Settings
  await p.host(`window.frames[0].__dcFake.designSystem.settingsNotices(['Acme was deleted, so new designs ask you in chat.'])`);
  await openSettings();
  await p.guest(`doc.querySelector('${DEFAULT}').scrollIntoView({ block: 'center' })`);
  await p.settle(300);
  check((await triggerText(DEFAULT)) === 'Ask me each time', `${tag}: the default starts at Ask me each time (${await triggerText(DEFAULT)})`);
  check((await text('.dc-settings')).includes('Acme was deleted, so new designs ask you in chat.'), `${tag}: the service's one-time notice is shown`);
  await checkSoon(async () => (await p.guest(`return doc.querySelectorAll('.dc-sys-pin').length`)) === 1, `${tag}: one row for the open project`);
  check((await text('.dc-sys-pin-name')) === 'ember-oak', `${tag}: the row names the project`);
  check(await p.guest(`return doc.querySelector('.dc-sys-pin-name').title.length > 0`), `${tag}: its path is in the tooltip`);
  check(await noOverflow(), `${tag}: nothing scrolls sideways`);
  await p.shot(`${tag}-1-settings`);

  await p.click(DEFAULT);
  await p.waitFor(`return !!doc.querySelector('.oc-sdk-popup [role=option]')`, 'the default options');
  const defaults = await options();
  check(defaults.startsWith('Ask me each time|No design system|') && !defaults.includes('Acme'), `${tag}: the default offers Ready systems only (${defaults})`);
  await p.shot(`${tag}-2-default-options`);
  await p.click('.oc-sdk-popup [role=option]', { text: 'Harbor' });
  await checkSoon(async () => (await triggerText(DEFAULT)) === 'Harbor', `${tag}: picking Harbor saves it as the default (${await triggerText(DEFAULT)})`);
  await pick(PIN, 'Juniper');
  await checkSoon(async () => (await triggerText(PIN)) === 'Juniper', `${tag}: the project pins Juniper (${await triggerText(PIN)})`);
  await p.shot(`${tag}-3-pinned`);
  await closeSettings();

  // ---- New dialog: the pin wins, then the default
  await openNew();
  check((await triggerText(FIELD)) === 'Juniper', `${tag}: New preselects the project's pin (${await triggerText(FIELD)})`);
  check((await text('.dc-system-field .oc-sdk-field-note')) === 'Pinned for ember-oak', `${tag}: and says why (${await text('.dc-system-field .oc-sdk-field-note')})`);
  check(!(await presetShown()), `${tag}: a chosen system hides the style preset`);
  await p.shot(`${tag}-4-new-pinned`);
  await p.click(FIELD);
  await p.waitFor(`return !!doc.querySelector('.oc-sdk-popup [role=option]')`, 'the system options');
  const choices = await options();
  check(choices === 'TidepoolRevision 9|HarborRevision 4|Field notesRevision 2|JuniperRevision 12|No design system|Ask me in chat', `${tag}: the field offers Ready systems, none and ask (${choices})`);
  await p.click('.oc-sdk-popup [role=option]', { text: 'No design system' });
  await p.settle(250);
  check(await presetShown(), `${tag}: No design system brings the style preset back`);
  check((await text('.dc-system-field .oc-sdk-field-note')) === '', `${tag}: a pick of your own has no hint`);
  await p.shot(`${tag}-5-new-none`);
  await closeNew();

  await openSettings();
  await pick(PIN, 'Use the default');
  await closeSettings();
  await openNew();
  check((await triggerText(FIELD)) === 'Harbor' && (await text('.dc-system-field .oc-sdk-field-note')) === 'Your default', `${tag}: with no pin New shows the default (${await triggerText(FIELD)}, ${await text('.dc-system-field .oc-sdk-field-note')})`);
  await p.shot(`${tag}-6-new-default`);
  await closeNew();
};
