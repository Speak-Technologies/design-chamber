// Markdown notes on the system page (fix/system-markdown-render): the panel shows the overview and
// notes with their line breaks (pre-wrap, not one collapsed paragraph), the editor opens on the raw
// markdown with its breaks, and a save carries them through to the service. The fake board is a
// stub, so the board's own markdown is covered by the generator tests and by headless screenshots
// of real generated documents, not here.

const OVERVIEW = '# Tidepool design system\n\nThe system for **Tidepool**, a calm billing app.\n\n## The look\n\n- Brand teal `#2f6f6a` for the one action.\n- See [the docs](https://example.com/look).\n\n```\n--brand: #2f6f6a;\n```\n';
const NOTE = '## Contrast\n\nText keeps **4.5 to 1** on its background.\n\n- `--text` on `--surface`.\n- `--text-muted` for captions only.\n';
const VALUE = '.dc-sp-entry[data-entry="overview"] .dc-sp-value';
const INPUT = '.dc-sp-entry[data-entry="overview"] .dc-sp-input';

const patch = (p) =>
  p.host(
    `window.frames[0].__dcFake.systems.patchDetail('tidepool', ${JSON.stringify({
      overview: { text: OVERVIEW, problem: null },
      notes: [{ id: 'accessibility', title: 'Accessibility', text: NOTE, problem: null }],
    })})`,
  );

export const run = async (h) => {
  for (const theme of ['dark', 'light']) {
    const tag = `sysmarkdown-page-1400-${theme}`;
    const p = await h.openPage({ width: 1400, height: 900, surface: 'page', theme, label: tag });
    console.log(tag);
    await h.listReady(p);
    await p.click('.dc-library-bar .oc-sdk-btn', { text: 'Design systems' });
    await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the list is up`);
    // Patch before opening: the fake's change event carries no system id, so an open page would not refetch.
    await patch(p);
    await p.click('.dc-sys[data-id="tidepool"] .dc-sys-main');
    await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg[data-state=\\"ready\\"]")'), `${tag}: the system page loads`);
    await p.click('.dc-syspg-row[data-focus-key="row:overview"]');
    await p.settle(400);

    const whiteSpace = (selector) => p.guest(`const el = doc.querySelector(${JSON.stringify(selector)}); return el ? getComputedStyle(el).whiteSpace : null`);
    h.check((await whiteSpace(VALUE)) === 'pre-wrap', `${tag}: the overview value keeps line breaks on show`);
    h.check((await p.guest(`return doc.querySelector(${JSON.stringify(VALUE)}).textContent`)).includes('\n'), `${tag}: the shown overview is not one collapsed paragraph`);
    h.check((await whiteSpace('.dc-sp-entry[data-entry="note:accessibility"] .dc-sp-value')) === 'pre-wrap', `${tag}: a note value keeps line breaks on show`);
    h.check(await p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth'), `${tag}: nothing scrolls sideways`);
    await p.shot(`${tag}-1-overview`);

    // The editor opens on the raw markdown, breaks and all; an appended line saves with its break.
    await p.click(VALUE);
    await p.waitFor(`return !!doc.querySelector(${JSON.stringify(INPUT)})`, `${tag}: the editor`);
    h.check((await p.guest(`return doc.querySelector(${JSON.stringify(INPUT)}).value`)) === OVERVIEW, `${tag}: the editor opens on the raw markdown`);
    await p.guest(`const el = doc.querySelector(${JSON.stringify(INPUT)}); el.focus(); el.setSelectionRange(el.value.length, el.value.length);`);
    await p.send('Input.insertText', { text: '\nAn extra line.' });
    await p.key('Enter', { ctrl: true, focus: INPUT });
    await p.waitFor('return !!doc.querySelector(".dc-syspg-editbar")', `${tag}: the unsaved bar`);
    await p.shot(`${tag}-2-pending`);
    await p.click('.dc-syspg-editbar .oc-sdk-btn', { text: 'Save' });
    await h.checkSoon(() => p.host('JSON.stringify(window.frames[0].__dcFake.systems.pageLog()).includes("\\\\nAn extra line.")'), `${tag}: the save carried the line break`);
    await p.settle(400);
    h.check((await p.guest(`return doc.querySelector(${JSON.stringify(VALUE)}).textContent`)).includes('An extra line.'), `${tag}: the saved overview shows the new line`);
    h.check((await whiteSpace(VALUE)) === 'pre-wrap', `${tag}: still pre-wrap after the save`);
    await p.shot(`${tag}-3-saved`);
    await p.close();
  }
};