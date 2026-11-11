// Visual scenario for the Tweaks panel (Phase 2 feature 09, U2): page 1400 and rail 320 and 480, dark and light, plus the
// rail at 540 px tall (the full-height fallback). Per variant, on the coffee canvas (five knobs: three sliders, a choice and
// a formula the panel cannot tune; one slider is also set for a narrow screen): the Tweaks button and its place; the panel
// (a side dock on the page, a non-modal bottom sheet of at most half the rail on the rail, the wall live above it); the
// rows, the broken knob's reason and the also-set note; moving a knob (the dot, "Unsaved", Send going quiet so Save is the
// one filled primary); saving (progress, a refusal with the values kept, then a real save with its notice and Undo); a file
// the agent rewrote (the stale banner: Apply to the new file, Discard); tokens.css that cannot be read (Try again); leaving
// with unsaved values (Keep editing, Discard); values that survive a reload; an old version (read only); and a design with
// no knobs ("Ask for tweaks"). The fake backend keeps an in-memory tokens.css (fake-tokens.ts).
// DC_TWEAKS_ONLY=<tag regex> limits the variants while iterating.

const VARIANTS = [
  ['page', 1400, 900, 'dark'],
  ['page', 1400, 900, 'light'],
  ['rail', 320, 780, 'dark'],
  ['rail', 320, 780, 'light'],
  ['rail', 480, 780, 'dark'],
  ['rail', 480, 780, 'light'],
  ['rail', 320, 540, 'dark'],
  ['rail', 320, 540, 'light'],
];

const SLUG = 'coffee-subscription';
const PLAIN = 'invoice-template';

