// Visual scenario for the chat blocks (feat/chat-blocks, documentation/specs/phase-1-5-sdk-2-7.md §U7,
// §U8, §12.2): DesignCard (loading, canvas, page, no Chrome, preview not ready, not found, bad
// arguments, service down, Open and Comment, the rail not available) and DirectionPick (three
// options, a missing and a no-Chrome option, a pick, the answer replayed, a note, no options, an
// answer the host refuses, four options, the keyboard). Light and dark, at chat widths 360 and 640.
// `helpers` is what the other scenarios use: openPage, check, sleep.

const CARD = (slug) => ({ name: 'DesignCard', args: { slug } });
const PICK = (options, slugs, question = 'Which direction should the pricing page take?', answered = null) => ({ name: 'DirectionPick', args: { question, options, slugs }, answered });
const THREE = PICK('Warm and editorial|Clean product grid|Habit-style cards', 'coffee-subscription|northwind-pricing|habit-tracker');
const REFUSED = 'Couldn’t send your choice. Type it in the chat instead.';

export const run = async (helpers) => {
  for (const theme of ['dark', 'light']) {
    for (const width of [360, 640]) {
      await designCard(helpers, width, theme);
      await directionPick(helpers, width, theme);
    }
  }
  await slowPreview(helpers);
  await themeSwitch(helpers);
};

/** The frame's height follows the block: the last `resize` equals the root's height. */
const sized = async (p, check, tag) => {
  await p.settle(200);
  const root = await p.guest('return Math.ceil(doc.getElementById("root").getBoundingClientRect().height)');
  const frame = await p.host('parseInt(document.getElementById("g").style.height, 10)');
  check(root > 40 && frame === root, `${tag}: the frame is as tall as the block (${frame} px for ${root} px)`);
};

const fitsWidth = (p) => p.guest('return doc.documentElement.scrollWidth <= win.innerWidth');

