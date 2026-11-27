// Visual scenario for the rail's This chat group (documentation/specs/native-extras.md §4.2, U6): a click on a
// chat's sidebar mark opens the rail in that chat, so the designs linked to it lead the list. One design, several
// (three rows and Show all, which narrows the list to the chat behind a "This chat" chip), a chat with no designs,
// no chat at all, and a search, which hides the group. Rail 320 and 480 and a 390 px phone, dark and light.

const CONFIGS = [
  { width: 320, theme: 'dark' },
  { width: 480, theme: 'light' },
  { width: 320, theme: 'light' },
  { width: 480, theme: 'dark' },
  { width: 390, theme: 'dark', phone: true },
  { width: 390, theme: 'light', phone: true },
];

const SESSION = 'ses_coffee';

const groupSlugs = (p) => p.guest('const box = doc.querySelector(".dc-this-chat"); return !box || box.hidden ? null : [...box.querySelectorAll(".dc-row[data-slug]")].map((n) => n.dataset.slug)');
const listSlugs = (p) => p.guest('return [...doc.querySelectorAll("ul.dc-rows[aria-label=\\"Designs\\"] .dc-row[data-slug]")].map((n) => n.dataset.slug)');

export const run = async ({ PHONE, openPage, check, checkSoon, listReady, thumbsReady, wallReady }) => {
  for (const { width, theme, phone } of CONFIGS) {
    const tag = phone ? `phone-390-${theme}-this-chat` : `rail-${width}-${theme}-this-chat`;
    const size = phone ? PHONE : { width, height: 780 };
    const p = await openPage({ ...size, surface: 'panel', theme, label: tag, query: `&session=${SESSION}` });
    console.log(tag);
    await listReady(p);
    await thumbsReady(p);
    await p.settle(400);

    // one linked design
    check(JSON.stringify(await groupSlugs(p)) === '["coffee-subscription"]', `${tag}: one linked design leads the list (${JSON.stringify(await groupSlugs(p))})`);
    check(await p.guest('return doc.querySelector(".dc-this-chat h2")?.textContent === "This chat" && !doc.querySelector(".dc-this-chat-more button")'), `${tag}: headed "This chat", no Show all`);
    check(await p.guest('const h = doc.querySelector(".dc-rail-rest-h"); return !!h && !h.hidden && h.textContent === "All designs"'), `${tag}: the rest of the list is headed "All designs"`);
    check((await listSlugs(p)).includes('coffee-subscription'), `${tag}: the design stays in the full list too`);
    check(await p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth'), `${tag}: no horizontal overflow`);
    await p.shot(`${tag}-1-one`);

    // several: three rows, newest first, then Show all
    for (const slug of ['northwind-pricing', 'invoice-template', 'habit-tracker', 'launch-announcement']) await p.guest(`win.__dcFake.linkDesign(${JSON.stringify(slug)}, ${JSON.stringify(SESSION)}); return true`);
    await checkSoon(async () => (await groupSlugs(p))?.length === 3, `${tag}: five linked designs show three rows`);
    check(await p.guest('const b = doc.querySelector(".dc-this-chat-more button"); return !!b && b.textContent.trim() === "Show all 5" && b.getAttribute("aria-label") === "Show all 5 designs from this chat"'), `${tag}: Show all 5, named for a screen reader`);
    await p.settle(500);
    await p.shot(`${tag}-2-several`);

    // a group row opens the design, and Back focuses that row
    const first = (await groupSlugs(p))[0];
    await p.click(`.dc-this-chat .dc-row[data-slug="${first}"] .dc-row-main`);
    await wallReady(p, 1);
    await p.click('.dc-toolbar-compact .dc-iconbtn[aria-label="Back to designs"]');
    await listReady(p);
    check(await p.guest(`return !!doc.activeElement?.closest(".dc-this-chat .dc-row[data-slug='${first}']")`), `${tag}: Back returns focus to the This chat row`);

    // Show all narrows the list to the chat, behind a chip
    await p.click('.dc-this-chat-more button');
    await checkSoon(async () => (await listSlugs(p)).length === 5 && (await groupSlugs(p)) === null, `${tag}: Show all lists the chat's 5 designs and the group steps aside`);
    check(await p.guest('const c = doc.querySelector(".dc-chat-chiprow"); return !!c && !c.hidden && c.textContent.trim() === "This chat" && doc.querySelector(".dc-rail-chiprow:not(.dc-chat-chiprow)").hidden'), `${tag}: a "This chat" chip says the list is narrowed`);
    await p.settle(300);
    await p.shot(`${tag}-3-show-all`);
    await p.click('.dc-filter-chip-x[aria-label="Show all designs again"]');
    await checkSoon(async () => (await listSlugs(p)).length >= 6 && (await groupSlugs(p))?.length === 3, `${tag}: the chip's × shows everything and the group again`);
    check(await p.guest('return doc.querySelector(".dc-chat-chiprow").hidden'), `${tag}: and the chip goes`);

    // a search hides the group
    await p.type('.dc-search input', 'invoice');
    await checkSoon(async () => (await groupSlugs(p)) === null, `${tag}: a search hides the group`);
    await p.guest('const el = doc.querySelector(".dc-search input"); el.value = ""; el.dispatchEvent(new win.Event("input", { bubbles: true })); return true');
    await checkSoon(async () => (await groupSlugs(p))?.length === 3, `${tag}: clearing the search brings it back`);

    // another chat with no designs, then no chat: no group, no heading
    await p.host('window.__host.setSession("ses_empty")');
    await checkSoon(async () => (await groupSlugs(p)) === null, `${tag}: a chat with no designs shows no group`);
    check(await p.guest('return doc.querySelector(".dc-rail-rest-h").hidden'), `${tag}: and no heading over the list`);
    await p.host('window.__host.setSession(null)');
    await checkSoon(async () => (await groupSlugs(p)) === null, `${tag}: no chat shows no group`);
    await p.settle(300);
    await p.shot(`${tag}-4-no-chat`);
    await p.close();
  }
};
