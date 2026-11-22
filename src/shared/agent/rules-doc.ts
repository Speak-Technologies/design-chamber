// `<design>/.chamber/RULES.md` (docs/SPEC.md §11.2): the full instructions the chip makes
// mandatory reading. Assembly order: header → precedence (layers 1–5, the preset inlined) →
// viewports → design.json contract → rules/DESIGN-RULES.md verbatim → rules/QUESTIONS.md
// verbatim → rendering constraints. Deterministic for equal inputs (no clock), so the service
// can skip a rewrite when nothing changed.

import { BRIEF_MAX, DIRECTION_NAME_MAX, DIRECTION_OPTIONS_MAX, DIRECTION_OPTIONS_MIN, FOLDER_REQUEST_NAMES_MAX, SCREEN_DESCRIPTION_MAX, SCREENS_MAX, TITLE_MAX, TWEAKS_MAX, TWEAK_CHOICES_MAX, TWEAK_CHOICES_MIN, VIEWPORT_HEIGHT_MAX, VIEWPORT_HEIGHT_MIN, VIEWPORT_WIDTH_MAX, VIEWPORT_WIDTH_MIN, VIEWPORTS_MAX } from '../limits.ts';
import { VIEWPORT_LAPTOP, VIEWPORT_PHONE } from '../design-json.ts';
import type { DesignKind, Viewport } from '../types.ts';
import { clip, designFilePath, formatViewport, joinFolder, oneLine, SYSTEM_GUIDANCE_ONLY, systemOf, VIEWPORT_DESKTOP, VIEWPORT_TABLET, type AgentContext, type AgentSystem, type ProjectBreakpoint, type ProjectRules } from './context.ts';
import { CHECK_TOOL_NAME } from './guide.ts';

/** The two bundled rules files, exactly as read from `rules/`. */
export type RulesDocFiles = { designRules: string; questions: string };

const kindWord = (kind: DesignKind): string => (kind === 'canvas' ? 'canvas' : 'page');

/** A verbatim file between markers, so the agent sees where our text ends and the file begins. Shared with the bundled skill. */
export const verbatim = (name: string, text: string): string[] => [`<!-- BEGIN ${name} (verbatim) -->`, text.endsWith('\n') ? text.slice(0, -1) : text, `<!-- END ${name} -->`];

const breakpointText = (breakpoint: ProjectBreakpoint): string => {
  const direction = breakpoint.directions.length === 2 ? 'min/max-width' : `${breakpoint.directions[0] ?? 'min'}-width`;
  const origin = breakpoint.origin === 'css' ? `${breakpoint.count}× in @media` : breakpoint.origin === 'tailwind-default' ? 'Tailwind default' : 'Tailwind config';
  return `${breakpoint.px}px (${direction}${breakpoint.name ? `, ${breakpoint.name}` : ''}; ${origin})`;
};

// ---- header ----

const fileMap = (context: AgentContext): string[] => {
  const at = (relative: string): string => designFilePath(context.folder, relative);
  return [
    `  - design.json: ${at('design.json')}`,
    context.kind === 'canvas' ? `  - one file per screen: ${at('screens/<id>.html')}` : `  - the page: ${at('index.html')}`,
    `  - tokens.css: ${at('tokens.css')}`,
    `  - DESIGN.md: ${at('DESIGN.md')}`,
    `  - assets/: ${at('assets')}`,
    '  - Never touch: .versions/ (snapshots), .chamber/ (this file; the extension rewrites it), .thumb.png (thumbnail cache).',
  ];
};

const kindMeaning = (kind: DesignKind): string =>
  kind === 'canvas'
    ? 'a canvas is an infinite wall of screens, each shown at every viewport side by side, like Claude Design'
    : 'a page is one index.html shown full screen, like a browser tab';