const designCard = async ({ openPage, check }, width, theme) => {
  const base = `blocks-card-${width}-${theme}`;
  const open = (label, block, routes = null) => openPage({ width, height: 700, surface: 'block', theme, label: `${base}-${label}`, block, routes });
  const ready = (p) => p.waitFor('return !!doc.querySelector(".dcb-card[data-state=ready] .dcb-preview[data-state=ready], .dcb-card[data-state=ready] .dcb-preview[data-state=note]")', 'the card and its preview');
  console.log(base);

  // ---- loading: the design read is held
  let p = await open('loading', CARD('coffee-subscription'), { 'GET /designs/:slug': { delayMs: 60_000, body: {} } });
  await p.waitFor('return !!doc.querySelector(".dcb-card[data-state=loading]")', 'the loading card');
  await p.settle(250);
  await p.shot(`${base}-1-loading`);
  await p.close();

  // ---- a canvas with issues: preview, screens, the badge, Open and Comment
  p = await open('canvas', CARD('coffee-subscription'));
  await ready(p);
  const canvas = await p.guest(`return {
    title: doc.querySelector('.dcb-card-title')?.textContent,
    kind: doc.querySelector('.dcb-kind')?.textContent,
    line: doc.querySelector('.dcb-card-line')?.textContent,
    badge: doc.querySelector('.dcb-checks .oc-sdk-badge')?.textContent ?? doc.querySelector('.dcb-checks [aria-hidden]')?.textContent,
    said: doc.querySelector('.dcb-checks .dcb-sr')?.textContent,
    img: doc.querySelector('.dcb-preview img')?.getAttribute('src')?.slice(0, 22),
    buttons: [...doc.querySelectorAll('.dcb-actions button')].map((b) => b.textContent.trim()),
    primary: doc.querySelector('.dcb-actions button[data-emphasis=primary]')?.textContent.trim(),
  }`);
  check(canvas.title === 'Coffee subscription' && canvas.kind === 'Canvas', `${base}: title and kind`);
  check(canvas.line === 'Screens: Home, Pricing, Checkout', `${base}: the screens line (${canvas.line})`);
  check(/^\d+ issues?$|^No issues$|^Checking$/.test(canvas.badge ?? '') && (canvas.said ?? '').startsWith('Checks: '), `${base}: the viewer's badge with its words (${canvas.badge} / ${canvas.said})`);
  check(canvas.img === 'data:image/png;base64,', `${base}: the preview is a data: PNG`);
  check(JSON.stringify(canvas.buttons) === '["Open","Comment"]' && canvas.primary === 'Open', `${base}: Open (filled) and Comment`);
  check(!(await p.guest('return !!doc.querySelector("iframe")')), `${base}: no design HTML in the block`);
  check((await p.host('JSON.stringify(window.__host.surfacesOpened)')) === '[]', `${base}: nothing opens before a click`);
  check(await fitsWidth(p), `${base}: nothing wider than the chat column`);
  await sized(p, check, base);
  await p.shot(`${base}-2-canvas`);

  await p.click('.dcb-actions button', { text: 'Open' });
  await p.settle(150);
  check((await p.host('JSON.stringify(window.__host.surfacesOpened)')) === '["plugin:design-chamber"]', `${base}: Open opens the rail`);
  await p.click('.dcb-actions button', { text: 'Comment' });
  await p.settle(150);
  check((await p.host('window.__host.surfacesOpened.length')) === 2, `${base}: Comment opens the rail too`);
  // Where the rail cannot open (no project, or a host without it): a sentence, and the card stays.
  await p.host('window.__host.openSurfaceFails = "NO_DIRECTORY"');
  await p.click('.dcb-actions button', { text: 'Open' });
  await p.settle(200);
  check((await p.host('JSON.stringify(window.__host.toasts.map((t) => t.message))')).includes('Open Design Chamber from the rail to see it.'), `${base}: the rail not here says so`);
  check(await p.guest('return !!doc.querySelector(".dcb-card[data-state=ready]") && !doc.querySelector(".dcb-actions button[aria-busy=true]")'), `${base}: the card stays, buttons ready again`);
  await p.shot(`${base}-3-not-here`);
  await p.close();

  // ---- a page, with its viewports
  p = await open('page', CARD('northwind-pricing'));
  await ready(p);
  const line = await p.guest('return doc.querySelector(".dcb-card-line")?.textContent');
  check(line === 'Viewports: Laptop', `${base}: a page lists its viewports (${line})`);
  await p.shot(`${base}-4-page`);
  await p.close();

  // ---- no Chrome: the kind icon and a sentence
  p = await open('nochrome', CARD('invoice-template'));
  await ready(p);
  check((await p.guest('return doc.querySelector(".dcb-preview-text")?.textContent')) === 'No preview without Chrome', `${base}: no Chrome says so`);
  await p.shot(`${base}-5-no-chrome`);
  await p.close();

  // ---- the preview is still being made: a spinner in the preview, the rest of the card ready
  p = await open('pending', CARD('onboarding-flow'));
  await p.waitFor('return !!doc.querySelector(".dcb-card[data-state=ready] .dcb-preview[data-state=loading]")', 'the pending preview');
  await p.settle(200);
  await p.shot(`${base}-6-preview-pending`);
  await p.close();

  // ---- the design is gone
  p = await open('gone', CARD('pricing-z'));
  await p.waitFor('return !!doc.querySelector(".dcb-notice")', 'the gone notice');
  check((await p.guest('return doc.querySelector(".dcb-notice-text")?.textContent')) === 'This design is no longer in your Designs folder.', `${base}: a missing design says so`);
  check(!(await p.guest('return !!doc.querySelector("button")')), `${base}: no buttons on a missing design`);
  await sized(p, check, `${base}-gone`);
  await p.shot(`${base}-7-gone`);
  await p.close();

  // ---- arguments that do not name a design folder
  p = await open('badargs', CARD('../etc'));
  await p.waitFor('return !!doc.querySelector(".dcb-notice")', 'the bad-args notice');
  check((await p.guest('return doc.querySelector(".dcb-notice-text")?.textContent')) === 'This card doesn’t point to a design.', `${base}: bad arguments say so`);
  await p.shot(`${base}-8-bad-args`);
  await p.close();

  // ---- the service does not answer, then Try again works
  p = await open('down', CARD('coffee-subscription'), { 'GET /designs/:slug': { status: 500, body: { error: 'internal', message: 'The local service didn’t answer.' } } });
  await p.waitFor('return !!doc.querySelector(".dcb-notice button")', 'the service-down notice');
  check((await p.guest('return doc.querySelector(".dcb-notice-text")?.textContent')) === 'Design Chamber isn’t responding.', `${base}: the service down says so`);
  await p.shot(`${base}-9-service-down`);
  await p.route('GET /designs/:slug', null);
  await p.click('.dcb-notice button', { text: 'Try again' });
  await ready(p);
  check(true, `${base}: Try again loads the card`);
  await p.close();
};

