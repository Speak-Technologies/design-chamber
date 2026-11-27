// Visual harness only: an in-memory design systems book (Phase 2.5 U1) behind the `/systems`, `/system-scans`, `/uploads` and
// brand-file routes, with hooks so a scenario can seed the list, make it fail, slow the scan, refuse a file or make the
// agent request fail. The real rules (names, caps, file checks, scans) are the service's (test/service/systems/*.test.ts);
// this answers the same shapes with the same sentences for the screens.

import type {
  AddSystemAssetResponse,
  AssetsFromFolderResponse,
  CodeResyncReview,
  LivingPageResponse,
  LocationView,
  RevealBody,
  CreateSystemResponse,
  CreateUploadResponse,
  DeleteSystemResponse,
  OkResponse,
  PatchSystemBody,
  PatchSystemResponse,
  PutUploadChunkResponse,
  RegisterSystemBody,
  ScanSummary,
  SystemCandidate,
  SystemListResponse,
  SystemResyncBody,
  SystemResyncResponse,
  SystemPromptResponse,
  SystemBuildTicketResponse,
  SystemChipBody,
  SystemChipResponse,
  SystemScanResponse,
  CreateSystemScanResponse,
  RenderChunkResponse,
  RenderMeta,
  RestoreVersionResponse,
  SystemEditRequest,
  SystemEditResponse,
  SystemUndoEditResponse,
  VersionDiffResponse,
  VersionListResponse,
  OkResponse as Ok,
} from '../../../src/shared/api.ts';
import { CHIP_PROVIDER_ID, type ChangeEvent, type RepoResyncReview, type SystemChangeKind, type SystemDetail, type SystemScreen, type SystemSection, type SystemSummary, type SystemToken, type VersionSummary } from '../../../src/shared/types.ts';
import { SYSTEM_NAME_MAX, SYSTEMS_MAX } from '../../../src/shared/limits.ts';
import { sameDirectory } from '../../../src/shared/path-compare.ts';
import { resyncStampOf } from '../../../src/shared/system-json.ts';
import { ServiceError } from './service-error.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

const SHOP = 'C:\\Users\\you\\work\\shop';
const TIDEPOOL = 'C:\\Users\\you\\work\\tidepool-web';
const JUNIPER = 'C:\\Users\\you\\work\\juniper-site';

const none: SystemSummary['sources'] = { code: null, brand: 0, description: false };

const blank = (over: Partial<SystemSummary> & Pick<SystemSummary, 'id' | 'name'>): SystemSummary => ({
  status: 'draft',
  changesToReview: false,
  sources: none,
  created: '2026-01-01T00:00:00Z',
  swatches: [],
  usedBy: 0,
  isDefault: false,
  pinnedFor: [],
  updated: ago(HOUR),
  revision: 1,
  empty: false,
  unreadable: null,
  home: 'internal',
  building: false,
  sharedRepoWith: null,
  livingPage: null,
  proposalWaiting: false,
  depth: null,
  ...over,
});

/** The five systems of the 360 px mockup: every badge, the folding, the shared-repo notice. */
export const sampleSystems = (): SystemSummary[] => [
  blank({
    id: 'tidepool',
    name: 'Tidepool',
    depth: 'core',
    swatches: ['#0f766e', '#134e4a', '#f59e0b', '#ccfbf1', '#f0fdfa'],
    status: 'ready',
    changesToReview: true,
    isDefault: true,
    pinnedFor: [SHOP],
    usedBy: 4,
    updated: ago(2 * HOUR),
    revision: 9,
    home: { repo: 'tidepool-web', directory: TIDEPOOL },
    sources: { code: { directory: TIDEPOOL, lastScan: ago(DAY), partial: false }, brand: 0, description: false },
  }),
  blank({ id: 'acme', name: 'Acme', status: 'draft', building: true, updated: ago(MINUTE / 2), home: { repo: 'tidepool-web', directory: TIDEPOOL }, sharedRepoWith: 'Tidepool' }),
  blank({
    id: 'harbor',
    name: 'Harbor',
    depth: 'full',
    swatches: ['#1d4ed8', '#0f172a', '#e11d48', '#dbeafe'],
    status: 'ready',
    changesToReview: true,
    pinnedFor: [SHOP],
    usedBy: 2,
    updated: ago(DAY),
    revision: 4,
    sources: { code: null, brand: 3, description: true },
  }),
  blank({ id: 'field-notes', name: 'Field notes', swatches: ['#7c2d12', '#1c1917', '#d6d3d1'], status: 'ready', usedBy: 1, updated: ago(3 * DAY), revision: 2, sources: { code: null, brand: 0, description: true } }),
  blank({
    id: 'juniper',
    name: 'Juniper',
    swatches: ['#15803d', '#052e16', '#fbbf24', '#dcfce7', '#fafaf9', '#78716c'],
    status: 'ready',
    pinnedFor: [SHOP],
    usedBy: 6,
    updated: ago(8 * DAY),
    revision: 12,
    home: { repo: 'juniper-site', directory: JUNIPER },
    livingPage: 'out-of-date',
    sources: { code: { directory: JUNIPER, lastScan: ago(9 * DAY), partial: true }, brand: 1, description: false },
  }),
];

/** What a scan of a real app finds (the spec's own example sentence). */
export const sampleScan = (directory: string): ScanSummary => ({
  directory,
  counts: { colours: 48, typography: 9, spacing: 12, radius: 4, shadows: 3, motion: 0, layers: 0, sizes: 0, other: 0, fonts: 3, logos: 2 },
  files: Array.from({ length: 14 }, (_, n) => ({ path: n < 3 ? `src/styles/tokens-${n + 1}.css` : `src/components/part-${n}.module.css`, found: 20 - n })),
  skipped: [{ path: 'public/bundle.min.css', reason: 'larger than 1 MB' }],
  assets: [
    { path: 'public/fonts/Inter-Regular.woff2', kind: 'font', bytes: 98_000, family: 'Inter', weight: 400, style: 'normal' },
    { path: 'public/fonts/Inter-SemiBold.woff2', kind: 'font', bytes: 101_000, family: 'Inter', weight: 600, style: 'normal' },
    { path: 'public/fonts/Inter-Bold.woff2', kind: 'font', bytes: 103_000, family: 'Inter', weight: 700, style: 'normal' },
    { path: 'public/logo-mark.svg', kind: 'logo', bytes: 2400 },
    { path: 'public/logo-wordmark.svg', kind: 'logo', bytes: 5100 },
  ],
  forAgent: [
    { path: 'tailwind.config.js', why: 'A JavaScript theme Design Chamber does not run.' },
    { path: 'src/theme.ts', why: 'A JavaScript theme Design Chamber does not run.' },
  ],
  refused: 1,
  partial: false,
  // Phase 2.6 E2: the real read count (14 files held values, 4 more were read with none) and what was missed.
  read: 18,
  missed: { pages: 12, components: 40, codeThemes: 2 },
});

const EMPTY_SCAN = (directory: string): ScanSummary => ({
  directory,
  counts: { colours: 0, typography: 0, spacing: 0, radius: 0, shadows: 0, motion: 0, layers: 0, sizes: 0, other: 0, fonts: 0, logos: 0 },
  files: [],
  skipped: [],
  assets: [],
  forAgent: [],
  refused: 0,
  partial: false,
  read: 0,
  missed: { pages: 0, components: 0, codeThemes: 0 },
});

// ---- Phase 2.6 E2 (visual): discovery candidates, location scans, "Register it as it is" ----
// The shapes and sentences mirror the service (src/service/systems/{candidates,scan-folder,extract,register}.ts);
// the real rules are tested there. Paths drive the answers, as the rest of this fake does.

const baseName = (directory: string): string => directory.split(/[\\/]+/).filter((part) => part !== '').pop() ?? directory;

/** The four places the approved canvas draws, ranked as the service ranks them (contract first). */
const sampleCandidates = (): SystemCandidate[] => [
  { path: 'design-system', marks: ['contract', 'page', 'tokens', 'docs', 'components'], counts: { colours: 24, tokens: 29, docs: 3, components: 14, pages: 1 }, strong: true, registered: null },
  { path: 'apps/web/design-system', marks: ['page', 'components'], counts: { colours: 0, tokens: 0, docs: 0, components: 14, pages: 1 }, strong: true, registered: { id: 'juniper', name: 'Juniper' } },
  { path: 'packages/ui/tokens', marks: ['tokens'], counts: { colours: 79, tokens: 143, docs: 0, components: 0, pages: 0 }, strong: false, registered: null },
  { path: 'docs/design', marks: ['docs'], counts: { colours: 0, tokens: 0, docs: 2, components: 0, pages: 0 }, strong: false, registered: null },
];

const COMPONENT_PATHS = Array.from({ length: 14 }, (_, n) => `design-system/components/${['Button', 'Card', 'Field', 'Tabs', 'Badge', 'Banner', 'Dialog', 'Menu', 'Table', 'Toast', 'Nav', 'Footer', 'Hero', 'Grid'][n]}.tsx`);