const headerSection = (context: AgentContext): string[] => {
  const brief = clip(context.brief.trim(), BRIEF_MAX);
  const project = context.project;
  return [
    `# Design Chamber instructions for "${clip(oneLine(context.title), TITLE_MAX)}"`,
    '',
    'This file is part of your instructions for this design. Read all of it before you design, and follow it on every later message about this design, not only the first.',
    '',
    `- Design: "${clip(oneLine(context.title), TITLE_MAX)}" (${kindWord(context.kind)}: ${kindMeaning(context.kind)})`,
    `- Folder (write ONLY inside it): ${context.folder}`,
    `- Designs folder: ${context.designsRoot}. The user set it in Design Chamber settings (the default is ~/Documents/Designs). Every design is its own folder in there. Never save designs anywhere else, and never as a loose file.`,
    '- Files:',
    ...fileMap(context),
    ...(brief === '' ? ['- Brief: none. Ask the user what to design.'] : ["- Brief (the user's words):", ...brief.split(/\r?\n/).map((line) => `  > ${line}`)]),
    project.directory === null
      ? '- Project folder: none open in this chat.'
      : `- Project folder (read it, never write design files into it): ${project.directory}`,
    '- Your file tools may ask permission to write in your designs folder, because it is outside the project. That is expected; the user can allow it.',
    '',
    '## Do this, in this order',
    '',
    '1. Read this whole file. Read it again at the start of every new request about this design: it may have been refreshed.',
    systemOf(context).state === 'linked'
      ? '2. Read the design system\'s OVERVIEW.md FIRST (Precedence, layer 2), then look for the active project\'s design rules for anything it does not cover (layer 3). Tell the user what you found in 2–4 lines, citing files.'
      : '2. Look for the active project\'s design rules FIRST (Precedence, layer 2). Tell the user what you found in 2–4 lines, citing files, or say "no project context".',
    '3. Settle the viewports (Viewports).',
    '4. If anything material is unclear, ask before you build: one message, then wait (Ask when unsure). Skip the questions only if the user said "go" or the request is a small edit.',
    '5. Build only inside the folder above. Write design.json first, then the HTML. Write DESIGN.md and tokens.css before the second screen. Update design.json in the same turn as the files it describes.',
    '6. Before you say you are done, run the check in "Check your work" and fix every error. Your reply states what you built, which sources you followed, your assumptions, and at most one open question.',
  ];
};

// ---- precedence ----

const PROJECT_LAYER_HEADING = '### Layer 2: the active project\'s design rules (look for these FIRST)';

const projectLayer = (project: ProjectRules, heading: string = PROJECT_LAYER_HEADING): string[] => {
  const intro = [heading, ''];
  const discover = 'Also run the discovery in "Discover the project\'s design rules first" (Design rules, §2): this list can miss non-standard places. Copy the values you use into tokens.css with a comment naming the source file.';
  switch (project.state) {
    case 'no-project':
      return [
        ...intro,
        `No project folder is open in this chat (${project.note ?? 'none given'}). Ask the user whether an existing codebase or brand should be followed before you invent a look; if they say there is none, this layer is empty.`,
      ];
    case 'unreadable':
      return [
        ...intro,
        `The project folder ${project.directory ?? ''} could not be read (${project.note ?? 'unknown reason'}). Look at the project yourself. If you cannot find its design rules, ask the user; do not guess.`,
      ];
    case 'scanned': {
      const stopped = project.truncated ? ' The scan stopped early on a size or time limit, so the list may be incomplete.' : '';
      if (project.sources.length === 0) {
        return [
          ...intro,
          `Design Chamber scanned ${project.directory ?? 'the project'} and found no design documents, token/theme files, or design sections in AGENTS.md / CLAUDE.md.${stopped}`,
          '',
          `${discover} If you still find nothing, say "no project context" and follow Ask when unsure.`,
        ];
      }
      return [
        ...intro,
        `Design Chamber found these in ${project.directory ?? 'the project'} (paths relative to it; read them yourself, since you are working in that project):${stopped}`,
        '',
        ...project.sources.map((source) => `- \`${source.path}\`: ${source.why}`),
        ...(project.sourcesOmitted > 0 ? [`- … and ${project.sourcesOmitted} more not listed.`] : []),
        '',
        discover,
      ];
    }
  }
};

const presetLayer = (context: AgentContext): string[] => {
  const { preset } = context;
  if (preset === null) {
    return [
      '### Layer 3: style preset, none chosen',
      '',
      'The user did not pick a preset. If layers 1–2 do not settle the look, propose 2–3 distinct named directions yourself in your questions (Ask when unsure, §5) instead of defaulting to one.',
    ];
  }
  return [
    `### Layer 3: style preset ${preset.name} (\`${preset.id}\`)`,
    '',
    'The user picked this preset when creating the design. Follow it unless layer 1 or 2 says otherwise. Its CSS block seeds this design\'s tokens.css and DESIGN.md. The preset, verbatim:',
    '',
    ...verbatim(`rules/presets/${preset.id}.md`, preset.text),
  ];
};

