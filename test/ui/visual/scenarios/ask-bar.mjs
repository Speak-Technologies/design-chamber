// Visual scenario for the docked ask bar and "Send this" (feat/ask-bar-send-pin): page 1400 and
// rail 320 and 480, dark and light. Per variant: the empty bar, an element chip, the character
// counter and the over-the-limit state, a failed send (text and chip kept), sending, sent, an old
// version on show (disabled), "Send this" on a thread card and the drawer row's send button.
// `helpers` is what the other scenarios use: openPage, check, listReady, thumbsReady, wallReady,
// menuItem, scaleLabel, sleep, outDir. DC_ASK_ONLY=<tag regex> limits the variants while iterating.

const VARIANTS = [
  ['page', 1400, 'dark'],
  ['page', 1400, 'light'],
  ['rail', 320, 'dark'],
  ['rail', 320, 'light'],
  ['rail', 480, 'dark'],
  ['rail', 480, 'light'],
];

const BAR = '.dc-ask';
const INPUT = '.dc-ask-input';

export const run = async (helpers) => {
  const { openPage, check, checkSoon, listReady, thumbsReady, wallReady, menuItem, sleep } = helpers;
  const only = process.env.DC_ASK_ONLY ? new RegExp(process.env.DC_ASK_ONLY) : null;

  for (const [kind, width, theme] of VARIANTS) {
    const tag = `${kind}-${width}-${theme}-ask`;
    if (only && !only.test(tag)) continue;
    console.log(tag);
    const rail = kind === 'rail';
    const p = await openPage({ width, height: rail ? 780 : 900, surface: rail ? 'panel' : 'page', theme, label: tag });

    // The coffee design is linked to this chat, so an ask goes straight to it.
    await p.send('Page.navigate', { url: `${await p.host('location.href')}&session=ses_coffee` });
    await sleep(700);
    await p.waitFor('return !!doc.querySelector(".dc-app")', 'the app to mount');
    await listReady(p);
    await thumbsReady(p);
    await p.click(rail ? '.dc-row[data-slug="coffee-subscription"] .dc-row-main' : '.dc-card[data-slug="coffee-subscription"] .dc-card-main');
    await wallReady(p, rail ? 2 : 6);
    await p.settle(700);

    const text = (selector) => p.guest(`return doc.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? null`);
    const visible = (selector) => p.guest(`const n = doc.querySelector(${JSON.stringify(selector)}); return !!n && !n.hidden && n.getClientRects().length > 0`);
    const setValue = (value) =>
      p.guest(`const a = doc.querySelector(${JSON.stringify(INPUT)}); a.value = ${JSON.stringify(value)}; a.dispatchEvent(new Event('input', { bubbles: true }));`);
    const prompts = async () => JSON.parse(await p.host('JSON.stringify(window.__host.prompts)'));

    // 1. empty bar
    check(await visible(BAR), `${tag}: the ask bar is docked under the design`);
    check(
      await p.guest(`const w = doc.querySelector('.dc-wall').getBoundingClientRect(); const b = doc.querySelector(${JSON.stringify(BAR)}).getBoundingClientRect(); return w.bottom <= b.top + 1`),
      `${tag}: the bar sits below the wall and does not cover it`,
    );
    check((await p.guest(`return doc.querySelector(${JSON.stringify(INPUT)}).placeholder`)) === 'Ask the agent to change something', `${tag}: placeholder for a linked chat`);
    check(await p.guest(`return doc.querySelector('.dc-ask .oc-sdk-btn').disabled`), `${tag}: Send is disabled while the box is empty`);
    check(await p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth'), `${tag}: no horizontal overflow`);
    await p.shot(`${tag}-1-empty`);

    // 2. pick an element: the composer opens and the bar shows the chip
    const home = await p.rect('.dc-board[data-board="home@laptop"]');
    if (!rail) {
      await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Fit' });
      await p.wheel(home.x + home.w / 2, home.y + home.h / 2, 0, -130, { ctrl: true });
      await p.settle(500);
    }
    const board = await p.rect('.dc-board[data-board="home@laptop"]');
    const pick = [board.x + board.w * 0.2, board.y + board.h * 0.22];
    await p.move(...pick);
    await p.settle(300);
    await p.clickAt(...pick);
    await p.waitFor('return !!doc.querySelector(".dc-composer")', 'the comment composer');
    await p.waitFor('return !!doc.querySelector(".dc-ask-chip:not([hidden])")', 'the ask bar chip');
    check(/^<\w+>$/.test((await text('.dc-ask-chip .dc-chip-code')) ?? ''), `${tag}: the chip names the element tag`);
    check(((await text('.dc-ask-chip-where')) ?? '').includes('Home'), `${tag}: the chip says where the element is`);
    await p.shot(`${tag}-2-chip`);

    // Cancelling the composer keeps the chip: the user may still ask about the element.
    await p.key('Escape', { focus: '.dc-composer textarea' });
    await p.waitFor('return !doc.querySelector(".dc-composer")', 'the composer to close');
    check(await visible('.dc-ask-chip'), `${tag}: cancelling the comment keeps the chip`);

    // 3. type; Shift+Enter adds a line; the bar grows
    await p.type(INPUT, 'Make this headline shorter and warmer');
    // A synthesized Shift+Enter would not type a newline in headless Chrome, so check the box leaves it alone.
    const prevented = await p.guest(`const a = doc.querySelector(${JSON.stringify(INPUT)}); a.focus(); const e = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }); a.dispatchEvent(e); return e.defaultPrevented;`);
    check(!prevented, `${tag}: Shift+Enter is left to the browser, which adds a line`);
    await p.send('Input.insertText', { text: '\nKeep the rest as it is.' });
    await p.settle(150);
    check((await p.guest(`return doc.querySelector(${JSON.stringify(INPUT)}).value`)).includes('\n'), `${tag}: a second line fits in the box`);
    check((await prompts()).length === 0, `${tag}: Shift+Enter sends nothing`);
    check(!(await p.guest(`return doc.querySelector('.dc-ask .oc-sdk-btn').disabled`)), `${tag}: Send is enabled with text`);
    await p.shot(`${tag}-3-typed`);

    // 4. counter, then over the limit
    await setValue('a'.repeat(10500));
    await checkSoon(async () => ((await text('.dc-ask-counter')) ?? '').includes('/'), `${tag}: the counter shows from 10 000 characters`);
    await p.shot(`${tag}-4-counter`);
    await setValue('a'.repeat(12100));
    await checkSoon(async () => ((await text('.dc-ask-target')) ?? '').includes('over the limit') && (await visible('.dc-ask-target')), `${tag}: over the limit says, in view, by how many`);
    await checkSoon(() => p.guest(`return doc.querySelector('.dc-ask .oc-sdk-btn').disabled`), `${tag}: Send is disabled over the limit`);
    await p.shot(`${tag}-4b-over`);
    await setValue('Make this headline shorter and warmer');

    // 5. a failed send keeps the text and the chip
    await p.host("window.__host.failNext = 'prompt'");
    await p.key('Enter', { focus: INPUT });
    await p.waitFor('const n = doc.querySelector(".dc-ask-msg"); return !!n && !n.hidden', 'the send error');
    check(((await text('.dc-ask-msg')) ?? '').includes('Your message is still here.'), `${tag}: the error says the message is still here`);
    check((await p.guest(`return doc.querySelector(${JSON.stringify(INPUT)}).value`)) === 'Make this headline shorter and warmer', `${tag}: the text is kept after a failure`);
    check(await visible('.dc-ask-chip'), `${tag}: the chip is kept after a failure`);
    check(await p.guest(`return doc.activeElement === doc.querySelector(${JSON.stringify(INPUT)})`), `${tag}: focus returns to the box after a failure`);
    await p.shot(`${tag}-5-error`);

    // 6. sending (held), then sent
    const before = (await prompts()).length;
    // The expression must not evaluate to the pending promise: host() would wait on it.
    await p.host('void (window.__host.promptGate = new Promise((resolve) => { window.__release = resolve; }))');
    await p.key('Enter', { focus: INPUT });
    await p.waitFor(`return doc.querySelector(${JSON.stringify(BAR)}).getAttribute('aria-busy') === 'true'`, 'the bar to show sending');
    check(await p.guest(`return doc.querySelector(${JSON.stringify(INPUT)}).readOnly`), `${tag}: the box is read only while sending`);
    await p.key('Enter', { focus: INPUT });
    await p.shot(`${tag}-6-sending`);
    await p.host('void (window.__release(), (window.__host.promptGate = null))');
    await p.waitFor('return (doc.querySelector(".dc-ask-status")?.textContent ?? "").includes("Sent")', 'the sent message');
    const sent = (await prompts()).slice(before);
    check(sent.length === 1, `${tag}: sending twice sends once (${sent.length} prompt)`);
    check(sent[0]?.send === true && String(sent[0]?.text).includes('Make this headline shorter and warmer'), `${tag}: the chat got the words`);
    check(/About this element: `/.test(String(sent[0]?.text)), `${tag}: the chat got the element`);
    check((await p.guest(`return doc.querySelector(${JSON.stringify(INPUT)}).value`)) === '', `${tag}: the box is empty after sending`);
    check(!(await visible('.dc-ask-chip')), `${tag}: the chip is gone after sending`);
    await p.shot(`${tag}-7-sent`);

    // A comment half written in the open card survives the ask going out, and removing the chip.
    await p.clickAt(...pick);
    await p.waitFor('return !!doc.querySelector(".dc-composer")', 'the composer for the draft');
    await p.type('.dc-composer textarea', 'Half written comment');
    await p.type(INPUT, 'One more thing to ask');
    const beforeDraft = (await prompts()).length;
    await p.key('Enter', { focus: INPUT });
    await p.waitFor('return (doc.querySelector(".dc-ask-status")?.textContent ?? "").includes("Sent")', 'the second ask to be sent');
    check((await prompts()).length === beforeDraft + 1, `${tag}: the ask went out`);
    check((await p.guest('return doc.querySelector(".dc-composer textarea")?.value ?? null')) === 'Half written comment', `${tag}: sending an ask keeps a half written comment`);
    check(!(await visible('.dc-ask-chip')), `${tag}: the chip went with the ask`);
    await p.key('Escape', { focus: '.dc-composer textarea' });
    await p.waitFor('return !doc.querySelector(".dc-composer")', 'the draft composer to close');
    await p.clickAt(...pick);
    await p.waitFor('return !!doc.querySelector(".dc-ask-chip:not([hidden])")', 'the chip for the remove test');
    await p.type('.dc-composer textarea', 'Another draft');
    await p.click('.dc-ask-chip .dc-iconbtn');
    check(!(await visible('.dc-ask-chip')), `${tag}: the chip is removed with its x`);
    check((await p.guest('return doc.querySelector(".dc-composer textarea")?.value ?? null')) === 'Another draft', `${tag}: removing the chip keeps a half written comment`);
    await p.key('Escape', { focus: '.dc-composer textarea' });
    await p.waitFor('return !doc.querySelector(".dc-composer")', 'the second draft composer to close');

    // Picking another element while an ask is on its way: that element's chip and card are left alone when the ask lands.
    await p.clickAt(...pick);
    await p.waitFor('return !!doc.querySelector(".dc-ask-chip:not([hidden])")', 'the chip for the in-flight test');
    const firstChip = await text('.dc-ask-chip-text');
    await p.type(INPUT, 'Ask while I pick something else');
    await p.host('void (window.__host.promptGate = new Promise((resolve) => { window.__release = resolve; }))');
    await p.key('Enter', { focus: INPUT });
    await p.waitFor(`return doc.querySelector(${JSON.stringify(BAR)}).getAttribute('aria-busy') === 'true'`, 'the in-flight ask');
    // The first pick's composer is still open; in a narrow rail it covers the middle of the board, so aim above it.
    const other = [board.x + board.w * 0.8, board.y + board.h * (board.w < 300 ? 0.08 : 0.4)];
    await p.clickAt(...other);
    await p.waitFor('return doc.querySelector(".dc-ask-chip-text")?.textContent !== ' + JSON.stringify(firstChip) + ' && !!doc.querySelector(".dc-composer")', 'the composer for the second element');
    await p.host('void (window.__release(), (window.__host.promptGate = null))');
    await p.waitFor('return (doc.querySelector(".dc-ask-status")?.textContent ?? "").includes("Sent")', 'the in-flight ask to land');
    check(await p.guest('return !!doc.querySelector(".dc-composer")'), `${tag}: an ask that lands does not close the card of an element picked meanwhile`);
    check((await visible('.dc-ask-chip')) && (await text('.dc-ask-chip-text')) !== firstChip, `${tag}: the chip of the element picked meanwhile stays`);
    await p.key('Escape', { focus: '.dc-composer textarea' });
    await p.waitFor('return !doc.querySelector(".dc-composer")', 'the in-flight composer to close');

    // Esc with a chip removes the chip; Esc without one hands the keyboard back to the wall.
    await p.clickAt(...pick);
    await p.waitFor('return !!doc.querySelector(".dc-ask-chip:not([hidden])")', 'the chip again');
    // A loaded browser sometimes drops the synthesized key, so a press that did nothing is repeated (retry); the assertions stay.
    check(await p.retry(() => p.key('Escape', { focus: INPUT }), async () => !(await visible('.dc-ask-chip')), 'Esc to remove the chip'), `${tag}: Esc in the box removes the chip`);
    await checkSoon(async () => !(await p.guest('return !!doc.querySelector(".dc-composer")')), `${tag}: removing the chip closes its composer`);
    check(await p.retry(() => p.key('Escape', { focus: INPUT }), () => p.guest(`return doc.activeElement !== doc.querySelector(${JSON.stringify(INPUT)})`), 'Esc to leave the box'), `${tag}: Esc without a chip leaves the box`);

    // 7. an old version on show: asking is off
    if (rail) await p.click('.dc-compact-actions .dc-versions-btn');
    else await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Versions' });
    await p.waitFor('return !!doc.querySelector(".dc-version")', 'the versions list');
    await p.click('.dc-version .oc-sdk-btn', { text: 'View', nth: 1 });
    await p.waitFor('return !!doc.querySelector(".dc-viewing")', 'the viewing banner');
    await checkSoon(() => p.guest(`return doc.querySelector(${JSON.stringify(INPUT)}).disabled`), `${tag}: the box is disabled while an old version is on show`);
    await checkSoon(async () => ((await text('.dc-ask-target')) ?? '') === 'Go back to the current design to ask the agent.' && (await visible('.dc-ask-target')), `${tag}: the bar says, in view, how to get back`);
    await p.shot(`${tag}-8-viewing`);
    await p.click('.dc-viewing .oc-sdk-btn', { text: 'Back to current' });
    await checkSoon(async () => !(await p.guest(`return doc.querySelector(${JSON.stringify(INPUT)}).disabled`)), `${tag}: the box is back on the current design`);
    if (rail) await p.key('Escape');
    else await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Versions' });
    await p.settle(300);

    // 8. Send this on a thread card
    const pin = '.dc-board[data-board="home@laptop"] .dc-pin:not(.dc-temp-pin)';
    await p.click(pin);
    await p.waitFor('return !!doc.querySelector(".dc-thread")', 'the thread card');
    check(await p.guest('return [...doc.querySelectorAll(".dc-thread .oc-sdk-btn")].some((b) => b.textContent.includes("Send this"))'), `${tag}: an open comment offers Send this`);
    await p.shot(`${tag}-9-send-this`);
    const beforePin = (await prompts()).length;
    await p.click('.dc-thread .oc-sdk-btn', { text: 'Send this' });
    await p.waitFor('return !doc.querySelector(".dc-thread")', 'the thread card to close');
    const pinPrompts = (await prompts()).slice(beforePin);
    check(pinPrompts.length === 1 && /Revise ".*": 1 comment\b/.test(String(pinPrompts[0]?.text)), `${tag}: Send this sends that one comment`);
    await checkSoon(() => p.guest('return doc.querySelectorAll(".dc-thread").length === 0'), `${tag}: the card closed after sending`);

    // 9. the drawer row's send button
    if (rail) await p.click('.dc-compact-actions .dc-comments-chip');
    else await p.click('.dc-toolbar .oc-sdk-btn', { text: 'Comments' });
    await p.waitFor('return !!doc.querySelector(".dc-comment")', 'the comments list');
    await checkSoon(async () => (await p.guest('return doc.querySelectorAll(".dc-comment .dc-iconbtn[aria-label^=\\"Send comment\\"]").length')) > 0, `${tag}: open comments have a send button in the list`);
    check(await p.guest('const f = doc.querySelector(".dc-comments-foot .oc-sdk-btn"); return f?.dataset.emphasis === "primary"'), `${tag}: the footer button is the one filled primary`);
    await p.shot(`${tag}-10-drawer-row`);
    if (!rail) {
      // A thread card opened from the list goes stale when its comment is sent from the list.
      await p.click('.dc-comment .dc-comment-main');
      await p.waitFor('return !!doc.querySelector(".dc-thread")', 'the thread card from the list');
      const sendThisShown = () => p.guest('const b = [...doc.querySelectorAll(".dc-thread .oc-sdk-btn")].find((n) => n.textContent.includes("Send this")); return !!b && !b.hidden');
      check(await sendThisShown(), `${tag}: the card from the list offers Send this`);
      const beforeStale = (await prompts()).length;
      await p.click('.dc-comment .dc-iconbtn[aria-label^="Send comment"]');
      await p.waitFor('const b = [...doc.querySelectorAll(".dc-thread .oc-sdk-btn")].find((n) => n.textContent.includes("Send this")); return !b || b.hidden', 'the card to stop offering Send this');
      check(!(await sendThisShown()), `${tag}: the open card stops offering Send this once its comment was sent`);
      check((await p.guest('return doc.querySelector(".dc-thread .oc-sdk-badge")?.textContent ?? ""')).includes('Sent'), `${tag}: the open card shows the comment as sent`);
      await p.settle(300);
      check((await prompts()).length === beforeStale + 1, `${tag}: the stale card did not send it twice`);
      await p.shot(`${tag}-10b-stale-card`);
      await p.key('Escape', { focus: '.dc-thread textarea' });
    }
    const beforeRow = (await prompts()).length;
    await p.click('.dc-comment .dc-iconbtn[aria-label^="Send comment"]');
    await p.waitFor(`return !doc.querySelector('.dc-comment .dc-iconbtn[aria-label^="Send comment"]') || true`, 'the row to update');
    await checkSoon(async () => (await prompts()).length >= beforeRow + 1, `${tag}: a row send went out`);
    await p.settle(300); // a second send, if that bug came back, lands within this window
    check((await prompts()).length === beforeRow + 1, `${tag}: a row send is one message`);
    await p.shot(`${tag}-11-drawer-after`);
    await p.close();
  }
};
