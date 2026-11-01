// What an agent reads when it has no `/design` or `/page` chip (documentation/specs/
// agent-guidance-and-pages.md §4, §5): the guide the service keeps at `<root>/AGENTS.md`, the
// `design-chamber` OpenCode skill the user can install from Settings, and the AGENTS.md
// snippet Settings offers to copy. Pure and deterministic, no Node imports: the guest bundles
// import this file for the snippet.
//
// The root path is the only outside input. A root holding a control character (a newline
// would start a new instruction line) is refused here as well as in `PUT /settings`.

import { AGENTS_SNIPPET_MAX, GUIDE_TEXT_MAX, SKILL_DESCRIPTION_MAX, SKILL_TEXT_MAX } from '../limits.ts';
import { guideMarkerLine, OWNERSHIP_PLACEHOLDER, withOwnershipHash } from './ownership.ts';

/** The skill's folder and `name:`. Never `design` or `page`: the host drops an extension command a skill name already uses. */
export const SKILL_NAME = 'design-chamber';

/** The guide's file name inside the designs root (D5). */
export const GUIDE_FILE = 'AGENTS.md';

export const SKILL_DESCRIPTION: string =
  'Use when the user asks for a design, mockup, wireframe, UI screen, landing page, prototype, HTML page or design canvas, ' +
  'or mentions the Designs folder, Design Chamber or a design studio. Explains where to save designs so Design Chamber ' +
  'shows them inside OpenChamber, and how to lay out pages and canvases.';

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/** Throws on a root no instruction text may carry. */
const assertRoot = (root: string, label = 'designs folder'): void => {
  if (typeof root !== 'string' || root.trim() === '') throw new Error(`The ${label} path is empty.`);
  if (CONTROL_CHARACTER.test(root)) throw new Error(`The ${label} path contains a control character.`);
};

/** A builder never answers text over its cap: a root that long is refused, loudly. */
const capped = (text: string, max: number, what: string): string => {
  if (text.length > max) throw new Error(`The ${what} would be ${text.length} characters, over the ${max} limit: the designs folder path is too long.`);
  return text;
};

/** `\` for a Windows-looking path, else `/`. */
const separatorOf = (anyPath: string): string => (/^[A-Za-z]:[\\/]|^\\\\/.test(anyPath) || (anyPath.includes('\\') && !anyPath.includes('/')) ? '\\' : '/');

/** `root` joined with `parts` using `sep`, without doubling a trailing separator. */
const joinWith = (sep: string, root: string, ...parts: string[]): string => {
  const base = root.endsWith('/') || root.endsWith('\\') ? root.slice(0, -1) : root;
  return [base, ...parts].join(sep);
};

/** An inline code span that survives a backtick inside the value. */
const code = (value: string): string => (value.includes('`') ? `\`\` ${value} \`\`` : `\`${value}\``);

const PAGE_EXAMPLE = [
  '```json',
  '{',
  '  "version": 1,',
  '  "kind": "page",',
  '  "title": "Pricing",',
  '  "updated": "2026-11-01T10:00:00Z",',
  '  "viewports": [{ "id": "laptop", "label": "Laptop", "width": 1280, "height": 800 }]',
  '}',
  '```',
];

const CANVAS_EXAMPLE = [
  '```json',
  '{',
  '  "version": 1,',
  '  "kind": "canvas",',
  '  "title": "Signup flow",',
  '  "updated": "2026-11-01T10:00:00Z",',
  '  "viewports": [',
  '    { "id": "laptop", "label": "Laptop", "width": 1280, "height": 800 },',
  '    { "id": "phone", "label": "Phone", "width": 390, "height": 844 }',
  '  ],',
  '  "screens": [',
  '    { "id": "welcome", "title": "Welcome", "file": "screens/welcome.html" },',
  '    { "id": "details", "title": "Your details", "file": "screens/details.html" }',
  '  ]',
  '}',
  '```',
];