/** A location scan's answer, by the folder scanned: the complete contract, an incomplete one, docs only, tokens only. */
const locationSummary = (directory: string, location: { project: string; rel: string }): ScanSummary => {
  const { rel } = location;
  const view = (over: Partial<LocationView> & Pick<LocationView, 'marks' | 'read' | 'contract'>): LocationView => ({ path: rel, ...over });
  if (rel === 'design-system' || rel === 'full-system') {
    return {
      directory,
      counts: { colours: 24, typography: 2, spacing: 0, radius: 0, shadows: 3, motion: 0, layers: 0, sizes: 0, other: 0, fonts: 1, logos: 0 },
      // Paths here are relative to the scanned folder, as the service's walk reports them; location.read is project-relative.
      files: [
        { path: 'tokens.css', found: 18 },
        { path: 'system.json', found: 7 },
        { path: 'theme.css', found: 2 },
        { path: 'components.css', found: 2 },
      ],
      skipped: [{ path: 'bundle.css', reason: "It's larger than 1 MB, so it wasn't read." }],
      assets: [{ path: 'fonts/SpeakSans-Regular.woff2', kind: 'font', bytes: 96_000, family: 'Speak Sans', weight: 400, style: 'normal' }],
      forAgent: [],
      refused: 0,
      partial: false,
      read: 6,
      missed: { pages: 1, components: 14, codeThemes: 0 },
      location: view({
        marks: ['contract', 'page', 'tokens', 'docs', 'components'],
        read: { page: ['design-system/index.html'], docs: ['design-system/DESIGN.md', 'design-system/notes/voice.md', 'design-system/notes/motion.md'], components: COMPONENT_PATHS },
        contract: { complete: true },
      }),
    };
  }
  if (/incomplete|style-guide/i.test(rel)) {
    return {
      directory,
      counts: { colours: 8, typography: 0, spacing: 0, radius: 0, shadows: 0, motion: 0, layers: 0, sizes: 0, other: 0, fonts: 0, logos: 0 },
      files: [{ path: 'tokens.css', found: 8 }],
      skipped: [],
      assets: [],
      forAgent: [],
      refused: 0,
      partial: false,
      read: 2,
      missed: { pages: 0, components: 0, codeThemes: 0 },
      location: view({ marks: ['tokens', 'docs'], read: { page: [], docs: [`${rel}/DESIGN.md`], components: [] }, contract: { complete: false, missing: ['tokens.css'] } }),
    };
  }
  if (rel === 'docs/design') {
    return {
      ...EMPTY_SCAN(directory),
      location: view({ marks: ['docs'], read: { page: [], docs: ['docs/design/DESIGN.md', 'docs/design/voice.md'], components: [] }, contract: null }),
    };
  }
  if (rel === 'packages/ui/tokens') {
    return {
      directory,
      counts: { colours: 79, typography: 0, spacing: 0, radius: 0, shadows: 0, motion: 0, layers: 0, sizes: 64, other: 0, fonts: 0, logos: 0 },
      files: [{ path: 'tokens.css', found: 79 }, { path: 'sizes.css', found: 64 }],
      skipped: [],
      assets: [],
      forAgent: [],
      refused: 0,
      partial: false,
      read: 3,
      missed: { pages: 0, components: 0, codeThemes: 0 },
      location: view({ marks: ['tokens'], read: { page: [], docs: [], components: [] }, contract: null }),
    };
  }
  if (rel === '') {
    // The project root reads like Project code, but a repo home needs a folder of its own.
    return {
      ...sampleScan(directory),
      location: view({ marks: ['page', 'tokens', 'docs'], read: { page: ['index.html'], docs: ['DESIGN.md'], components: [] }, contract: { complete: false, missing: ['a folder inside the project'] } }),
    };
  }
  return {
    directory,
    counts: { colours: 6, typography: 0, spacing: 0, radius: 0, shadows: 0, motion: 0, layers: 0, sizes: 0, other: 0, fonts: 0, logos: 0 },
    files: [{ path: 'tokens.css', found: 6 }],
    skipped: [],
    assets: [],
    forAgent: [],
    refused: 0,
    partial: false,
    read: 1,
    missed: { pages: 0, components: 0, codeThemes: 0 },
    location: view({ marks: ['tokens'], read: { page: [], docs: [], components: [] }, contract: null }),
  };
};