const directionPick = async ({ openPage, check }, width, theme) => {
  const base = `blocks-pick-${width}-${theme}`;
  const open = (label, block) => openPage({ width, height: 700, surface: 'block', theme, label: `${base}-${label}`, block });
  const previews = (p, n) => p.waitFor(`return doc.querySelectorAll(".dcb-tile .dcb-preview:is([data-state=ready],[data-state=note],[data-state=missing])").length === ${n}`, 'the tile previews');
  const tiles = (p) => p.guest('return [...doc.querySelectorAll(".dcb-tile")].map((t) => ({ pressed: t.getAttribute("aria-pressed"), disabled: t.getAttribute("aria-disabled"), dimmed: t.hasAttribute("data-dimmed"), name: t.getAttribute("aria-label") }))');
  const caption = (p) => p.guest('return doc.querySelector(".dcb-caption")?.textContent');
  console.log(base);

  // ---- three options with previews, then a pick
  let p = await open('three', THREE);
  await previews(p, 3);
  check((await p.guest('return doc.querySelector(".dcb-tiles")?.getAttribute("role") === "group" && doc.querySelector(".dcb-tiles")?.getAttribute("aria-labelledby") === "dcb-question"')), `${base}: the tiles are a group named by the question`);
  check((await tiles(p)).map((t) => t.name).join(' / ') === 'A: Warm and editorial / B: Clean product grid / C: Habit-style cards', `${base}: tile names carry the letter`);
  check((await p.host('window.__host.blockAnswers.length')) === 0, `${base}: no answer before a click`);
  check(await fitsWidth(p), `${base}: nothing wider than the chat column`);
  await sized(p, check, base);
  await p.shot(`${base}-1-three`);
  await p.hover('.dcb-tile', { nth: 1 });
  await p.shot(`${base}-2-hover`);

  // Keyboard: arrows move along the group.
  await p.guest('doc.querySelectorAll(".dcb-tile")[0].focus()');
  await p.key('ArrowRight', { focus: '.dcb-tile[tabindex="0"]' });
  check((await p.guest('return [...doc.querySelectorAll(".dcb-tile")].indexOf(doc.activeElement)')) === 1, `${base}: ArrowRight moves to B`);
  await p.shot(`${base}-3-focus`);

  await p.host('window.__host.blockClick = true');
  await p.click('.dcb-tile', { nth: 1 });
  await p.waitFor('return doc.querySelector(".dcb-tile[aria-pressed=true]") !== null', 'the picked tile');
  check((await p.host('JSON.stringify(window.__host.blockAnswers)')) === '["B: Clean product grid (northwind-pricing)"]', `${base}: the click answers "B: <label> (<slug>)"`);
  check((await caption(p)) === 'You picked B.', `${base}: the caption says which`);
  const picked = await tiles(p);
  check(picked[1].pressed === 'true' && picked[0].dimmed && picked[2].dimmed && picked.every((t) => t.disabled === 'true'), `${base}: B marked, the others dimmed, all done`);
  await p.host('window.__host.blockClick = true');
  await p.click('.dcb-tile', { nth: 2 });
  await p.settle(150);
  check((await p.host('window.__host.blockAnswers.length')) === 1, `${base}: a second click does nothing`);
  await p.host('window.__host.blockClick = false');
  await p.shot(`${base}-4-picked`);
  await p.close();

  // ---- the answer replayed after a reload, and a note
  p = await open('replayed', PICK('Warm and editorial|Clean product grid|Habit-style cards', 'coffee-subscription|northwind-pricing|habit-tracker', undefined, 'C: Habit-style cards (renamed)'));
  await previews(p, 3);
  check((await tiles(p))[2].pressed === 'true' && (await caption(p)) === 'You picked C.', `${base}: a replayed answer marks its tile`);
  await p.close();
  p = await open('note', PICK('Warm and editorial|Clean product grid', 'coffee-subscription|northwind-pricing', undefined, 'Neither. Try the warm one with the grid layout.'));
  await previews(p, 2);
  check((await caption(p)) === 'You answered with a note.' && (await tiles(p)).every((t) => t.disabled === 'true' && t.pressed === 'false'), `${base}: a note answers, no tile marked`);
  await p.shot(`${base}-5-note`);
  await p.close();

  // ---- a missing design and one with no Chrome
  p = await open('missing', PICK('Warm and editorial|Sage invoice|Gone already', 'coffee-subscription|invoice-template|pricing-z'));
  await previews(p, 3);
  const notes = await p.guest('return [...doc.querySelectorAll(".dcb-tile .dcb-preview-text")].map((n) => n.textContent)');
  check(notes.includes('No preview without Chrome') && notes.includes('Not found'), `${base}: no Chrome and not found say so (${notes.join(', ')})`);
  check((await tiles(p))[2].name === 'C: Gone already. Not found in your Designs folder', `${base}: the missing tile says so to a screen reader`);
  await p.shot(`${base}-6-missing`);

  // The host refuses the answer (no click activation here): a toast, and the tiles open again.
  await p.click('.dcb-tile', { nth: 0 });
  await p.settle(250);
  check((await p.host('JSON.stringify(window.__host.toasts.map((t) => t.message))')).includes(REFUSED), `${base}: a refused answer says to type it`);
  check((await tiles(p)).every((t) => t.disabled === 'false' && t.pressed === 'false'), `${base}: the tiles open again after a refusal`);
  await p.close();

  // ---- four options
  p = await open('four', PICK('Warm|Grid|Cards|Plain', 'coffee-subscription|northwind-pricing|habit-tracker|launch-announcement', 'Pick a look for the launch page'));
  await previews(p, 4);
  check(await fitsWidth(p), `${base}: four tiles fit`);
  await sized(p, check, `${base}-four`);
  await p.shot(`${base}-7-four`);
  await p.close();

  // ---- not a question we can draw
  p = await open('invalid', PICK('Only one', 'coffee-subscription'));
  await p.waitFor('return !!doc.querySelector(".dcb-notice")', 'the invalid notice');
  check((await p.guest('return doc.querySelector(".dcb-notice-text")?.textContent')) === 'This question has no options to pick from.' && !(await p.guest('return !!doc.querySelector("button")')), `${base}: no options, no buttons`);
  await p.shot(`${base}-8-invalid`);
  await p.close();
};