export const run = async (helpers) => {
  const { openPage, check, checkSoon, listReady, thumbsReady, wallReady, sleep } = helpers;
  const only = process.env.DC_TWEAKS_ONLY ? new RegExp(process.env.DC_TWEAKS_ONLY) : null;

  for (const [kind, width, height, theme] of VARIANTS) {
    const rail = kind === 'rail';
    const short = height < 560;
    const tag = `${kind}-${width}${short ? 'x' + height : ''}-${theme}-tweaks`;
    if (only && !only.test(tag)) continue;
    console.log(tag);
    const p = await openPage({ width, height, surface: rail ? 'panel' : 'page', theme, label: tag });
    await listReady(p);
    await thumbsReady(p);

    const q = (selector) => JSON.stringify(selector);
    const text = (selector) => p.guest(`return doc.querySelector(${q(selector)})?.textContent?.trim() ?? null`);
    const visible = (selector) => p.guest(`const n = doc.querySelector(${q(selector)}); return !!n && !n.hidden && n.getClientRects().length > 0`);
    const attr = (selector, name) => p.guest(`return doc.querySelector(${q(selector)})?.getAttribute(${q(name)}) ?? null`);
    const box = (selector) => p.guest(`const n = doc.querySelector(${q(selector)}); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, b: r.bottom }`);
    const noOverflow = () => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');

    const BUTTON = '.dc-tweaks-btn';
    const PANEL = '.dc-sheet:has(.dc-tweaks-rows) .dc-sheet-panel';
    const ROW = (name) => `.dc-knob[data-knob="${name}"]`;
    const SLIDER = (name) => `${ROW(name)} input[type=range]`;
    const value = (name) => text(`${ROW(name)} .dc-knob-value`);
    const SAVE = '.dc-tweaks-foot .oc-sdk-btn[data-emphasis="primary"]';
    const RESET = '.dc-tweaks-foot .oc-sdk-btn[data-variant="ghost"]';
    const sheetOpen = () => visible('.dc-tweaks-rows');
    const back = () => p.click(rail ? '.dc-toolbar-row .dc-iconbtn[aria-label="Back to designs"]' : '.dc-toolbar .oc-sdk-btn', rail ? {} : { text: 'Library' });
    const openDesign = async (slug, boards) => {
      await p.click(rail ? `.dc-row[data-slug="${slug}"] .dc-row-main` : `.dc-card[data-slug="${slug}"] .dc-card-main`);
      await wallReady(p, boards);
      await p.settle(500);
    };
    const openPanel = async () => {
      if (await sheetOpen()) return;
      await p.click(BUTTON);
      await checkSoon(sheetOpen, `${tag}: the panel opens`);
      await p.settle(250);
    };
    const closePanel = async () => {
      await p.click('.dc-sheet:has(.dc-tweaks-rows) .dc-sheet-head .dc-iconbtn');
      await checkSoon(async () => !(await sheetOpen()), `${tag}: the panel closes`);
    };
    const nudge = async (name, key, times) => {
      for (let n = 0; n < times; n += 1) await p.key(key, { focus: SLIDER(name) });
    };
    // A save closes the full-height sheet (it would cover the notice), a moment after the button stops spinning: open it again.
    const reopenAfterSave = async () => {
      if (!short) return;
      await checkSoon(async () => !(await sheetOpen()), `${tag}: the full-height sheet closes after a save`);
      await openPanel();
    };
    const sendQuiet = () => p.guest(`const s = doc.querySelector('.dc-ask .oc-sdk-btn'); return !!s && s.dataset.emphasis !== 'primary' && s.dataset.variant === 'outline'`);

    await openDesign(SLUG, rail ? 2 : 6);

    // 1. the button: between Comments and Versions, no dot, named
    check(await visible(BUTTON), `${tag}: the Tweaks button is shown (the design has knobs)`);
    check(
      await p.guest(
        rail
          ? `const a = [...doc.querySelectorAll('.dc-compact-actions > *')].map((n) => n.className + ' ' + (n.getAttribute('aria-label') ?? '')); const t = a.findIndex((s) => s.includes('dc-tweaks-btn')); return t > 0 && a[t + 1].includes('dc-versions-btn')`
          : `const a = [...doc.querySelectorAll('.dc-toolbar-group > *')].map((n) => n.textContent.trim()); const t = a.indexOf('Tweaks'); return t > 0 && a[t - 1].startsWith('Comments') && a[t + 1] === 'Versions'`,
      ),
      `${tag}: it sits between Comments and Versions`,
    );
    check((rail ? await attr(BUTTON, 'aria-label') : await text(BUTTON)) === 'Tweaks', `${tag}: it is named "Tweaks"`);
    check(!(await p.guest(`return doc.querySelector(${q(BUTTON)}).classList.contains('dc-dotmark')`)), `${tag}: no dot while nothing is unsaved`);
    check(!(await sendQuiet()), `${tag}: Send is the filled primary while the panel is shut`);
    await p.shot(`${tag}-1-closed`);

    // 2. the panel
    await openPanel();
    check((await attr(BUTTON, 'aria-pressed')) === 'true', `${tag}: the button is pressed while the panel is open`);
    check((await p.guest(`return doc.querySelector('.dc-sheet:has(.dc-tweaks-rows) .dc-sheet-title').firstChild.textContent`)) === 'Tweaks', `${tag}: the panel is titled Tweaks`);
    check((await p.guest(`return doc.querySelectorAll('.dc-knob').length`)) === 5, `${tag}: five rows`);
    check((await value('--accent-h')) === '17' && (await value('--radius')) === '8 px' && (await value('--density')) === 'Comfortable', `${tag}: the rows read the file's values with their units`);
    check((await attr(SLIDER('--radius'), 'aria-valuetext')) === '8 px', `${tag}: the slider's value text carries the unit`);
    check(await p.guest(`const l = doc.querySelector('${ROW('--radius')} label'); return l && l.getAttribute('for') === doc.querySelector(${q(SLIDER('--radius'))}).id`), `${tag}: each slider is labelled`);
    check((await p.guest(`return doc.querySelector('${ROW('--density')} [role=tab][aria-selected=true]')?.textContent`)) === 'Comfortable', `${tag}: the choice shows its option pressed`);
    check(await p.guest(`const r = doc.querySelector(${q(ROW('--heading-scale'))}); return r.querySelector('input').disabled && r.querySelector('.dc-knob-reason')?.textContent.includes('This value is a formula. Ask the agent to change it.')`), `${tag}: the broken knob is off, with its reason`);
    check(await p.guest(`return doc.querySelector('${ROW('--space')} .dc-knob-notes').textContent.includes('Also set for @media (max-width: 700px); only the default changes.') && doc.querySelector('${ROW('--space')} .dc-knob-notes').textContent.includes('The preview shows this value everywhere')`), `${tag}: the also-set line and the preview note`);
    check(!(await visible('.dc-tweaks-badge')), `${tag}: no "Unsaved" while nothing is`);
    check(await p.guest(`return doc.querySelector(${q(SAVE)}).disabled && doc.querySelector(${q(RESET)}).disabled`), `${tag}: Save and Reset are off with nothing to save`);
    check((await text('.dc-tweaks-note')) === 'Nothing to save yet.', `${tag}: and the foot says why`);
    if (rail) {
      const panel = await box(PANEL);
      const host = await box('.dc-app');
      const stage = await box('.dc-stage');
      const bottom = !short;
      check((await attr('.dc-sheet:has(.dc-tweaks-rows)', 'data-variant')) === (bottom ? 'bottom' : 'full'), `${tag}: the rail opens a ${bottom ? 'bottom' : 'full-height'} sheet`);
      if (bottom) {
        check(panel.h <= host.h / 2 + 1, `${tag}: the sheet is at most half the rail (${Math.round(panel.h)} of ${Math.round(host.h)})`);
        check(Math.abs(panel.b - host.b) < 2, `${tag}: it is pinned to the bottom of the rail`);
        check(stage.h > 0 && stage.y + stage.h > host.y && panel.y > stage.y + 60, `${tag}: the wall is visible above it`);
        check(await p.guest(`const p = doc.querySelector(${q(PANEL)}); return p.getAttribute('role') === 'region' && !p.hasAttribute('aria-modal')`), `${tag}: it is a region, not a modal`);
        check(await p.guest(`const body = doc.querySelector('.dc-tweaks-body'); return getComputedStyle(body).overflowY === 'auto'`), `${tag}: the rows scroll inside the sheet`);
        check(await p.guest(`return doc.querySelector('.dc-dock')?.hidden !== false`), `${tag}: the empty side dock stays shut (it would squeeze the wall)`);
        // Fit uses the part of the wall still visible: the boards sit above the sheet's top edge
        await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Fit' });
        await p.settle(300);
        check(await p.guest(`const top = doc.querySelector(${q(PANEL)}).getBoundingClientRect().top; const bs = [...doc.querySelectorAll('.dc-board[data-board]')].map((n) => n.getBoundingClientRect()); return Math.max(...bs.map((r) => r.bottom)) <= top + 2`), `${tag}: Fit keeps every artboard above the sheet`);
      } else check(await p.guest(`return doc.querySelector(${q(PANEL)}).getAttribute('role') === 'dialog'`), `${tag}: at this height it is the modal full sheet`);
    } else {
      const panel = await box(PANEL);
      check(Math.abs(panel.w - 360) < 2, `${tag}: the page's panel is a 360 px dock`);
    }
    check(await noOverflow(), `${tag}: no horizontal overflow with the panel open`);
    await p.shot(`${tag}-2-panel`);

    // 3. move a knob: keyboard on a slider, a click on a choice
    await nudge('--accent-h', 'ArrowRight', 3);
    await checkSoon(async () => (await value('--accent-h')) === '20', `${tag}: ArrowRight steps the slider and the value follows (${await value('--accent-h')})`);
    await nudge('--radius', 'ArrowRight', 2);
    check((await value('--radius')) === '12 px', `${tag}: the radius steps by its own step, 2 px (${await value('--radius')})`);
    await nudge('--radius', 'End', 1);
    check((await value('--radius')) === '24 px', `${tag}: End goes to the top of the range`);
    await nudge('--radius', 'Home', 1);
    check((await value('--radius')) === '0 px', `${tag}: Home goes to the bottom`);
    await nudge('--radius', 'PageUp', 1);
    check((await value('--radius')) === '20 px', `${tag}: Page Up moves ten steps (${await value('--radius')})`);
    await p.click(`${ROW('--density')} [role=tab]`, { text: 'Roomy' });
    check((await value('--density')) === 'Roomy', `${tag}: the choice follows a click`);
    check(await p.guest(`return doc.querySelector(${q(BUTTON)}).classList.contains('dc-dotmark')`), `${tag}: the button carries the dot`);
    check(rail ? (await attr(BUTTON, 'aria-label')) === 'Tweaks, unsaved changes' : (await attr(BUTTON, 'aria-label')) === 'Tweaks, unsaved changes', `${tag}: and says so in its name`);
    check((await text('.dc-tweaks-badge')) === 'Unsaved', `${tag}: the panel says "Unsaved"`);
    check(await p.guest(`return !doc.querySelector(${q(SAVE)}).disabled && !doc.querySelector(${q(RESET)}).disabled`), `${tag}: Save and Reset are on`);
    check(await sendQuiet(), `${tag}: Send went quiet (outline) while the panel is open`);
    check((await p.guest(`return [...doc.querySelectorAll('.oc-sdk-btn[data-emphasis="primary"]')].filter((n) => n.getClientRects().length > 0).length`)) === 1, `${tag}: Save is the one filled primary on screen`);
    check((await p.guest(`return doc.querySelector('${ROW('--radius')}').dataset.changed`)) === 'true' && (await p.guest(`return doc.querySelector('${ROW('--space')}').dataset.changed`)) === 'false', `${tag}: only the moved rows read as changed`);
    await p.shot(`${tag}-3-unsaved`);

    // the dot and the values survive closing the panel; Send is filled again
    await closePanel();
    check(await p.guest(`return doc.querySelector(${q(BUTTON)}).classList.contains('dc-dotmark')`), `${tag}: the dot stays after the panel is closed`);
    check(!(await sendQuiet()), `${tag}: Send is the filled primary again`);
    check(await p.guest(`return doc.activeElement === doc.querySelector(${q(BUTTON)})`), `${tag}: focus goes back to the Tweaks button`);
    await openPanel();
    check((await value('--accent-h')) === '20' && (await value('--density')) === 'Roomy', `${tag}: the values are still there when it opens again`);

    // Esc pressed on the wall closes the rail's bottom sheet (the wall had no card, editor or popover open to use it)
    if (rail && !short) {
      await p.key('Escape', { focus: '.dc-wall' });
      await checkSoon(async () => !(await sheetOpen()), `${tag}: Escape on the wall closes the bottom sheet`);
      await openPanel();
    }

    // Reset: back to the file's values, nothing written
    await p.click(RESET);
    check((await value('--accent-h')) === '17' && (await value('--density')) === 'Comfortable', `${tag}: Reset returns to the file's values`);
    check(!(await p.guest(`return doc.querySelector(${q(BUTTON)}).classList.contains('dc-dotmark')`)), `${tag}: and the dot goes`);

    // 4. saving: progress, a refusal with the values kept, then a real save with its notice and Undo
    await nudge('--accent-h', 'ArrowRight', 5);
    await p.route('POST /designs/:slug/edits', {
      delayMs: 1500,
      body: { edit: { id: 'e_slow', label: 'Tweaks saved to tokens.css', files: ['tokens.css'], undoable: false }, version: null, coalesced: false, stamps: {} },
    });
    await p.click(SAVE, { wait: 250 });
    check(await p.guest(`const s = doc.querySelector(${q(SAVE)}); return s.dataset.loading === 'true' && s.disabled`), `${tag}: Save shows progress while it saves`);
    check(await p.guest(`return doc.querySelector(${q(SLIDER('--accent-h'))}).disabled`), `${tag}: the rows are off while it saves`);
    await p.shot(`${tag}-4-saving`);
    await checkSoon(async () => !(await p.guest(`return doc.querySelector(${q(SAVE)}).dataset.loading === 'true'`)), `${tag}: the slow save ends`, 8000);
    await reopenAfterSave();
    await p.route('POST /designs/:slug/edits', { status: 422, body: { error: 'invalid', message: "This file is a link, so Design Chamber can't edit it here. Ask the agent instead." } });
    await nudge('--accent-h', 'ArrowRight', 5);
    await p.click(SAVE);
    await checkSoon(async () => (await text('.dc-tweaks-note'))?.startsWith("Couldn't save your tweaks.") === true, `${tag}: a refused save says so under the values`);
    check((await text('.dc-tweaks-note'))?.endsWith('Your values are still here.') === true, `${tag}: and that they are kept`);
    check((await attr('.dc-tweaks-note', 'role')) === 'alert', `${tag}: the refusal is announced`);
    check((await p.guest(`return Number(doc.querySelector(${q(SLIDER('--accent-h'))}).value)`)) > 17, `${tag}: the slider still holds the user's value`);
    check(await p.guest(`return !doc.querySelector(${q(SAVE)}).disabled`), `${tag}: Save is on to try again`);
    await p.shot(`${tag}-5-refused`);
    await p.route('POST /designs/:slug/edits', null);

    // a real save: the notice says what happened and offers Undo (the slow save's own notice, without Undo, is still up: wait for the one that has it)
    await p.click(SAVE);
    await checkSoon(() => visible('.dc-notices .dc-row-actions .oc-sdk-btn'), `${tag}: the saved notice offers Undo`);
    check((await text('.dc-notices .oc-sdk-banner-title')) === 'Tweaks saved to tokens.css', `${tag}: it says "Tweaks saved to tokens.css"`);
    check(!(await p.guest(`return doc.querySelector(${q(BUTTON)}).classList.contains('dc-dotmark')`)), `${tag}: the dot is gone`);
    check(!(await visible('.dc-tweaks-badge')), `${tag}: and so is "Unsaved"`);
    await p.shot(`${tag}-6-saved`);
    // The full-height sheet covers the notices, so Save closes it; Undo is then reachable, and the panel opens again to read the file.
    if (short) check(!(await sheetOpen()), `${tag}: the full-height sheet closed on Save, so the notice and its Undo are not hidden under it`);
    await p.click('.dc-notices .oc-sdk-btn', { text: 'Undo' });
    await checkSoon(async () => (await text('.dc-notices .oc-sdk-banner-title')) === 'Undone', `${tag}: Undo answers "Undone"`);
    if (!(await sheetOpen())) await openPanel();
    await checkSoon(async () => (await value('--accent-h')) === '17', `${tag}: and the panel reads the file as it was (${await value('--accent-h')})`);

    // 5. the agent rewrote tokens.css under unsaved values: the stale banner
    await nudge('--accent-h', 'ArrowRight', 8);
    await p.guest(`win.__dcFake.touchTokens(${q(SLUG)})`);
    await checkSoon(() => visible('.dc-tweaks-banner'), `${tag}: the stale banner appears`, 6000);
    check((await text('.dc-tweaks-banner .oc-sdk-banner-title')) === 'tokens.css changed since you started.', `${tag}: it says what happened`);
    check((await text('.dc-tweaks-banner .oc-sdk-banner-body'))?.includes('Your values are still shown.') === true, `${tag}: and that the values are still shown`);
    check(await p.guest(`const names = [...doc.querySelectorAll('.dc-tweaks-banner .oc-sdk-btn')].map((n) => n.textContent.trim()); return names.join('|') === 'Apply to the new file|Discard my tweaks'`), `${tag}: with Apply to the new file and Discard my tweaks`);
    check(await p.guest(`return doc.querySelector(${q(SAVE)}).disabled && doc.querySelector(${q(SAVE)}).title.includes('Apply to the new file')`), `${tag}: Save is off until the user chooses, and says so`);
    check((await value('--accent-h')) !== '17', `${tag}: the user's value is still on the slider`);
    await p.shot(`${tag}-7-stale`);
    await p.click('.dc-tweaks-banner .oc-sdk-btn', { text: 'Apply to the new file' });
    await checkSoon(async () => (await text('.dc-notices .oc-sdk-banner-title')) === 'Tweaks saved to tokens.css', `${tag}: Apply to the new file saves onto it`);
    check(!(await visible('.dc-tweaks-banner')), `${tag}: the banner is gone`);
    await reopenAfterSave();
    // and Discard
    await nudge('--accent-h', 'ArrowRight', 4);
    await p.guest(`win.__dcFake.touchTokens(${q(SLUG)})`);
    await checkSoon(() => visible('.dc-tweaks-banner'), `${tag}: the banner comes back for a second rewrite`, 6000);
    await p.click('.dc-tweaks-banner .oc-sdk-btn', { text: 'Discard my tweaks' });
    await checkSoon(async () => !(await visible('.dc-tweaks-banner')), `${tag}: Discard my tweaks closes it`);
    check(!(await p.guest(`return doc.querySelector(${q(BUTTON)}).classList.contains('dc-dotmark')`)), `${tag}: and drops the unsaved values`);

    // 6. leaving with unsaved values: the three-button question
    await nudge('--accent-h', 'ArrowRight', 3);
    await closePanel();
    await back();
    await checkSoon(() => visible('.dc-sheet[data-variant="dialog"]'), `${tag}: leaving with unsaved values asks`);
    check((await text('.dc-sheet[data-variant="dialog"] .dc-sheet-title')) === 'Save your tweaks?', `${tag}: "Save your tweaks?"`);
    check((await p.guest(`return [...doc.querySelectorAll('.dc-sheet[data-variant="dialog"] .dc-sheet-foot .oc-sdk-btn')].map((n) => n.textContent.trim()).join('|')`)) === 'Keep editing|Discard|Save', `${tag}: Keep editing, Discard, Save`);
    check((await p.guest(`return doc.querySelector('.dc-sheet[data-variant="dialog"] .oc-sdk-btn[data-emphasis="primary"]')?.textContent.trim()`)) === 'Save', `${tag}: Save is the primary`);
    await p.shot(`${tag}-8-leave`);
    await p.key('Escape', { focus: '.dc-sheet[data-variant="dialog"] .dc-sheet-panel' });
    await checkSoon(async () => !(await visible('.dc-sheet[data-variant="dialog"]')), `${tag}: Escape is Keep editing`);
    check(await visible('.dc-tweaks-btn'), `${tag}: the design is still open`);
    await back();
    await checkSoon(() => visible('.dc-sheet[data-variant="dialog"]'), `${tag}: back asks again`);
    await p.click('.dc-sheet[data-variant="dialog"] .oc-sdk-btn', { text: 'Discard' });
    await checkSoon(() => p.guest(`return !!doc.querySelector('.dc-row[data-slug], .dc-card[data-slug]')`), `${tag}: Discard leaves for the list`);
    await listReady(p);

    // 7. values survive a reload of the frame (the storage mirror)
    await openDesign(SLUG, rail ? 2 : 6);
    await openPanel();
    const fileHue = Number(await value('--accent-h'));
    await nudge('--accent-h', 'ArrowRight', 6);
    await p.settle(700);
    await p.host('document.getElementById("g").contentWindow.location.reload()');
    await p.settle(900);
    await p.waitFor('return !!doc.querySelector(".dc-app")', 'the app to mount again');
    if (!(await visible(BUTTON))) {
      await listReady(p);
      await openDesign(SLUG, rail ? 2 : 6);
    }
    await checkSoon(() => p.guest(`return doc.querySelector(${q(BUTTON)})?.classList.contains('dc-dotmark') === true`), `${tag}: unsaved values come back after a reload (the dot)`, 8000);
    await openPanel();
    check((await value('--accent-h')) === String(fileHue + 6) && (await text('.dc-tweaks-badge')) === 'Unsaved', `${tag}: with their values and "Unsaved" (${await value('--accent-h')}, file ${fileHue})`);
    await p.click(RESET);

    // 8. an old version on show: read only, with the reason
    await closePanel();
    await p.click(rail ? '.dc-versions-btn' : '.dc-toolbar .oc-sdk-btn', rail ? {} : { text: 'Versions' });
    await checkSoon(() => visible('.dc-version, .dc-versions-list, [data-version]'), `${tag}: the versions list opens`, 8000).catch(() => undefined);
    await p.click('.dc-sheet .oc-sdk-btn', { text: 'View' }).catch(() => undefined);
    await checkSoon(() => visible('.dc-viewing'), `${tag}: an old version is on show`, 8000);
    await openPanel();
    check((await text('.dc-tweaks-banners .oc-sdk-banner-title')) === "You're viewing an old version.", `${tag}: the panel says so`);
    check(await p.guest(`return [...doc.querySelectorAll('.dc-knob input[type=range]')].every((n) => n.disabled) && doc.querySelector(${q(SAVE)}).disabled`), `${tag}: the rows and Save are off`);
    await p.shot(`${tag}-9-viewing`);
    await closePanel();
    await p.click('.dc-viewing .oc-sdk-btn', { text: 'Back to current' });
    await checkSoon(async () => !(await visible('.dc-viewing')), `${tag}: back on the current design`);

    // 9. tokens.css cannot be read: the failed row, Try again, the values kept
    await back();
    await listReady(p);
    await p.route('GET /designs/:slug/tokens', { status: 500, body: { error: 'internal', message: 'The local service did not answer.' } });
    await openDesign(SLUG, rail ? 2 : 6);
    await openPanel();
    await checkSoon(() => visible('.dc-tweaks-error'), `${tag}: a failed read says so`, 8000);
    check((await text('.dc-tweaks-error'))?.startsWith("Couldn't read tokens.css.") === true, `${tag}: "Couldn't read tokens.css. …" (${await text('.dc-tweaks-error')})`);
    check(await p.guest(`return [...doc.querySelectorAll('.dc-knob input[type=range]')].every((n) => n.disabled) && doc.querySelector(${q(SAVE)}).disabled && doc.querySelector(${q(RESET)}).disabled`), `${tag}: every knob and both buttons are off`);
    check(await visible('.dc-tweaks-failed .oc-sdk-btn'), `${tag}: Try again is there`);
    check(await visible(BUTTON), `${tag}: the Tweaks button stays`);
    await p.shot(`${tag}-10-failed`);
    await p.route('GET /designs/:slug/tokens', null);
    await p.click('.dc-tweaks-failed .oc-sdk-btn', { text: 'Try again' });
    await checkSoon(async () => !(await visible('.dc-tweaks-error')) && (await value('--radius')) === '8 px', `${tag}: Try again reads it and the rows come back`, 8000);
    check(await noOverflow(), `${tag}: no horizontal overflow at the end`);
    if (await sheetOpen()) await closePanel();
    await back();
    await listReady(p);

    // 10. a design without knobs: no button; the menu offers "Ask for tweaks", which fills the ask bar and sends nothing
    await openDesign(PLAIN, 1);
    check(!(await visible(BUTTON)), `${tag}: a design with no knobs has no Tweaks button`);
    await p.click(rail ? '.dc-toolbar-row .dc-iconbtn[aria-label="More actions"]' : '.dc-toolbar .dc-iconbtn[aria-label="More actions"]');
    check((await p.guest(`return [...doc.querySelectorAll('.dc-popup [role=menuitem]')].some((n) => n.textContent.trim() === 'Ask for tweaks')`)) === true, `${tag}: the menu offers "Ask for tweaks"`);
    await p.click('.dc-popup [role="menuitem"]', { text: 'Ask for tweaks' });
    check((await p.guest(`return doc.querySelector('.dc-ask-input').value`)) === 'Add tweaks for this design (accent hue, density, type scale, radius).', `${tag}: it puts the words in the ask bar`);
    check(await p.guest(`return doc.activeElement === doc.querySelector('.dc-ask-input')`), `${tag}: and the keyboard goes there`);
    check(!(await p.host('JSON.stringify(window.__host.prompts)')).includes('Add tweaks'), `${tag}: nothing was sent`);
    await p.shot(`${tag}-11-no-knobs`);
    await p.close();
  }
};
