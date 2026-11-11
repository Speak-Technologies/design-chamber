// Visual harness only: an in-memory stand-in for the local service (docs/SPEC.md §7), typed from
// `ApiRoutes`, so the real UI and guest core can be screenshot-tested without OpenChamber.
// `fake-transport.ts` puts it behind the host's `serviceRequest`. Sample designs, comments, versions and thumbnails; every mutation emits a change event.

import type { ApiRoutes, EditRequest, OpenRequest, RouteBody, RouteKey, RouteResponse, SettingsResponse, StatusDesignRow } from '../../../src/shared/api.ts';
import { SCREENS_MAX, STATUS_ROWS_MAX } from '../../../src/shared/limits.ts';
import { copyTitle, describeMove, directionGroups, freeCopyId, SCREEN_LIST_STALE_MESSAGE } from '../../../src/shared/screen-ops.ts';
import type {
  ChangeEvent,
  Comment,
  DesignJson,
  DesignKind,
  DesignSummary,
  Outbox,
  Screen,
  ThumbState,
  VersionSummary,
  Viewport,
} from '../../../src/shared/types.ts';
import { createFakeChecks, type FakeChecks } from './fake-checks.ts';
import { createFakeTokens, type FakeTokens } from './fake-tokens.ts';
import { COFFEE, SAGE, SLATE, coffeeCheckout, coffeeDirection, coffeeHome, coffeePricing, invoicePage, onboardingScreen, pricingPage, type Palette } from './fake-docs.ts';
import { CHIP_PROVIDER_ID, type DesignChip } from '../../../src/shared/types.ts';
import { ServiceError } from './service-error.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

const LAPTOP: Viewport = { id: 'laptop', label: 'Laptop', width: 1280, height: 800 };
const PHONE: Viewport = { id: 'phone', label: 'Phone', width: 390, height: 844 };

type Rec = {
  design: DesignJson;
  palette: Palette;
  thumb: ThumbState;
  written: Set<string>;
  external: string[];
  blocked: string[];
  rev: number;
  versions: VersionSummary[];
  dirty: boolean;
  /** Keep this one (Phase 2): a screen that now shows another screen's content (the kept direction's, in the original's place). */
  content?: Map<string, string>;
};

const screen = (id: string, title: string): Screen => ({ id, title, file: `screens/${id}.html` });

const baseDesign = (over: Partial<DesignJson> & Pick<DesignJson, 'kind' | 'title'>): DesignJson => ({
  version: 1,
  created: ago(2 * DAY),
  updated: ago(HOUR),
  brief: '',
  sessionId: null,
  projectDirectory: 'C:\\Users\\you\\Documents\\GitHub\\ember-oak',
  preset: null,
  entry: over.kind === 'page' ? 'index.html' : null,
  viewports: over.kind === 'page' ? [LAPTOP] : [LAPTOP, PHONE],
  screens: [],
  designSystem: { confirmed: false },
  tweaks: [],
  comments: [],
  ...over,
});

const comment = (id: string, over: Partial<Comment> & Pick<Comment, 'screen' | 'body'>): Comment => ({
  id,
  viewport: 'laptop',
  anchor: {
    selector: 'body > section:nth-of-type(1) > div:nth-of-type(1) > h1:nth-of-type(1)',
    text: 'Roasted this week. On your doorstep.',
    html: '<h1 style="font-size:68px;margin-bottom:22px">',
    rect: { x: 56, y: 150, w: 560, h: 150 },
    point: { x: 0.5, y: 0.35 },
  },
  status: 'open',
  created: ago(3 * HOUR),
  sentAt: null,
  sentVersion: null,
  ...over,
});

const versions = (count: number, dirty: boolean): VersionSummary[] => {
  const reasons: VersionSummary['reason'][] = ['turn', 'auto', 'turn', 'manual', 'turn', 'restore-point', 'restored'];
  const list: VersionSummary[] = [];
  for (let n = 1; n <= count; n += 1) {
    list.push({
      id: `v${n}`,
      n,
      created: ago((count - n) * 38 * MINUTE + (dirty ? 6 * MINUTE : 4 * MINUTE)),
      reason: reasons[(n - 1) % reasons.length] ?? 'auto',
      sessionId: 'ses_coffee',
      treeHash: `tree${n}`,
      bytes: 24_000 + n * 1_300,
      fileCount: 5 + n,
    });
  }
  return list;
};

