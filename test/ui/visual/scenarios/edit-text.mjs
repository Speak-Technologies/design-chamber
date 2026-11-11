// Visual scenario for Edit text (Phase 2 feature 08, U1): page 1400 and rail 320 and 480, dark and light.
// Per variant, on the coffee canvas (and on the invoice page for the page presentation): the selection
// toolbar over a picked element with the comment box beside it, Edit text opening the editor with the
// source text selected, Enter saving (notice with Undo, then Undone), a refusal that keeps the typed text,
// the stale sentence with Reload and try again, the click-away line, the character counter, a formatted
// element (Edit text disabled with its reason), a duplicated one, Escape and Ctrl+Z. The fake backend
// answers edits with "not built yet", so the scenario answers the routes itself (`p.route`).
// DC_EDIT_ONLY=<tag regex> limits the variants while iterating.

const VARIANTS = [
  ['page', 1400, 'dark'],
  ['page', 1400, 'light'],
  ['rail', 320, 'dark'],
  ['rail', 320, 'light'],
  ['rail', 480, 'dark'],
  ['rail', 480, 'light'],
];

const TOOLBAR = '.dc-seltoolbar';
const EDITOR = '.dc-editor';
const AREA = '.dc-editor textarea';
const SAVED = { edit: { id: 'e_visual001', label: 'Text updated in Home', files: ['screens/home.html'], undoable: true }, version: null, coalesced: false, stamps: { file: 'x' } };