/** At most 10 lines: the anti-slop and offline rules an agent without RULES.md still follows. */
const RULES_DIGEST = [
  '- The user\'s words come first, then the project\'s own design rules (DESIGN.md, tokens, theme files), then these.',
  '- No default purple-to-blue gradients, no stock centred hero with three equal cards, no box around every section.',
  '- Pick a typeface on purpose, at most two families. Not Inter, Roboto or Arial by default.',
  '- One spacing scale, one radius scale and one type scale, kept in `tokens.css`. No one-off values.',
  '- Real copy from the brief: no lorem ipsum, no made-up stats, logos or testimonials.',
  '- No emoji as icons. Use inline SVG.',
  '- Contrast at least WCAG AA, a visible focus ring, a label on every input.',
  '- One responsive file per screen, never a copy per device.',
  '- Show loading, empty and error states wherever data appears.',
  '- Everything opens offline.',
];

export type AgentGuideInput = { root: string; platform: NodeJS.Platform };

/** The guide at `<root>/AGENTS.md` (§4), marker on line 1 with its hash filled in. */
export const buildAgentGuide = ({ root, platform }: AgentGuideInput): string => {
  assertRoot(root);
  const sep = platform === 'win32' ? '\\' : '/';
  const designFolder = joinWith(sep, root, '<slug>') + sep;
  const lines = [
    guideMarkerLine(OWNERSHIP_PLACEHOLDER),
    '# Designs folder (Design Chamber)',
    '',
    `This folder, ${code(root)}, is the user's designs folder for Design Chamber, the design viewer inside OpenChamber. ` +
      'The user sets it in Design Chamber settings (the default is `~/Documents/Designs`). Designs saved anywhere else do not show up.',
    '',
    '## One folder per design',
    '',
    `- Every design is its own folder: ${code(designFolder)}. Never save a design as a loose file in this folder.`,
    '- The slug uses lower-case letters, digits and hyphens, starts with a letter or digit, and is at most 63 characters (for example `pricing-page`).',
    '- Pick a new slug for a new design. Never reuse or edit another design\'s folder unless the user asks you to.',
    '',
    '## Page or canvas',
    '',
    '- A **page** is one `index.html`, shown full screen like a browser tab.',
    '- A **canvas** is a wall of screens, each one shown at several device sizes side by side, like Claude Design. Each screen is `screens/<id>.html`.',
    '- Make a canvas when the user says canvas, or when the work has several screens, steps or boards.',
    '- A very tall page made of board-like sections works better as a canvas with one screen per board.',
    '',
    '## Write order',
    '',
    '1. Create the design folder.',
    '2. Write `design.json` first.',
    '3. Then the HTML: `index.html` for a page, one `screens/<id>.html` per screen for a canvas.',
    '4. Then `tokens.css`, `DESIGN.md` and anything in `assets/`.',
    '',
    'design.json for a page:',
    '',
    ...PAGE_EXAMPLE,
    '',
    'design.json for a canvas:',
    '',
    ...CANVAS_EXAMPLE,
    '',
    'Set `updated` to the current time whenever you change the design. When design.json already exists, change only ' +
      '`title`, `updated`, `viewports`, `screens` and `designSystem`, and keep every other key as it is.',
    '',
    '## Works offline',
    '',
    '- No CDNs, no Google Fonts or other web fonts, no remote images or scripts. The viewer blocks anything from the internet.',
    '- Put fonts in `assets/fonts/` and load them with `@font-face`. End every font stack with a generic family such as `sans-serif`.',
    '',
    '## Relative paths only',
    '',
    '- From `index.html`: `assets/photo.png`, `tokens.css`.',
    '- From `screens/`: `../assets/photo.png`, `../tokens.css`.',
    '- No absolute paths, no `file://`, no drive letters.',
    '',
    '## Leave these alone',
    '',
    'Never touch `.versions/`, `.chamber/`, `.thumb.png` or `.trash/`. Design Chamber keeps versions, comments and thumbnails there.',
    '',
    '## Design rules',
    '',
    'When the user\'s message starts with `/design` or `/page`, follow the instructions attached to it and the design\'s `.chamber/RULES.md`. ' +
      'Without them, follow this file and these short rules:',
    '',
    ...RULES_DIGEST,
    '',
    'When the user wants the full rules for a fresh design, suggest starting with `/design <brief>` for a canvas or `/page <brief>` for a page.',
    '',
    '## About this file',
    '',
    'Design Chamber wrote this file and keeps it up to date. If you edit it, Design Chamber stops updating it.',
    '',
  ];
  return capped(withOwnershipHash(lines.join('\n')), GUIDE_TEXT_MAX, 'guide');
};

