# Design checks (the agent looks at its own work)

Before an agent says a design is done, it runs one command. Design Chamber renders every screen
at every viewport, saves pictures, and lists what is wrong. The same findings feed the Checks
badge in the viewer (the last section covers it).

## What the agent runs
`<designs folder>/.chamber/bin/dc` (Windows: `dc.cmd`), a small launcher the service writes. The
chip, RULES.md, the guide and the skill quote the exact command for this computer:

    sh '/home/you/Documents/Designs/.chamber/bin/dc' check signup-flow

Windows: `"C:\Users\you\Documents\Designs\.chamber\bin\dc.cmd" check signup-flow` (PowerShell
needs `&` in front; the chip says so). Options: `--screen <id>` (repeatable, canvas only),
`--static` (files only: no browser, nothing written), `--json`. The command takes a design folder
name or a path to a design folder, and refuses anything that is not a design directly inside the
designs folder. **Exit 0** no errors, **1** errors found, **2** the check could not run (one
sentence on stderr). Ctrl-C or a shutdown during a render ends the browser at once and exits 2 with
"The check was interrupted, so no report was saved.": no `check.json` and no pictures are left, so
nothing half-done reads as a clean result.

The launcher holds the runtime that runs the extension's service and the path of the CLI, so the
agent needs no Node on its PATH. The service rewrites it when the extension starts and the bytes
differ. A file at that spot that Design Chamber did not write (no marker on line 2) is left alone,
and the instructions then ask for a read-through instead of a command. The launcher has no secret
in it and Design Chamber never runs it.

## What it finds
Severity and wording come from the finding code only (one table, `src/shared/checks.ts`).

| Kind | Findings |
|---|---|
| Errors | a screen listed in design.json with no file · a missing `index.html` · links to missing files, files outside the folder, or the internet · content wider than the viewport · low text contrast (AA: 4.5:1, 3:1 for large text) · an image without `alt` · a form field without a label · a button or link without a name · a script error · a request to the internet that was blocked · a screen that could not be rendered |
| Warnings | tokens redefined in a screen that `tokens.css` already defines · `design.json` fields that were ignored · a screen file design.json does not list · a device copy of a screen (`home-phone` next to `home`) · a script import that cannot load · no doctype, `lang`, viewport meta or `<title>` · cut-off or overlapping text · a screen six or more viewports tall · a screen that took too long |
| Notes | no charset · hardcoded colours although `tokens.css` defines colours · the page opened an alert · screens not rendered because of the limit · no browser found · the page height |

Static checks (the files) run on every change. Rendering runs when the agent runs the command, or
when the user asks (`POST /designs/:slug/checks/run`, one design at a time).

## Where results live
- `<design>/.chamber/check.json`: the report (schema `design-chamber/check@1`), written atomically
  after the pictures. It records which files it was based on, so the service can say whether the
  rendering is **fresh** or **stale**.
- `<design>/.chamber/check/<run>/<screen>@<viewport>[-<n>].png`: one picture per screen height (at most four per artboard).
  When a run finishes, earlier run folders that the new report does not name are removed if they are
  more than two minutes old (a run that is still going keeps its folder). Nothing in `.chamber/` is versioned or exported.
- A throwaway browser profile (`.chamber/dc-check-*`, removed after the run) on Linux; the OS
  temp folder on Windows and macOS.

## How rendering stays offline and safe
The design is bundled exactly as the wall renders it and handed to a headless Chrome, Edge or
Chromium from memory, under the same rules as the in-app frame: scripts may run, but the page
cannot read files or reach the network (no `file://`, an opaque origin, a content policy with
`connect-src 'none'`). Layers back each other up: the policy, every request but the page
failed by the engine, host names that never resolve, a dead proxy that loopback and IP-literal
addresses go through too, and WebRTC told not to send UDP (set with `--webrtc-ip-handling-policy`;
Chrome 157 ignores the `--force-` spelling alone, so both are given, and tests check that no STUN or
TURN packet reaches a local listener). The thumbnail browser, which renders the same untrusted HTML,
uses the same flags. The browser is driven over
a pipe (no debugging port is opened), killed when the run ends, and limited to 12 seconds per
screen and 90 seconds per run. A screen that hangs, crashes or reloads forever is a finding;
the next screen still renders. Renders use the light scheme, as the wall does.

## Limits
24 artboards per run (the rest are counted as not rendered; the note says so and how to check them: `--screen <id>`), a 90-second run budget, or three failures in a row (each stop has its own note), 4 pictures per artboard, 200 findings
per report (5 per kind per screen), 60 HTML files in the static check. Contrast is skipped where the
real backdrop cannot be known (an image or gradient behind the text, filters, blend modes,
opacity). Overlap and cut-off text are heuristics, so they are warnings.

## States
- **No browser found:** the file checks run, the report says `unavailable`, the text output says
  "No Chrome, Edge or Chromium was found, so nothing was rendered", and the exit code follows the files.
- **A browser that cannot be driven** (some Snap or Flatpak builds): the render is `failed` with
  "This browser build can't be driven. Set another browser in Settings."
- **`check.json` missing, linked, over 2 MB or invalid:** treated as "rendering not checked yet".
  A forged file cannot choose a severity or a sentence, add a path outside the design, or put
  more than its valid findings in the counts.

