// Visual scenario for feat/findability: the first-run tip, the rail viewer's Comments chip and
// Versions button, restore with an Undo notice (and its failure), and the one filled primary in the
// New dialog and Settings. `helpers` is what the other scenarios use: openPage, check, listReady,
// thumbsReady, wallReady, menuItem, scaleLabel, sleep, outDir.

const FAKE = 'window.frames[0].__dcFake';

const tipAndHeader = async (h, width, theme) => {
  const tag = `find-rail-${width}-${theme}`;
  const p = await h.openPage({ width, height: 780, surface: 'panel', theme, label: tag, query: '&tip=1' });
  console.log(tag);
  await h.listReady(p);
  await h.thumbsReady(p);
  await p.settle(300);
  h.check(await p.guest('return !!doc.querySelector(".dc-rail-tip .oc-sdk-banner") && !doc.querySelector(".dc-rail-tip").hidden'), `${tag}: the first-run tip shows above the search`);
  h.check(await p.guest('const tip = doc.querySelector(".dc-rail-tip"); const search = doc.querySelector(".dc-rail-filters"); return !!(tip.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING)'), `${tag}: the tip sits between the header and the filters`);
  h.check(await p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth'), `${tag}: no horizontal overflow with the tip`);
  await p.shot(`${tag}-1-tip`);

  await p.click('.dc-rail-tip .oc-sdk-btn', { text: 'Got it' });
  await p.settle(200);
  h.check(await p.guest('return doc.querySelector(".dc-rail-tip").hidden && !doc.querySelector(".dc-rail-tip .oc-sdk-banner")'), `${tag}: "Got it" hides the tip`);
  h.check(await p.guest('return doc.activeElement?.closest(".dc-search") !== null'), `${tag}: focus moves to the search field`);
  await p.shot(`${tag}-2-tip-dismissed`);

  // Header: Comments chip with the open count, then without.
  await p.click('.dc-row[data-slug="coffee-subscription"] .dc-row-main');
  await h.wallReady(p, 2);
  await p.settle(500);
  const chip = await p.guest('const c = doc.querySelector(".dc-compact-actions .dc-comments-chip"); return c ? { aria: c.getAttribute("aria-label"), text: c.textContent.trim(), pressed: c.getAttribute("aria-pressed") } : null');
  h.check(chip?.aria === 'Comments, 3 open' && chip.text === '3', `${tag}: the chip counts open comments (${JSON.stringify(chip)})`);
  const titleWidth = await p.guest('return doc.querySelector(".dc-toolbar-compact .dc-title-text").getBoundingClientRect().width');
  h.check(titleWidth >= 120, `${tag}: the title keeps ${Math.round(titleWidth)} px (at least 120)`);
  h.check(await p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth'), `${tag}: no horizontal overflow in the viewer header`);
  await p.shot(`${tag}-3-header-chip-3`);

  await p.click('.dc-toolbar-compact .dc-iconbtn[aria-label="More actions"]');
  h.check(!(await p.guest('return [...doc.querySelectorAll(".dc-popup [role=menuitem]")].some((n) => /Versions|Comments/.test(n.textContent))')), `${tag}: the ⋯ menu no longer lists Comments or Versions`);
  await p.shot(`${tag}-4-menu`);
  await p.key('Escape');

  await p.click('.dc-compact-actions .dc-comments-chip');
  await p.waitFor('return !!doc.querySelector(".dc-comment")', 'comments');
  await p.settle(200);
  await p.shot(`${tag}-5-comments-sheet`);
  await p.key('Escape');
  h.check((await p.guest('return doc.querySelector(".dc-compact-actions .dc-comments-chip").getAttribute("aria-pressed")')) === 'false', `${tag}: the chip is not pressed once its sheet is closed`);

  await p.click('.dc-compact-actions .dc-versions-btn');
  await p.waitFor('return !!doc.querySelector(".dc-version")', 'versions');
  await p.settle(200);
  await p.shot(`${tag}-6-versions-sheet`);
  await p.key('Escape');

  await p.click('.dc-toolbar-compact .dc-iconbtn[aria-label="Back to designs"]');
  await p.click('.dc-row[data-slug="launch-announcement"] .dc-row-main');
  await h.wallReady(p, 1);
  await p.settle(500);
  const none = await p.guest('const c = doc.querySelector(".dc-compact-actions .dc-comments-chip"); return c ? { aria: c.getAttribute("aria-label"), text: c.textContent.trim() } : null');
  h.check(none?.aria === 'Comments' && none.text === '', `${tag}: the chip is icon only with no open comments (${JSON.stringify(none)})`);
  await p.shot(`${tag}-7-header-chip-0`);
  await p.close();
};

const restoreRail = async (h, width, theme) => {
  const tag = `find-restore-rail-${width}-${theme}`;
  const p = await h.openPage({ width, height: 780, surface: 'panel', theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await p.click('.dc-row[data-slug="coffee-subscription"] .dc-row-main');
  await h.wallReady(p, 2);
  await p.settle(400);
  await p.click('.dc-compact-actions .dc-versions-btn');
  await p.waitFor('return !!doc.querySelector(".dc-version")', 'versions');
  await p.settle(200);
  await p.click('.dc-version .oc-sdk-btn', { text: 'Restore' });
  await p.waitFor('return !!doc.querySelector(".dc-notices .dc-restore-notice")', 'the restore notice');
  await p.settle(300);
  h.check(!(await p.guest('return !!doc.querySelector(".dc-sheet[data-variant=dialog]")')), `${tag}: restoring asks nothing first`);
  h.check(await p.guest('const n = doc.querySelector(".dc-notices .dc-restore-notice"); return n.closest("[aria-live=polite]") !== null && /Restored v\\d+/.test(n.textContent) && /Undo/.test(n.textContent)'), `${tag}: the notice sits in the live region with the title and an Undo`);
  h.check(!(await p.guest('return !!doc.querySelector(".dc-sheet")')), `${tag}: the Versions sheet closed so the notice shows`);
  h.check(await p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth'), `${tag}: no horizontal overflow with the notice`);
  await p.shot(`${tag}-1-restored`);

  // Undo brings the earlier state back, with its own short notice.
  await p.click('.dc-restore-notice .oc-sdk-btn', { text: 'Undo' });
  await p.waitFor('return /Back to v\\d+/.test(doc.querySelector(".dc-notices .dc-restore-notice, .dc-notices .oc-sdk-banner")?.textContent ?? "")', 'the undone notice');
  await p.settle(200);
  h.check(await p.guest('return !doc.querySelector(".dc-notices")?.textContent.includes("Undo")'), `${tag}: no Undo of the Undo`);
  h.check(await p.guest('return doc.activeElement?.closest(".dc-wall") !== null'), `${tag}: focus goes back to the wall after Undo`);
  await p.shot(`${tag}-2-undone`);

  // A restore, then an Undo that fails: the error stays with Try again and the way to Versions.
  const failNext = (message) => p.host(`${FAKE}.failNextRestore(${JSON.stringify(message)})`);
  const focused = () => p.guest('const a = doc.activeElement; return a ? { text: (a.textContent || "").trim().slice(0, 24), tag: a.tagName, inNotice: !!a.closest(".dc-restore-notice"), inWall: !!a.closest(".dc-wall"), inSheet: !!a.closest(".dc-sheet"), restore: a.dataset.restore ?? null } : null');
  const restoreRow = async (nth) => {
    await p.click('.dc-compact-actions .dc-versions-btn');
    await p.waitFor('return !!doc.querySelector(".dc-version")', 'versions');
    await p.click('.dc-version .oc-sdk-btn', { text: 'Restore', nth });
    await p.waitFor('return /Undo/.test(doc.querySelector(".dc-notices")?.textContent ?? "")', 'the restore notice again');
  };
  await restoreRow(1);
  await failNext('The local service stopped answering.');
  await p.click('.dc-restore-notice .oc-sdk-btn', { text: 'Undo' });
  await p.waitFor('return /Couldn’t undo/.test(doc.querySelector(".dc-notices")?.textContent ?? "")', 'the undo error');
  await p.settle(200);
  h.check(await p.guest('const n = doc.querySelector(".dc-notices").textContent; return /Try again/.test(n) && /Dismiss/.test(n) && /Your earlier state is saved as v\\d+ in Versions/.test(n)'), `${tag}: a failed Undo says where the earlier state is and offers Try again`);
  const afterUndoFail = await focused();
  h.check(afterUndoFail?.inNotice && afterUndoFail.text === 'Try again', `${tag}: after a failed Undo focus is on Try again (${JSON.stringify(afterUndoFail)})`);
  await p.shot(`${tag}-3-undo-failed`);
  await failNext('Still not answering.');
  await p.click('.dc-restore-notice .oc-sdk-btn', { text: 'Try again' });
  await p.waitFor('return /Still not answering/.test(doc.querySelector(".dc-notices")?.textContent ?? "")', 'the second undo error');
  await p.settle(150);
  const afterRetryFail = await focused();
  h.check(afterRetryFail?.inNotice && afterRetryFail.text === 'Try again', `${tag}: after a failed Try again focus is on the new Try again (${JSON.stringify(afterRetryFail)})`);
  await p.click('.dc-restore-notice .oc-sdk-btn', { text: 'Dismiss' });
  await p.settle(150);
  const afterDismiss = await focused();
  h.check(!(await p.guest('return !!doc.querySelector(".dc-restore-notice")')) && afterDismiss?.inWall, `${tag}: Dismiss clears the notice and focus returns to the wall (${JSON.stringify(afterDismiss)})`);

  await restoreRow(1);
  await failNext('The local service stopped answering.');
  await p.click('.dc-restore-notice .oc-sdk-btn', { text: 'Undo' });
  await p.waitFor('return /Couldn’t undo/.test(doc.querySelector(".dc-notices")?.textContent ?? "")', 'the undo error');
  await p.click('.dc-restore-notice .oc-sdk-btn', { text: 'Try again' });
  await p.waitFor('return /Back to v\\d+/.test(doc.querySelector(".dc-notices")?.textContent ?? "")', 'the retry to go through');
  h.check(await p.guest('return !/Try again/.test(doc.querySelector(".dc-notices").textContent)'), `${tag}: Try again undoes it and clears the error`);

  // A failed restore leaves the Versions list as it was and says so in a host toast.
  await p.click('.dc-compact-actions .dc-versions-btn');
  await p.waitFor('return !!doc.querySelector(".dc-version")', 'versions');
  await p.host(`${FAKE}.failNextRestore('The local service stopped answering.')`);
  await p.click('.dc-version .oc-sdk-btn', { text: 'Restore' });
  await p.waitFor('return !!window.__host.toasts.length', 'the toast', 4000).catch(() => undefined);
  await p.settle(300);
  const toasts = await p.host('JSON.stringify(window.__host.toasts.map((t) => t.message))');
  h.check(/Couldn’t restore v\d+\. The local service stopped answering\. Nothing was changed\./.test(toasts), `${tag}: a failed restore toasts what happened`);
  h.check(await p.guest('return !!doc.querySelector(".dc-version")'), `${tag}: the Versions sheet stays open after a failed restore`);
  const afterRestoreFail = await focused();
  h.check(afterRestoreFail?.inSheet && afterRestoreFail.text === 'Restore' && afterRestoreFail.restore !== null, `${tag}: after a failed restore focus is back on that row's Restore button, inside the sheet (${JSON.stringify(afterRestoreFail)})`);
  await p.shot(`${tag}-4-restore-failed`);
  await p.close();
};

const restorePage = async (h, theme) => {
  const tag = `find-restore-page-1400-${theme}`;
  const p = await h.openPage({ width: 1400, height: 900, surface: 'page', theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await h.thumbsReady(p);
  await p.click('.dc-card[data-slug="coffee-subscription"] .dc-card-main');
  await h.wallReady(p, 6);
  await p.settle(500);
  await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Versions' });
  await p.waitFor('return !!doc.querySelector(".dc-version")', 'versions');
  await p.settle(200);
  // Viewing an old version, then restoring it from the bar: the bar goes and the notice offers Undo.
  await p.click('.dc-version .oc-sdk-btn', { text: 'View', nth: 1 });
  await p.waitFor('return !!doc.querySelector(".dc-viewing")', 'the viewing bar');
  await p.settle(400);
  await p.shot(`${tag}-1-viewing`);
  await p.click('.dc-viewing .oc-sdk-btn', { text: 'Restore' });
  await p.waitFor('return !!doc.querySelector(".dc-notices .dc-restore-notice")', 'the restore notice');
  await p.settle(400);
  h.check(await p.guest('return !doc.querySelector(".dc-viewing")'), `${tag}: restoring leaves version viewing`);
  h.check(await p.guest('return /Restored v\\d+/.test(doc.querySelector(".dc-restore-notice").textContent) && /Undo/.test(doc.querySelector(".dc-restore-notice").textContent)'), `${tag}: the notice says what was restored and offers Undo`);
  await p.shot(`${tag}-2-restored`);
  // A second restore starts while the first notice still offers Undo: that Undo is disabled at once, with a reason.
  const stale = await p.guest('const undo = [...doc.querySelectorAll(".dc-restore-notice .oc-sdk-btn")].find((b) => b.textContent.includes("Undo")); const row = [...doc.querySelectorAll(".dc-version .oc-sdk-btn")].filter((b) => b.textContent.includes("Restore"))[1]; row.click(); return { disabled: undo.disabled, title: undo.title, rowLoading: !!doc.querySelector(".dc-version .oc-sdk-btn[data-loading=true]") };');
  h.check(stale?.disabled === true && /Another restore/.test(stale.title) && stale.rowLoading === true, `${tag}: an older Undo is disabled with a reason while another restore runs (${JSON.stringify(stale)})`);
  await p.waitFor('return /Undo/.test(doc.querySelector(".dc-restore-notice")?.textContent ?? "") && ![...doc.querySelectorAll(".dc-restore-notice .oc-sdk-btn")].some((b) => b.disabled)', 'the second restore to finish');
  await p.close();
};

const primaries = async (h, width, theme) => {
  const tag = `find-primary-${width}-${theme}`;
  const p = await h.openPage({ width, height: 780, surface: 'panel', theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await p.click('.dc-rail-head .oc-sdk-btn', { text: 'New' });
  await h.menuItem(p, 'Canvas');
  await p.waitFor('return !!doc.querySelector(".dc-sheet[data-variant=dialog] textarea")', 'the New dialog');
  await p.type('.dc-sheet textarea', 'A pricing page for a coffee subscription, laptop and phone');
  await p.settle(300);
  const filled = (selector, text) => p.guest(`const b = [...doc.querySelectorAll(${JSON.stringify(selector)})].find((n) => n.textContent.includes(${JSON.stringify(text)})); if (!b) return null; const s = getComputedStyle(b); return { emphasis: b.dataset.emphasis ?? null, bg: s.backgroundColor, fg: s.color };`);
  const start = await filled('.dc-sheet .oc-sdk-btn', 'Start canvas');
  h.check(start?.emphasis === 'primary' && start.bg !== 'rgba(0, 0, 0, 0)' && start.bg !== start.fg, `${tag}: "Start canvas" is the filled primary (${start?.bg} on ${start?.fg})`);
  h.check((await p.guest('return doc.querySelectorAll(".dc-sheet [data-emphasis=primary]").length')) === 1, `${tag}: one filled primary in the New dialog`);
  await p.shot(`${tag}-1-new-dialog`);
  await p.key('Escape');

  await p.click('.dc-rail-head .dc-iconbtn[aria-label="Settings"]');
  await p.waitFor('return !!doc.querySelector(".dc-settings .dc-code")', 'settings');
  await p.settle(300);
  h.check((await p.guest('return doc.querySelectorAll(".dc-settings [data-emphasis=primary]").length')) === 1, `${tag}: one filled primary in Settings`);
  h.check((await p.guest('return doc.querySelector(".dc-settings [data-emphasis=primary]")?.disabled')) === true, `${tag}: "Apply folder" starts disabled while the folder is unchanged`);
  await p.shot(`${tag}-2-settings-disabled`);
  await p.type('.dc-settings input', 'D:\\Designs elsewhere');
  await p.settle(200);
  h.check((await p.guest('return doc.querySelector(".dc-settings [data-emphasis=primary]")?.disabled')) === false, `${tag}: "Apply folder" enables once the path changes`);
  await p.shot(`${tag}-3-settings-enabled`);
  await p.key('Escape');
  await p.close();
};

export const run = async (helpers) => {
  for (const [width, theme] of [[320, 'dark'], [480, 'light']]) await tipAndHeader(helpers, width, theme);
  for (const [width, theme] of [[320, 'dark'], [480, 'light']]) await restoreRail(helpers, width, theme);
  await restorePage(helpers, 'light');
  await restorePage(helpers, 'dark');
  for (const [width, theme] of [[320, 'dark'], [480, 'light'], [320, 'light'], [480, 'dark']]) await primaries(helpers, width, theme);
};