const designSystemLayer = (context: AgentContext): string[] => {
  const { confirmed, hasDesignMd, hasTokensCss } = context.designSystem;
  const status = confirmed
    ? 'confirmed (design.json `designSystem.confirmed` is true): follow DESIGN.md and tokens.css exactly; change them only if the user asks.'
    : hasDesignMd || hasTokensCss
      ? `not confirmed yet (${[hasDesignMd ? 'DESIGN.md exists' : 'no DESIGN.md', hasTokensCss ? 'tokens.css exists' : 'no tokens.css'].join(', ')}). Treat what is there as your own proposal: show the user the palette, type and spacing, and set \`designSystem.confirmed\` to true in design.json once they accept it. A file marked \`Status: placeholder\` holds scaffold defaults, not decisions.`
      : 'not written yet. Write DESIGN.md and tokens.css once, before the second screen, from layers 1–3; set `designSystem.confirmed` to true in design.json when the user accepts them.';
  return ['### Layer 4: this design\'s own DESIGN.md + tokens.css, once confirmed', '', `Status: ${status}`];
};

const PRECEDENCE_INTRO = 'Highest first. A higher layer always wins. Never silently override one; if a lower layer conflicts with a higher one, say so in one line. Inside the winning layer, do not invent colours, spacing or type values it already defines.';

const userLayer = (): string[] => ['### Layer 1: the user\'s words in chat', '', 'Always first. Never ask the user to repeat something they already said in this chat.'];

const builtInLayer = (): string[] => [
  '### Layer 5: the built-in rules',
  '',
  'The "Design rules" and "Ask when unsure" sections below: anti-slop, best practices, file rules and the self-check. They apply when nothing above settles a question.',
];

/** The Phase 0 order, unchanged (a design with no system, or an old design: byte-identical, test-held). */
const phaseZeroOrder = (context: AgentContext): string[] => [
  PRECEDENCE_INTRO,
  '',
  ...userLayer(),
  '',
  ...projectLayer(context.project),
  '',
  ...presetLayer(context),
  '',
  ...designSystemLayer(context),
  '',
  ...builtInLayer(),
];

type LinkedSystem = Extract<AgentSystem, { state: 'linked' }>;

/** A system path as the agent sees it, in the design folder's separator style. */
const inSystem = (system: LinkedSystem, relative: string): string => joinFolder(system.folder, ...relative.split('/'));

/** Layer 2 with a linked system (§8.2, §8.10): the system, read by path, never inlined. */
export const linkedSystemLines = (system: LinkedSystem): string[] => {
  const name = oneLine(system.name);
  return [
    `This design uses the design system "${name}" (revision ${system.revision}), copied into ${system.folder}. Read ${inSystem(system, 'OVERVIEW.md')} first, every time. ` +
      `Read only the sections a task needs in ${inSystem(system, 'system.json')} and ${inSystem(system, 'tokens.css')}, and a component's note in system.json before you build that component. ` +
      'Use only its tokens. Follow its usage notes, including when not to use something. If it lacks something you need, tell the user and propose an addition to the system; don\'t invent it. ' +
      `Never change any file in ${system.folder}; put this design's own changes in tokens.css as overrides. Link ${inSystem(system, 'system.css')} before tokens.css (system/system.css from index.html, ../system/system.css from screens/).`,
    SYSTEM_GUIDANCE_ONLY,
    `Read ${inSystem(system, 'patterns')} when a task involves layout or copy, and ${inSystem(system, 'brand')} when it involves marketing surfaces.`,
    ...(system.repo === null
      ? []
      : [`This system lives in ${system.repo}. The copy here is a snapshot. To change the system, ask the user or use the system's chat; never write ${system.repo} from a design task.`]),
    ...(system.complete ? [] : [`This design's copy of ${name} is missing ${system.missing.length === 0 ? 'some files' : system.missing.join(', ')}. Tell the user; don't recreate it.`]),
    ...(system.overviewEmpty ? ['The system has no overview yet.'] : []),
  ];
};

const linkedOrder = (context: AgentContext, system: LinkedSystem): string[] => [
  PRECEDENCE_INTRO,
  '',
  ...userLayer(),
  '',
  '### Layer 2: this design\'s design system',
  '',
  ...linkedSystemLines(system).flatMap((line, index) => (index === 0 ? [line] : ['', line])),
  '',
  ...projectLayer(context.project, '### Layer 3: the active project\'s design rules, for anything the design system doesn\'t cover'),
  '',
  '### Layer 4: style preset',
  '',
  'No style preset applies: this design uses a design system.',
  '',
  ...builtInLayer(),
  '',
  'With a design system linked, you don\'t need to confirm a DESIGN.md or tokens.css.',
];