## Service routes
- `GET /designs/:slug/checks`: static findings, the render state (`none`, `fresh`, `stale`,
  `running`, `unavailable`, `failed`), counts (errors, warnings, notes of the static findings plus
  the render findings whose files are unchanged since the render, whatever the render's own state:
  a screen that timed out is a real finding), and whether a run can start. Page heights are left out.
- `POST /designs/:slug/checks/run`: body `{}`. Starts a render and answers at once; ends with a
  `checks` change event. 409 "Another design is being checked. Try again in a moment." while
  another design is running; 422 when no browser is found.
- `POST /designs/:slug/prompt` with `purpose: "checks"`: "Ask the agent to fix". Errors and warnings
  only, errors first, at most 40 findings; 422 "There is nothing to fix." when none are counted.
  A rendering made before the latest edit is not sent, and the text says to run the check first.
  Text from the design (selectors, URLs) is introduced to the agent as data.

## Where it lives
`src/cli/dc.ts` (the command), `src/service/check/**` (static checks, colour maths, analysis,
browser pipe, render loop, output, launcher, service, target resolution, report text),
`src/service/routes/checks.ts`, `src/shared/checks.ts` (finding table and `check.json` validation),
`src/shared/agent/check-command.ts`, `src/guest/probe/probe.ts` (the measuring script, built into
the CLI and the service). Tests: `test/service/check/**`, `test/cli/**`, `test/agent/check-copy.test.ts`,
`test/agent/checks-prompt-route.test.ts`, `test/shared/checks.test.ts`.

## The Checks badge (the viewer side)
Both viewers (the full-screen page, canvas and page designs, and the compact rail viewer) show a pill that says how the design stands, and open the findings. Screens: [full-screen page](../pages/full-screen-page.md) (P7) and [rail panel](../pages/rail-panel.md).

- **Label.** `Checking` (first load, or a rendering check is running) · `No issues` · `1 issue` / `n issues` (errors plus warnings from `counts`; notes never count) · `Checks` (the service did not answer). Accessible name `Checks: <label>`. Red with errors, amber with only warnings, green for a pass, grey while unknown. Low contrast is an error, so it turns the badge red.
- **In the rail** the badge is compact (shape and number, or a check mark, or a spinner; 26 px like its neighbours) and carries the words in its accessible name; the full-screen page shows the words.
- **Green means verified.** A pass is green when the rendering was checked on the current files (`fresh`), when no browser exists to render with (`unavailable`, or `none` with `canRun: false`). Clean files whose rendering is `none` or `stale` show a grey `No issues` and the badge's description says "Rendering hasn't been checked yet." or "Rendering was checked before your latest changes."
- **What is listed.** The service's sentences only (`message`), grouped Needs fixing, Worth a look, Notes, and a muted "From before your latest changes" for render findings that are not counted (`stale`, or the last check while one runs). Render findings count when `render.state` is `fresh`; for `unavailable` and `failed` the UI compares the service's `counts` with the listed findings, because the service counts those whenever their file keys still match. The `browser-missing` note is left out of the list (the rendering line says it) and out of the summary's note count. `detail` and `selector` are design text: set with `textContent` in a code element, never parsed.
- **Actions.** **Ask the agent to fix** calls `POST /designs/:slug/prompt` with `purpose: 'checks'` (errors and warnings, owner decision Q4), puts the text in the linked chat's composer (new linked chat when there is none, same path as the offline banner) and closes the panel; a 422 "There is nothing to fix." shows as a toast and the badge refetches. **Check rendering** / **Check again** calls `POST /designs/:slug/checks/run` (Q2); the badge shows `Checking` from the click, the service's `checks` event ends it, and the start and the result are each announced once in the badge's live region ("Rendering check finished. 3 issues."; it is only written when its sentence changes). A 409 (another design is running) or a 422 (no browser) shows its sentence in a toast.
- **Repaint in place.** A refresh updates the findings without rebuilding what a person can focus: the Notes and "From before…" disclosures keep focus and their open state, the error banner is rebuilt only when its text changes, and if the button that was pressed switches itself off while a check runs, focus moves to the dialog instead of falling to the page. The filled button is the next step (Ask when something is counted, otherwise Check rendering).
- **Live updates.** `GET /designs/:slug/checks` on mount, on opening the panel, and 600 ms after a `files`, `design`, `checks` or `added` event for the design, a `root` event, or a feed reset. Only the newest answer is applied. While a check is running the badge also asks every 4 seconds, in case the feed is down. The last good answer stays on screen when a refresh fails.
- **Where it lives.** `src/ui/wall/feature-checks.ts` (mounted by the design view as a Phase 1 feature: header status slot on the page, compact actions in the rail), `src/ui/components/checks-badge.ts` (badge, popover or sheet, actions), `src/ui/model/checks-model.ts` (labels, tones, groups, copy; pure), `openPopover` in `src/ui/components/kit.ts`, `askAgent` in `src/ui/guest.ts`. Tests: `test/ui/checks-model.test.ts`; visual scenario `test/ui/visual/scenarios/checks.mjs` with the fake service in `test/ui/visual/fake-checks.ts` (one sample design per state).