const seed = (): Map<string, Rec> => {
  const map = new Map<string, Rec>();
  const put = (slug: string, rec: Omit<Rec, 'rev'>): void => void map.set(slug, { ...rec, rev: 1 });

  put('coffee-subscription', {
    design: baseDesign({
      kind: 'canvas',
      title: 'Coffee subscription',
      updated: ago(4 * MINUTE),
      sessionId: 'ses_coffee',
      brief: 'A pricing page for a coffee subscription, laptop and phone',
      screens: [screen('home', 'Home'), screen('pricing', 'Pricing'), screen('checkout', 'Checkout')],
      // Tweaks (feature 09): five knobs; fake-tokens.ts holds the file they read from.
      tweaks: [
        { var: '--accent-h', label: 'Accent hue', kind: 'number', min: 0, max: 360, step: 1, unit: '' },
        { var: '--radius', label: 'Corner radius', kind: 'number', min: 0, max: 24, step: 2, unit: 'px' },
        { var: '--space', label: 'Section spacing', kind: 'number', min: 24, max: 120, step: 4, unit: 'px' },
        {
          var: '--density',
          label: 'Density',
          kind: 'choice',
          options: [
            { label: 'Compact', value: '0.85' },
            { label: 'Comfortable', value: '1' },
            { label: 'Roomy', value: '1.2' },
          ],
        },
        { var: '--heading-scale', label: 'Heading size', kind: 'number', min: 1, max: 2, step: 0.05, unit: '' },
      ],
      comments: [
        comment('c_a1', { screen: 'home', body: 'Make the headline shorter — it wraps to three lines on phone.' }),
        comment('c_a2', {
          screen: 'home',
          body: 'This button should say what happens next.',
          anchor: { selector: 'body > section:nth-of-type(1) > div:nth-of-type(1) > a:nth-of-type(1)', text: 'See the plans', html: '<a class="btn" href="pricing.html">', rect: { x: 56, y: 360, w: 150, h: 44 }, point: { x: 0.5, y: 0.5 } },
          created: ago(2 * HOUR),
        }),
        comment('c_a3', {
          screen: 'pricing',
          body: 'The middle plan needs more contrast against the page.',
          anchor: { selector: '#gone-element', text: 'Everyday · most picked', html: '<div class="card">', rect: { x: 480, y: 330, w: 320, h: 300 }, point: { x: 0.2, y: 0.1 } },
          created: ago(HOUR),
        }),
        comment('c_a4', { screen: 'home', viewport: 'phone', body: 'Looks good on phone — keep the hero image.', status: 'sent', sentAt: ago(30 * MINUTE), sentVersion: 4, created: ago(5 * HOUR), anchor: { selector: 'body > section:nth-of-type(1) > div:nth-of-type(2)', text: '☕', html: '<div style="aspect-ratio:1">', rect: { x: 20, y: 420, w: 350, h: 350 }, point: { x: 0.5, y: 0.5 } } }),
        comment('c_a5', { screen: 'checkout', body: 'Add a note about skipping months.', status: 'resolved', created: ago(DAY), anchor: { selector: 'form', text: 'Email', html: '<form class="card sans">', rect: { x: 330, y: 190, w: 620, h: 360 }, point: { x: 0.9, y: 0.05 } } }),
      ],
    }),
    palette: COFFEE,
    thumb: 'ready',
    written: new Set(['home', 'pricing', 'checkout']),
    external: [],
    blocked: [],
    versions: versions(5, false),
    dirty: false,
  });
  put('northwind-pricing', {
    design: baseDesign({
      kind: 'page',
      title: 'Northwind pricing page',
      updated: ago(2 * HOUR),
      created: ago(DAY),
      sessionId: 'ses_north',
      comments: [comment('c_b1', { screen: null, body: 'Highlight the Team plan with the brand colour.', anchor: { selector: 'main > div:nth-of-type(1) > div:nth-of-type(2)', text: 'Team $24', html: '<div class="card" style="border:2px solid">', rect: { x: 320, y: 330, w: 300, h: 250 }, point: { x: 0.5, y: 0.1 } } })],
    }),
    palette: SLATE,
    thumb: 'ready',
    written: new Set(['index']),
    external: ['https://cdn.tailwindcss.com'],
    blocked: [],
    versions: versions(2, true),
    dirty: true,
  });
  put('onboarding-flow', {
    design: baseDesign({
      kind: 'canvas',
      title: 'Onboarding flow',
      updated: ago(20_000),
      created: ago(20_000),
      sessionId: 'ses_onboarding',
      brief: 'A three-step onboarding for a habit tracker',
      screens: [screen('welcome', 'Welcome'), screen('profile', 'Profile'), screen('done', 'All set')],
    }),
    palette: SLATE,
    thumb: 'pending',
    written: new Set(),
    external: [],
    blocked: [],
    versions: [],
    dirty: false,
  });
  put('invoice-template', {
    design: baseDesign({ kind: 'page', title: 'Invoice template', updated: ago(DAY + 3 * HOUR), created: ago(4 * DAY), sessionId: null }),
    palette: SAGE,
    thumb: 'unavailable',
    written: new Set(['index']),
    external: [],
    blocked: ['../logo-source.psd'],
    versions: versions(1, false),
    dirty: false,
  });
  put('habit-tracker', {
    design: baseDesign({
      kind: 'canvas',
      title: 'Habit tracker explorations',
      updated: ago(3 * DAY),
      created: ago(6 * DAY),
      sessionId: 'ses_habit',
      screens: [screen('welcome', 'Welcome'), screen('profile', 'Profile')],
    }),
    palette: SLATE,
    thumb: 'ready',
    written: new Set(['welcome', 'profile']),
    external: [],
    blocked: [],
    versions: versions(3, false),
    dirty: false,
  });
  put('launch-announcement', {
    design: baseDesign({ kind: 'page', title: 'Launch announcement', updated: ago(9 * DAY), created: ago(10 * DAY), sessionId: null, comments: [] }),
    palette: SAGE,
    thumb: 'ready',
    written: new Set(['index']),
    external: [],
    blocked: [],
    versions: [],
    dirty: false,
  });
  return map;
};

// ---- thumbnails: a schematic PNG per palette, drawn on a canvas ----

const thumbCache = new Map<string, string>();

const drawThumb = (palette: Palette, kind: DesignKind): string => {
  const cached = thumbCache.get(`${palette.bg}${kind}`);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 200;
  const g = canvas.getContext('2d');
  if (!g) return '';
  g.fillStyle = palette.bg;
  g.fillRect(0, 0, 320, 200);
  g.fillStyle = palette.ink;
  g.fillRect(18, 16, 54, 8);
  g.fillStyle = palette.soft;
  for (let i = 0; i < 3; i += 1) g.fillRect(190 + i * 38, 17, 28, 6);
  g.fillStyle = palette.accent;
  g.beginPath();
  g.roundRect(268, 11, 36, 18, 9);
  g.fill();
  g.fillStyle = palette.ink;
  g.fillRect(18, 56, 150, 14);
  g.fillRect(18, 78, 118, 14);
  g.fillStyle = palette.soft;
  g.fillRect(18, 104, 140, 5);
  g.fillRect(18, 114, 112, 5);
  g.fillStyle = palette.accent;
  g.beginPath();
  g.roundRect(18, 132, 62, 20, 10);
  g.fill();
  if (kind === 'canvas') {
    g.fillStyle = palette.accent;
    g.beginPath();
    g.roundRect(204, 50, 98, 110, [48, 48, 10, 10]);
    g.fill();
  } else {
    g.fillStyle = palette.card;
    for (let i = 0; i < 3; i += 1) {
      g.beginPath();
      g.roundRect(182 + i * 40, 58, 36, 78, 6);
      g.fill();
    }
  }
  g.fillStyle = palette.card;
  for (let i = 0; i < 3; i += 1) {
    g.beginPath();
    g.roundRect(18 + i * 98, 168, 90, 32, [6, 6, 0, 0]);
    g.fill();
  }
  const data = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
  thumbCache.set(`${palette.bg}${kind}`, data);
  return data;
};

