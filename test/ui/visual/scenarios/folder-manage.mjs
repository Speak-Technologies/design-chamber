// Visual scenario for Phase 2.6 F2 (folder management): the delete confirm's three count variants
// and its Undo, Move as one action with one Undo, the already-in row with its reason, a refusal
// that changes nothing, the sidebar row menu's New folder… and the New folder dialog. Rail 320/480
// and the page, dark and light. The rail Show select's New folder… option and the rail folder
// actions menu's New folder… entry are L1a's wiring (list-view.ts); the row menu's Move/Remove
// entries already work here because the rail consumes listDesignMenu.

const FAKE = 'window.frames[0].__dcFake';

const toastTexts = (p) => p.host('JSON.stringify(window.__host.toasts.map((t) => t.message))');
const noOverflow = (p) => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');

/** Q4 launch holds coffee and northwind; Archive also holds northwind; Scratch is empty. */
const seedWorld = async (p) => {
  const q4 = await p.host(`${FAKE}.folders.seed('Q4 launch', ['coffee-subscription', 'northwind-pricing'])`);
  const archive = await p.host(`${FAKE}.folders.seed('Archive', ['northwind-pricing'])`);
  const scratch = await p.host(`${FAKE}.folders.seed('Scratch', [])`);
  await p.host(`${FAKE}.folders.changed()`);
  await p.settle(400);
  return { q4, archive, scratch };
};

const rowMenu = async (p, slug, surface) => {
  if (surface === 'page') {
    await p.hover(`.dc-card[data-slug="${slug}"]`);
    await p.click(`.dc-card[data-slug="${slug}"] .dc-card-more`);
  } else {
    await p.hover(`.dc-row[data-slug="${slug}"]`);
    await p.click(`.dc-row[data-slug="${slug}"] .dc-iconbtn`);
  }
};

const folderMenu = async (p, scope) => {
  await p.click(`.dc-side-row[data-scope="${scope}"] .dc-iconbtn`);
  await p.waitFor('return !!doc.querySelector(".dc-popup")', 'the folder menu');
};

// ---------------------------------------------------------------- the page