export type RetiredGuideInput = { oldRoot: string; newRoot: string };

/** What our guide in a previous root becomes after a root change: still ours, so switching back restores the full guide. */
export const buildRetiredGuide = ({ oldRoot, newRoot }: RetiredGuideInput): string => {
  assertRoot(oldRoot, 'old designs folder');
  assertRoot(newRoot);
  const lines = [
    guideMarkerLine(OWNERSHIP_PLACEHOLDER),
    `Design Chamber now saves designs in ${code(newRoot)}.`,
    'Save new designs there.',
    `The designs in this folder (${code(oldRoot)}) stay where they are.`,
    '',
  ];
  return capped(withOwnershipHash(lines.join('\n')), GUIDE_TEXT_MAX, 'guide');
};

export type SkillDocInput = { root: string; guidePath: string };

/** `SKILL.md` of the `design-chamber` OpenCode skill (§5.1). Paths sit in the body, never in the frontmatter. */
export const buildSkillDoc = ({ root, guidePath }: SkillDocInput): string => {
  assertRoot(root);
  assertRoot(guidePath, 'guide');
  const sep = separatorOf(root);
  const designFolder = joinWith(sep, root, '<slug>') + sep;
  const lines = [
    '---',
    `name: ${SKILL_NAME}`,
    `description: ${JSON.stringify(capped(SKILL_DESCRIPTION, SKILL_DESCRIPTION_MAX, 'skill description'))}`,
    'metadata:',
    `  generator: ${SKILL_NAME}`,
    '  version: "1"',
    `  sha256: "${OWNERSHIP_PLACEHOLDER}"`,
    '---',
    '',
    '# Designs for Design Chamber',
    '',
    `The user's designs folder is ${code(root)}. Design Chamber shows what is saved there inside OpenChamber.`,
    '',
    `Read ${code(guidePath)} first and follow it. If it is missing, follow these points:`,
    '',
    `- Every design is its own folder, ${code(designFolder)}, never a loose file. The slug uses lower-case letters, digits and hyphens, ` +
      'starts with a letter or digit and is at most 63 characters. Use a new slug, and never edit another design\'s folder unless the user asks.',
    '- A page is one `index.html` shown full screen. A canvas is a wall of screens (`screens/<id>.html`) shown at several device sizes side by side. ' +
      'Make a canvas when the user says canvas or the work has several screens or boards. A very tall page of board-like sections fits better as a canvas.',
    '- Write `design.json` first, then the HTML, then `tokens.css`, `DESIGN.md` and `assets/`. design.json holds `"version": 1`, `"kind"` ' +
      '(`"page"` or `"canvas"`), `"title"`, `"updated"`, `"viewports"`, and `"screens"` for a canvas. In an existing design.json change only ' +
      '`title`, `updated`, `viewports`, `screens` and `designSystem`.',
    '- Work offline: no CDNs, no Google Fonts or other web fonts, no remote images or scripts. Fonts go in `assets/fonts/` with `@font-face`, ' +
      'and every font stack ends with a generic family.',
    '- Relative paths only: `assets/x.png`, and `../tokens.css` from `screens/`.',
    '- Never touch `.versions/`, `.chamber/`, `.thumb.png` or `.trash/`.',
    '',
    'If the user wants a fresh design with the full rules, suggest `/design <brief>` for a canvas or `/page <brief>` for a page.',
    '',
  ];
  return capped(withOwnershipHash(lines.join('\n')), SKILL_TEXT_MAX, 'skill');
};

/** The lines Settings offers to paste into a project's or the global `AGENTS.md` (§5.3). */
export const buildAgentsSnippet = (root: string): string => {
  assertRoot(root);
  const guide = joinWith(separatorOf(root), root, GUIDE_FILE);
  const text = [
    '## Designs (Design Chamber)',
    `When I ask for a design, mockup, page or canvas, save it in my designs folder: ${root}`,
    `Read ${guide} first and follow it. Each design is its own folder there, never a loose`,
    '.html file. Write design.json first, then the HTML. Work offline: no CDNs, no Google Fonts.',
  ].join('\n');
  return capped(text, AGENTS_SNIPPET_MAX, 'AGENTS.md snippet');
};