/** The service's location validation, disk-free: a web address, an escape from the project, a folder that isn't there. */
const fakeLocation = (raw: string, project: string): { rel: string } => {
  const value = raw.trim();
  if (value === '') throw new ServiceError('bad-path', 'Choose a folder.');
  if (/^[a-z][a-z0-9+.-]+:\/\//i.test(value) || /^www\./i.test(value) || /^localhost(:\d+)?(\/|$)/i.test(value)) {
    throw new ServiceError('bad-path', 'Use the folder on this machine, not a web address.');
  }
  const inside = `Pick a folder inside ${baseName(project)}.`;
  let rel: string;
  if (/^([A-Za-z]:[\\/]|\/|\\\\)/.test(value)) {
    const norm = value.replace(/\\/g, '/').replace(/\/+$/, '');
    const proj = project.replace(/\\/g, '/').replace(/\/+$/, '');
    if (norm.toLowerCase() !== proj.toLowerCase() && !norm.toLowerCase().startsWith(`${proj.toLowerCase()}/`)) throw new ServiceError('bad-path', inside);
    rel = norm.slice(proj.length).replace(/^\//, '');
  } else {
    const stack: string[] = [];
    for (const part of value.split(/[\\/]+/).filter((part) => part !== '')) {
      if (part === '.') continue;
      if (part === '..') {
        if (stack.length === 0) throw new ServiceError('bad-path', inside);
        stack.pop();
      } else stack.push(part);
    }
    rel = stack.join('/');
  }
  if (/missing|gone/i.test(rel)) throw new ServiceError('bad-path', `Design Chamber can't read ${value}. It doesn't exist.`);
  return { rel };
};
// ---- end Phase 2.6 E2 ----

/** What a re-read of the project finds against a filled-in system: two modes of a colour, a conflict, new and gone tokens, new files. */
const SAMPLE_REVIEW: CodeResyncReview = {
  kind: 'code',
  changed: [
    { name: '--brand', mode: 'light', from: '#2f6f6a', to: '#0b6e66' },
    { name: '--brand', mode: 'dark', from: '#6fc2ba', to: '#4fd1c5' },
    { name: '--surface', mode: 'light', from: '#fbfaf7', to: '#f6f4ee' },
    { name: '--space-4', mode: 'light', from: '16px', to: '20px' },
    { name: '--radius-md', mode: 'light', from: '10px', to: '12px' },
  ],
  conflicts: [{ name: '--text-muted', mode: 'light', mine: '#5d6a68', code: '#4a5755' }],
  added: ['--accent', '--space-8'],
  removed: ['--danger', '--space-6'],
  assets: [
    { path: 'public/fonts/Inter-Italic.woff2', kind: 'font' },
    { path: 'public/logo-dark.svg', kind: 'logo' },
  ],
  partial: false,
};
const SAMPLE_REPO_REVIEW: RepoResyncReview = {
  kind: 'repo',
  directory: TIDEPOOL,
  directoryChanged: false,
  folderFound: true,
  tokens: {
    changed: [
      { name: '--brand', mode: 'light', from: '#2f6f6a', to: '#2a6b66' },
      { name: '--brand', mode: 'dark', from: '#6fc2ba', to: '#7ad0c7' },
      { name: '--text-muted', mode: 'light', from: '#5d6a68', to: '#566361' },
    ],
    added: ['--accent', '--space-8'],
    removed: ['--danger'],
    totals: { changed: 3, added: 2, removed: 1 },
  },
  files: { changed: ['design-system/overview.md', 'design-system/notes/voice.md'], added: ['design-system/notes/motion.md'], removed: [] },
  livingPageFound: true,
  refused: 0,
  skipped: [{ path: 'design-system/fonts/Inter-Black.woff2', reason: 'larger than 1 MB' }],
};
const ADDED_VALUES: Record<string, string> = { '--accent': '#d9822b', '--space-8': '32px' };

const LIVING_SENTENCE: Record<NonNullable<SystemSummary['livingPage']>, string> = {
  fresh: 'Generated from revision 7, the current one.',
  'out-of-date': 'Generated from revision 5; the system is at revision 7.',
  missing: 'No living page in the repo yet.',
  changed: 'The page in the repo differs from the one Design Chamber generated.',
  reformatted: 'The living page may have been reformatted since it was generated.',
  unsafe: 'The living page has markup Design Chamber didn’t generate and can’t check as safe.',
  unreadable: 'Design Chamber can’t read the living page.',
};

const SECTIONS: readonly SystemSection[] = ['overview', 'colours', 'typography', 'spacing', 'radius', 'shadows', 'motion', 'layers', 'sizes', 'components', 'patterns', 'brand', 'assets'];

const detailOf = (summary: SystemSummary): SystemDetail => ({
  id: summary.id,
  name: summary.name,
  path: `C:\\Users\\you\\Documents\\Designs\\_systems\\${summary.id}`,
  status: summary.status,
  revision: summary.revision,
  created: summary.updated,
  updated: summary.updated,
  sessionId: null,
  sources: summary.sources,
  review: Object.fromEntries(SECTIONS.map((section) => [section, { state: 'not-reviewed' as const, note: null }])) as SystemDetail['review'],
  changesToReview: summary.changesToReview,
  overview: null,
  notes: [],
  tokens: [],
  type: [],
  fonts: [],
  logos: [],
  sourceFiles: [],
  components: [],
  problems: [],
  unreadable: summary.unreadable,
  stamps: { tokens: null, systemJson: null, overview: null, notes: {} },
  usedBy: summary.usedBy,
  isDefault: summary.isDefault,
  pinnedFor: summary.pinnedFor,
  empty: summary.empty,
  home: { kind: 'internal' },
  editable: true,
  build: null,
  buildProblem: null,
  coverage: ['foundations', 'components', 'patterns', 'brand'],
  patterns: [],
  brand: [],
  snapshot: null,
  codeDrift: null,
  livingPage: null,
  proposal: null,
  landed: null,
  agentDrift: null,
  boardLayout: { sections: {}, ignored: [], ignoredCount: 0 },
  depth: null,
  pairs: [],
  outOfScope: [],
  icons: [],
  screens: [],
  viewports: [{ id: 'laptop', label: 'Laptop', width: 1280, height: 800 }, { id: 'phone', label: 'Phone', width: 390, height: 844 }],
});


const tok = (name: string, section: SystemToken['section'], group: SystemToken['group'], light: string, dark: string | null = null, note = ''): SystemToken => ({
  name,
  section,
  group,
  light: { text: light, editable: light.startsWith('var(') ? 'formula' : 'ok', problem: null },
  dark: dark === null ? null : { text: dark, editable: 'ok', problem: null },
  note,
  breakpoint: false,
  alsoSet: [],
  fromCode: false,
  problem: null,
});

/** What a filled-in system looks like: colours in groups with dark values and a formula, type, spacing, two components, notes. */
const fillIn = (detail: SystemDetail, coverage: SystemDetail['coverage']): void => {
  detail.empty = false;
  detail.coverage = coverage;
  detail.overview = { text: `${detail.name} is calm and a little warm. Rounded corners, one strong accent, generous space.`, problem: null };
  detail.tokens = [
    tok('--brand', 'colours', 'brand', '#2f6f6a', '#6fc2ba', 'The main accent. Use it for the one action on a screen.'),
    tok('--brand-strong', 'colours', 'brand', 'var(--brand)', null),
    tok('--surface', 'colours', 'surface', '#fbfaf7', '#17191b', 'The page behind everything.'),
    tok('--surface-raised', 'colours', 'surface', '#ffffff', '#202326'),
    tok('--text', 'colours', 'text', '#1d2423', '#eef2f1'),
    tok('--text-muted', 'colours', 'text', '#5d6a68', '#a4b0ae', 'Captions and hints only.'),
    tok('--border', 'colours', 'border', '#d9dfdc', '#34393b'),
    tok('--danger', 'colours', 'status', '#b3402f', '#f08a7a'),
    tok('--space-2', 'spacing', null, '8px'),
    tok('--space-4', 'spacing', null, '16px', null, 'Default gap between related items.'),
    tok('--space-6', 'spacing', null, '24px'),
    tok('--radius-md', 'radius', null, '10px'),
    tok('--shadow-card', 'shadows', null, '0 1px 2px rgb(0 0 0 / 0.08)'),
  ];
  detail.type = [
    { id: 'heading', name: 'Heading', family: 'Inter, sans-serif', size: '28px', weight: '650', lineHeight: '1.2', letterSpacing: '-0.01em', case: 'none', note: 'One per page.' },
    { id: 'body', name: 'Body', family: 'Inter, sans-serif', size: '16px', weight: '400', lineHeight: '1.5', letterSpacing: '0', case: 'none', note: '' },
  ];
  detail.components = [
    { id: 'button', name: 'Button', purpose: 'Starts or confirms one action.', note: '', variants: ['Filled', 'Outline', 'Ghost'], sizes: [], states: ['Hover', 'Disabled', 'Loading'], tokens: ['--brand', '--radius-md'], source: 'src/ui/Button.tsx', example: null, undefinedTokens: [], layout: null },
    { id: 'card', name: 'Card', purpose: 'Groups related content on a raised surface.', note: 'Never nest a card in a card.', variants: ['Plain'], sizes: [], states: [], tokens: ['--surface-raised', '--border'], source: null, example: null, undefinedTokens: ['--card-pad'], layout: null },
  ];
  detail.notes = [{ id: 'accessibility', title: 'Accessibility', text: 'Text keeps 4.5 to 1 contrast on its background.', problem: null, layout: null }];
  detail.patterns = [{ id: 'forms', kind: 'pattern', title: 'Forms', note: '', text: 'Labels sit above fields. Errors sit under the field in plain words.', problem: null, layout: null, example: null }];
  detail.brand = [{ id: 'voice', kind: 'voice', title: 'Voice', note: '', text: 'Plain and warm. Short sentences.', problem: null, layout: null, example: null }];
  detail.fonts = [{ file: 'inter.woff2', family: 'Inter', weight: 400, style: 'normal' }];
  detail.logos = [{ file: 'mark.svg', variant: 'Mark', note: 'Use on light surfaces.' }];
  detail.stamps = { tokens: 'tk:1', systemJson: 'sj:1', overview: 'ov:1', notes: { accessibility: 'nt:1' } };
};

/**
 * What system-builder-depth adds (T4): sizes, the new kinds, colour pairs and the depth. Tidepool is a core system that
 * left two topics out; Harbor is a full one. Every other system stays as an older one: none of these fields set.
 * The pairs cover each state the panel draws: a pair that passes, one that is too low, a formula Node can't read
 * ("Measured by the check"), an oklch() pair it can't parse but the sample still draws, and the automatic ones.
 */
const deepen = (detail: SystemDetail, flavour: 'core' | 'full'): void => {
  detail.depth = flavour;
  detail.tokens.push(
    tok('--brand-fg', 'colours', 'brand', '#ffffff', '#0b1f1d', 'Text on the brand colour.'),
    tok('--accent', 'colours', 'brand', 'oklch(0.55 0.12 190)', 'oklch(0.8 0.1 190)'),
    tok('--on-accent', 'colours', 'brand', '#ffffff', '#08201e'),
  );
  detail.pairs = [
    { fg: '--text', bg: '--surface', use: 'text', note: 'Body copy on the page.', auto: false },
    { fg: '--text-muted', bg: '--surface-raised', use: 'text', note: '', auto: false },
    { fg: '--border', bg: '--surface', use: 'ui', note: 'Card edges. Pair it with a shadow where the edge must read.', auto: false },
    { fg: '--brand-strong', bg: '--surface', use: 'large', note: '', auto: false },
    { fg: '--brand-fg', bg: '--brand', use: 'text', note: '', auto: true },
    { fg: '--on-accent', bg: '--accent', use: 'text', note: '', auto: true },
  ];
  const button = detail.components.find((component) => component.id === 'button');
  if (button) button.sizes = ['Small', 'Medium', 'Large'];
  if (flavour === 'core') {
    detail.outOfScope = ['motion', 'marketing', 'data-display'];
    detail.patterns = [
      { id: 'forms', kind: 'forms', title: 'Forms', note: '', text: 'Labels sit above fields. Errors sit under the field in plain words.', problem: null, layout: null, example: null },
      { id: 'top-bar', kind: 'navigation', title: 'Top bar and bottom bar', note: '', text: 'A top bar on a laptop, a bottom bar on a phone.', problem: null, layout: null, example: { remote: [] } },
    ];
    detail.brand = [
      { id: 'voice', kind: 'voice', title: 'Voice', note: '', text: 'Plain and warm. Short sentences.', problem: null, layout: null, example: null },
      { id: 'palette', kind: 'colour', title: 'Marketing palette', note: '', text: 'Teal leads. Amber is for one highlight per page.', problem: null, layout: null, example: null },
    ];
  } else {
    detail.outOfScope = [];
    detail.patterns = [
      { id: 'sheets', kind: 'overlay', title: 'Sheets and modals', note: '', text: 'A bottom sheet on a phone, a centred modal on a laptop.', problem: null, layout: null, example: null },
      { id: 'empty', kind: 'states', title: 'Screen states', note: '', text: 'Say what goes here and how to add it.', problem: null, layout: null, example: null },
      { id: 'tables', kind: 'data-display', title: 'Tables', note: '', text: 'Right-align numbers. Keep the header in view.', problem: null, layout: null, example: null },
    ];
    detail.brand = [
      { id: 'social', kind: 'social', title: 'Social cards', note: '', text: 'One headline, one mark, no photos.', problem: null, layout: null, example: null },
      { id: 'mail', kind: 'email', title: 'Email', note: '', text: 'Plain text first, one button.', problem: null, layout: null, example: null },
    ];
  }
};

/** T10c: a full system's motion tokens (one a formula) and icons (one the board can't draw). */
const addMotionAndIcons = (detail: SystemDetail): void => {
  detail.tokens.push(
    tok('--duration-fast', 'motion', null, '120ms', null, 'Hover and press.'),
    tok('--duration-slow', 'motion', null, '0.3s'),
    tok('--ease-standard', 'motion', null, 'cubic-bezier(0.2, 0, 0, 1)', null, 'Everything that moves on screen.'),
    tok('--ease-out', 'motion', null, 'ease-out'),
    tok('--motion-sheet', 'motion', null, 'var(--duration-slow)'),
  );
  detail.icons = [
    { file: 'assets/icons/search.svg', name: 'Search', note: 'Top bar and filter fields.' },
    { file: 'assets/icons/orders.svg', name: 'Orders', note: '' },
    { file: 'assets/icons/anchor.svg', name: 'Anchor', note: '' },
    { file: 'assets/icons/navigation-chevron-double-right-small-outline.svg', name: 'Chevron double right, small outline', note: '' },
    { file: 'assets/icons/wave-detailed.svg', name: 'Wave, detailed', note: '' },
  ];
};

const ICON_SHAPES = ['<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>', '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>', '<circle cx="12" cy="5" r="2"/><path d="M12 7v13M5 13a7 7 0 0 0 14 0"/>', '<path d="M6 6l6 6-6 6M13 6l6 6-6 6"/>'];

/** The icon grid the way the service's board bundles it: each icon only as an `<img>` of a data URL. The last one is left out, as a file too large to draw is. */
const fakeIconGrid = (detail: SystemDetail): string => {
  if (detail.icons.length === 0) return '';
  const cards = detail.icons.map((icon, index) => {
    const shape = ICON_SHAPES[index];
    const picture = shape === undefined ? '' : `<img class="dc-icon dc-icon-current" style="width:32px;height:32px" src="data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${shape}</svg>`)}" alt="">`;
    return `<div class="dc-card" data-dc-entry="icon:${index}">${picture}<div>${icon.name}</div></div>`;
  });
  return `<h2>Assets</h2><div class="dc-grid dc-icons">${cards.join('')}</div>`;
};

