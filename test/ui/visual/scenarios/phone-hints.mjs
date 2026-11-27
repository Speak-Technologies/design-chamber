// Visual scenario for KI-44 and its neighbours: on a 390 px phone nothing on screen names a key the
// phone doesn't have. The comment card and the text box show no shortcut line, the text box has a
// Cancel button and its click-away line names the buttons. A 480 px desktop rail is the control: it
// keeps every shortcut line and has no extra button. With the keyboard up the text box and its buttons stay on screen,
// on a 390 x 844 phone and a 375 x 667 one.

/** Keys a phone keyboard doesn't have, or shortcuts it can't type. */
const KEYS = '/Ctrl|⌘|Shift\\+|\\bEsc\\b|\\bSpace\\b|[Aa]rrow keys|Enter to|Press Enter/';

export const run = async ({ PHONE, openPage, check, checkSoon, listReady, thumbsReady, wallReady }) => {
  for (const theme of ['dark', 'light']) {
    for (const size of [
      { name: 'phone-390', ...PHONE, phone: true },
      { name: 'phone-375', width: 375, height: 667, device: { ...PHONE.device, insets: { top: 0, right: 0, bottom: 0, left: 0 } }, phone: true },
      { name: 'rail-480', width: 480, height: 780, phone: false },
    ]) {
      const tag = `${size.name}-${theme}-hints`;
      const p = await openPage({ ...size, surface: 'panel', theme, label: tag });
      console.log(tag);
      await listReady(p);
      await thumbsReady(p);
      await p.click('.dc-row[data-slug="coffee-subscription"] .dc-row-main');
      await wallReady(p, 2);
      await p.settle(900);

      const shown = (selector) => p.guest(`const n = doc.querySelector(${JSON.stringify(selector)}); return !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden'`);
      /** What is on screen, as read: the text a person sees, without screen-reader-only and hidden parts. */
      const onScreen = () => p.guest('return doc.body.innerText');
      const named = async () => p.guest(`return (doc.body.innerText.match(${KEYS}) ?? [null])[0]`);
      const spoken = () => p.guest(`return [doc.querySelector('.dc-wall')?.getAttribute('aria-label'), doc.querySelector('.dc-ask-sr')?.textContent].join(' | ')`);
      /** The last of a card's foot buttons ends at its right edge, hint or no hint. */
      const atRight = (card, foot) => p.guest(`const c = doc.querySelector('${card}'); const b = [...c.querySelectorAll('${foot} button')].at(-1).getBoundingClientRect(); const r = c.getBoundingClientRect(); return r.right - b.right < 24`);

      // Home is paused in a narrow wall until it is near the middle.
      const wall = await p.rect('.dc-wall');
      const home = await p.rect('.dc-board[data-board="home@laptop"]');
      await p.wheel(home.x + home.w / 2, home.y + home.h / 2, 0, home.y + home.h / 2 - (wall.y + wall.h / 2));
      await p.waitFor(`return doc.querySelector('.dc-board[data-board="home@laptop"]')?.dataset.state === 'ready'`, 'Home to load', 20000);
      await p.settle(500);
      // Zoom in so a line of text is big enough to pick.
      const near = await p.rect('.dc-board[data-board="home@laptop"] .dc-frame');
      await p.wheel(near.x + near.w * 0.3, near.y + near.h * 0.5, 0, -160, { ctrl: true });
      await p.settle(600);

      if (size.phone) check(!new RegExp(KEYS.slice(1, -1)).test(await spoken()), `${tag}: screen readers are not told about keys (${await spoken()})`);
      else check((await spoken()).includes('Arrow keys') && (await spoken()).includes('Shift+Enter'), `${tag}: desktop screen readers still hear the keys`);

      // Click points until the toolbar offers Edit text for the element under it.
      const editable = async () => {
        const board = await p.rect('.dc-board[data-board="home@laptop"] .dc-frame');
        const view = await p.rect('.dc-wall');
        for (const fy of [0.46, 0.5, 0.54, 0.42, 0.58, 0.62, 0.38, 0.66, 0.7, 0.3]) {
          for (const fx of [0.12, 0.3, 0.2, 0.45]) {
            const [x, y] = [board.x + board.w * fx, board.y + board.h * fy];
            if (x < view.x + 4 || x > view.x + view.w - 4 || y < view.y + 4 || y > view.y + view.h - 4) continue;
            await p.clickAt(x, y);
            await p.settle(500);
            if (await p.guest('const b = doc.querySelector(".dc-seltoolbar [data-action=edit]"); return !!b && !b.disabled && b.getAttribute("aria-disabled") === null && getComputedStyle(doc.querySelector(".dc-seltoolbar")).visibility !== "hidden"')) return true;
            if (await shown('.dc-composer')) {
              await p.key('Escape', { focus: '.dc-composer textarea' });
              await p.settle(150);
            }
          }
        }
        return false;
      };
      check(await editable(), `${tag}: picked an element whose text can be edited`);

      // The comment card.
      check(await shown('.dc-composer'), `${tag}: the comment card is open`);
      check((await shown('.dc-composer .dc-pop-hint')) !== size.phone, `${tag}: the card's shortcut line is ${size.phone ? 'hidden' : 'shown'}`);
      check(await atRight('.dc-composer', '.dc-pop-foot'), `${tag}: Add comment stays at the right of the card`);
      if (size.phone) check((await named()) === null, `${tag}: nothing on screen names a key (${await named()})`);
      else check(/Ctrl\+↵ to add|⌘↵ to add/.test(await onScreen()), `${tag}: desktop still says how to add`);
      await p.shot(`${tag}-1-comment-card`);

      // The text box.
      await p.click('.dc-seltoolbar [data-action=edit]');
      await p.waitFor('return !!doc.querySelector(".dc-editor textarea")', 'the text box');
      await p.settle(300);
      check((await shown('.dc-editor .dc-pop-hint')) !== size.phone, `${tag}: the text box's shortcut line is ${size.phone ? 'hidden' : 'shown'}`);
      check(await atRight('.dc-editor', '.dc-editor-foot'), `${tag}: Save stays at the right of the text box`);
      const buttons = await p.guest('return [...doc.querySelectorAll(".dc-editor-foot button")].map((b) => b.textContent.trim()).join("|")');
      check(buttons === (size.phone ? 'Cancel|Save' : 'Save'), `${tag}: the text box's buttons are ${buttons}`);

      const original = await p.guest('return doc.querySelector(".dc-editor textarea").value');
      await p.type('.dc-editor textarea', `${original} today`);
      const view = await p.rect('.dc-wall');
      await p.clickAt(view.x + view.w - 6, view.y + view.h - 6);
      await p.settle(400);
      const line = await p.guest('return doc.querySelector(".dc-editor-line")?.textContent ?? ""');
      check(line === (size.phone ? 'Tap Save to keep this change, or Cancel to discard it.' : 'Press Enter to save or Esc to discard.'), `${tag}: the click-away line (${line})`);
      if (size.phone) check((await named()) === null, `${tag}: still nothing names a key (${await named()})`);
      await p.shot(`${tag}-2-text-box`);

      if (size.phone) {
        // The keyboard comes up under the open box: the box is placed again and its text and buttons stay in sight.
        await p.host(`window.__host.setDevice(${JSON.stringify({ ...size.device, keyboard: 300 })})`);
        await p.settle(900);
        const kept = await p.guest(`const w = doc.querySelector('.dc-wall').getBoundingClientRect(); const e = doc.querySelector('.dc-editor'); if (!e) return 'closed';
          const out = [e.querySelector('textarea'), ...e.querySelectorAll('.dc-editor-foot button')].map((n) => n.getBoundingClientRect()).filter((r) => r.height < 28 || r.top < w.top - 1 || r.bottom > w.bottom + 1 || r.bottom > win.innerHeight - 300 + 1);
          return out.length === 0 ? 'ok' : 'cut ' + JSON.stringify([out.map((r) => [Math.round(r.top), Math.round(r.bottom)]), Math.round(w.top), Math.round(w.bottom)])`);
        check(kept === 'ok', `${tag}: keyboard 300, the text box and its buttons are on screen (${kept})`);
        await p.shot(`${tag}-3-text-box-keyboard`);
        await p.host(`window.__host.setDevice(${JSON.stringify(size.device)})`);
        await p.settle(600);

        // Cancel is the phone's way out of a changed line: the box closes and nothing is written.
        const writes = () => p.routeHits('POST /designs/:slug/edit');
        const before = await writes();
        await p.click('.dc-editor-foot button', { text: 'Cancel' });
        await checkSoon(() => p.guest('return !doc.querySelector(".dc-editor")'), `${tag}: Cancel closes the text box`);
        check((await writes()) === before, `${tag}: and writes nothing`);
      }
      await p.close();
    }
  }
};