/** The ask paragraph (§8.2): which system, recorded in design.json, then wait for the copy. */
export const askSystemLine = (context: AgentContext, system: Extract<AgentSystem, { state: 'ask' }>): string => {
  const choices = system.choices.map((choice) => `${oneLine(choice.name)} (${choice.id}): ${oneLine(choice.line)}`);
  const recommended = system.choices.find((choice) => choice.id === system.recommended);
  return [
    `Before the first screen, ask the user which design system to use. Your choices: ${[...choices, 'or none'].join('; ')}.`,
    ...(recommended === undefined ? [] : [`I'd recommend ${oneLine(recommended.name)}.`]),
    "If the user already said in this chat, don't ask.",
    `Record the answer in design.json as "systemChoice": "<id>" or "none", then wait until ${designFilePath(context.folder, 'system/COPY.json')} exists before you use the system.`,
  ].join(' ');
};

const precedenceSection = (context: AgentContext): string[] => {
  const system = systemOf(context);
  return [
    '## Precedence',
    '',
    ...(system.state === 'ask' ? [askSystemLine(context, system), ''] : []),
    ...(system.state === 'linked' ? linkedOrder(context, system) : phaseZeroOrder(context)),
  ];
};

// ---- viewports ----

const viewportsSection = (context: AgentContext): string[] => {
  const { project } = context;
  const found =
    project.breakpoints.length > 0
      ? [
          `Design Chamber found these breakpoints in the project: ${project.breakpoints.map(breakpointText).join(' · ')}.`,
          project.viewports.length > 0 ? `They suggest: ${project.viewports.map(formatViewport).join(', ')}. Treat that as a hint, not a decision.` : '',
        ].filter((line) => line !== '')
      : ['Design Chamber found no breakpoints in the project (or no project is open).'];
  const system = systemOf(context);
  if (system.state === 'linked' && system.breakpoints.length > 0) {
    found.push(`The design system's breakpoints are ${system.breakpoints.map((px) => `${px}px`).join(', ')}; suggest them alongside the project's.`);
  }
  return [
    '## Viewports',
    '',
    'Settle the viewports before you design: every screen is rendered at every viewport you list in design.json.',
    '',
    `1. Derive them from the project first. ${found.join(' ')}`,
    '2. If the project or brief makes it clear (a desktop-only admin console, a mobile app), use that and state it as an assumption; no question needed.',
    `3. Otherwise ask which viewports to show, recommending the defaults **${formatViewport(VIEWPORT_LAPTOP)} + ${formatViewport(VIEWPORT_PHONE)}**. Add ${formatViewport(VIEWPORT_TABLET)} when the layout changes there, ${formatViewport(VIEWPORT_DESKTOP)} for wide dashboards, 1080×1080 for social posts, 794×1123 for A4 print. Never assume desktop-only for a product people use on phones.`,
    `4. Record the agreed viewports in design.json \`viewports\` (1–${VIEWPORTS_MAX} items; width ${VIEWPORT_WIDTH_MIN}–${VIEWPORT_WIDTH_MAX}, height ${VIEWPORT_HEIGHT_MIN}–${VIEWPORT_HEIGHT_MAX}).`,
    '',
    `design.json lists now: ${context.viewports.map(formatViewport).join(', ')}${context.pending ? ' (the extension\'s defaults until you change them)' : ''}.`,
  ];
};

// ---- design.json contract ----

const viewportJson = (viewport: Readonly<Viewport>): string =>
  `{ "id": "${viewport.id}", "label": "${viewport.label}", "width": ${viewport.width}, "height": ${viewport.height} }`;