/**
 * T13: the full system's screens. A page template at the system's two sizes, a state at the phone only, a marketing card
 * at its own fixed size, and one entry the reader refused (its file is missing), so the Screens view shows each case.
 */
export const sampleScreens = (): SystemScreen[] => [
  { id: 'dashboard', title: 'Dashboard', kind: 'page', viewports: null, problem: null, source: null },
  { id: 'orders-empty', title: 'No orders yet', kind: 'state', viewports: [{ id: 'phone', label: 'Phone', width: 390, height: 844 }], problem: null, source: null },
  { id: 'launch-card', title: 'Launch card', kind: 'marketing', viewports: [{ id: 'social', label: 'Social card', width: 1200, height: 630 }], problem: null, source: null },
  { id: 'checkout', title: 'Checkout', kind: 'page', viewports: null, problem: 'screens/checkout.html is missing.', source: null },
];

/** A screen document like an agent writes one: its own tokens, with dark values under `prefers-color-scheme`. */
const screenHtml = (screen: SystemScreen): string => {
  const css = `:root{--surface:#fbfaf7;--raised:#fff;--text:#1d2423;--muted:#5d6a68;--brand:#2f6f6a;--border:#d9dfdc}
@media (prefers-color-scheme: dark){:root{--surface:#17191b;--raised:#202326;--text:#eef2f1;--muted:#a4b0ae;--brand:#6fc2ba;--border:#34393b}}
*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--text);font:16px/1.5 system-ui,sans-serif}
header{display:flex;align-items:center;gap:16px;padding:16px 24px;border-bottom:1px solid var(--border);background:var(--raised)}
header b{font-size:18px}nav{display:flex;gap:16px;margin-left:auto;color:var(--muted)}main{padding:24px;display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.card{padding:16px;border:1px solid var(--border);border-radius:10px;background:var(--raised)}.n{font-size:28px;font-weight:650}.m{color:var(--muted);font-size:14px}
.btn{display:inline-block;padding:10px 16px;border-radius:10px;background:var(--brand);color:var(--surface);font-weight:600}
.empty{display:grid;place-items:center;gap:12px;min-height:100vh;padding:32px;text-align:center}
.hero{display:grid;align-content:center;gap:20px;height:100vh;padding:72px;background:var(--brand);color:var(--surface)}.hero h1{margin:0;font-size:64px;line-height:1.05}`;
  const body = screen.kind === 'state'
    ? '<div class="empty"><div class="n">No orders yet</div><p class="m">Orders show here once a customer checks out.</p><span class="btn">Share your shop</span></div>'
    : screen.kind === 'marketing'
      ? '<section class="hero"><h1>Harbor 2.0 is here</h1><p style="font-size:24px;margin:0">Faster checkout, calmer dashboards.</p></section>'
      : '<header><b>Harbor</b><nav><span>Orders</span><span>Products</span><span>Customers</span></nav></header><main><div class="card"><div class="m">Sales today</div><div class="n">1,284</div></div><div class="card"><div class="m">Open orders</div><div class="n">32</div></div><div class="card"><div class="m">Returns</div><div class="n">3</div></div><div class="card"><span class="btn">New product</span></div></main>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${screen.title}</title><style>${css}</style></head><body>${body}</body></html>`;
};

type Req = { params: Record<string, string> };

export type FakeSystems = {
  handlers: {
    'GET /systems': () => SystemListResponse;
    'POST /systems': (req: { body: { name: string; code?: { scanId: string; assets: string[] }; description?: { text: string; preset: string | null }; brand?: true } }) => CreateSystemResponse;
    'PATCH /systems/:id': (req: Req & { body: PatchSystemBody }) => PatchSystemResponse;
    'DELETE /systems/:id': (req: Req) => DeleteSystemResponse;
    'POST /system-scans': (req: { body: { directory: string; systemId?: string; location?: string } }) => CreateSystemScanResponse;
    'GET /system-scans/:scanId': (req: Req) => SystemScanResponse;
    'DELETE /system-scans/:scanId': (req: Req) => OkResponse;
    /** Phase 2.6 E2: register a done location scan's complete contract as a repo-backed Draft. */
    'POST /systems/register': (req: { body: RegisterSystemBody }) => CreateSystemResponse;
    'POST /uploads': (req: { body: { total: number; encoding?: 'text' | 'base64' } }) => CreateUploadResponse;
    'PUT /uploads/:id/:index': (req: Req & { body: { data: string } }) => PutUploadChunkResponse;
    'POST /systems/:id/assets': (req: Req & { body: { uploadId: string; name: string; kind: 'font' | 'logo' | 'source' } }) => AddSystemAssetResponse;
    'POST /systems/:id/assets/from-folder': (req: Req & { body: { directory: string } }) => AssetsFromFolderResponse;
    'POST /systems/:id/prompt': (req: Req & { body: { purpose: string; text?: string; entry?: string; section?: string; before?: string } }) => SystemPromptResponse;
    'POST /systems/chip': (req: { body: SystemChipBody }) => SystemChipResponse;
    'GET /system-builds/:ticket': (req: Req) => SystemBuildTicketResponse;
    'POST /systems/:id/resync': (req: Req & { body: SystemResyncBody }) => SystemResyncResponse;
    'GET /systems/:id/living-page': (req: Req) => LivingPageResponse;
    'GET /systems/:id/living-page/render': (req: Req & { query: { which?: string; scheme?: string } }) => RenderMeta;
    'GET /systems/:id/living-page/render/chunk': (req: Req & { query: { key?: string } }) => RenderChunkResponse;
    'POST /reveal': (req: { body: RevealBody }) => OkResponse;
    'GET /systems/:id': (req: Req) => SystemDetail;
    'POST /systems/:id/edits': (req: Req & { body: SystemEditRequest }) => SystemEditResponse;
    'POST /systems/:id/edits/:eid/undo': (req: Req) => SystemUndoEditResponse;
    'POST /systems/:id/hand-edits/clear': (req: Req) => Ok;
    'GET /systems/:id/board': (req: Req & { query: { version?: string; scheme?: string } }) => RenderMeta;
    'GET /systems/:id/board/chunk': (req: Req & { query: { key?: string } }) => RenderChunkResponse;
    'GET /systems/:id/versions': (req: Req) => VersionListResponse;
    'GET /systems/:id/versions/:vid/diff': (req: Req) => VersionDiffResponse;
    'POST /systems/:id/versions/:vid/restore': (req: Req) => RestoreVersionResponse;
    'GET /systems/:id/screens/render': (req: Req & { query: { screen?: string; version?: string; proposal?: string; scheme?: string } }) => RenderMeta;
    'GET /systems/:id/screens/render/chunk': (req: Req & { query: { key?: string } }) => RenderChunkResponse;
  };
  hooks: {
    /** What `GET /system-builds/:ticket` answers from now on (the build chip's poll); the default is a build that is still waiting. */
    setBuild: (answer: SystemBuildTicketResponse) => void;
    /** The build requests the chip route was asked for and the tickets polled, for a scenario's checks. */
    buildLog: () => { requests: SystemChipBody[]; polls: number };
    /** The list now (no event). */
    seed: (systems: SystemSummary[]) => void;
    /** The book as it is now (the design system link fake reads Ready/draft and revisions from it). */
    current: () => SystemSummary[];
    /** An empty list. */
    clear: () => void;
    /** `GET /systems` answers a failure until `false`. */
    failLoads: (fail: boolean) => void;
    /** One more row whose files can't be read. */
    addUnreadable: () => void;
    /** The agent request answers this sentence instead of the text; `null` goes back to working. */
    failPrompt: (message: string | null) => void;
    /** A scan answers "running" this many more times before it is done. */
    slowScan: (polls: number) => void;
    /** What was made, uploaded and asked, for a scenario's checks. */
    log: () => { created: Array<{ name: string; body: unknown }>; uploads: Array<{ total: number; chunks: number; encoding: string }>; assets: Array<{ name: string; kind: string }>; prompts: number; scanDirectories: string[]; cancelled: number };
    /** The default system as the settings route set it (an id or null). */
    setDefaultId: (id: string | null) => void;
    /** The next save answers "stale", as if the agent had changed a file meanwhile. */
    staleNext: () => void;
    /** The system's linked chat id (or none). */
    setSession: (id: string, sessionId: string | null) => void;
    /** Make the system's detail answer a failure until `false`. */
    failDetail: (fail: boolean) => void;
    /** `GET /systems/:id/board` answers a failure until `false`. */
    failBoard: (fail: boolean) => void;
    /** A system with this coverage (areas), to show the uncovered sentence. */
    setCoverage: (id: string, coverage: SystemDetail['coverage']) => void;
    /** Make the system's detail repo-backed (read only) with this living-page state (`null` = not judged yet). */
    setRepoHome: (id: string, state: NonNullable<SystemSummary['livingPage']> | null) => void;
    /** Change pieces of the system's detail (a shallow merge; `home` merges one level down): banners, drift, landed, snapshot, proposal. */
    patchDetail: (id: string, patch: Record<string, unknown>) => void;
    /** Change pieces of the living-page view a repo-backed system answers (a shallow merge; `staged` merges one level down, `null` clears it). */
    patchLiving: (id: string, patch: Record<string, unknown>) => void;
    /** The review the next repo re-sync scan finds (`null` goes back to the sample). */
    setRepoResync: (review: RepoResyncReview | null) => void;
    /** The reveal requests, for a scenario's checks. */
    revealLog: () => RevealBody[];
    /** What saves, undos, reviews and prompts reached the service. */
    pageLog: () => { saves: SystemEditRequest[]; undos: string[]; reviews: Array<{ section: string; state: string }>; asks: Array<{ purpose: string; text?: string; entry?: string; section?: string; before?: string }>; resyncs: SystemResyncBody[] };
    /** The review the next re-sync scan finds (`null` goes back to the sample). */
    setResync: (review: CodeResyncReview | null) => void;
    /** The next re-sync apply answers "stale", as if a file changed after the scan. */
    staleResyncNext: () => void;
    /** The next re-sync apply answers this sentence (the ticks stay); `null` goes back to working. */
    failResync: (message: string | null) => void;
    /** The folder the system's code source points at (to make the re-sync meet a missing or unreadable one). */
    setCodeFolder: (id: string, directory: string) => void;
    // ---- Phase 2.6 E2 hooks ----
    /** What register was asked to do, for a scenario's checks. */
    registerLog: () => Array<{ name: string; scanId: string; rel: string }>;
    /** The next register answers this sentence (a conflict); `null` goes back to working. */
    failRegister: (message: string | null) => void;
    /** Pieces of the next project scan's summary (candidates, missed, read); applied once, `null` clears. */
    setNextScan: (patch: Partial<ScanSummary> | null) => void;
    // ---- system-builder-depth T13 hooks ----
    /** The system's screens from now on, then a `system` files event for it (the Screens view lays out again). */
    setScreens: (id: string, screens: SystemScreen[]) => void;
    /** The sample screens and a readable system.json again (after a scenario made it unreadable), with a files event. */
    restoreScreens: (id: string) => void;
    /** A `system` files event for the system, as an agent turn sends one (loaded screens draw again). */
    redrawScreens: (id: string) => void;
    /** Screen renders answer a failure until `null` (every screen, or only this id). */
    failScreens: (screen: string | null | true) => void;
    /** The screen renders asked for so far (id, scheme, version), for a scenario's checks. */
    screenLog: () => Array<{ screen: string; scheme: string; version: string | null }>;
  };
};

