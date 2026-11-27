// Visual scenario for the phone shell (documentation/specs/native-extras.md §2.2, U3) on a 390 x 844 phone, dark
// and light: the full-screen page on a phone is the rail app (list, a canvas, a page, Settings), with no footer
// hint and no first-run tip, at most two live frames, and no Reveal, Export or Copy path in its menus; the
// on-screen keyboard lifts the content and the sheets above it. The phone's panel tab keeps a hint and a tip in
// the phone's words. A desktop rail (no device) keeps every entry: the main rail and page walks in shoot.mjs
// shoot the desktop unchanged.

const CANVAS = 'coffee-subscription';
const PAGE = 'northwind-pricing';
const COMPUTER_ONLY = ['Reveal in folder', 'Export ZIP', 'Export single-file HTML', 'Export screen as HTML…', 'Copy path'];

const menuLabels = (p) => p.guest('return [...doc.querySelectorAll(".dc-popup [role=\\"menuitem\\"]")].map((n) => n.querySelector(".oc-sdk-option-label")?.textContent ?? "")');
const closeMenu = async (p) => {
  await p.key('Escape');
  await p.waitFor('return !doc.querySelector(".dc-popup")', 'the menu to close', 4000);
};
const back = async (p, listReady) => {
  await p.click('.dc-toolbar-compact .dc-iconbtn[aria-label="Back to designs"]');
  await listReady(p);
};

