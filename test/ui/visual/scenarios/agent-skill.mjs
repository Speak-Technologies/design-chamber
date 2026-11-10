// Visual scenario for the Settings "Agent skill" row (feat/agent-skill, spec phase-1-5-sdk-2-7 §U2.5):
// the rail Settings sheet at 320 and 480 px, dark and light. Walks every row of the §U2.5 table with the
// fake backend plus route overrides: no old copy, an old copy that is ours (current and outdated),
// one the user edited, a foreign one, the service not being able to look, the duplicate warning, a
// remove that fails (500 and 409, the row stays usable), a remove in flight (disabled, busy) and
// the removal itself (toast, announcement, row back to the first state, focus kept).
// `helpers` is what the other scenarios use: openPage, check, sleep. DC_SKILL_ONLY=<tag regex> limits the variants.

const VARIANTS = [
  [320, 'dark'],
  [320, 'light'],
  [480, 'dark'],
  [480, 'light'],
];

const SKILL_PATH = 'C:\\Users\\you\\.config\\opencode\\skills\\design-chamber\\SKILL.md';
const ROOT = 'C:\\Users\\you\\Documents\\Designs';
const ROW = '[data-skill-row]';
const ACTION = '[data-skill-action]';

/** A full GET /settings answer with the skill status given (the override replaces the whole body). */
const settingsWith = (skill) => ({
  status: 200,
  body: {
    root: ROOT,
    defaultRoot: ROOT,
    previousRoots: [],
    rootExists: true,
    chrome: { path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', source: 'detected' },
    downloadsDir: 'C:\\Users\\you\\Downloads',
    agent: { guide: { path: `${ROOT}\\AGENTS.md`, state: 'current' }, skill: { path: SKILL_PATH, duplicates: [], ...skill } },
  },
});

export const run = async ({ openPage, check, sleep }) => {
  const only = process.env.DC_SKILL_ONLY ? new RegExp(process.env.DC_SKILL_ONLY) : null;
  for (const [width, theme] of VARIANTS) {
    const tag = `rail-${width}-${theme}-skill`;
    if (only && !only.test(tag)) continue;
    console.log(tag);
    const p = await openPage({ width, height: 780, surface: 'panel', theme, label: tag });
    await p.waitFor('return doc.querySelectorAll(".dc-row[data-slug]").length >= 5', 'the list rows');

    // The path is shortened in the middle on screen and whole in its tooltip: compare with the whole one.
    const rowText = () =>
      p.guest(`const para = doc.querySelector('${ROW}')?.querySelector('.dc-settings-p'); if (!para) return null; const copy = para.cloneNode(true); for (const code of copy.querySelectorAll('code')) code.replaceWith(code.title); return copy.textContent;`);
    const buttons = () => p.guest(`return [...doc.querySelectorAll('${ROW} .oc-sdk-btn')].map((b) => b.textContent.trim())`);
    // Close and reopen the sheet: opening it asks the service for the settings again.
    const openSettings = async () => {
      await p.click('.dc-rail-head .dc-iconbtn[aria-label="Settings"]');
      await p.waitFor(`return !!doc.querySelector('${ROW}')`, 'the skill row');
      await p.guest(`doc.querySelector('${ROW}').scrollIntoView({ block: 'center' })`);
      await p.settle(250);
    };
    const closeSettings = async () => {
      await p.key('Escape');
      await p.waitFor('return !doc.querySelector(".dc-settings")', 'settings to close');
    };
    const showState = async (skill) => {
      await p.route('GET /settings', settingsWith(skill));
      await openSettings();
    };
    const noOverflow = () => p.guest('const b = doc.querySelector(".dc-sheet-body"); return !b || (b.scrollWidth <= b.clientWidth && doc.documentElement.scrollWidth <= doc.documentElement.clientWidth)');

    // ---- no old copy (the fake backend's own answer): built in, no control
    await openSettings();
    check((await rowText()) === 'Built in. Agents in OpenChamber can use it while Design Chamber is on.', `${tag}: no old copy says the skill is built in`);
    check((await buttons()).length === 0, `${tag}: no old copy has no control`);
    check(await p.guest(`return doc.querySelector('${ROW} .oc-sdk-field-label')?.textContent === 'Agent skill'`), `${tag}: the field is named Agent skill`);
    check(await noOverflow(), `${tag}: no horizontal overflow`);
    await p.shot(`${tag}-1-built-in`);
    await closeSettings();

    // ---- an old copy that is ours and unedited: Remove old copy
    await showState({ state: 'current' });
    check((await rowText()) === `Built in. An older copy is also installed at ${SKILL_PATH}, so agents may see the skill twice.`, `${tag}: an old copy of ours says agents may see the skill twice`);
    check(JSON.stringify(await buttons()) === '["Remove old copy"]', `${tag}: the control is Remove old copy, and only that`);
    check(await p.guest(`return doc.querySelector('${ACTION}')?.dataset.variant === 'outline' && doc.querySelector('${ACTION}')?.dataset.size === 'xs' && doc.querySelector('${ACTION}')?.dataset.emphasis === undefined`), `${tag}: it is a small outline button, not a second primary`);
    check(await p.guest(`return doc.querySelector('${ROW}')?.getAttribute('role') === 'group' && doc.querySelector('${ROW}')?.getAttribute('aria-label') === 'Agent skill'`), `${tag}: the row is a labelled group`);
    check(await noOverflow(), `${tag}: no horizontal overflow with the path and button`);
    await p.shot(`${tag}-2-old-copy`);
    await closeSettings();

    await showState({ state: 'outdated' });
    check(JSON.stringify(await buttons()) === '["Remove old copy"]', `${tag}: an old copy for an earlier folder is removable too`);
    await closeSettings();

    // ---- the service says no: the message as written, the button stays
    await showState({ state: 'current' });
    await p.route('DELETE /agent/skill', { status: 500, body: { error: 'internal', message: 'Design Chamber couldn’t remove the old copy. Check that you can write to that folder, then try again.' } });
    await p.click(ACTION);
    await p.waitFor(`return !!doc.querySelector('${ROW} .dc-form-error')`, 'the failure message');
    check((await p.guest(`return doc.querySelector('${ROW} .dc-form-error').textContent`)) === 'Design Chamber couldn’t remove the old copy. Check that you can write to that folder, then try again.', `${tag}: a failed remove shows the service's message as written`);
    check(await p.guest(`return doc.querySelector('${ROW} .dc-form-error').getAttribute('role') === 'alert'`), `${tag}: the failure is announced (role alert)`);
    check(await p.guest(`const b = doc.querySelector('${ACTION}'); return !!b && !b.disabled && b.dataset.loading === 'false'`), `${tag}: Remove old copy is usable again after a failure`);
    check(await p.guest(`return doc.activeElement === doc.querySelector('${ACTION}')`), `${tag}: focus is back on Remove old copy`);
    check(await p.host('window.__host.toasts.every((t) => t.message !== "Old copy removed.")'), `${tag}: no success toast after a failure`);
    check(await noOverflow(), `${tag}: no horizontal overflow with the error`);
    await p.shot(`${tag}-3-failed`);

    // a 409: the copy was edited after Settings loaded
    await p.route('DELETE /agent/skill', { status: 409, body: { error: 'conflict', message: 'You edited that skill, so Design Chamber left it alone. Delete it yourself if you don’t need it.' } });
    await p.click(ACTION);
    await p.waitFor(`return doc.querySelector('${ROW} .dc-form-error')?.textContent.startsWith('You edited that skill')`, 'the conflict message');
    check(await p.guest(`return doc.querySelectorAll('${ROW} .dc-form-error').length === 1`), `${tag}: the new message replaces the old one`);
    await p.shot(`${tag}-4-conflict`);

    // ---- a remove in flight: busy and disabled, then the row goes back to the first state
    await p.host('window.__host.toasts.length = 0');
    await p.route('DELETE /agent/skill', { delayMs: 1500, body: { skill: { path: SKILL_PATH, state: 'not-installed', duplicates: [] } } });
    await p.click(ACTION);
    await p.route('GET /settings', null); // the refetch after the removal gets the fake backend's own "no old copy"
    await p.settle(250);
    check(await p.guest(`const b = doc.querySelector('${ACTION}'); return !!b && b.disabled && b.dataset.loading === 'true' && b.getAttribute('aria-busy') === 'true'`), `${tag}: while removing, the button is disabled and busy`);
    check(await p.guest(`return !doc.querySelector('${ROW} .dc-form-error')`), `${tag}: a new attempt clears the earlier error`);
    await p.shot(`${tag}-5-removing`);
    await p.waitFor(`return !doc.querySelector('${ACTION}')`, 'the old copy to go', 8000);
    check((await rowText()) === 'Built in. Agents in OpenChamber can use it while Design Chamber is on.', `${tag}: after removal the row is back to the built-in line`);
    check(await p.host('JSON.stringify(window.__host.toasts.map((t) => [t.kind, t.message])) === JSON.stringify([["success", "Old copy removed."]])'), `${tag}: one success toast, "Old copy removed."`);
    check((await p.guest(`return doc.querySelector('.dc-settings')?.parentElement.querySelector('[role=status].dc-sr-only')?.textContent`)) === 'Old copy removed.', `${tag}: a screen reader is told the old copy was removed`);
    check(await p.guest(`return doc.activeElement === doc.querySelector('${ROW}')`), `${tag}: focus moves to the row, not lost to the page`);
    await p.shot(`${tag}-6-removed`);
    await p.route('DELETE /agent/skill', null);
    await closeSettings();

    // ---- an old copy the user edited: left alone, Copy path
    await showState({ state: 'edited' });
    check((await rowText()) === `Built in. You edited the older copy at ${SKILL_PATH}, so Design Chamber leaves it alone. Delete it if you don’t need it.`, `${tag}: an edited copy says it is left alone`);
    check(JSON.stringify(await buttons()) === '["Copy path"]', `${tag}: the control is Copy path, never Remove`);
    await p.host('window.__host.clipboard.length = 0');
    await p.click(`${ROW} .oc-sdk-btn`);
    await p.waitFor(`return doc.querySelector('${ROW} .oc-sdk-btn')?.textContent.trim() === 'Copied'`, 'Copied');
    check(await p.host(`window.__host.clipboard.length === 1 && window.__host.clipboard[0] === ${JSON.stringify(SKILL_PATH)}`), `${tag}: Copy path copies the full path`);
    check(await p.guest(`return doc.querySelector('${ROW} .oc-sdk-btn').getAttribute('aria-label') === 'Copied the path of the older copy'`), `${tag}: the acknowledgement has an accessible name`);
    check(await noOverflow(), `${tag}: no horizontal overflow`);
    await p.shot(`${tag}-7-edited`);
    await closeSettings();

    // ---- a different skill with our name
    await showState({ state: 'foreign' });
    check((await rowText()) === `Built in. Another design-chamber skill is installed at ${SKILL_PATH}.`, `${tag}: a foreign copy is named as another skill`);
    check(JSON.stringify(await buttons()) === '["Copy path"]', `${tag}: a foreign copy offers Copy path`);
    await p.shot(`${tag}-8-foreign`);
    await closeSettings();

    // ---- the duplicate warning still shows, beside the built-in line
    await showState({ state: 'not-installed', duplicates: ['C:\\Users\\you\\.claude\\skills\\design-chamber\\SKILL.md'] });
    check(await p.guest(`return doc.querySelectorAll('${ROW} .dc-status-line').length === 1 && doc.querySelector('${ROW} .dc-status-line').textContent.includes('Duplicate')`), `${tag}: an extra copy is still flagged as a duplicate`);
    check(await noOverflow(), `${tag}: no horizontal overflow with the duplicate`);
    await p.shot(`${tag}-9-duplicate`);
    await closeSettings();

    // ---- the service could not look
    await showState({ state: 'unavailable', message: 'Your home folder could not be found.' });
    check((await rowText()) === 'Built in. Your home folder could not be found.', `${tag}: when the service can't look, it says so after "Built in."`);
    check((await buttons()).length === 0, `${tag}: and offers nothing`);
    await closeSettings();

    void sleep;
    await p.close();
  }
};