// ---- the database ----

const DEFAULT_ROOT = 'C:\\Users\\you\\Documents\\Designs';

export type FakeBackend = {
  call: <K extends RouteKey>(key: K, args: { params?: Record<string, string>; query?: Record<string, string>; body?: RouteBody<K> }) => Promise<RouteResponse<K>>;
  onChange: (listener: (event: ChangeEvent) => void) => () => void;
  /** Test hook: the agent finishes the pending onboarding design. */
  writePending: () => void;
  /** Test hooks for the Checks badge states (fake-checks.ts). */
  checks: FakeChecks['hooks'];
  /** Test hook: the agent saves one file of a design (`files` event with that path). */
  writeFile: (slug: string, path: string) => void;
  /** Test hook: a design was created this long ago (milliseconds). */
  ageDesign: (slug: string, ageMs: number) => void;
  /** Test hook (screens): a canvas grows to `count` screens (written ones named "Extra n"), or the file of one screen goes missing. */
  padScreens: (slug: string, count: number) => void;
  unwriteScreen: (slug: string, id: string) => void;
  /** Test hook (directions): the agent marks `count` screens (<of>-a, -b, …) as directions of `of`; the first `written` of them have a file. */
  addDirections: (slug: string, of: string, count: number, written: number) => void;
  /** Test hook: the next restore fails once with this message (the Undo error notice). */
  failNextRestore: (message: string) => void;
  /** Test hook (tweaks): the agent rewrote tokens.css (a new sha and a `files` event). */
  touchTokens: (slug: string) => void;
};