export const run = async ({ PHONE, openPage, check, listReady, thumbsReady, wallReady }) => {
  for (const theme of ['dark', 'light']) {
    // ---------------------------------------------------------------- the phone page (More → Design Chamber)
    {
      const tag = `phone-390-${theme}-page`;
      const p = await openPage({ ...PHONE, surface: 'page', theme, label: tag });
      console.log(tag);
      await listReady(p);
      await thumbsReady(p);
      await p.settle(500);
      check(await p.guest('return doc.querySelector(".dc-app")?.dataset.variant === "phone-page" && doc.documentElement.dataset.dcForm === "phone"'), `${tag}: the page on a phone mounts the rail layout`);
      check(await p.guest('return !doc.querySelector(".dc-card") && doc.querySelectorAll(".dc-row[data-slug]").length >= 5'), `${tag}: rows, not the 1400 px library cards`);
      check(await p.guest('const t = doc.querySelector(".dc-rail-tip"); return !t || t.hidden'), `${tag}: no first-run tip (it is already full screen)`);
      check(await p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth'), `${tag}: no horizontal overflow on the list`);
      check(await p.guest('const b = doc.querySelector(".dc-row-main").getBoundingClientRect(); return b.height >= 44'), `${tag}: a list row is at least 44 px tall`);
      check(await p.guest('const b = doc.querySelector(".dc-rail-head .dc-iconbtn").getBoundingClientRect(); return b.width >= 44 && b.height >= 44'), `${tag}: header icon buttons are 44 px`);
      check((await p.guest('return getComputedStyle(doc.querySelector(".dc-app")).paddingBottom')) === '34px', `${tag}: the page keeps clear of the home indicator (34 px)`);
      await p.shot(`${tag}-1-list`);

      // the row menu
      await p.click(`.dc-row[data-slug="${CANVAS}"] .dc-iconbtn`);
      await p.waitFor('return !!doc.querySelector(".dc-popup")', 'the row menu');
      const rowMenu = await menuLabels(p);
      check(!rowMenu.includes('Reveal in folder') && rowMenu.includes('Rename') && rowMenu.includes('Add to folder…'), `${tag}: the row menu has no Reveal (${rowMenu.join(', ')})`);
      await p.shot(`${tag}-2-row-menu`);
      await closeMenu(p);

      // a canvas
      await p.click(`.dc-row[data-slug="${CANVAS}"] .dc-row-main`);
      await wallReady(p, 1);
      await p.settle(1200);
      check(await p.guest('return !doc.querySelector(".dc-hint")'), `${tag}: no footer hint on the phone page`);
      const live = await p.guest('return [...doc.querySelectorAll(".dc-board")].filter((b) => b.dataset.state && b.dataset.state !== "idle").length');
      check(live <= 2, `${tag}: at most two live frames on a phone (${live})`);
      await p.shot(`${tag}-3-canvas`);
      await p.click('.dc-toolbar-compact .dc-iconbtn[aria-label="More actions"]');
      await p.waitFor('return !!doc.querySelector(".dc-popup")', 'the viewer menu');
      const canvasMenu = await menuLabels(p);
      check(COMPUTER_ONLY.every((label) => !canvasMenu.includes(label)) && canvasMenu.includes('Continue in chat') && canvasMenu.at(-1) === 'Delete…', `${tag}: the canvas menu hides Reveal, Export and Copy path (${canvasMenu.join(', ')})`);
      await p.shot(`${tag}-4-canvas-menu`);
      await closeMenu(p);

      // the on-screen keyboard lifts the view; a new `ready` reapplies it without a remount
      await p.host(`window.__host.setDevice(${JSON.stringify({ ...PHONE.device, keyboard: 300 })})`);
      await p.waitFor('return getComputedStyle(doc.querySelector(".dc-app")).paddingBottom === "334px"', 'the keyboard gap', 4000).catch(() => undefined);
      check((await p.guest('return getComputedStyle(doc.querySelector(".dc-app")).paddingBottom')) === '334px', `${tag}: the keyboard (300 px) and the inset lift the content`);
      check(await p.guest('return !!doc.querySelector(".dc-board")'), `${tag}: the canvas stays open through the keyboard`);
      const dock = await p.guest('const b = doc.querySelector(".dc-bottom-dock"); return b ? Math.round(b.getBoundingClientRect().bottom) : null');
      check(dock === null || dock <= 844 - 334, `${tag}: the ask bar dock ends above the keyboard (${dock})`);
      await p.shot(`${tag}-5-keyboard`);
      await p.host(`window.__host.setDevice(${JSON.stringify(PHONE.device)})`);
      await p.settle(300);
      await back(p, listReady);

      // a page
      await p.click(`.dc-row[data-slug="${PAGE}"] .dc-row-main`);
      await wallReady(p, 1);
      await p.settle(800);
      await p.shot(`${tag}-6-page`);
      await p.click('.dc-toolbar-compact .dc-iconbtn[aria-label="More actions"]');
      await p.waitFor('return !!doc.querySelector(".dc-popup")', 'the viewer menu');
      const pageMenu = await menuLabels(p);
      check(COMPUTER_ONLY.every((label) => !pageMenu.includes(label)) && pageMenu.includes('Copy HTML'), `${tag}: the page menu keeps Copy HTML, hides the rest (${pageMenu.join(', ')})`);
      await p.shot(`${tag}-7-page-menu`);
      await closeMenu(p);
      await back(p, listReady);

      // Settings
      await p.click('.dc-rail-head .dc-iconbtn[aria-label="Settings"]');
      await p.waitFor('return !!doc.querySelector(".dc-settings-where")', 'Settings with the computer line', 8000).catch(() => undefined);
      check((await p.guest('return doc.querySelector(".dc-settings-where")?.textContent ?? ""')) === 'This folder is on the computer that runs OpenChamber.', `${tag}: Settings says where the folder is`);
      check(await p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth'), `${tag}: no horizontal overflow in Settings`);
      await p.settle(300);
      await p.shot(`${tag}-8-settings`);
      await p.close();
    }

    // ---------------------------------------------------------------- the phone's panel tab (workspace drawer)
    {
      const tag = `phone-390-${theme}-panel`;
      const p = await openPage({ ...PHONE, surface: 'panel', theme, label: tag, query: '&tip=1' });
      console.log(tag);
      await listReady(p);
      await thumbsReady(p);
      await p.waitFor('const t = doc.querySelector(".dc-rail-tip"); return !!t && !t.hidden', 'the first-run tip', 6000).catch(() => undefined);
      check((await p.guest('return doc.querySelector(".dc-rail-tip")?.textContent ?? ""')).includes('In your chats list, open More and pick Design Chamber.'), `${tag}: the tip points at the More menu`);
      check((await p.guest('return getComputedStyle(doc.querySelector(".dc-app")).paddingBottom')) === '0px', `${tag}: the drawer tab adds no inset of its own`);
      await p.shot(`${tag}-1-list-tip`);
      await p.click(`.dc-row[data-slug="${CANVAS}"] .dc-row-main`);
      await wallReady(p, 1);
      await p.settle(800);
      check((await p.guest('return doc.querySelector(".dc-hint")?.textContent ?? ""')) === 'Full screen: chats list → More → Design Chamber', `${tag}: the footer hint says where the page is on a phone`);
      await p.shot(`${tag}-2-canvas`);
      await p.close();
    }

    // ---------------------------------------------------------------- a desktop rail keeps everything
    {
      const tag = `rail-320-${theme}-desktop-menus`;
      const p = await openPage({ width: 320, height: 780, surface: 'panel', theme, label: tag });
      console.log(tag);
      await listReady(p);
      await thumbsReady(p);
      await p.click(`.dc-row[data-slug="${CANVAS}"] .dc-row-main`);
      await wallReady(p, 1);
      await p.settle(600);
      check((await p.guest('return doc.querySelector(".dc-hint")?.textContent ?? ""')) === 'Full screen: sidebar → Extension pages → Design Chamber', `${tag}: the desktop hint is unchanged`);
      await p.click('.dc-toolbar-compact .dc-iconbtn[aria-label="More actions"]');
      await p.waitFor('return !!doc.querySelector(".dc-popup")', 'the viewer menu');
      const menu = await menuLabels(p);
      check(['Reveal in folder', 'Export ZIP', 'Copy path'].every((label) => menu.includes(label)), `${tag}: the desktop menu keeps Reveal, Export and Copy path`);
      check(await p.guest('const b = doc.querySelector(".dc-toolbar-compact .dc-iconbtn").getBoundingClientRect(); return b.width === 32'), `${tag}: desktop icon buttons stay 32 px`);
      await closeMenu(p);
      await p.close();
    }
  }
};