export const createFakeSystems = (deps: {
  emit: (slug: string | null, kind: ChangeEvent['kind']) => void;
  /** A `system` event with the id and what changed, as the watcher sends it. */
  emitSystem?: (system: string, change: SystemChangeKind) => void;
  /** Systems live under the designs root: a foreign root has none of them (the rows stay, so switching back restores them). */
  visible?: () => boolean;
}): FakeSystems => {
  let screenFailure: string | true | null = null;
  const screenLog: Array<{ screen: string; scheme: string; version: string | null }> = [];
  let rows: SystemSummary[] = sampleSystems();
  let failing = false;
  let boardFailure = false;
  let promptFailure: string | null = null;
  let slowPolls = 2;
  let scanN = 0;
  let uploadN = 0;
  const scans = new Map<string, { directory: string; polls: number; systemId?: string; location?: { project: string; rel: string } }>();
  // Phase 2.6 E2 state: the register log, a one-shot refusal, and a one-shot patch of the next project scan.
  const registerLog: Array<{ name: string; scanId: string; rel: string }> = [];
  let registerFailure: string | null = null;
  let nextScanPatch: Partial<ScanSummary> | null = null;
  const uploads = new Map<string, { total: number; chunks: number; encoding: string }>();
  const log: ReturnType<FakeSystems['hooks']['log']> = { created: [], uploads: [], assets: [], prompts: 0, scanDirectories: [], cancelled: 0 };
  const details = new Map<string, SystemDetail>();
  const undos = new Map<string, string>();
  const versions = new Map<string, VersionSummary[]>();
  const pageLog: ReturnType<FakeSystems['hooks']['pageLog']> = { saves: [], undos: [], reviews: [], asks: [], resyncs: [] };
  let resyncReview: CodeResyncReview | null = null;
  let repoReview: RepoResyncReview | null = null;
  const livingPatch = new Map<string, Record<string, unknown>>();
  const revealed: RevealBody[] = [];
  let resyncStale = false;
  let resyncFailure: string | null = null;
  let staleOnce = false;
  let detailFailing = false;
  let editN = 0;
  let buildAnswer: SystemBuildTicketResponse = { state: 'waiting', project: { label: 'ember-oak' } };
  let buildSeq = 0;
  const buildLog: ReturnType<FakeSystems['hooks']['buildLog']> = { requests: [], polls: 0 };

  const detailFor = (row: SystemSummary): SystemDetail => {
    let detail = details.get(row.id);
    if (!detail) {
      detail = detailOf(row);
      if (!row.empty && !row.unreadable && row.id !== 'field-notes') fillIn(detail, row.id === 'juniper' ? ['foundations', 'components'] : ['foundations', 'components', 'patterns', 'brand']);
      if (row.id === 'tidepool') deepen(detail, 'core');
      if (row.id === 'harbor') deepen(detail, 'full');
      if (row.id === 'harbor') detail.screens = sampleScreens();
      if (row.id === 'harbor') addMotionAndIcons(detail);
      if (row.id === 'harbor') for (const section of ['colours', 'typography'] as const) detail.review[section] = { state: 'looks-good', note: null };
      details.set(row.id, detail);
    }
    detail.name = row.name;
    detail.status = row.status;
    detail.updated = row.updated;
    return detail;
  };
  const detailOfId = (id: string): SystemDetail | undefined => details.get(id);
  const livingView = (row: SystemSummary): LivingPageResponse => {
    const detail = detailFor(row);
    if (detail.home.kind !== 'repo') return { home: 'internal' };
    const state = detail.livingPage?.state ?? 'missing';
    const base = {
      home: 'repo' as const,
      path: `${detail.home.folder}/index.html`,
      absolute: `${detail.home.directory}\\${detail.home.folder}\\index.html`,
      staged: { revision: detail.revision, bytes: 421_000, omitted: [], problem: null, fonts: 'fallback' as const, secrets: [], preview: null },
      committed: { state, revision: state === 'out-of-date' ? detail.revision - 2 : state === 'missing' ? null : detail.revision, sentence: detail.livingPage?.sentence ?? LIVING_SENTENCE[state], reasons: state === 'unsafe' ? ['A script tag Design Chamber didn’t write.', 'An inline event handler on a button.'] : [] },
      repoReadable: detail.home.readable,
      embedFonts: false,
    };
    const patch = livingPatch.get(row.id) ?? {};
    const staged = patch.staged === undefined ? base.staged : patch.staged === null ? null : { ...base.staged, ...(patch.staged as object) };
    return { ...base, ...patch, staged } as LivingPageResponse;
  };
  const versionsOf = (id: string): VersionSummary[] => {
    let list = versions.get(id);
    if (!list) {
      list = [1, 2, 3].map((n) => ({ id: `v${n}`, n, created: ago((4 - n) * DAY), reason: n === 1 ? 'turn' : 'user-edit', sessionId: null, treeHash: `h${n}`, bytes: 4000 * n, fileCount: 3 + n, ...(n === 3 ? { label: 'Changed --brand' } : {}) }) as VersionSummary);
      versions.set(id, list);
    }
    return list;
  };
  const boardHtml = (detail: SystemDetail, dark: boolean): string => {
    const colour = (token: SystemToken): string => {
      const value = (dark ? token.dark?.text : null) ?? token.light?.text ?? '';
      return `<figure data-dc-entry="token:${token.name}" class="sw"><span style="background:var(${token.name}, ${value})"></span><figcaption>${token.name}</figcaption></figure>`;
    };
    const colours = detail.tokens.filter((token) => token.section === 'colours' && !token.light?.text.startsWith('var(')).map(colour).join('');
    const types = detail.type.map((style) => `<p data-dc-entry="type:${style.id}" style="font-size:${style.size};font-weight:${style.weight};margin:6px 0">${style.name}: The quick brown fox</p>`).join('');
    const parts = detail.components.map((component) => `<div data-dc-entry="component:${component.id}" class="cmp">${component.name}</div>`).join('');
    const bg = dark ? '#17191b' : '#fbfaf7';
    const fg = dark ? '#eef2f1' : '#1d2423';
    return `<!doctype html><html><head><meta charset="utf-8"><title>${detail.name}</title><style>body{margin:0;padding:28px;background:${bg};color:${fg};font:15px system-ui,sans-serif}h1{margin:0 0 16px;font-size:26px}h2{font-size:13px;margin:26px 0 10px;opacity:.7}.row{display:flex;flex-wrap:wrap;gap:12px}.sw{margin:0;width:110px}.sw span{display:block;height:64px;border-radius:10px;border:1px solid #8884}.sw figcaption{font-size:12px;margin-top:4px}.cmp{padding:12px 18px;border:1px solid #8886;border-radius:10px}[data-dc-entry]{cursor:pointer}</style></head><body><h1>${detail.name}</h1><h2>Colours</h2><div class="row">${colours}</div><h2>Typography</h2>${types}<h2>Components</h2><div class="row">${parts}</div>${fakeIconGrid(detail)}</body></html>`;
  };
  const stampBump = (detail: SystemDetail): void => {
    detail.revision += 1;
    detail.stamps = { ...detail.stamps, tokens: `tk:${detail.revision}`, systemJson: `sj:${detail.revision}`, overview: `ov:${detail.revision}` };
  };

  const find = (id: string | undefined): SystemSummary => {
    const row = rows.find((entry) => entry.id === id);
    if (!row) throw new ServiceError('not-found', 'That design system is no longer in your Designs folder.');
    return row;
  };
  /** The service reads `_systems/` under the current root; the fake keeps its rows but hides them on a foreign root. */
  const inThisRoot = (): boolean => deps.visible === undefined || deps.visible();
  const checkName = (raw: string, ignore: string | null): string => {
    const name = raw.normalize('NFKC').trim();
    if (name === '') throw new ServiceError('bad-request', 'Give the design system a name.');
    if (name.length > SYSTEM_NAME_MAX) throw new ServiceError('bad-request', `Keep the name to ${SYSTEM_NAME_MAX} characters or fewer.`);
    const taken = rows.find((row) => row.id !== ignore && row.name.toLowerCase() === name.toLowerCase());
    if (taken) throw new ServiceError('conflict', `You already have a system called ${taken.name}.`);
    return name;
  };
  const idFor = (name: string): string => {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'system';
    let id = base;
    for (let n = 2; rows.some((row) => row.id === id); n += 1) id = `${base}-${n}`;
    return id;
  };

  return {
    handlers: {
      'POST /systems/chip': ({ body }) => {
        buildSeq += 1;
        buildLog.requests.push({ ...body });
        const ticket = `sb_${String(buildSeq).padStart(12, '0')}`;
        return {
          ticket,
          chip: { providerId: CHIP_PROVIDER_ID, id: `system-build:${ticket}`, title: 'New design system', url: '', text: `[Design Chamber] Build a design system with the user.${body.brief ? ` The user's words: "${body.brief}"` : ''}`, data: { build: ticket } },
        };
      },
      'GET /system-builds/:ticket': () => {
        buildLog.polls += 1;
        return buildAnswer;
      },
      'GET /systems': () => {
        if (failing) throw new ServiceError('internal', 'The design systems list could not be read.');
        const shown = inThisRoot() ? rows : [];
        return { systems: shown.map((row) => ({ ...row })), total: shown.length, max: SYSTEMS_MAX };
      },
      'POST /systems': ({ body }) => {
        const name = checkName(body.name, null);
        if (rows.length >= SYSTEMS_MAX) throw new ServiceError('conflict', `You can have up to ${SYSTEMS_MAX} design systems.`);
        log.created.push({ name, body });
        const scan = body.code ? scans.get(body.code.scanId) : undefined;
        const row = blank({
          id: idFor(name),
          name,
          updated: new Date().toISOString(),
          sources: { code: scan ? { directory: scan.directory, lastScan: new Date().toISOString(), partial: false } : null, brand: body.brand ? 1 : 0, description: Boolean(body.description) },
        });
        rows = [row, ...rows];
        deps.emit(null, 'system');
        return { id: row.id, system: detailOf(row) };
      },
      'PATCH /systems/:id': ({ params, body }) => {
        const row = find(params.id);
        let readyNote: { unreviewed: number } | undefined;
        if ('name' in body) row.name = checkName(body.name, row.id);
        else if ('status' in body) {
          row.status = body.status;
          if (body.status === 'ready') {
            const detail = detailFor(row);
            const unreviewed = (Object.entries(detail.review) as Array<[SystemSection, { state: string }]>).filter(([section, entry]) => entry.state === 'not-reviewed' && detail.tokens.length + detail.components.length > 0 && section !== 'layers' && section !== 'sizes' && section !== 'assets').length;
            readyNote = { unreviewed };
          }
        } else if ('review' in body) {
          const detail = detailFor(row);
          detail.review[body.review.section] = { state: body.review.state, note: body.review.note ?? null };
          pageLog.reviews.push({ section: body.review.section, state: body.review.state });
        } else if ('sessionId' in body) detailFor(row).sessionId = body.sessionId;
        row.updated = new Date().toISOString();
        deps.emit(null, 'system');
        return { system: { ...row }, ...(readyNote ? { readyNote } : {}) };
      },
      'DELETE /systems/:id': ({ params }) => {
        const row = find(params.id);
        rows = rows.filter((entry) => entry.id !== row.id);
        deps.emit(null, 'system');
        return { trashedTo: `C:\\Users\\you\\Documents\\Designs\\.trash\\${row.id}`, clearedSettings: { default: row.isDefault, pins: row.pinnedFor.length } };
      },
      'POST /system-scans': ({ body }) => {
        const directory = body.directory.trim();
        if (/designs/i.test(directory)) throw new ServiceError('bad-request', 'Pick your app’s folder, not the Designs folder.');
        if (/missing/i.test(directory)) throw new ServiceError('bad-path', `Design Chamber can’t read ${directory}. The folder doesn’t exist.`);
        // Phase 2.6 E2: a location scan is rooted at the folder, inside the project (the service's validateLocation).
        if (body.location !== undefined) {
          const { rel } = fakeLocation(body.location, directory);
          scanN += 1;
          const scanId = `sc_fakescan${String(scanN).padStart(10, '0')}`;
          scans.set(scanId, { directory: rel === '' ? directory : `${directory}\\${rel.replace(/\//g, '\\')}`, polls: 0, location: { project: directory, rel } });
          log.scanDirectories.push(directory);
          return { scanId };
        }
        scanN += 1;
        const scanId = `sc_fakescan${String(scanN).padStart(10, '0')}`;
        scans.set(scanId, { directory, polls: 0, ...(body.systemId ? { systemId: body.systemId } : {}) });
        log.scanDirectories.push(directory);
        return { scanId };
      },
      'GET /system-scans/:scanId': ({ params }) => {
        const scan = scans.get(params.scanId ?? '');
        if (!scan) throw new ServiceError('not-found', 'That scan is gone. Read the project again.');
        scan.polls += 1;
        if (scan.polls <= slowPolls) return { state: 'running', seen: scan.polls * 240 };
        if (/unreadable/i.test(scan.directory)) return { state: 'failed', message: `Design Chamber can’t read ${scan.directory}. Permission denied.` };
        // Phase 2.6 E2: a location job answers what the folder holds, with its contract verdict.
        if (scan.location) return { state: 'done', summary: locationSummary(scan.directory, scan.location) };
        if (scan.systemId && detailOfId(scan.systemId)?.home.kind === 'repo') return { state: 'done', summary: sampleScan(scan.directory), review: /matches/i.test(scan.directory) ? { ...(repoReview ?? SAMPLE_REPO_REVIEW), directoryChanged: false, tokens: { changed: [], added: [], removed: [], totals: { changed: 0, added: 0, removed: 0 } }, files: { changed: [], added: [], removed: [] }, skipped: [] } : (repoReview ?? SAMPLE_REPO_REVIEW) };
        if (scan.systemId) return { state: 'done', summary: sampleScan(scan.directory), review: /matches/i.test(scan.directory) ? { ...SAMPLE_REVIEW, changed: [], conflicts: [], added: [], removed: [], assets: [] } : (resyncReview ?? SAMPLE_REVIEW) };
        // Phase 2.6 E2: a project scan also answers its candidates (the sheet's discovery and nudge).
        if (/empty/i.test(scan.directory)) return { state: 'done', summary: { ...EMPTY_SCAN(scan.directory), candidates: [], candidatesMore: 0, ...(nextScanPatch ?? {}) } };
        const patch = nextScanPatch;
        nextScanPatch = null;
        return { state: 'done', summary: { ...sampleScan(scan.directory), candidates: sampleCandidates(), candidatesMore: 2, ...(patch ?? {}) } };
      },
      'DELETE /system-scans/:scanId': ({ params }) => {
        scans.delete(params.scanId ?? '');
        log.cancelled += 1;
        return { ok: true };
      },
      // ---- Phase 2.6 E2: "Register it as it is" (the service's register.ts, same refusals) ----
      'POST /systems/register': ({ body }) => {
        const name = checkName(body.name, null);
        if (rows.length >= SYSTEMS_MAX) throw new ServiceError('conflict', `You can have up to ${SYSTEMS_MAX} design systems.`);
        if (registerFailure !== null) {
          const message = registerFailure;
          registerFailure = null;
          throw new ServiceError('conflict', message);
        }
        const scan = scans.get(body.scanId);
        if (!scan) throw new ServiceError('not-found', 'That scan is no longer available. Scan the folder again.');
        if (scan.polls <= slowPolls) throw new ServiceError('conflict', 'The scan is still running. Wait for it to finish.');
        if (!scan.location) throw new ServiceError('conflict', "That scan isn't of a system folder. Scan the folder again.");
        const { project, rel } = scan.location;
        if (locationSummary(scan.directory, scan.location).location?.contract?.complete !== true) {
          throw new ServiceError('conflict', "That scan isn't of a system folder. Scan the folder again.");
        }
        if (rel === 'full-system') {
          throw new ServiceError('conflict', `${rel} already has index.html and living-page.html, so Design Chamber has no place for its living page. Make a new system from it instead.`);
        }
        const overlap = rows.find((row) => {
          const home = detailFor(row).home;
          return home.kind === 'repo' && home.folder === rel && sameDirectory(home.directory, project);
        });
        if (overlap) throw new ServiceError('conflict', `${overlap.name} already uses this repo folder or living-page path.`);
        const row = blank({
          id: idFor(name),
          name,
          updated: new Date().toISOString(),
          home: { repo: baseName(project), directory: project },
          sources: { code: null, brand: 0, description: false },
        });
        const detail = detailFor(row);
        detail.home = { kind: 'repo', directory: project, label: baseName(project), folder: rel, livingPage: `${rel}/index.html`, readable: true, problem: null, lastRead: new Date().toISOString() };
        detail.editable = false;
        detail.snapshot = { at: new Date().toISOString(), by: 'user', tampered: false, treeHash: `tree-${Date.now()}` };
        rows = [row, ...rows];
        registerLog.push({ name, scanId: body.scanId, rel });
        deps.emit(null, 'system');
        return { id: row.id, system: detail };
      },
      // ---- end Phase 2.6 E2 ----
      'POST /uploads': ({ body }) => {
        uploadN += 1;
        const uploadId = `u_fakeupload${String(uploadN).padStart(8, '0')}`;
        uploads.set(uploadId, { total: body.total, chunks: 0, encoding: body.encoding ?? 'text' });
        return { uploadId };
      },
      'PUT /uploads/:id/:index': ({ params, body }) => {
        const upload = uploads.get(params.id ?? '');
        if (!upload) throw new ServiceError('not-found', 'That upload is gone or has expired. Send the file again.');
        if (upload.encoding === 'base64' && !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) throw new ServiceError('bad-request', 'This part of the file isn’t valid base64. Send the file again.');
        upload.chunks += 1;
        return { received: upload.total, complete: true };
      },
      'POST /systems/:id/assets': ({ params, body }) => {
        const row = find(params.id);
        const upload = uploads.get(body.uploadId);
        if (upload) log.uploads.push({ ...upload });
        if (/broken/i.test(body.name)) throw new ServiceError('invalid', `${body.name} isn’t a real ${body.name.split('.').pop()?.toUpperCase() ?? ''} file.`);
        log.assets.push({ name: body.name, kind: body.kind });
        row.sources = { ...row.sources, brand: row.sources.brand + 1 };
        deps.emit(null, 'system');
        return { asset: { file: body.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-'), kind: body.kind, bytes: upload?.total ?? 0 }, refused: null };
      },
      'POST /systems/:id/assets/from-folder': ({ params, body }) => {
        find(params.id);
        if (/designs/i.test(body.directory)) throw new ServiceError('bad-request', 'Pick a folder outside your Designs folder.');
        return {
          added: [
            { file: 'brand-guide.pdf', kind: 'source' },
            { file: 'mark.svg', kind: 'logo' },
          ],
          refused: [{ name: 'notes.key', reason: 'notes.key isn’t a file type design systems use.' }],
        };
      },

      'GET /systems/:id': ({ params }) => {
        if (!inThisRoot()) throw new ServiceError('not-found', 'That design system is no longer in your Designs folder.');
        const row = find(params.id);
        if (detailFailing) throw new ServiceError('internal', 'The design system could not be read.');
        return structuredClone(detailFor(row));
      },
      'POST /systems/:id/edits': ({ params, body }) => {
        const row = find(params.id);
        const detail = detailFor(row);
        pageLog.saves.push(body);
        if (staleOnce) {
          staleOnce = false;
          throw new ServiceError('stale', `${row.name} changed while you were editing. Nothing was saved.`);
        }
        if (body.op !== 'save') throw new ServiceError('bad-request', 'Only saves are faked here.');
        if (body.stamps.tokens !== undefined && body.stamps.tokens !== detail.stamps.tokens) throw new ServiceError('stale', `${row.name} changed while you were editing. Nothing was saved.`);
        const before = structuredClone(detail);
        for (const edit of body.tokens ?? []) {
          if (edit.kind === 'remove') detail.tokens = detail.tokens.filter((token) => token.name !== edit.name);
          else {
            const token = detail.tokens.find((entry) => entry.name === edit.name);
            if (!token) continue;
            const value = { text: edit.value, editable: 'ok' as const, problem: null };
            if (edit.mode === 'light') token.light = value;
            else token.dark = value;
          }
        }
        for (const change of body.meta ?? []) {
          const [kind, id, field] = change.at as [string, string, string | undefined];
          if (kind === 'tokens' && field === 'note') {
            const token = detail.tokens.find((entry) => entry.name === id);
            if (token) token.note = String(change.value ?? '');
          } else if (kind === 'components') {
            const component = detail.components.find((entry) => entry.id === id);
            if (component && field === 'note') component.note = String(change.value ?? '');
            if (component && field === 'purpose') component.purpose = String(change.value ?? '');
          } else if (kind === 'type') {
            const style = detail.type.find((entry) => entry.id === id);
            if (style && field && field in style) (style as unknown as Record<string, unknown>)[field] = String(change.value ?? '');
          }
        }
        for (const entry of body.texts ?? []) if (entry.file === 'OVERVIEW.md' && detail.overview) detail.overview.text = entry.text;
        stampBump(detail);
        const list = versionsOf(row.id);
        const n = list.length + 1;
        const version: VersionSummary = { id: `v${n}`, n, created: new Date().toISOString(), reason: 'user-edit', sessionId: null, treeHash: `h${n}`, bytes: 4000 * n, fileCount: 4, label: 'Edited by hand' };
        list.push(version);
        editN += 1;
        const id = `e${editN}`;
        undos.set(id, JSON.stringify(before));
        deps.emit(null, 'system');
        const count = (body.tokens?.length ?? 0) + (body.meta?.length ?? 0) + (body.texts?.length ?? 0);
        return { edit: { id, label: count === 1 ? 'Changed 1 value' : `Changed ${count} values`, files: ['tokens.css'], undoable: true }, version, coalesced: false, stamps: { tokens: detail.stamps.tokens ?? undefined, systemJson: detail.stamps.systemJson ?? undefined } };
      },
      'POST /systems/:id/edits/:eid/undo': ({ params }) => {
        const row = find(params.id);
        const saved = undos.get(params.eid ?? '');
        if (!saved) throw new ServiceError('not-found', 'That edit can’t be undone any more.');
        pageLog.undos.push(params.eid ?? '');
        const detail = detailFor(row);
        const revision = detail.revision + 1;
        details.set(row.id, { ...(JSON.parse(saved) as SystemDetail), revision, stamps: { ...detail.stamps, tokens: `tk:${revision}`, systemJson: `sj:${revision}` } });
        undos.delete(params.eid ?? '');
        deps.emit(null, 'system');
        return { files: ['tokens.css'], stamps: {}, version: null };
      },
      'POST /systems/:id/resync': ({ params, body }) => {
        const row = find(params.id);
        const detail = detailFor(row);
        pageLog.resyncs.push(body);
        if (resyncFailure !== null) {
          const message = resyncFailure;
          resyncFailure = null;
          throw new ServiceError('internal', message);
        }
        if (detail.home.kind === 'repo') {
          if (resyncStale || body.stamp !== (detail.snapshot?.treeHash ?? 'none')) {
            resyncStale = false;
            throw new ServiceError('stale', `${row.name} changed after the scan, so nothing was changed. Scan again.`);
          }
          const review = repoReview ?? SAMPLE_REPO_REVIEW;
          detail.snapshot = { at: new Date().toISOString(), by: 'user', tampered: false, treeHash: `tree-${Date.now()}` };
          stampBump(detail);
          deps.emit(null, 'system');
          return { counts: { changed: review.tokens.totals.changed, added: review.tokens.totals.added, removed: review.tokens.totals.removed }, edit: { undoable: false, id: null, detail: null }, version: null } as unknown as SystemResyncResponse;
        }
        if (resyncStale || body.stamp !== resyncStampOf(detail.stamps)) {
          resyncStale = false;
          throw new ServiceError('stale', `${row.name} changed after the scan, so nothing was changed. Scan again.`);
        }
        const review = resyncReview ?? SAMPLE_REVIEW;
        const before = structuredClone(detail);
        const list = versionsOf(row.id);
        const put = (token: SystemToken, mode: 'light' | 'dark', value: string): void => {
          const next = { text: value, editable: 'ok' as const, problem: null };
          if (mode === 'light') token.light = next;
          else token.dark = next;
        };
        let changed = 0;
        for (const name of [...(body.changes ?? []), ...(body.useCode ?? [])]) {
          const token = detail.tokens.find((entry) => entry.name === name);
          if (!token) continue;
          changed += 1;
          for (const one of review.changed.filter((entry) => entry.name === name)) put(token, one.mode, one.to);
          for (const one of review.conflicts.filter((entry) => entry.name === name)) put(token, one.mode, one.code);
        }
        for (const name of body.add ?? []) {
          detail.tokens.push(tok(name, name.startsWith('--space') ? 'spacing' : 'colours', name.startsWith('--space') ? null : 'brand', ADDED_VALUES[name] ?? '#808080'));
        }
        const removed = (body.remove ?? []).filter((name) => detail.tokens.some((token) => token.name === name)).length;
        detail.tokens = detail.tokens.filter((token) => !(body.remove ?? []).includes(token.name));
        stampBump(detail);
        const code = detail.sources.code;
        if (code) {
          detail.sources = { ...detail.sources, code: { ...code, lastScan: new Date().toISOString() } };
          row.sources = detail.sources;
        }
        const n = list.length + 1;
        const version: VersionSummary = { id: `v${n}`, n, created: new Date().toISOString(), reason: 'resync', sessionId: null, treeHash: `h${n}`, bytes: 4000 * n, fileCount: 3, label: 'Before re-sync' } as VersionSummary;
        list.push(version);
        editN += 1;
        const id = `e${editN}`;
        undos.set(id, JSON.stringify(before));
        deps.emit(null, 'system');
        return {
          edit: { id, label: 'Re-synced from code', files: ['tokens.css', 'system.json'], undoable: true },
          version,
          coalesced: false,
          stamps: { tokens: detail.stamps.tokens ?? undefined, systemJson: detail.stamps.systemJson ?? undefined },
          counts: { changed, added: (body.add ?? []).length, removed },
        };
      },
      'POST /systems/:id/hand-edits/clear': ({ params }) => {
        find(params.id);
        return { ok: true };
      },
      'GET /systems/:id/living-page': ({ params }) => livingView(find(params.id)),
      'GET /systems/:id/living-page/render': ({ params, query }) => {
        const row = find(params.id);
        return { key: `living:${row.id}:${query.which ?? 'staged'}:${query.scheme ?? 'light'}`, chunks: 1, bytes: 2000, title: `${row.name}: living page`, missing: [], blocked: [], external: [], warnings: [] };
      },
      'GET /systems/:id/living-page/render/chunk': ({ params, query }) => {
        const row = find(params.id);
        const [, , which, scheme] = (query.key ?? '').split(':');
        const dark = scheme === 'dark';
        return `<!doctype html><html><head><meta charset="utf-8"><title>${row.name}</title><style>body{margin:0;padding:32px;background:${dark ? '#17191b' : '#fbfaf7'};color:${dark ? '#eef2f1' : '#1d2423'};font:15px system-ui,sans-serif}h1{margin:0 0 6px;font-size:30px}p{max-width:56ch;opacity:.8}.row{display:flex;gap:10px;margin-top:20px}.c{width:90px;height:56px;border-radius:10px;border:1px solid #8884}</style></head><body><h1>${row.name}</h1><p>${which === 'preview' ? 'A preview of the proposed living page.' : 'The living page Design Chamber generated.'}</p><div class="row"><div class="c" style="background:#2f6f6a"></div><div class="c" style="background:#d9822b"></div><div class="c" style="background:#b3402f"></div></div></body></html>`;
      },
      'POST /reveal': ({ body }) => {
        revealed.push(body);
        return { ok: true };
      },
      'GET /systems/:id/board': ({ params, query }) => {
        if (boardFailure) throw new ServiceError('internal', 'The board couldn’t be drawn.');
        const row = find(params.id);
        const detail = detailFor(row);
        const html = boardHtml(detail, query.scheme === 'dark');
        return { key: `board:${row.id}:${detail.revision}:${query.scheme ?? 'light'}:${query.version ?? 'cur'}`, chunks: 1, bytes: html.length, title: `${row.name}: specimen board`, missing: [], blocked: [], external: [], warnings: [] };
      },
      'GET /systems/:id/board/chunk': ({ params, query }) => {
        const row = find(params.id);
        const dark = (query.key ?? '').split(':')[3] === 'dark';
        return boardHtml(detailFor(row), dark);
      },
      'GET /systems/:id/screens/render': ({ params, query }) => {
        const row = find(params.id);
        const screen = detailFor(row).screens.find((entry) => entry.id === query.screen);
        if (!screen) throw new ServiceError('not-found', 'That screen isn’t in this system any more.');
        screenLog.push({ screen: screen.id, scheme: query.scheme ?? 'light', version: query.version ?? null });
        if (screenFailure === true || screenFailure === screen.id) throw new ServiceError('internal', `screens/${screen.id}.html couldn’t be read.`);
        if (screen.problem !== null) throw new ServiceError('no-html', screen.problem);
        const html = screenHtml(screen);
        return { key: `screen:${row.id}:${screen.id}:${query.scheme ?? 'light'}:${query.version ?? 'cur'}:${detailFor(row).revision}`, chunks: 1, bytes: html.length, title: screen.title, missing: [], blocked: [], external: [], warnings: [] };
      },
      'GET /systems/:id/screens/render/chunk': ({ params, query }) => {
        const row = find(params.id);
        const id = (query.key ?? '').split(':')[2];
        const screen = detailFor(row).screens.find((entry) => entry.id === id);
        if (!screen) throw new ServiceError('stale', 'The screen changed. Load it again.');
        return screenHtml(screen);
      },
      'GET /systems/:id/versions': ({ params }) => {
        find(params.id);
        return { versions: versionsOf(params.id ?? ''), currentTreeHash: 'current', dirty: false };
      },
      'GET /systems/:id/versions/:vid/diff': ({ params }) => {
        find(params.id);
        return { files: [{ path: 'tokens.css', change: 'modified' }, { path: 'system.json', change: 'modified' }] };
      },
      'POST /systems/:id/versions/:vid/restore': ({ params }) => {
        find(params.id);
        const list = versionsOf(params.id ?? '');
        const restored = list.find((entry) => entry.id === params.vid) ?? list[0];
        const before = list[list.length - 1];
        if (!restored || !before) throw new ServiceError('not-found', 'That version is gone.');
        deps.emit(null, 'system');
        return { restorePoint: null, restored, before };
      },
      'POST /systems/:id/prompt': ({ params, body }) => {
        const row = find(params.id);
        log.prompts += 1;
        pageLog.asks.push({ purpose: body.purpose, ...(body.text ? { text: body.text } : {}), ...(body.entry ? { entry: body.entry } : {}), ...(body.section ? { section: body.section } : {}), ...(body.before ? { before: body.before } : {}) });
        if (promptFailure !== null) throw new ServiceError('internal', promptFailure);
        return {
          text: `[Design Chamber] Write the design system "${row.name}". Its folder is _systems/${row.id}. Write only there.`,
          chip: { providerId: CHIP_PROVIDER_ID, id: `system:${row.id}`, title: row.name, url: '', text: 'Write this design system.', data: { system: row.id } },
          handEdits: null,
        };
      },
    },
    hooks: {
      setBuild: (answer) => {
        buildAnswer = answer;
      },
      buildLog: () => buildLog,
      seed: (next) => {
        rows = next.map((row) => ({ ...row }));
      },
      current: () => rows,
      clear: () => {
        rows = [];
      },
      failLoads: (fail) => {
        failing = fail;
      },
      addUnreadable: () => {
        rows = [...rows, blank({ id: 'broken-one', name: 'Broken one', updated: ago(5 * DAY), unreadable: 'Design Chamber can’t read this design system. Its system.json isn’t valid JSON.' })];
        deps.emit(null, 'system');
      },
      failPrompt: (message) => {
        promptFailure = message;
      },
      slowScan: (polls) => {
        slowPolls = polls;
      },
      log: () => log,
      staleNext: () => {
        staleOnce = true;
      },
      setSession: (id, sessionId) => {
        detailFor(find(id)).sessionId = sessionId;
      },
      failBoard: (fail) => {
        boardFailure = fail;
      },
      failDetail: (fail) => {
        detailFailing = fail;
      },
      setCoverage: (id, coverage) => {
        detailFor(find(id)).coverage = coverage;
      },
      setRepoHome: (id, state) => {
        const row = find(id);
        const detail = detailFor(row);
        const directory = row.home === 'internal' ? TIDEPOOL : row.home.directory;
        const label = row.home === 'internal' ? 'shop' : row.home.repo;
        detail.home = { kind: 'repo', directory, label, folder: 'design-system', livingPage: 'design-system/index.html', readable: true, problem: null, lastRead: ago(DAY) };
        detail.editable = false;
        detail.snapshot = { at: ago(DAY), by: 'agent', tampered: false, treeHash: 'tree-1' };
        detail.livingPage = state === null ? null : { state, sentence: LIVING_SENTENCE[state] };
      },
      patchDetail: (id, patch) => {
        const detail = detailFor(find(id));
        const { home, ...rest } = patch;
        Object.assign(detail, rest);
        if (home && typeof home === 'object') detail.home = { ...detail.home, ...home } as SystemDetail['home'];
        deps.emit(null, 'system');
      },
      patchLiving: (id, patch) => {
        livingPatch.set(id, { ...(livingPatch.get(id) ?? {}), ...patch });
        deps.emit(null, 'system');
      },
      setRepoResync: (review) => {
        repoReview = review;
      },
      revealLog: () => revealed,
      setScreens: (id, screens) => {
        const detail = detailFor(find(id));
        detail.screens = structuredClone(screens);
        detail.revision += 1;
        if (deps.emitSystem) deps.emitSystem(id, 'files');
        else deps.emit(null, 'system');
      },
      restoreScreens: (id) => {
        const detail = detailFor(find(id));
        detail.unreadable = null;
        detail.screens = sampleScreens();
        detail.revision += 1;
        if (deps.emitSystem) deps.emitSystem(id, 'files');
        else deps.emit(null, 'system');
      },
      redrawScreens: (id) => {
        detailFor(find(id)).revision += 1;
        if (deps.emitSystem) deps.emitSystem(id, 'files');
        else deps.emit(null, 'system');
      },
      failScreens: (screen) => {
        screenFailure = screen;
      },
      screenLog: () => screenLog,
      pageLog: () => pageLog,
      setResync: (review) => {
        resyncReview = review;
      },
      staleResyncNext: () => {
        resyncStale = true;
      },
      failResync: (message) => {
        resyncFailure = message;
      },
      setCodeFolder: (id, directory) => {
        const row = find(id);
        const detail = detailFor(row);
        if (detail.sources.code) detail.sources = { ...detail.sources, code: { ...detail.sources.code, directory } };
        row.sources = detail.sources;
        deps.emit(null, 'system');
      },
      setDefaultId: (id) => {
        rows = rows.map((row) => ({ ...row, isDefault: row.id === id }));
        deps.emit(null, 'system');
      },
      // ---- Phase 2.6 E2 hooks ----
      registerLog: () => registerLog,
      failRegister: (message) => {
        registerFailure = message;
      },
      setNextScan: (patch) => {
        nextScanPatch = patch;
      },
    },
  };
};
