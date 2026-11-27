# Design Chamber on the phone

OpenChamber's phone app can show Design Chamber in two places: the **full-screen page**, from the chats
list's **More** menu, and the **Design Chamber tab** of the workspace drawer (the rail panel on the phone).
Both opt in through the manifest (`page.mobile` and `panel.mobile`). An older OpenChamber ignores both keys,
so the extension still installs there and simply isn't listed on the phone.

The service never runs on the phone. It runs on the computer that runs OpenChamber, and the phone reaches it
through the app, so the designs folder, exports and thumbnails all live on that computer.

## How a frame knows it's on a phone
OpenChamber sends `ready.device` with every `ready`: the form factor (`phone`, `tablet`, `desktop`), the
pointer (`coarse` or `fine`), the safe-area insets and how many pixels the on-screen keyboard covers. Design
Chamber reads it defensively: a missing or malformed value is a desktop with a mouse, and every number is
rounded and clamped to 0 to 400 px before it reaches a style. A tablet keeps the desktop layouts.

## The full-screen page on a phone
- It is the rail layout, not the 1400 px library: the designs list, the compact viewer and Settings as a
  sheet, the same screens the 320 to 480 px rail shows ([list](../pages/img/phone-390-dark-page-1-list.png) ·
  [canvas](../pages/img/phone-390-light-page-3-canvas.png) · [page](../pages/img/phone-390-dark-page-6-page.png)).
  The choice is made once, when the page opens; a phone stays a phone.
- It reports what is open as the page does, and remembers the open design under the page's key
  (`place:page`), shared with the desktop page as before.
- No footer hint and no first-run tip: it is already full screen.
- It doesn't take "open this design" requests from chat cards, Work Status or the Files action. Those go to
  the drawer tab, which is what OpenChamber opens for them.
- The content keeps clear of the home indicator (the bottom safe area).

## The drawer tab
- The rail as on the desktop, with the phone's words: the first-run tip reads "Open Design Chamber full
  screen. In your chats list, open More and pick Design Chamber." and the viewer's footer reads "Full screen:
  chats list → More → Design Chamber".

## On both
- **Hidden actions.** Reveal in folder, Export ZIP, Export single-file HTML, Export screen as HTML and Copy
  path act on the computer, not the phone (a folder opens there, a download lands in its Downloads), so they
  are left out of the viewer's ⋯ menu, the list rows' menu and the design systems menus
  ([viewer menu](../pages/img/phone-390-dark-page-4-canvas-menu.png) ·
  [row menu](../pages/img/phone-390-dark-page-2-row-menu.png)). Copy HTML stays: it copies to the phone's
  own clipboard. The service's checks are unchanged; this only hides the entries. A phone's design system page
  uses the rail layout, which offers **Preview living page** only; the full living-page card also drops
  **Reveal living page** on a phone.
- **Settings** stays, with one line under the folder field: "This folder is on the computer that runs
  OpenChamber." ([Settings](../pages/img/phone-390-dark-page-8-settings.png))
- **Two live frames.** A canvas keeps at most two artboards loaded (the rail keeps 4, the desktop page 12);
  the rest say "Paused" until you pan to them.
- **Touch-sized controls.** With a coarse pointer, buttons, menu rows, list rows and the ask bar's Send are
  at least 44 px tall, and icon buttons 44 px square.
- **The on-screen keyboard.** The view stops above the keyboard, so the ask bar, the comment card and every
  sheet stay in sight while you type ([keyboard open](../pages/img/phone-390-dark-page-5-keyboard.png)).
  Rotation and the keyboard arrive as a new `ready`; nothing reloads and nothing you typed is lost.

## Gestures on the canvas and pages
These work with a finger on any touchscreen, tablets and touch laptops included. Mouse and trackpad work as before.

| Gesture | On a canvas | On a page |
|---|---|---|
| Tap | Edit: comment on that element, or open the pin you tapped. Play: the design's own tap | The same |
| Drag one finger | Moves the wall. In Play, a drag that starts on a screen goes to the design, and one that starts between screens moves the wall | Scrolls the page, in Edit and in Play |
| Pinch two fingers | Zooms around the point between them, from 5% to 400%. Moving both fingers moves the wall | Nothing, a page doesn't zoom |

- A finger can wobble up to 10 px and still count as a tap. A drag or a pinch never leaves a comment, even when you lift one finger before the other, and the finger still down carries on moving the wall.
- As with a mouse wheel, moving or zooming the wall closes an open comment card.
- In Play, two fingers on a screen belong to the design. Pinch between screens, or use the zoom buttons.
- There's no outline under your finger before you tap; that hover outline is for a mouse.
- Rotating the phone mid-gesture simply ends it.

Code: `src/ui/model/wall-input.ts` (the maths), `src/ui/wall/input-controller.ts`. Checks:
`test/ui/visual/scenarios/wall-touch.mjs`. Headless Chrome stops sending touches into design frames after a
synthesized two-finger gesture, so Play after a pinch still needs a try on a real phone.

## Screenshots
`test/ui/visual/scenarios/phone.mjs` shoots a 390 × 844 phone, dark and light:
`node test/ui/visual/shoot.mjs '^phone$' --out <folder>` (after `npm run build`).

---
*Last updated: 2026-11-27: the phone shell (page and drawer tab, hidden computer actions, keyboard, two live frames).*