/** A preview that never gets made: retried at 2, 5 and 10 s, then a sentence. Once, it takes 17 s. */
const slowPreview = async ({ openPage, check }) => {
  const tag = 'blocks-card-360-dark-not-ready';
  const p = await openPage({ width: 360, height: 700, surface: 'block', theme: 'dark', label: tag, block: CARD('onboarding-flow') });
  console.log(tag);
  await p.waitFor('return doc.querySelector(".dcb-preview-text")?.textContent === "Preview not ready yet"', 'the preview to give up', 25_000);
  check(true, `${tag}: a preview never made says it is not ready`);
  await p.shot(tag);
  await p.close();
};

/** The theme follows the host live while the block is on screen. */
const themeSwitch = async ({ openPage, check }) => {
  const tag = 'blocks-card-640-themeswitch';
  const p = await openPage({ width: 640, height: 700, surface: 'block', theme: 'dark', label: tag, block: CARD('coffee-subscription') });
  console.log(tag);
  await p.waitFor('return !!doc.querySelector(".dcb-card[data-state=ready]")', 'the card');
  const before = await p.guest('return getComputedStyle(doc.body).backgroundColor');
  await p.host('window.__host.setTheme("light")');
  await p.settle(200);
  const after = await p.guest('return getComputedStyle(doc.body).backgroundColor');
  check(before !== after && (await p.guest('return !!doc.querySelector(".dcb-card[data-state=ready] img")')), `${tag}: a theme switch repaints and keeps the card (${before} → ${after})`);
  await p.shot(tag);
  await p.close();
};