export const createFakeBackend = (): FakeBackend => {
  const db = seed();
  let seq = 0;
  let nextId = 100;
  let root = DEFAULT_ROOT;
  const previous: SettingsResponse['previousRoots'] = [{ path: 'D:\\Old designs', exists: true, designCount: 3 }];
  let chromePath: string | null = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  /** A page the agent saved straight into the root instead of a design folder: the loose-file banner offers to import it. */
  const loose = new Map<string, { bytes: number; mtime: string }>([['pricing-v2.html', { bytes: 14_200, mtime: ago(2 * HOUR) }]]);
  let skillState: 'not-installed' | 'current' = 'not-installed';
  const listeners = new Set<(event: ChangeEvent) => void>();
  let restoreFailure: string | null = null;

  const emit = (slug: string | null, kind: ChangeEvent['kind'], files?: string[]): void => {
    seq += 1;
    const event: ChangeEvent = files ? { seq, slug, kind, files } : { seq, slug, kind };
    for (const listener of listeners) listener(event);
  };

  const get = (slug: string | undefined): Rec => {
    const rec = slug === undefined ? undefined : db.get(slug);
    if (!rec) throw new ServiceError('not-found', 'That design is no longer in your Designs folder.');
    return rec;
  };

  const rootVisible = (): boolean => root === DEFAULT_ROOT;

  const isPending = (rec: Rec): boolean => rec.written.size === 0;

  const summary = (slug: string, rec: Rec): DesignSummary => ({
    slug,
    kind: rec.design.kind,
    title: rec.design.title,
    created: rec.design.created,
    updated: rec.design.updated,
    pending: isPending(rec),
    screenCount: rec.design.screens.length,
    viewports: rec.design.viewports,
    sessionId: rec.design.sessionId,
    projectDirectory: rec.design.projectDirectory,
    openComments: rec.design.comments.filter((c) => c.status === 'open').length,
    thumb: { state: rec.thumb, key: rec.thumb === 'ready' ? `${slug}:${rec.rev}` : null },
    warnings: [],
  });

  const docFor = (slug: string, rec: Rec, screenId: string | undefined, versionId: string | undefined): string => {
    const latest = rec.versions[rec.versions.length - 1]?.id;
    const old = versionId !== undefined && versionId !== latest;
    let html: string;
    if (slug === 'coffee-subscription') {
      const shown = (screenId === undefined ? undefined : rec.content?.get(screenId)) ?? screenId;
      // A kept direction's content sits in the original's place as `dir:<letter>` (its own screen is gone).
      const letter = shown?.startsWith('dir:') ? shown.slice(4) : rec.design.screens.find((s) => s.id === shown)?.direction?.letter;
      html = letter ? coffeeDirection(letter) : shown === 'pricing' ? coffeePricing() : shown === 'checkout' ? coffeeCheckout() : coffeeHome();
      if (old) html = html.replace('Roasted this week.', 'Fresh coffee, monthly.').replace('Pick a rhythm', 'Choose a plan');
    } else if (slug === 'northwind-pricing' || slug === 'launch-announcement') {
      html = pricingPage();
    } else if (slug === 'invoice-template') {
      html = invoicePage();
    } else {
      const found = rec.design.screens.find((s) => s.id === screenId);
      html = onboardingScreen(found?.title ?? 'Screen', `Step ${Math.max(1, rec.design.screens.findIndex((s) => s.id === screenId) + 1)} of ${rec.design.screens.length}`);
    }
    return html;
  };

  const touch = (rec: Rec): void => {
    rec.design.updated = new Date().toISOString();
    rec.rev += 1;
  };

  const detail = (slug: string, rec: Rec): RouteResponse<'GET /designs/:slug'> => {
    const screens: Record<string, { exists: boolean; size: number; mtime: string | null }> = {};
    for (const s of rec.design.screens) screens[s.id] = { exists: rec.written.has(s.id), size: rec.written.has(s.id) ? 18_400 : 0, mtime: rec.written.has(s.id) ? rec.design.updated : null };
    return {
      slug,
      path: `${root}\\${slug}`,
      design: rec.design,
      pending: isPending(rec),
      files: rec.design.kind === 'page' ? { entry: { exists: rec.written.has('index'), size: 22_000, mtime: rec.design.updated }, screens: {} } : { screens },
      warnings: [],
      screensStamp: `screens:${rec.design.screens.map((s) => s.id).join(',')}`,
      designJson: 'ok',
    };
  };

  // ---- Phase 2: screen edits, in memory ----
  const stampOf = (rec: Rec): string => `screens:${rec.design.screens.map((s) => s.id).join(',')}`;
  const undos = new Map<string, { screens: Screen[]; written: Set<string>; comments: Comment[]; content: Map<string, string> | undefined }>();
  let editSeq = 0;
  const tokens: FakeTokens = createFakeTokens({ emit: (slug, files) => emit(slug, 'files', files) });

  const screenEdit = (slug: string, rec: Rec, request: Extract<EditRequest, { op: 'reorder' | 'duplicate' | 'trash-screen' | 'keep-direction' }>): RouteResponse<'POST /designs/:slug/edits'> => {
    if (request.screens !== stampOf(rec)) throw new ServiceError('stale', SCREEN_LIST_STALE_MESSAGE);
    const before = { screens: structuredClone(rec.design.screens), written: new Set(rec.written), comments: structuredClone(rec.design.comments), content: rec.content ? new Map(rec.content) : undefined };
    const titleOf = (id: string): string => before.screens.find((entry) => entry.id === id)?.title ?? id;
    const ids = before.screens.map((entry) => entry.id);
    let label = '';
    let detailText: string | undefined;
    let created: { id: string; title: string } | undefined;
    if (request.op === 'keep-direction') {
      // The service's rules in memory: the group must still be one, every file as the wall saw it, the kept board written.
      const group = directionGroups(rec.design.screens).find((one) => one.of === request.of);
      if (group === undefined) throw new ServiceError('invalid', SCREEN_LIST_STALE_MESSAGE);
      for (const entry of request.files) if ((entry.file === null) === rec.written.has(entry.id)) throw new ServiceError('stale', SCREEN_LIST_STALE_MESSAGE);
      if (!rec.written.has(request.keep)) throw new ServiceError('invalid', 'Not written yet.');
      const mark = group.members.find((one) => one.id === request.keep)?.direction;
      const content = new Map(rec.content ?? []);
      if (request.keep !== request.of) {
        content.set(request.of, content.get(request.keep) ?? `dir:${mark?.letter ?? ''}`);
        rec.design.comments = rec.design.comments.map((entry) => (entry.screen === request.keep ? { ...entry, screen: request.of } : entry));
      }
      rec.content = content;
      for (const one of group.members) {
        rec.design.screens = rec.design.screens.filter((entry) => entry.id !== one.id);
        rec.written.delete(one.id);
      }
      label = mark === undefined ? `Kept the current ${titleOf(request.of)}` : `Kept ${mark.letter} for ${titleOf(request.of)}`;
      detailText = mark === undefined ? 'The directions are in the trash.' : 'The others are in the trash.';
    } else if (request.op === 'reorder') {
      const byId = new Map(rec.design.screens.map((entry) => [entry.id, entry] as const));
      const next = request.order.map((id) => byId.get(id));
      if (next.length !== ids.length || next.some((entry) => entry === undefined)) throw new ServiceError('bad-request', 'That order does not match the screens.');
      rec.design.screens = next.filter((entry): entry is Screen => entry !== undefined);
      const move = describeMove(ids, request.order);
      label = move === null ? 'Screens reordered' : move.above === null ? `Moved ${titleOf(move.moved)} to the end` : `Moved ${titleOf(move.moved)} above ${titleOf(move.above)}`;
    } else if (request.op === 'duplicate') {
      if (rec.design.screens.length >= SCREENS_MAX) throw new ServiceError('invalid', 'A canvas holds up to 40 screens.');
      const copyId = freeCopyId(request.id, new Set(ids));
      const index = ids.indexOf(request.id);
      if (copyId === null || index < 0) throw new ServiceError('invalid', 'That screen cannot be copied.');
      const title = copyTitle(titleOf(request.id));
      rec.design.screens.splice(index + 1, 0, screen(copyId, title));
      rec.written.add(copyId);
      created = { id: copyId, title };
      label = `Duplicated ${titleOf(request.id)}`;
    } else {
      rec.design.screens = rec.design.screens.filter((entry) => entry.id !== request.id);
      rec.written.delete(request.id);
      label = `Moved ${titleOf(request.id)} to trash`;
    }
    editSeq += 1;
    const id = `e_fake${String(editSeq).padStart(4, '0')}`;
    undos.set(id, before);
    touch(rec);
    emit(slug, 'design');
    return { edit: { id, label, ...(detailText ? { detail: detailText } : {}), files: [], undoable: true }, version: null, coalesced: false, stamps: { screens: stampOf(rec) }, ...(created ? { created } : {}) };
  };

  type Req<K extends RouteKey> = { params: Record<string, string>; query: Record<string, string>; body: RouteBody<K> };
  type Handlers = { [K in RouteKey]?: (req: Req<K>) => RouteResponse<K> | Promise<RouteResponse<K>> };

  let outbox: Outbox | null = null;
  let openRequest: OpenRequest | null = null;
  const handlers: Handlers = {
    'GET /health': () => ({ ok: true, version: '0.1.0', epoch: 'dev' }),
    'GET /settings': () => ({
      root,
      defaultRoot: DEFAULT_ROOT,
      previousRoots: previous.filter((p) => p.path !== root),
      rootExists: true,
      chrome: chromePath ? { path: chromePath, source: 'detected' } : { path: null, source: 'none' },
      downloadsDir: 'C:\\Users\\you\\Downloads',
      agent: {
        guide: { path: `${root}\\AGENTS.md`, state: 'current' },
        skill: { path: 'C:\\Users\\you\\.config\\opencode\\skills\\design-chamber\\SKILL.md', state: skillState, duplicates: [] },
      },
    }),
    'PUT /settings': ({ body }) => {
      if (body.root !== undefined) {
        const next = body.root ?? DEFAULT_ROOT;
        if (!/^[A-Za-z]:[\\/]|^\//.test(next)) throw new ServiceError('bad-path', 'That folder cannot be used: it must be a full path.');
        if (/forbidden/i.test(next)) throw new ServiceError('bad-path', 'That folder cannot be used: Design Chamber cannot create it. Pick a folder you can write to.');
        if (next !== root && !previous.some((p) => p.path === root)) previous.unshift({ path: root, exists: true, designCount: db.size });
        root = next;
        emit(null, 'root');
      }
      if (body.chromePath !== undefined) {
        chromePath = body.chromePath;
      }
      return handlers['GET /settings']?.({ params: {}, query: {}, body: undefined }) as RouteResponse<'PUT /settings'>;
    },
    'GET /designs': ({ query }) => {
      let designs = rootVisible() ? [...db.entries()].map(([slug, rec]) => summary(slug, rec)) : [];
      if (query.q) designs = designs.filter((d) => d.title.toLowerCase().includes((query.q ?? '').toLowerCase()));
      const files = rootVisible() ? [...loose.entries()].map(([name, file]) => ({ name, ...file })).sort((a, b) => b.mtime.localeCompare(a.mtime)) : [];
      return { root, designs, loose: { files, total: files.length } };
    },
    'POST /loose/import': ({ body }) => {
      if (!loose.delete(body.name)) throw new ServiceError('not-found', 'That file is no longer in your designs folder.');
      const title = body.name.replace(/\.html?$/i, '').replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
      const slug = body.name.replace(/\.html?$/i, '').toLowerCase();
      const design = baseDesign({ kind: 'page', title, brief: '', created: new Date().toISOString(), updated: new Date().toISOString() });
      db.set(slug, { design, palette: SLATE, thumb: 'pending', written: new Set(['index']), external: [], blocked: [], rev: 1, versions: [], dirty: false });
      emit(slug, 'added');
      emit(null, 'loose');
      return { slug, title, originalMovedTo: `${root}\\.trash\\${slug}-20261101090000.html` };
    },
    // An older copy installed from Settings: only an unedited copy of ours is removed.
    'DELETE /agent/skill': () => {
      skillState = 'not-installed';
      return { skill: { path: 'C:\\Users\\you\\.config\\opencode\\skills\\design-chamber\\SKILL.md', state: skillState, duplicates: [] } };
    },
    // A Work Status row or a chat block asks the rail to open a design; the rail takes it once.
    'POST /open-request': ({ body }) => {
      get(body.slug);
      openRequest = { slug: body.slug, intent: body.intent ?? 'view', created: new Date().toISOString() };
      emit(body.slug, 'open');
      return { ok: true };
    },
    'DELETE /open-request': () => {
      const taken = openRequest;
      openRequest = null;
      return { request: taken };
    },
    'POST /session-events': () => ({ ok: true }),
    'POST /mentions/search': ({ body }) => {
      const wanted = body.query.trim().toLowerCase();
      const items = [...db.entries()]
        .filter(([slug, rec]) => wanted === '' || slug.includes(wanted) || rec.design.title.toLowerCase().includes(wanted))
        .sort(([, a], [, b]) => b.design.updated.localeCompare(a.design.updated))
        .slice(0, 20)
        .map(([slug, rec]) => {
          const open = rec.design.comments.filter((c) => c.status === 'open').length;
          const kind = rec.design.kind === 'canvas' ? `Canvas · ${rec.design.screens.length} screen${rec.design.screens.length === 1 ? '' : 's'}` : 'Page';
          return { id: slug, title: rec.design.title, subtitle: open > 0 ? `${kind} · ${open} open comment${open === 1 ? '' : 's'}` : kind };
        });
      return { items };
    },
    'POST /mentions/resolve': ({ body }) => {
      const rec = get(body.id);
      return { text: `Design "${rec.design.title}" (${rec.design.kind}) from Design Chamber. Its folder: ${root}\\${body.id}` };
    },
    // Work Status: this chat's designs first, then the newest; checks as the badge would read them.
    'GET /status/designs': ({ query }) => {
      const session = query.session ?? '';
      const matched = (rootVisible() ? [...db.entries()] : [])
        .filter(([, rec]) => !query.directory || rec.design.projectDirectory === null || rec.design.projectDirectory.toLowerCase() === query.directory.toLowerCase())
        .sort(([, a], [, b]) => Number(session !== '' && b.design.sessionId === session) - Number(session !== '' && a.design.sessionId === session) || b.design.updated.localeCompare(a.design.updated));
      const rows: StatusDesignRow[] = matched.slice(0, STATUS_ROWS_MAX).map(([slug, rec]) => ({
        slug,
        title: rec.design.title,
        kind: rec.design.kind,
        here: session !== '' && rec.design.sessionId === session,
        agent: null,
        lastFile: null,
        checks: checks.summary(slug),
        pending: isPending(rec),
        openComments: rec.design.comments.filter((c) => c.status === 'open').length,
      }));
      return { rows, total: matched.length };
    },
    'POST /designs': ({ body }) => {
      const slug = `${body.title ?? 'new-design'}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design';
      const unique = db.has(slug) ? `${slug}-${(nextId += 1)}` : slug;
      const design = baseDesign({ kind: body.kind, title: body.title ?? 'Untitled design', brief: body.brief ?? '', created: new Date().toISOString(), updated: new Date().toISOString() });
      db.set(unique, { design, palette: SLATE, thumb: 'pending', written: new Set(), external: [], blocked: [], rev: 1, versions: [], dirty: false });
      emit(unique, 'added');
      return { slug: unique, path: `${root}\\${unique}`, design };
    },
    'GET /designs/:slug': ({ params }) => detail(params.slug ?? '', get(params.slug)),
    'PATCH /designs/:slug': ({ params, body }) => {
      const rec = get(params.slug);
      if (body.title !== undefined) rec.design.title = body.title;
      if (body.sessionId !== undefined) rec.design.sessionId = body.sessionId;
      touch(rec);
      emit(params.slug ?? null, 'design');
      return { design: rec.design };
    },
    'DELETE /designs/:slug': ({ params }) => {
      get(params.slug);
      db.delete(params.slug ?? '');
      emit(params.slug ?? null, 'removed');
      return { trashedTo: `${root}\\.trash\\${params.slug}-20261026180000` };
    },
    'POST /designs/:slug/comments': ({ params, body }) => {
      const rec = get(params.slug);
      nextId += 1;
      const created: Comment = { id: `c_n${nextId}`, screen: body.screen, viewport: body.viewport, anchor: body.anchor, body: body.body, status: 'open', created: new Date().toISOString(), sentAt: null, sentVersion: null };
      rec.design.comments.push(created);
      emit(params.slug ?? null, 'comments');
      return { comment: created };
    },
    'PATCH /designs/:slug/comments/:id': ({ params, body }) => {
      const rec = get(params.slug);
      const found = rec.design.comments.find((c) => c.id === params.id);
      if (!found) throw new ServiceError('not-found', 'That comment no longer exists.');
      if (body.body !== undefined) found.body = body.body;
      if (body.status !== undefined) found.status = body.status;
      emit(params.slug ?? null, 'comments');
      return { comment: found };
    },
    'DELETE /designs/:slug/comments/:id': ({ params }) => {
      const rec = get(params.slug);
      rec.design.comments = rec.design.comments.filter((c) => c.id !== params.id);
      emit(params.slug ?? null, 'comments');
      return { ok: true };
    },
    'POST /designs/:slug/comments/mark-sent': ({ params, body }) => {
      const rec = get(params.slug);
      const sent: Comment[] = [];
      for (const c of rec.design.comments) {
        if (body.ids.includes(c.id)) {
          c.status = 'sent';
          c.sentAt = new Date().toISOString();
          c.sentVersion = body.version;
          sent.push(c);
        }
      }
      emit(params.slug ?? null, 'comments');
      return { comments: sent };
    },
    'GET /designs/:slug/render': ({ params, query }) => {
      const rec = get(params.slug);
      const id = query.screen ?? (rec.design.kind === 'page' ? 'index' : (rec.design.screens.find((s) => rec.written.has(s.id))?.id ?? 'index'));
      if (!rec.written.has(id)) {
        const file = rec.design.kind === 'page' ? 'index.html' : `screens/${id}.html`;
        throw new ServiceError('no-html', `${file} has not been written yet.`);
      }
      const html = docFor(params.slug ?? '', rec, id === 'index' ? undefined : id, query.version);
      const blocked = params.slug === 'coffee-subscription' && query.screen === 'pricing' ? ['../private/brand-guide.pdf', 'module import ./app.js'] : rec.blocked;
      return { key: `${params.slug}:${id}:${query.version ?? 'cur'}:${rec.rev}`, chunks: 1, bytes: html.length, title: rec.design.title, missing: [], blocked, external: rec.external, warnings: [] };
    },
    'GET /designs/:slug/render/chunk': ({ params, query }) => {
      const rec = get(params.slug);
      const [, id, version] = (query.key ?? '').split(':');
      return docFor(params.slug ?? '', rec, id === 'index' ? undefined : id, version === 'cur' ? undefined : version);
    },
    'GET /designs/:slug/source': ({ params, query }) => {
      const rec = get(params.slug);
      const text = docFor(params.slug ?? '', rec, query.screen, undefined);
      return { text, bytes: text.length, sha256: `src:${text.length}`, utf8: true, link: false };
    },
    'GET /designs/:slug/thumbnail': ({ params }) => {
      const rec = get(params.slug);
      if (rec.thumb === 'ready') return { state: 'ready', key: `${params.slug}:${rec.rev}`, png: drawThumb(rec.palette, rec.design.kind), width: 320, height: 200 };
      if (rec.thumb === 'unavailable') return { state: 'unavailable', key: null, message: 'No Chrome or Edge was found, so this shows a live preview.' };
      return { state: 'pending', key: null };
    },
    'GET /designs/:slug/versions': ({ params }) => {
      const rec = get(params.slug);
      return { versions: rec.versions, currentTreeHash: 'current', dirty: rec.dirty };
    },
    'POST /designs/:slug/versions': ({ params }) => {
      const rec = get(params.slug);
      const n = (rec.versions[rec.versions.length - 1]?.n ?? 0) + 1;
      if (!rec.dirty && rec.versions.length > 0) return { created: null };
      const created: VersionSummary = { id: `v${n}`, n, created: new Date().toISOString(), reason: 'manual', sessionId: null, treeHash: `tree${n}`, bytes: 30_000, fileCount: 8 };
      rec.versions.push(created);
      rec.dirty = false;
      emit(params.slug ?? null, 'versions');
      return { created };
    },
    'GET /designs/:slug/versions/:vid/diff': () => ({
      files: [
        { path: 'screens/home.html', change: 'modified' },
        { path: 'screens/pricing.html', change: 'modified' },
        { path: 'assets/hero.png', change: 'added' },
        { path: 'screens/legacy.html', change: 'removed' },
      ],
    }),
    'POST /designs/:slug/versions/:vid/restore': ({ params }) => {
      const rec = get(params.slug);
      const target = rec.versions.find((v) => v.id === params.vid);
      if (!target) throw new ServiceError('not-found', 'That version is no longer saved.');
      if (restoreFailure !== null) {
        const message = restoreFailure;
        restoreFailure = null;
        throw new ServiceError('internal', message);
      }
      const n = (rec.versions[rec.versions.length - 1]?.n ?? 0) + 1;
      const point: VersionSummary = { id: `v${n}`, n, created: new Date().toISOString(), reason: 'restore-point', sessionId: null, treeHash: `tree${n}`, bytes: 30_000, fileCount: 8 };
      rec.versions.push(point);
      const restored: VersionSummary = { id: `v${n + 1}`, n: n + 1, created: new Date().toISOString(), reason: 'restored', sessionId: null, treeHash: target.treeHash, bytes: target.bytes, fileCount: target.fileCount };
      rec.versions.push(restored);
      touch(rec);
      emit(params.slug ?? null, 'versions');
      emit(params.slug ?? null, 'files');
      return { restorePoint: point, restored, before: point };
    },
    'POST /designs/:slug/export': ({ params, body }) => {
      get(params.slug);
      return { path: `C:\\Users\\you\\Downloads\\${params.slug}${body.format === 'zip' ? '.zip' : '.html'}`, bytes: 184_320, format: body.format };
    },
    'POST /reveal': () => ({ ok: true }),
    'GET /presets': () => ({
      presets: [
        { id: 'minimal-saas', name: 'Minimal SaaS', bestFor: 'dashboards, settings' },
        { id: 'editorial', name: 'Editorial', bestFor: 'content, blogs' },
        { id: 'playful-consumer', name: 'Playful consumer', bestFor: 'apps, onboarding' },
      ],
    }),
    // The page hands a message for a chat that is not selected to the rail through the outbox.
    'GET /outbox': () => ({ outbox }),
    'PUT /outbox': ({ body }) => {
      outbox = { ...body, created: new Date().toISOString() };
      return { outbox };
    },
    'DELETE /outbox': () => {
      const taken = outbox;
      outbox = null;
      return { outbox: taken };
    },
    'POST /designs/:slug/prompt': ({ params, body }) => {
      const rec = get(params.slug);
      const chip: DesignChip = { providerId: CHIP_PROVIDER_ID, id: `design:${params.slug}`, title: rec.design.title, url: `file:///designs/${params.slug}`, text: 'Continue this design.', data: { slug: params.slug ?? '', kind: rec.design.kind } };
      if (body.purpose === 'revision') {
        const wanted = body.commentIds ? new Set(body.commentIds) : null;
        // Like the service: no ids means every open comment; named ids are sent whatever their status.
        const picked = rec.design.comments.filter((candidate) => (wanted ? wanted.has(candidate.id) : candidate.status === 'open'));
        if (picked.length === 0) throw new ServiceError('invalid', wanted ? 'None of those comments exist any more.' : 'There are no open comments to send.');
        const lines = picked.map((candidate, index) => `${index + 1}. element: \`${candidate.anchor.selector}\`\n   → ${candidate.body}`);
        return { text: `[Design Chamber] Revise "${rec.design.title}": ${picked.length} comment${picked.length === 1 ? '' : 's'}.\n${lines.join('\n')}`, commentIds: picked.map((candidate) => candidate.id), omitted: [], chip, handEdits: null };
      }
      // The service-written requests of "Ask the agent to fix it" (checks badge, remote-files banner).
      if (body.purpose === 'checks') return { ...checks.prompt(params.slug ?? ''), commentIds: [], omitted: [], chip, handEdits: null };
      if (body.purpose === 'offline') return { text: `[Design Chamber] Make "${rec.design.title}" work offline: bundle remote files into assets/ or remove them.`, commentIds: [], omitted: [], chip, handEdits: null };
      if (body.purpose !== 'ask') throw new ServiceError('internal', 'The UI shim answers revisions, asks, checks and offline requests only.');
      const words = typeof body.text === 'string' ? body.text.trim() : '';
      if (words === '') throw new ServiceError('bad-request', 'Write what you want the agent to do.');
      const element = body.element;
      const lines = [
        `[Design Chamber] Request about the ${rec.design.kind} "${rec.design.title}".`,
        ...(element ? [`About this element: \`${element.anchor.selector}\``] : []),
        words,
      ];
      return { text: lines.join('\n'), commentIds: [], omitted: [], chip, handEdits: null };
    },
    // Phase 2: the screen actions are answered in memory (a scenario can still override the route); the other ops keep the "not built yet" answer.
    'POST /designs/:slug/edits': ({ params, body }) => {
      const rec = get(params.slug);
      if (body.op === 'reorder' || body.op === 'duplicate' || body.op === 'trash-screen' || body.op === 'keep-direction') return screenEdit(params.slug ?? '', rec, body);
      if (body.op === 'tokens') return tokens.edit(params.slug ?? '', body.base, body.values, rec.design.tweaks);
      throw new ServiceError('internal', 'This part of Design Chamber (edits) is not built yet.');
    },
    'POST /designs/:slug/edits/:id/undo': ({ params }) => {
      const rec = get(params.slug);
      if (tokens.hasUndo(params.id ?? '')) return tokens.undo(params.slug ?? '', params.id ?? '');
      const undo = undos.get(params.id ?? '');
      if (!undo) throw new ServiceError('not-found', "This edit can't be undone any more.");
      undos.delete(params.id ?? '');
      rec.design.screens = undo.screens;
      rec.written = undo.written;
      rec.design.comments = undo.comments;
      if (undo.content) rec.content = undo.content;
      else delete rec.content;
      touch(rec);
      emit(params.slug ?? null, 'design');
      return { files: [], stamps: { screens: stampOf(rec) }, version: null };
    },
    'GET /designs/:slug/tokens': ({ params }) => {
      const rec = get(params.slug);
      // A design with tweaks and no tokens.css in the harness reads as "no file".
      return tokens.read(params.slug ?? '', rec.design.tweaks) ?? { exists: false, editable: false, sha256: null, knobs: rec.design.tweaks.map((tweak) => ({ var: tweak.var, state: 'no-file', value: null, fileUnit: null, alsoSet: [] })) };
    },
    'POST /designs/:slug/hand-edits/clear': ({ params }) => {
      get(params.slug);
      throw new ServiceError('internal', 'This part of Design Chamber (edits) is not built yet.');
    },
    'GET /designs/:slug/page-state': ({ params }) => {
      get(params.slug);
      throw new ServiceError('internal', 'This part of Design Chamber (page-state) is not built yet.');
    },
    'PATCH /designs/:slug/page-state': ({ params }) => {
      get(params.slug);
      throw new ServiceError('internal', 'This part of Design Chamber (page-state) is not built yet.');
    },
    'DELETE /designs/:slug/page-state': ({ params }) => {
      get(params.slug);
      throw new ServiceError('internal', 'This part of Design Chamber (page-state) is not built yet.');
    },
  };

  const checks = createFakeChecks({
    emit: (slug, kind) => emit(slug, kind),
    info: (slug) => {
      const rec = get(slug);
      return { viewports: rec.design.viewports, unwritten: rec.design.screens.filter((s) => !rec.written.has(s.id)).map((s) => s.file) };
    },
  });
  Object.assign(handlers, checks.handlers);

  const call: FakeBackend['call'] = async (key, args) => {
    await new Promise((resolve) => setTimeout(resolve, 60 + Math.random() * 120));
    const handler = handlers[key];
    if (!handler) throw new ServiceError('internal', `The fake service does not implement ${key}.`);
    // Safe: `handlers[key]` is typed per key; the generic key loses that link here, and the
    // request shape is the one `ApiRoutes[key]` declares.
    const run = handler as (req: Req<typeof key>) => RouteResponse<typeof key> | Promise<RouteResponse<typeof key>>;
    return run({ params: args.params ?? {}, query: args.query ?? {}, body: args.body as RouteBody<typeof key> });
  };

  const writePending = (): void => {
    const rec = db.get('onboarding-flow');
    if (!rec) return;
    rec.written = new Set(['welcome', 'profile', 'done']);
    rec.thumb = 'ready';
    touch(rec);
    emit('onboarding-flow', 'files', ['design.json', 'screens/welcome.html', 'screens/profile.html', 'screens/done.html']);
    emit('onboarding-flow', 'design');
  };

  const writeFile = (slug: string, path: string): void => {
    const rec = db.get(slug);
    if (!rec) return;
    const written = path === 'index.html' ? 'index' : rec.design.screens.find((screen) => screen.file === path)?.id;
    if (written) rec.written.add(written);
    touch(rec);
    emit(slug, 'files', [path]);
  };

  const padScreens = (slug: string, count: number): void => {
    const rec = db.get(slug);
    if (!rec) return;
    for (let n = rec.design.screens.length + 1; n <= count; n += 1) {
      rec.design.screens.push(screen(`extra-${n}`, `Extra ${n}`));
      rec.written.add(`extra-${n}`);
    }
    touch(rec);
    emit(slug, 'design');
  };

  const unwriteScreen = (slug: string, id: string): void => {
    const rec = db.get(slug);
    if (!rec) return;
    rec.written.delete(id);
    touch(rec);
    emit(slug, 'files', [`screens/${id}.html`]);
  };

  const NAMES = ['Bold', 'Editorial', 'Cards', 'Quiet'] as const;
  const LETTERS = ['A', 'B', 'C', 'D'] as const;
  const addDirections = (slug: string, of: string, count: number, written: number): void => {
    const rec = db.get(slug);
    const original = rec?.design.screens.find((entry) => entry.id === of);
    if (!rec || !original) return;
    for (let n = 0; n < Math.min(count, LETTERS.length); n += 1) {
      const letter = LETTERS[n] ?? 'A';
      const id = `${of}-${letter.toLowerCase()}`;
      if (rec.design.screens.some((entry) => entry.id === id)) continue;
      rec.design.screens.push({ ...screen(id, `${original.title}, ${(NAMES[n] ?? '').toLowerCase()}`), direction: { of, letter, name: NAMES[n] ?? letter } });
      if (n < written) rec.written.add(id);
    }
    touch(rec);
    emit(slug, 'design');
  };

  const ageDesign = (slug: string, ageMs: number): void => {
    const rec = db.get(slug);
    if (!rec) return;
    rec.design.created = ago(ageMs);
    emit(slug, 'design');
  };

  return {
    call,
    onChange: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    writePending,
    checks: checks.hooks,
    writeFile,
    ageDesign,
    padScreens,
    unwriteScreen,
    addDirections,
    failNextRestore: (message) => {
      restoreFailure = message;
    },
    touchTokens: (slug) => tokens.touch(slug),
  };
};

export type { ApiRoutes };