export const run = async (helpers) => {
  const { openPage, check, checkSoon, listReady, thumbsReady, wallReady, sleep } = helpers;
  const only = process.env.DC_EDIT_ONLY ? new RegExp(process.env.DC_EDIT_ONLY) : null;

  for (const [kind, width, theme] of VARIANTS) {
    const tag = `${kind}-${width}-${theme}-edit`;
    if (only && !only.test(tag)) continue;
    console.log(tag);
    const rail = kind === 'rail';
    const p = await openPage({ width, height: rail ? 780 : 900, surface: rail ? 'panel' : 'page', theme, label: tag });
    await p.waitFor('return !!doc.querySelector(".dc-app")', 'the app to mount');
    await listReady(p);
    await thumbsReady(p);
    await p.click(rail ? '.dc-row[data-slug="coffee-subscription"] .dc-row-main' : '.dc-card[data-slug="coffee-subscription"] .dc-card-main');
    await wallReady(p, rail ? 2 : 6);
    await p.settle(700);

    const text = (selector) => p.guest(`return doc.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? null`);
    const visible = (selector) => p.guest(`const n = doc.querySelector(${JSON.stringify(selector)}); return !!n && !n.hidden && n.getClientRects().length > 0`);
    const attr = (selector, name) => p.guest(`return doc.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(name)}) ?? null`);
    const noOverflow = () => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');
    const inside = (selector) =>
      p.guest(`const n = doc.querySelector(${JSON.stringify(selector)}); const w = doc.querySelector('.dc-wall').getBoundingClientRect(); if (!n) return false; const r = n.getBoundingClientRect(); return r.left >= w.left - 1 && r.right <= w.right + 1 && r.top >= w.top - 1 && r.bottom <= w.bottom + 1`);

    if (!rail) {
      await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Fit' });
      const home0 = await p.rect('.dc-board[data-board="home@laptop"]');
      await p.wheel(home0.x + home0.w / 2, home0.y + home0.h / 2, 0, -130, { ctrl: true });
      await p.settle(500);
    }
    let board = await p.rect('.dc-board[data-board="home@laptop"]');

    // Click a grid of points over the board until the toolbar names an element whose label matches `want`.
    const pickWhere = async (want) => {
      // A notice above the wall pushes it down: measure the board again each time.
      board = await p.rect('.dc-board[data-board="home@laptop"]');
      for (const fy of [0.46, 0.5, 0.54, 0.42, 0.58, 0.62, 0.38, 0.66, 0.7, 0.3, 0.78, 0.86, 0.22, 0.16]) {
        for (const fx of [0.3, 0.12, 0.45, 0.6, 0.78]) {
          await p.clickAt(board.x + board.w * fx, board.y + board.h * fy);
          await p.settle(260);
          const name = await attr(`${TOOLBAR} [role=toolbar]`, 'aria-label');
          if (name && want.test(name)) return name;
          // On a narrow rail the comment box covers the board: close it so the next click lands on the design.
          if (await visible('.dc-composer')) {
            await p.key('Escape', { focus: '.dc-composer textarea' });
            await p.settle(120);
          }
        }
      }
      return null;
    };
    const pressEscape = () => p.key('Escape', { focus: `${TOOLBAR} .oc-sdk-btn` });

    // 1. pick an editable element: toolbar above, comment box beside it, Edit text ready
    p.route('GET /designs/:slug/source', null);
    const name = await pickWhere(/^Actions for (p|h3|h2|a) '/);
    check(name !== null, `${tag}: a click on text shows the toolbar named for it (${name})`);
    await checkSoon(async () => (await attr(`${TOOLBAR} [data-action=edit]`, 'aria-disabled')) === null && !(await p.guest(`return doc.querySelector('${TOOLBAR} [data-action=edit]').disabled`)), `${tag}: Edit text becomes usable once the frame and the file answered`);
    check(await visible('.dc-composer'), `${tag}: the comment box opens as before`);
    check(await inside(TOOLBAR), `${tag}: the toolbar stays inside the viewer`);
    check((await p.guest(`return [...doc.querySelectorAll('${TOOLBAR} .oc-sdk-btn')].map((b) => b.getAttribute('aria-label')).join('|')`)) === 'Edit text|Comment|Ask agent', `${tag}: Edit text, Comment and Ask agent`);
    check(await noOverflow(), `${tag}: no horizontal overflow`);
    await p.shot(`${tag}-1-select`);

    // Ask agent puts the element in the ask bar and moves the keyboard there
    await p.click(`${TOOLBAR} [data-action=ask]`);
    await checkSoon(() => p.guest('return doc.activeElement === doc.querySelector(".dc-ask-input")'), `${tag}: Ask agent focuses the ask bar`);
    check(await visible('.dc-ask-chip'), `${tag}: Ask agent attaches the element as a chip`);
    check(!(await visible(TOOLBAR)), `${tag}: the toolbar closes after Ask agent`);
    await p.click('.dc-ask-chip .dc-iconbtn');

    // 2. Edit text opens the editor with the source text selected
    await pickWhere(/^Actions for (p|h3|h2|a) '/);
    await checkSoon(async () => (await attr(`${TOOLBAR} [data-action=edit]`, 'aria-disabled')) === null && !(await p.guest(`return doc.querySelector('${TOOLBAR} [data-action=edit]').disabled`)), `${tag}: Edit text usable again`);
    await p.click(`${TOOLBAR} [data-action=edit]`);
    await p.waitFor(`return !!doc.querySelector(${JSON.stringify(EDITOR)})`, 'the editor');
    check(!(await visible(TOOLBAR)), `${tag}: the toolbar is hidden while editing`);
    const original = await p.guest(`return doc.querySelector(${JSON.stringify(AREA)}).value`);
    check(original.length > 0 && !original.includes('\n'), `${tag}: the editor holds the source text on one line (${JSON.stringify(original)})`);
    check(await p.guest(`const a = doc.querySelector(${JSON.stringify(AREA)}); return doc.activeElement === a && a.selectionStart === 0 && a.selectionEnd === a.value.length`), `${tag}: the editor has focus with the text selected`);
    check(await inside(EDITOR), `${tag}: the editor stays inside the viewer`);
    check(await noOverflow(), `${tag}: no horizontal overflow while editing`);
    await p.shot(`${tag}-2-edit`);

    // click-away with a change keeps the editor and says what to do
    await p.type(AREA, `${original} today`);
    const wallBox = await p.rect('.dc-wall');
    await p.clickAt(wallBox.x + wallBox.w - 6, wallBox.y + wallBox.h - 6);
    await p.settle(250);
    check(await visible(EDITOR), `${tag}: a click away with a change keeps the editor open`);
    check(((await text('.dc-editor-line')) ?? '') === 'Press Enter to save or Esc to discard.', `${tag}: the click-away line says what to do`);
    check(await p.guest(`return doc.activeElement === doc.querySelector(${JSON.stringify(AREA)})`), `${tag}: focus is back in the text`);
    await p.shot(`${tag}-3-clickaway`);

    // character counter and the limit
    await p.type(AREA, 'a'.repeat(4700));
    await checkSoon(async () => (await visible('.dc-editor-count')) && ((await text('.dc-editor-count')) ?? '').includes('/'), `${tag}: the counter shows from 4 500 characters`);
    await p.shot(`${tag}-4-counter`);
    await p.type(AREA, 'a'.repeat(5200));
    await checkSoon(async () => ((await text('.dc-editor-count')) ?? '').includes('characters at most'), `${tag}: past the limit the counter says the limit`);
    await checkSoon(() => p.guest('return doc.querySelector(".dc-editor .oc-sdk-btn[data-variant=default]").disabled'), `${tag}: Save is off over the limit`);
    await p.shot(`${tag}-4b-over`);

    // a refused save keeps the typed words; stale offers Reload and try again
    await p.type(AREA, `${original} refused`);
    await p.route('POST /designs/:slug/edits', { status: 409, body: { error: 'stale', message: 'raw service wording' } });
    await p.key('Enter', { focus: AREA });
    await checkSoon(async () => ((await text('.dc-editor .dc-form-error')) ?? '') === 'This file changed while you were editing. Nothing was saved.', `${tag}: stale says the exact sentence`);
    check((await p.guest(`return doc.querySelector(${JSON.stringify(AREA)}).value`)) === `${original} refused`, `${tag}: the typed text is kept after a refusal`);
    check(await p.guest('return [...doc.querySelectorAll(".dc-editor-ways .oc-sdk-btn")].some((b) => !b.closest("[hidden]") && b.textContent.includes("Reload and try again"))'), `${tag}: Reload and try again is offered`);
    await p.shot(`${tag}-5-stale`);

    // reload: the element is still in the file, so the text stays and the editor goes on
    await p.click('.dc-editor-ways .oc-sdk-btn', { text: 'Reload and try again' });
    await checkSoon(async () => !(await visible('.dc-editor .dc-form-error')), `${tag}: Reload and try again clears the refusal`);
    check((await p.guest(`return doc.querySelector(${JSON.stringify(AREA)}).value`)) === `${original} refused`, `${tag}: Reload keeps the typed text`);

    // a failure in the service keeps the text and says so
    await p.route('POST /designs/:slug/edits', { status: 500, body: 'oops' });
    await p.key('Enter', { focus: AREA });
    await checkSoon(async () => ((await text('.dc-editor .dc-form-error')) ?? '').endsWith('Your text is still here.'), `${tag}: a service failure says the text is still here`);
    await p.shot(`${tag}-6-failed`);

    // 3. success: notice with Undo, then Undone
    await p.route('POST /designs/:slug/edits', { body: SAVED });
    await p.route('POST /designs/:slug/edits/:id/undo', { body: { files: ['screens/home.html'], stamps: {}, version: null } });
    await p.key('Enter', { focus: AREA });
    await p.waitFor('return !!doc.querySelector(".dc-edit-notice")', 'the edit notice');
    check(!(await visible(EDITOR)), `${tag}: the editor closes after a save`);
    check(((await text('.dc-edit-notice .oc-sdk-banner-title')) ?? '') === 'Text updated in Home', `${tag}: the notice names what changed`);
    check(await p.guest('return [...doc.querySelectorAll(".dc-edit-notice .oc-sdk-btn")].some((b) => b.textContent.trim() === "Undo")'), `${tag}: the notice offers Undo`);
    await p.shot(`${tag}-7-saved`);
    await p.click('.dc-edit-notice .oc-sdk-btn', { text: 'Undo' });
    await checkSoon(async () => ((await text('.dc-notices .oc-sdk-banner-title')) ?? '') === 'Undone', `${tag}: Undo ends as Undone`);

    // Ctrl+Z: one slot. Save again, then Ctrl+Z undoes it once.
    await pickWhere(/^Actions for (p|h3|h2|a) '/);
    await checkSoon(async () => (await attr(`${TOOLBAR} [data-action=edit]`, 'aria-disabled')) === null && !(await p.guest(`return doc.querySelector('${TOOLBAR} [data-action=edit]').disabled`)), `${tag}: Edit text usable for the Ctrl+Z run`);
    await p.click(`${TOOLBAR} [data-action=edit]`);
    await p.waitFor(`return !!doc.querySelector(${JSON.stringify(EDITOR)})`, 'the editor for Ctrl+Z');
    await p.type(AREA, `${original} again`);
    await p.key('Enter', { focus: AREA });
    await p.waitFor('return !!doc.querySelector(".dc-edit-notice")', 'the second edit notice');
    await p.key('z', { code: 'KeyZ', ctrl: true, focus: '.dc-wall' });
    await checkSoon(async () => ((await text('.dc-notices .oc-sdk-banner-title')) ?? '') === 'Undone', `${tag}: Ctrl+Z undoes the last edit`);

    // an unchanged text is a no-op: Enter closes the editor and writes nothing
    await pickWhere(/^Actions for (p|h3|h2|a) '/);
    await checkSoon(async () => (await attr(`${TOOLBAR} [data-action=edit]`, 'aria-disabled')) === null && !(await p.guest(`return doc.querySelector('${TOOLBAR} [data-action=edit]').disabled`)), `${tag}: Edit text usable for the no-op run`);
    await p.click(`${TOOLBAR} [data-action=edit]`);
    await p.waitFor(`return !!doc.querySelector(${JSON.stringify(EDITOR)})`, 'the editor for the no-op');
    await p.route('POST /designs/:slug/edits', { status: 500, body: 'a no-op must not write' });
    await p.key('Enter', { focus: AREA });
    await checkSoon(async () => !(await visible(EDITOR)), `${tag}: Enter on unchanged text just closes the editor`);
    await p.clearRoutes();

    // Esc closes the editor and gives the keyboard back to the wall
    await pickWhere(/^Actions for (p|h3|h2|a) '/);
    await checkSoon(async () => (await attr(`${TOOLBAR} [data-action=edit]`, 'aria-disabled')) === null && !(await p.guest(`return doc.querySelector('${TOOLBAR} [data-action=edit]').disabled`)), `${tag}: Edit text usable for the Esc run`);
    await p.click(`${TOOLBAR} [data-action=edit]`);
    await p.waitFor(`return !!doc.querySelector(${JSON.stringify(EDITOR)})`, 'the editor for Esc');
    await p.key('Escape', { focus: AREA });
    await checkSoon(async () => !(await visible(EDITOR)), `${tag}: Esc closes the editor`);
    await checkSoon(() => p.guest('return doc.activeElement === doc.querySelector(".dc-wall")'), `${tag}: Esc hands focus back to the wall`);

    // 4. an element with formatting inside: Edit text disabled with its reason, still focusable
    const formatted = await pickWhere(/^Actions for h1 '/);
    check(formatted !== null, `${tag}: the headline is picked (${formatted})`);
    await checkSoon(async () => (await attr(`${TOOLBAR} [data-action=edit]`, 'aria-disabled')) === 'true', `${tag}: a headline with a line break inside is not editable`);
    check(((await text('.dc-seltoolbar-reason')) ?? '') === 'This has formatting inside. Ask the agent to change it.', `${tag}: the reason says why`);
    check((await attr(`${TOOLBAR} [data-action=edit]`, 'aria-describedby')) === (await attr('.dc-seltoolbar-reason', 'id')), `${tag}: the reason describes the button`);
    check(await inside(TOOLBAR), `${tag}: the toolbar stays inside the viewer with the reason`);
    await p.shot(`${tag}-8-blocked`);
    await p.key('Tab', { focus: '.dc-wall' });

    // keyboard: arrows move along the toolbar, Esc closes it and returns to the wall
    await p.guest(`doc.querySelector('${TOOLBAR} [data-action=edit]').focus()`);
    await p.key('ArrowRight', { focus: `${TOOLBAR} [data-action=edit]` });
    check(await p.guest(`return doc.activeElement === doc.querySelector('${TOOLBAR} [data-action=comment]')`), `${tag}: the right arrow moves to the next action`);
    await p.key('Escape', { focus: `${TOOLBAR} [data-action=comment]` });
    await checkSoon(async () => !(await visible(TOOLBAR)), `${tag}: Esc closes the toolbar`);
    await checkSoon(() => p.guest('return doc.activeElement === doc.querySelector(".dc-wall")'), `${tag}: and returns the keyboard to the wall`);

    // 5. an old version on show: Edit text has no way in
    if (rail) await p.click('.dc-compact-actions .dc-versions-btn');
    else await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Versions' });
    await p.waitFor('return !!doc.querySelector(".dc-version")', 'the versions list');
    await p.click('.dc-version .oc-sdk-btn', { text: 'View', nth: 1 });
    await p.waitFor('return !!doc.querySelector(".dc-viewing")', 'the viewing banner');
    board = await p.rect('.dc-board[data-board="home@laptop"]');
    await p.clickAt(board.x + board.w * 0.3, board.y + board.h * 0.5);
    await p.settle(300);
    check(!(await visible(TOOLBAR)) && !(await visible(EDITOR)), `${tag}: no toolbar or editor opens on a saved version`);
    await p.close();

    // 6. a page design (one frame like a browser tab, Comment mode on): the same toolbar, flipped below near the top edge
    if (tag.includes('page-1400-light') || tag.includes('rail-320-dark')) {
      const q = await openPage({ width, height: rail ? 780 : 900, surface: rail ? 'panel' : 'page', theme, label: `${tag}-page` });
      await listReady(q);
      await thumbsReady(q);
      await q.click(rail ? '.dc-row[data-slug="invoice-template"] .dc-row-main' : '.dc-card[data-slug="invoice-template"] .dc-card-main');
      await q.waitFor('return !!doc.querySelector(".dc-board[data-state=ready]")', 'the page to render', 20000);
      await q.settle(600);
      await q.click(rail ? '.dc-toolbar-tools .oc-sdk-btn' : '.dc-toolbar .oc-sdk-btn', { text: 'Comment' });
      await q.settle(300);
      const frame = await q.rect('.dc-board');
      let picked = null;
      const spots = rail ? [0.04, 0.06, 0.08, 0.1, 0.12, 0.14, 0.17, 0.2, 0.24].flatMap((fy) => [0.15, 0.3].map((fx) => [fx, fy])) : [[0.31, 0.16], [0.32, 0.18], [0.33, 0.15]];
      for (const [fx, fy] of spots) {
        await q.clickAt(frame.x + frame.w * fx, frame.y + frame.h * fy);
        await q.settle(300);
        picked = await q.guest(`return doc.querySelector('.dc-seltoolbar [role=toolbar]')?.getAttribute('aria-label') ?? null`);
        if (picked) break;
      }
      check(picked !== null, `${tag}: on a page, a click shows the toolbar (${picked})`);
      await checkSoon(() => q.guest(`const b = doc.querySelector('.dc-seltoolbar [data-action=edit]'); return !!b && !b.disabled`), `${tag}: Edit text is checked on a page too`);
      check(await q.guest(`const t = doc.querySelector('.dc-seltoolbar'); const w = doc.querySelector('.dc-wall').getBoundingClientRect(); const r = t.getBoundingClientRect(); return r.top >= w.top - 1 && r.bottom <= w.bottom + 1`), `${tag}: on a page the toolbar stays inside the viewer`);
      await q.shot(`${tag}-9-page`);
      await q.close();
    }
  }
};