const pageManage = async (h, theme) => {
  const tag = `folder-manage-page-1400-${theme}`;
  const p = await h.openPage({ width: 1400, height: 900, surface: 'page', theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await h.thumbsReady(p);
  const ids = await seedWorld(p);

  // Delete confirm, variant 1: empty.
  await folderMenu(p, `folder:${ids.scratch}`);
  h.check(await p.guest('const m = [...doc.querySelectorAll(".dc-popup [role=menuitem]")].map((n) => n.textContent.trim()); return JSON.stringify(m) === JSON.stringify(["Rename","New folder…","Delete folder"])'), `${tag}: the row menu is Rename, New folder…, Delete folder`);
  await p.shot(`${tag}-1-folder-menu`);
  await p.click('.dc-popup [role="menuitem"]', { text: 'Delete folder' });
  await p.waitFor('return !!doc.querySelector(".dc-sheet[data-variant=dialog]")', 'the delete confirm');
  h.check(await p.guest('const s = doc.querySelector(".dc-sheet"); return /Delete Scratch\\?/.test(s.querySelector(".dc-sheet-title").textContent) && /Scratch is empty\\. Deleting it changes nothing\\./.test(s.textContent) && !/never deletes designs/.test(s.textContent)'), `${tag}: an empty folder's confirm says deleting changes nothing`);
  await p.shot(`${tag}-2-delete-empty`);
  await p.click('.dc-sheet .oc-sdk-btn', { text: 'Cancel' });
  await p.settle(150);
  h.check(await p.guest(`return !!doc.querySelector('.dc-side-row[data-scope="folder:${ids.scratch}"]')`), `${tag}: Cancel keeps the folder`);

  // Variant 2: every design keeps another folder.
  await folderMenu(p, `folder:${ids.archive}`);
  await p.click('.dc-popup [role="menuitem"]', { text: 'Delete folder' });
  await p.waitFor('return !!doc.querySelector(".dc-sheet[data-variant=dialog]")', 'the delete confirm');
  h.check(await p.guest('const s = doc.querySelector(".dc-sheet"); return /Its 1 design keeps its other folders\\./.test(s.textContent) && /Deleting a folder never deletes designs\\./.test(s.textContent)'), `${tag}: the confirm says the designs keep their other folders, with the promise`);
  await p.shot(`${tag}-3-delete-keeps`);
  await p.click('.dc-sheet .oc-sdk-btn', { text: 'Cancel' });
  await p.settle(150);

  // Variant 3: some designs lose their last folder; the counts are emphasized.
  await folderMenu(p, `folder:${ids.q4}`);
  await p.click('.dc-popup [role="menuitem"]', { text: 'Delete folder' });
  await p.waitFor('return !!doc.querySelector(".dc-sheet[data-variant=dialog]")', 'the delete confirm');
  h.check(await p.guest('const s = doc.querySelector(".dc-sheet"); return /2 designs are in Q4 launch\\. 1 of them is in no other folder; it stays in All designs\\./.test(s.textContent) && s.querySelectorAll("strong").length === 2 && /Deleting a folder never deletes designs\\./.test(s.textContent)'), `${tag}: the confirm names the onlyHere count and stays truthful about All designs`);
  h.check(await p.guest('const b = [...doc.querySelectorAll(".dc-sheet-foot .oc-sdk-btn")].find((n) => n.textContent.includes("Delete folder")); return b?.dataset.variant === "destructive"'), `${tag}: Delete folder is the destructive button, apart from Cancel`);
  await p.shot(`${tag}-4-delete-confirm`);
  await p.click('.dc-sheet .oc-sdk-btn', { text: 'Delete folder' });
  await p.waitFor('return !!doc.querySelector(".dc-undo-notice .oc-sdk-banner")', 'the Undo notice');
  await p.settle(250);
  h.check(await p.guest('const n = doc.querySelector(".dc-undo-notice"); return /Deleted Q4 launch\\./.test(n.textContent) && /Its 2 designs are still in All designs\\./.test(n.textContent) && /Undo/.test(n.textContent)'), `${tag}: the notice uses the answer's numbers and offers Undo`);
  h.check((await p.guest('return doc.querySelectorAll(".dc-card[data-slug]").length')) === 6, `${tag}: every design is still listed`);
  await p.shot(`${tag}-5-delete-undo`);
  await p.click('.dc-undo-notice .oc-sdk-btn', { text: 'Undo' });
  await h.checkSoon(() => p.guest(`return !!doc.querySelector('.dc-side-row[data-scope="folder:${ids.q4}"]')`), `${tag}: Undo brings the folder back`);
  await p.settle(300);

  // Move: one pick, one atomic batch, one Undo.
  await p.click(`.dc-side-row[data-scope="folder:${ids.q4}"] .dc-side-main`);
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-card[data-slug]").length === 2'), `${tag}: the folder view lists its two designs`);
  await rowMenu(p, 'northwind-pricing', 'page');
  h.check(await p.guest('return [...doc.querySelectorAll(".dc-popup [role=menuitem]")].some((n) => n.textContent === "Move to folder…")'), `${tag}: the folder view's menu offers Move to folder…`);
  await p.click('.dc-popup [role="menuitem"]', { text: 'Move to folder' });
  await p.waitFor('return !!doc.querySelector(".dc-sheet[data-variant=dialog] .dc-pick")', 'the Move dialog');
  await p.settle(350);
  h.check(await p.guest('const s = doc.querySelector(".dc-sheet"); return /Move Northwind pricing page out of Q4 launch/.test(s.querySelector(".dc-sheet-title").textContent) && /Into which folder\\?/.test(s.querySelector(".dc-sheet-sub").textContent)'), `${tag}: the dialog names the design and where it leaves`);
  h.check(await p.guest('return [...doc.querySelectorAll(".dc-pick-btn")].every((n) => !n.textContent.includes("Q4 launch"))'), `${tag}: the source folder is not a target`);
  h.check(await p.guest('const b = [...doc.querySelectorAll(".dc-pick-btn")].find((n) => n.textContent.includes("Archive")); return b?.getAttribute("aria-disabled") === "true" && /Northwind pricing page is already in Archive\\./.test(b.textContent)'), `${tag}: a folder that already holds it is disabled with its reason`);
  h.check(await p.guest('const b = [...doc.querySelectorAll(".dc-pick-btn")].find((n) => n.textContent.includes("ember-oak")); return b?.getAttribute("aria-disabled") === "true"'), `${tag}: the derived project is locked in Move too`);
  await p.shot(`${tag}-6-move-dialog`);
  await p.click('.dc-pick-btn', { text: 'Scratch' });
  await p.waitFor('return !!doc.querySelector(".dc-undo-notice .oc-sdk-banner")', 'the move Undo notice');
  await p.settle(250);
  h.check(await p.guest('return !doc.querySelector(".dc-sheet[data-variant=dialog]") && /Moved Northwind pricing page to Scratch\\./.test(doc.querySelector(".dc-undo-notice").textContent)'), `${tag}: one pick moves it and closes the dialog`);
  h.check(!(await p.host(`${FAKE}.folders.members(${JSON.stringify(ids.q4)})`)).includes('northwind-pricing') && (await p.host(`${FAKE}.folders.members(${JSON.stringify(ids.scratch)})`)).includes('northwind-pricing'), `${tag}: the batch untagged the source and tagged the target`);
  await p.shot(`${tag}-7-move-undo`);
  await p.click('.dc-undo-notice .oc-sdk-btn', { text: 'Undo' });
  await h.checkSoon(async () => (await p.host(`${FAKE}.folders.members(${JSON.stringify(ids.q4)})`)).includes('northwind-pricing') && !(await p.host(`${FAKE}.folders.members(${JSON.stringify(ids.scratch)})`)).includes('northwind-pricing'), `${tag}: Undo applies the inverse batch`);
  await p.settle(300);

  // A refusal: the sentence shows in the dialog and nothing changes.
  await p.host(`${FAKE}.folders.failNextMemberships('That folder is full.')`);
  await rowMenu(p, 'coffee-subscription', 'page');
  await p.click('.dc-popup [role="menuitem"]', { text: 'Move to folder' });
  await p.waitFor('return !!doc.querySelector(".dc-sheet[data-variant=dialog] .dc-pick")', 'the Move dialog');
  await p.settle(300);
  await p.click('.dc-pick-btn', { text: 'Scratch' });
  await h.checkSoon(() => p.guest('return /That folder is full\\./.test(doc.querySelector(".dc-sheet-body > .dc-form-error")?.textContent ?? "")'), `${tag}: the refusal's sentence shows in the dialog`);
  h.check((await p.host(`${FAKE}.folders.members(${JSON.stringify(ids.q4)})`)).includes('coffee-subscription') && !(await p.host(`${FAKE}.folders.members(${JSON.stringify(ids.scratch)})`)).includes('coffee-subscription'), `${tag}: a refused move changes nothing`);
  await p.shot(`${tag}-8-move-refused`);
  await p.click('.dc-sheet .oc-sdk-btn', { text: 'Cancel' });
  await p.settle(150);

  // New folder from the row menu: the dialog, validation, Create folder.
  await folderMenu(p, `folder:${ids.q4}`);
  await p.click('.dc-popup [role="menuitem"]', { text: 'New folder' });
  await p.waitFor('return !!doc.querySelector(".dc-sheet[data-variant=dialog] input")', 'the New folder dialog');
  h.check(await p.guest('return /New folder/.test(doc.querySelector(".dc-sheet-title").textContent)'), `${tag}: the dialog is New folder`);
  await p.type('.dc-sheet input', '   ');
  await p.click('.dc-sheet .oc-sdk-btn', { text: 'Create folder' });
  await h.checkSoon(() => p.guest('return /Give the folder a name\\./.test(doc.querySelector(".dc-sheet")?.textContent ?? "")'), `${tag}: a blank name is refused inline`);
  await p.shot(`${tag}-9-new-folder-dialog`);
  await p.type('.dc-sheet input', 'Handoff');
  await p.key('Enter', { focus: '.dc-sheet input' });
  await h.checkSoon(async () => /Made folder Handoff/.test(await toastTexts(p)), `${tag}: Enter creates the folder`);
  await h.checkSoon(() => p.guest('return [...doc.querySelectorAll(".dc-side-label")].some((n) => n.textContent === "Handoff") && !doc.querySelector(".dc-sheet[data-variant=dialog]")'), `${tag}: the row appears and the dialog closes`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow at the end`);
  await p.close();
};

// ---------------------------------------------------------------- the rail

const railManage = async (h, width, theme) => {
  const tag = `folder-manage-rail-${width}-${theme}`;
  const p = await h.openPage({ width, height: 780, surface: 'panel', theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await h.thumbsReady(p);
  const ids = await seedWorld(p);

  await p.click('.dc-rail-show-select button');
  await p.click('.oc-sdk-popup .oc-sdk-option', { text: 'Folder · Q4 launch' });
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-row[data-slug]").length === 2'), `${tag}: the folder view lists its designs`);
  await rowMenu(p, 'northwind-pricing', 'rail');
  h.check(await p.guest('const m = [...doc.querySelectorAll(".dc-popup [role=menuitem]")].map((n) => n.textContent.trim()); return m.includes("Move to folder…") && m.includes("Remove from Q4 launch")'), `${tag}: the rail row menu offers Move and Remove`);
  await p.shot(`${tag}-1-row-menu`);
  await p.click('.dc-popup [role="menuitem"]', { text: 'Move to folder' });
  await p.waitFor('return !!doc.querySelector(".dc-sheet[data-variant=dialog] .dc-pick")', 'the Move dialog');
  await p.settle(350);
  h.check(await noOverflow(p), `${tag}: the Move dialog fits at ${width} px`);
  await p.shot(`${tag}-2-move-dialog`);
  await p.click('.dc-pick-btn', { text: 'Scratch' });
  await p.waitFor('return !!doc.querySelector(".dc-undo-notice .oc-sdk-banner")', 'the move notice');
  h.check(await p.guest('return /Moved Northwind pricing page to Scratch\\./.test(doc.querySelector(".dc-undo-notice").textContent)'), `${tag}: the rail shows the same move notice`);
  await p.shot(`${tag}-3-move-undo`);
  await p.click('.dc-undo-notice .oc-sdk-btn', { text: 'Undo' });
  await h.checkSoon(async () => (await p.host(`${FAKE}.folders.members(${JSON.stringify(ids.q4)})`)).includes('northwind-pricing'), `${tag}: Undo works from the rail`);
  await p.settle(300);

  // Delete from the rail's Folder actions: the same confirm, the same notice.
  await p.click('.dc-rail-show .dc-iconbtn');
  await p.click('.dc-popup [role="menuitem"]', { text: 'Delete folder' });
  await p.waitFor('return !!doc.querySelector(".dc-sheet[data-variant=dialog]")', 'the delete confirm');
  h.check(await p.guest('return /2 designs are in Q4 launch\\. 1 of them is in no other folder/.test(doc.querySelector(".dc-sheet").textContent)'), `${tag}: the rail confirm names the same counts`);
  await p.shot(`${tag}-4-delete-confirm`);
  await p.click('.dc-sheet .oc-sdk-btn', { text: 'Delete folder' });
  await p.waitFor('return !!doc.querySelector(".dc-undo-notice .oc-sdk-banner")', 'the Undo notice');
  h.check(await p.guest('return /Deleted Q4 launch\\./.test(doc.querySelector(".dc-undo-notice").textContent) && /Its 2 designs are still in All designs\\./.test(doc.querySelector(".dc-undo-notice").textContent)'), `${tag}: the notice reports the answer's numbers`);
  await p.shot(`${tag}-5-delete-undo`);
  await p.click('.dc-undo-notice .oc-sdk-btn', { text: 'Undo' });
  await h.checkSoon(() => p.guest('return !doc.querySelector(".dc-undo-notice .oc-sdk-banner")'), `${tag}: Undo clears the notice`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow at the end`);
  await p.close();
};

export const run = async (helpers) => {
  await pageManage(helpers, 'dark');
  await pageManage(helpers, 'light');
  await railManage(helpers, 320, 'dark');
  await railManage(helpers, 480, 'light');
};