const contractExample = (context: AgentContext): string =>
  [
    '{',
    '  "version": 1,',
    `  "kind": "${context.kind}",`,
    '  "title": "Checkout redesign",',
    '  "created": "2026-10-26T18:00:00.000Z",',
    '  "updated": "2026-10-26T18:20:00.000Z",',
    '  "brief": "…",',
    '  "sessionId": null,',
    '  "projectDirectory": null,',
    '  "preset": null,',
    ...(context.kind === 'page' ? ['  "entry": "index.html",'] : []),
    '  "viewports": [',
    `    ${viewportJson(VIEWPORT_LAPTOP)},`,
    `    ${viewportJson(VIEWPORT_PHONE)}`,
    '  ],',
    ...(context.kind === 'canvas'
      ? [
          '  "screens": [',
          '    { "id": "home", "title": "Home", "file": "screens/home.html", "viewports": ["laptop", "phone"], "description": "Landing page" }',
          '  ],',
        ]
      : []),
    '  "designSystem": { "confirmed": false },',
    '  "tweaks": [ { "var": "--accent-h", "label": "Accent hue", "kind": "number", "min": 0, "max": 360, "step": 1, "unit": "" } ],',
    '  "comments": []',
    '}',
  ].join('\n');

const contractSection = (context: AgentContext): string[] => [
  '## design.json contract',
  '',
  `Schema \`design-chamber/design@1\`. The extension and you both write this file, so the keys are split by owner. Example (${kindWord(context.kind)}):`,
  '',
  '```json',
  contractExample(context),
  '```',
  '',
  '| Key | Owner | Rule |',
  '|---|---|---|',
  '| `version` | extension | Always `1`. |',
  '| `kind` | extension | `"page"` (one index.html shown full screen) or `"canvas"` (a wall of screens). Fixed once you have written the first screen or index.html; before that you may switch it, as long as the design has no comments yet. |',
  `| \`title\` | you | 1–${TITLE_MAX} characters. The user may rename it. |`,
  '| `created` | extension | Never change. |',
  '| `updated` | you | ISO-8601 UTC time. Set it on every change you make to the design. |',
  '| `brief` | extension | The user\'s brief. Never change. |',
  '| `sessionId`, `projectDirectory`, `preset` | extension | Links to the chat, the project and the preset. Never change. |',
  '| `entry` | extension | Page only: always `"index.html"`. |',
  `| \`viewports\` | you | 1–${VIEWPORTS_MAX} items \`{ id, label, width, height }\`; \`id\` letters, digits, \`-\`, \`_\`. |`,
  `| \`screens\` | you | Canvas only, 0–${SCREENS_MAX}, in the order they appear on the wall: \`{ id, title, file, viewports?, description? }\`. \`id\` is lower-case letters, digits and \`-\`; \`file\` is exactly \`screens/<id>.html\`; \`viewports\` is an optional subset of the viewport ids (default: all); \`description\` ≤ ${SCREEN_DESCRIPTION_MAX} characters. A direction of another screen carries \`"direction": { "of": "home", "letter": "A", "name": "Bold" }\` (${DIRECTION_OPTIONS_MIN} to ${DIRECTION_OPTIONS_MAX} directions per screen, letters A to D, name up to ${DIRECTION_NAME_MAX} characters; never on the original). Design Chamber also writes this list when the user reorders, duplicates, trashes or keeps a screen, so read design.json again right before you write it. |`,
  '| `designSystem` | you | `{ "confirmed": false }`; set `true` once the user confirms DESIGN.md and tokens.css. |',
  `| \`tweaks\` | you | Optional, up to ${TWEAKS_MAX} knobs for the Tweaks panel. A number knob: \`{ "var", "label", "kind": "number", "min", "max", "step", "unit" }\`; a choice knob: \`{ "var", "label", "kind": "choice", "options": [{ "label", "value" }] }\` with ${TWEAK_CHOICES_MIN} to ${TWEAK_CHOICES_MAX} options. \`var\` must be set with a plain value in the \`:root\` block of tokens.css, in the knob's unit. When the user saves, Design Chamber writes only those values into tokens.css. |`,
  ...(systemOf(context).state === 'ask' || systemOf(context).state === 'linked'
    ? ['| `systemChoice` | you | The user\'s answer about the design system: a system id, or `"none"`. Design Chamber copies the system into `system/`; never edit that folder. |']
    : []),
  `| \`folderRequest\` | you | Optional, only when the user asks you to put this design in a folder, or take it out: \`{ "add": ["<folder name>"], "remove": ["<folder name>"], "at": "<ISO time>" }\`, up to ${FOLDER_REQUEST_NAMES_MAX} names in each list. Use the names of folders that already exist (they are in \`.chamber/folders.json\` in the designs folder: read it, never write it). Design Chamber files the design within a few seconds and never creates a folder. |`,
  '| `comments` | extension | The user\'s pinned comments. Never edit. |',
  '',
  '- Keep every key you do not own, including keys you do not recognise, exactly as it is. The extension puts its keys back if you change them.',
  '- Write design.json before any HTML file, so the extension takes your title, kind and viewports from the start.',
  '- Write the whole file as valid JSON in one write. A half-written file shows as an error until you fix it.',
  '- The user\'s hand edits (text, tweaks, the screen list) land in your files directly. Re-read a file before you change it.',
  '- Update `screens` / `viewports` / `updated` in the same turn you write the files they describe. A listed screen whose file is missing shows as "not written yet".',
];

// ---- rendering constraints ----

/** The offline rules. Context-free, so the bundled skill carries the same text. */
export const renderingSection = (): string[] => [
  '## Rendering constraints',
  '',
  'Design Chamber shows your files offline, inside a sandboxed frame. So:',
  '',
  '- Everything works with no network: no CDN scripts, Google Fonts or other web fonts, remote images or analytics. Bundle fonts and images in `assets/` (fonts in `assets/fonts/` with `@font-face`, and end every font stack with a generic family).',
  '- Remote files are blocked and listed back to you when the user sends comments.',
  '- Reference local files statically with relative paths: `assets/hero.jpg` and `tokens.css` from index.html; `../assets/hero.jpg` and `../tokens.css` from `screens/*.html`. URLs built at runtime (`new Image().src = "assets/x.png"`), `fetch()` / XHR of local files and ES-module imports across files do not load.',
  '- Small inline `<script>` interactions work (clicks, tabs, toggles). `localStorage` works and is kept per design (up to 1 MB), so saved ticks and filters survive a reload; `sessionStorage` lasts until the screen reloads. There is no `top.location`, `window.open`, cookie, IndexedDB or network call.',
  '- Link between screens with `<a href="other-screen.html">` (a sibling file in `screens/`) or `data-dc-goto="<screenId>"`. Links to `#anchors` work; an external https link asks the user before it opens.',
  '- Give meaningful elements stable hooks (`id`, `data-screen`, semantic class names): comments are pinned to elements by selector and travel with it.',
  '- One responsive file per screen: the wall renders it at every viewport in design.json.',
];

export type CheckSectionInput = {
  /** The agent tool named first (`design_check`). */
  tool: typeof CHECK_TOOL_NAME;
  /** The launcher command, or `null` when it is not in place here (and always in the bundled skill, which holds no path). */
  command: string | null;
};

/** How the agent looks at its own work: the tool first, the launcher command when the tool is missing. Shared with the bundled skill. */
export const checkSection = ({ tool, command }: CheckSectionInput): string[] => [
  '## Check your work',
  '',
  ...(command === null
    ? [
        `Check the design with the ${tool} tool after each change, before you say you are done. If you don't have that tool, look for the check command in the Designs folder's AGENTS.md and run it with the design's folder name. If there is none, read your HTML once more for overflow, contrast, alt text and labels.`,
      ]
    : [`Check the design with the ${tool} tool after each change, before you say you are done. If you don't have that tool, run:`, '', `    ${command}`]),
  '',
  `The check renders every screen at every viewport in design.json, saves PNGs in the design's .chamber/check/ folder and lists what it found: files that don't load, content wider than the viewport, cut-off or overlapping text, low contrast, images without alt text, fields without labels, script errors. Fix every error, open the PNGs to see the result, and check again.${command === null ? '' : ' The command exits with 0 when there are no errors.'} If the check says no browser was found, it still checks the files; say in your reply that the design was not rendered.`,
];

/** The full RULES.md text for one design. */
export const buildRulesDoc = (context: AgentContext, files: RulesDocFiles): string =>
  [
    ...headerSection(context),
    '',
    ...precedenceSection(context),
    '',
    ...viewportsSection(context),
    '',
    ...contractSection(context),
    '',
    '## Design rules',
    '',
    'The built-in design rules, exactly as shipped (layer 5):',
    '',
    ...verbatim('rules/DESIGN-RULES.md', files.designRules),
    '',
    '## Ask when unsure',
    '',
    'The question protocol, exactly as shipped:',
    '',
    ...verbatim('rules/QUESTIONS.md', files.questions),
    '',
    ...renderingSection(),
    '',
    ...checkSection({ tool: CHECK_TOOL_NAME, command: context.checkCommand }),
    '',
  ].join('\n');
