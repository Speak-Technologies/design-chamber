// In-memory stand-ins for the host and the local service (docs/SPEC.md §14 WP4), for UI
// development without OpenChamber and for guest-core tests. Not imported by any production
// entry: the UI opts in explicitly (e.g. a `?fake` switch in a dev build).
//
//   const { guestHost, client, host, service } = createFakeServices();
//   const store = createStore({ client });
//   const flows = createFlows({ host: guestHost, client });
//   host.emitReady({ surface: 'page' });

import {
  HostRequestError,
  type GuestBlockCall,
  type GuestItem,
  type GuestProject,
  type GuestRequest,
  type GuestRequestResult,
  type GuestSessionRecord,
  type GuestSessionsSnapshot,
  type HostReadyContext,
  type HostThemeTokens,
  type JsonValue,
  type PromptRequest,
  type PromptResult,
  type SessionLifecycleEvent,
  type SessionSnapshot,
  type StartSessionRequest,
  type StartSessionResult,
} from '@openchamber/sdk';

import { API_ERROR_STATUS, ROUTE_KEYS, splitRouteKey, type ApiErrorCode, type ChangesResponse, type EditStamps, type EditResponse, type OpenRequest, type RouteKey, type StatusDesignRow, type TokensResponse, type TweakState, type UndoEditResponse } from '../shared/api.ts';
import { CHIP_PROVIDER_ID, type AgentSkillStatus, type ChangeEvent, type ChangeKind, type Comment, type DesignJson, type DesignKind, type DesignSummary, type HandEdit, type HandEditBase, type LooseHtmlFile, type Outbox, type Preset, type Screen, type VersionSummary, type Viewport } from '../shared/types.ts';
import { CHANGES_RING_SIZE, EDIT_ID_PATTERN, HAND_EDITS_LEDGER_MAX, HAND_EDIT_QUOTE_MAX, LOOSE_LIST_MAX, SCREENS_MAX, SLUG_PATTERN, STATUS_ROWS_MAX, TEXT_EDIT_MAX, USER_EDIT_COALESCE_MS, USER_UNDO_KEEP } from '../shared/limits.ts';
import { sameDirectory } from '../shared/path-compare.ts';
import { ENTRY_FILE, screenFileOf } from '../shared/design-json.ts';
import { copyTitle, describeMove, directionGroups, freeCopyId, SCREEN_LIST_STALE_MESSAGE, SCREENS_CAP_MESSAGE } from '../shared/screen-ops.ts';
import { clip, oneLine } from '../shared/agent/context.ts';
import { createGuestHost, type GuestHost, type HostLike } from './host.ts';
import { createServiceClient, type ServiceClient } from './service-client.ts';

// ---- Sample content ----

const LAPTOP: Viewport = { id: 'laptop', label: 'Laptop', width: 1280, height: 800 };
const PHONE: Viewport = { id: 'phone', label: 'Phone', width: 390, height: 844 };

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
  '<style>body{margin:0;font-family:Georgia,serif;background:#f6f1ea;color:#2b211a}header,main,section,footer{padding:32px 6vw}' +
  'nav a{margin-right:16px;color:inherit}h1{font-size:clamp(32px,6vw,64px);margin:0 0 12px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}' +
  '.card{background:#fff;border:1px solid #e3d9cc;padding:20px}.cta{display:inline-block;padding:12px 20px;background:#2b211a;color:#f6f1ea;text-decoration:none}</style></head>' +
  `<body>${body}</body></html>`;

const SAMPLE_FILES: Record<string, Record<string, string>> = {
  'coffee-subscription': {
    'screens/home.html': page(
      'Home',
      '<header><nav><a href="home.html">Home</a><a href="pricing.html">Pricing</a><a href="https://example.com/about">About us</a></nav></header>' +
        '<main><section class="hero"><h1>Fresh roasts, every other Monday</h1><p>Single-origin beans from small farms, roasted the week they ship.</p>' +
        '<a class="cta" href="pricing.html#plans">See plans</a></section>' +
        '<section class="cards"><div class="card"><h2>Pick a roast</h2><p>Light, medium or dark — switch any time.</p></div>' +
        '<div class="card"><h2>Set the rhythm</h2><p>Weekly, fortnightly or monthly deliveries.</p></div>' +
        '<div class="card"><h2>Pause freely</h2><p>Skip a box from your account in one tap.</p></div></section></main>' +
        '<footer><p>Roasted in Leeds · Free delivery over £30</p></footer>',
    ),
    'screens/pricing.html': page(
      'Pricing',
      '<header><nav><a href="home.html">Home</a><a href="pricing.html">Pricing</a></nav></header>' +
        '<main><h1 id="plans">Plans</h1><div class="cards">' +
        '<div class="card" data-testid="plan-taster"><h2>Taster</h2><p>£12 / box · 250 g</p><button data-dc-goto="home">Start with Taster</button></div>' +
        '<div class="card" data-testid="plan-regular"><h2>Regular</h2><p>£21 / box · 500 g</p><button data-dc-goto="home">Start with Regular</button></div>' +
        '</div></main>',
    ),
  },
  'launch-announcement': {
    'index.html': page(
      'Launch announcement',
      '<main><h1>Design Chamber is here</h1><p>Designs your chat agent writes, rendered right inside OpenChamber.</p>' +
        '<form><label>Email <input type="email" placeholder="you@example.com"></label><button>Notify me</button></form></main>',
    ),
  },
};

const iso = (offsetMinutes: number): string => new Date(Date.UTC(2026, 9, 26, 18, 0) + offsetMinutes * 60_000).toISOString();

const baseDesign = (kind: DesignKind, title: string, minutes: number): DesignJson => ({
  version: 1,
  kind,
  title,
  created: iso(minutes),
  updated: iso(minutes + 20),
  brief: '',
  sessionId: null,
  projectDirectory: null,
  preset: null,
  entry: kind === 'page' ? 'index.html' : null,
  viewports: kind === 'page' ? [LAPTOP] : [LAPTOP, PHONE],
  screens: [],
  designSystem: { confirmed: false },
  tweaks: [],
  comments: [],
});

type FakeDesign = { design: DesignJson; files: Record<string, string>; versions: VersionSummary[]; edits: FakeEdits };

// ---- Phase 2 hand edits: the fake's stand-in for `.chamber/edits.json` and the pipeline ----
//
// The fake keeps the whole before/after state per edit (the real pipeline keeps byte-exact reverse
// steps), so Undo restores it wholesale. It mirrors the observable rules the UI develops against:
// version first, coalescing within USER_EDIT_COALESCE_MS, the ledger cap, the E9 stale-undo refusal,
// and `origin: "user"` events. It does not re-implement containment, CAS or the source scanner.

/** One ledger entry before the pipeline's `seq`/`at`/`editId` are added. */
type HandEditBody = HandEdit extends infer T ? (T extends HandEdit ? Omit<T, keyof HandEditBase> : never) : never;

type FakeSnapshot = { files: Record<string, string>; screens: Screen[]; comments: Comment[] };

type FakeUndoRecord = {
  id: string;
  label: string;
  /** The state the edit started from; Undo restores it. */
  before: FakeSnapshot;
  /** The state the edit left; a touched file that moved past it refuses the Undo (E9). */
  after: FakeSnapshot;
  touched: string[];
  screensTouched: boolean;
};

type FakeEdits = {
  seq: number;
  ledger: HandEdit[];
  dropped: number;
  undo: FakeUndoRecord[];
  /** The last hand edit's after-tree and time, for coalescing (§2.4); an agent write clears it. */
  coalesce: { at: number; afterTree: string } | null;
};

const emptyEdits = (): FakeEdits => ({ seq: 0, ledger: [], dropped: 0, undo: [], coalesce: null });

const snapshotOf = (entry: FakeDesign): FakeSnapshot => ({
  files: { ...entry.files },
  screens: entry.design.screens.map((screen) => ({ ...screen, ...(screen.direction ? { direction: { ...screen.direction } } : {}) })),
  comments: entry.design.comments.map((comment) => ({ ...comment })),
});

/** The tree identity the fake coalesces on: files plus the screen list. */
const fakeTree = (entry: FakeDesign): string => fakeHash(JSON.stringify(entry.files) + JSON.stringify(entry.design.screens));

const screensStampOf = (entry: FakeDesign): string => fakeHash(JSON.stringify(entry.design.screens));

/** A quoted ledger title/text: one line, clipped (§2.1). */
const quote = (text: string): string => clip(oneLine(text), HAND_EDIT_QUOTE_MAX);

const newEditId = (): string => `e_${Array.from({ length: 12 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')}`;

const sampleDesigns = (): Map<string, FakeDesign> => {
  const designs = new Map<string, FakeDesign>();
  const coffee = baseDesign('canvas', 'Coffee subscription', 0);
  coffee.brief = 'A pricing page for a coffee subscription';
  coffee.sessionId = 'ses_fake_coffee';
  coffee.screens = [
    { id: 'home', title: 'Home', file: 'screens/home.html' },
    { id: 'pricing', title: 'Pricing', file: 'screens/pricing.html' },
  ];
  coffee.comments = [
    {
      id: 'c_hero01',
      screen: 'home',
      viewport: 'laptop',
      anchor: {
        selector: 'main > section.hero > h1',
        text: 'Fresh roasts, every other Monday',
        html: '<h1>',
        rect: { x: 77, y: 120, w: 1126, h: 77 },
        point: { x: 0.1, y: 0.5 },
      },
      body: 'Make the headline shorter and warmer.',
      status: 'open',
      created: iso(30),
      sentAt: null,
      sentVersion: null,
    },
  ];
  designs.set('coffee-subscription', { design: coffee, files: { ...SAMPLE_FILES['coffee-subscription'] }, versions: [], edits: emptyEdits() });

  const launch = baseDesign('page', 'Launch announcement', 60);
  designs.set('launch-announcement', { design: launch, files: { ...SAMPLE_FILES['launch-announcement'] }, versions: [], edits: emptyEdits() });

  const onboarding = baseDesign('canvas', 'Onboarding flow', 120);
  onboarding.brief = 'Three-step onboarding for a budgeting app';
  designs.set('onboarding-flow', { design: onboarding, files: {}, versions: [], edits: emptyEdits() });

  for (const entry of designs.values()) if (Object.keys(entry.files).length > 0) pushVersion(entry, 'auto', null);
  return designs;
};

let versionCounter = 0;
const pushVersion = (entry: FakeDesign, reason: VersionSummary['reason'], sessionId: string | null): VersionSummary => {
  versionCounter += 1;
  const n = (entry.versions.at(-1)?.n ?? 0) + 1;
  const version: VersionSummary = {
    id: `v${n}`,
    n,
    created: new Date(Date.UTC(2026, 9, 26, 18, 30) + versionCounter * 60_000).toISOString(),
    reason,
    sessionId,
    treeHash: fakeHash(JSON.stringify(entry.files) + n),
    bytes: Object.values(entry.files).reduce((sum, text) => sum + text.length, 0),
    fileCount: Object.keys(entry.files).length,
  };
  entry.versions.push(version);
  return version;
};

/** 64 hex chars from a string (FNV-1a, repeated): a stand-in for sha256 keys. */
export const fakeHash = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').repeat(8);
};

const PRESETS: Preset[] = [
  { id: 'minimal-saas', name: 'Minimal SaaS', bestFor: 'Dashboards and product marketing' },
  { id: 'editorial', name: 'Editorial', bestFor: 'Long-form and content sites' },
];

// ---- Fake service ----

class FakeHttpError extends Error {
  readonly code: ApiErrorCode;
  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

type Matched = { key: RouteKey; params: Record<string, string> };

const matchRoute = (method: string, path: string): Matched | null => {
  const segments = path.split('/').filter(Boolean).map(decodeURIComponent);
  for (const key of ROUTE_KEYS) {
    const route = splitRouteKey(key);
    if (route.method !== method) continue;
    const pattern = route.pattern.split('/').filter(Boolean);
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (const [index, part] of pattern.entries()) {
      const value = segments[index] ?? '';
      if (part.startsWith(':')) params[part.slice(1)] = value;
      else if (part !== value) ok = false;
    }
    if (ok) return { key, params };
  }
  return null;
};

export type FakeServiceOptions = {
  /** Characters per render chunk (default: one chunk). */
  renderChunkChars?: number;
  /** Start empty instead of with the sample designs. */
  empty?: boolean;
};

export type FakeService = {
  handle(request: GuestRequest): Promise<GuestRequestResult>;
  readonly designs: Map<string, FakeDesign>;
  outbox: Outbox | null;
  /** Every request, in order (method + path). */
  readonly requests: GuestRequest[];
  /** Record a change event (also emitted by every fake mutation). `origin: 'user'` marks a hand edit's own event. */
  emit(slug: string | null, kind: ChangeKind, files?: string[], origin?: 'user'): void;
  /** Simulate the agent writing a file. */
  writeFile(slug: string, file: string, text: string): void;
  /** Simulate the agent saving a loose html file directly in the designs root (emits `loose`). */
  writeLooseFile(name: string, text: string): void;
};

export const createFakeService = (options: FakeServiceOptions = {}): FakeService => {
  const designs = options.empty ? new Map<string, FakeDesign>() : sampleDesigns();
  const epoch = fakeHash(String(Math.random())).slice(0, 16);
  const events: ChangeEvent[] = [];
  let seq = 0;
  const waiters = new Set<() => void>();
  const uploads = new Map<string, { total: number; parts: string[] }>();
  const renders = new Map<string, string>();
  const requests: GuestRequest[] = [];
  let root = 'C:\\Users\\you\\Documents\\Designs';
  let counter = 0;
  const outbox: { value: Outbox | null } = { value: null };
  const openRequest: { value: OpenRequest | null } = { value: null };
  /** Loose html files in the fake root, by name. */
  const loose = new Map<string, { text: string; mtime: string }>(
    options.empty ? [] : [['pricing-v2.html', { text: page('Pricing v2', '<main><h1>Pricing v2</h1><p>Two plans, billed monthly.</p></main>'), mtime: iso(90) }]],
  );
  const skillPath = 'C:\\Users\\you\\.config\\opencode\\skills\\design-chamber\\SKILL.md';
  let skill: AgentSkillStatus = { path: skillPath, state: 'not-installed', duplicates: [] };

  const emit = (slug: string | null, kind: ChangeKind, files?: string[], origin?: 'user'): void => {
    seq += 1;
    const event: ChangeEvent = { seq, slug, kind };
    if (files) event.files = files;
    if (origin) event.origin = origin;
    events.push(event);
    if (events.length > CHANGES_RING_SIZE) events.shift();
    for (const wake of [...waiters]) wake();
  };

  const get = (slug: string): FakeDesign => {
    const entry = designs.get(slug);
    if (!entry) throw new FakeHttpError('not-found', 'That design no longer exists. It may have been deleted.');
    return entry;
  };

  /** The edit routes' own 404 sentence (§2.2), distinct from the store's. */
  const editGet = (slug: string): FakeDesign => {
    const entry = designs.get(slug);
    if (!entry) throw new FakeHttpError('not-found', 'That design is no longer in your Designs folder.');
    return entry;
  };

  const pending = (entry: FakeDesign): boolean =>
    entry.design.kind === 'page' ? !entry.files['index.html'] : !entry.design.screens.some((screen) => entry.files[screen.file]);

  const summary = (slug: string, entry: FakeDesign): DesignSummary => ({
    slug,
    kind: entry.design.kind,
    title: entry.design.title,
    created: entry.design.created,
    updated: entry.design.updated,
    pending: pending(entry),
    screenCount: entry.design.screens.length,
    viewports: entry.design.viewports,
    sessionId: entry.design.sessionId,
    projectDirectory: entry.design.projectDirectory,
    openComments: entry.design.comments.filter((comment) => comment.status === 'open').length,
    thumb: { state: 'unavailable', key: null },
    warnings: [],
  });

  /** "Canvas · 2 screens · 1 open comment" or "Page · Laptop 1280×800", as the service words it (U6). */
  const mentionSubtitle = (entry: FakeDesign): string => {
    const open = entry.design.comments.filter((comment) => comment.status === 'open').length;
    const parts =
      entry.design.kind === 'canvas'
        ? ['Canvas', `${entry.design.screens.length} screen${entry.design.screens.length === 1 ? '' : 's'}`]
        : ['Page', ...entry.design.viewports.slice(0, 1).map((viewport) => `${viewport.label} ${viewport.width}×${viewport.height}`)];
    if (open > 0) parts.push(`${open} open comment${open === 1 ? '' : 's'}`);
    return parts.join(' · ');
  };

  const fileStatus = (text: string | undefined) => ({ exists: text !== undefined, size: text?.length ?? 0, mtime: text === undefined ? null : iso(20) });

  const touch = (entry: FakeDesign): void => {
    entry.design.updated = new Date().toISOString();
  };

  const createDesign = (kind: DesignKind, title: string, brief: string, extra: Partial<DesignJson> = {}, html?: string): string => {
    const base = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'design';
    let slug = base;
    for (let n = 2; designs.has(slug); n += 1) slug = `${base}-${n}`;
    const design = { ...baseDesign(kind, title, 0), created: new Date().toISOString(), updated: new Date().toISOString(), brief, ...extra };
    designs.set(slug, { design, files: html ? { 'index.html': html } : {}, versions: [], edits: emptyEdits() });
    emit(slug, 'added');
    return slug;
  };

  const chipOf = (slug: string) => {
    const entry = get(slug);
    return {
      providerId: CHIP_PROVIDER_ID,
      id: `design:${slug}`,
      title: entry.design.title,
      url: `file:///C:/Users/you/Documents/Designs/${slug}`,
      text: `[Design Chamber] ${entry.design.kind === 'canvas' ? 'New canvas' : 'New page'}: "${entry.design.title}"\nWrite ONLY inside: ${root}\\${slug}`,
      data: { slug, kind: entry.design.kind },
    } as const;
  };

  /** The fake keeps no file history: a version renders the current files. */
  const sourceOf = (slug: string, screen: string | undefined): string => {
    const entry = get(slug);
    const file = entry.design.kind === 'page' ? 'index.html' : entry.design.screens.find((item) => item.id === screen)?.file;
    if (!file) throw new FakeHttpError('not-found', 'That screen is not part of this design.');
    const text = entry.files[file];
    if (text === undefined) throw new FakeHttpError('not-found', `${file} is not written yet.`);
    return text;
  };

  /** `GET /designs` `loose`: newest first, at most `LOOSE_LIST_MAX` names. */
  const looseList = (): { files: LooseHtmlFile[]; total: number } => ({
    files: [...loose.entries()]
      .map(([name, file]) => ({ name, bytes: file.text.length, mtime: file.mtime }))
      .sort((a, b) => b.mtime.localeCompare(a.mtime))
      .slice(0, LOOSE_LIST_MAX),
    total: loose.size,
  });

  // ---- Phase 2 hand edits: the fake's edit pipeline stand-in ----

  const BAD_EDIT = "Design Chamber couldn't read that edit. Nothing was saved.";
  const PLACE_MESSAGE = "Design Chamber couldn't find this text in the file exactly. Nothing was saved.";
  const TOO_LONG = "That's too long to edit here. Ask the agent instead.";
  const STALE_TEXT = 'This file changed while you were editing. Nothing was saved.';
  const STALE_TOKENS = 'tokens.css changed since you started. Your values are still shown.';
  const STALE_TWEAKS = 'The tweaks in design.json changed while you were working. Nothing was saved.';
  const UNDO_STALE = "This file changed after your edit, so it can't be undone here. Restore the version 'Before your edits' from Versions.";
  const UNDO_GONE = "This edit can't be undone any more.";
  const NO_TOKENS = 'This design has no tokens.css.';

  type FakeOpPlan = {
    label: string;
    detail?: string;
    ledger: HandEditBody;
    created?: { id: string; title: string };
    reason: 'user-edit' | 'keep-direction';
    /** rel → new content; `null` deletes the file. Screen ops change `screens`, not design.json bytes. */
    files: Record<string, string | null>;
    screens?: Screen[];
    comments?: Comment[];
    touched: string[];
    stamps: EditStamps;
  };

  const appendLedger = (entry: FakeDesign, editId: string, body: HandEditBody): void => {
    entry.edits.seq += 1;
    entry.edits.ledger.push({ seq: entry.edits.seq, at: new Date().toISOString(), editId, ...body });
    if (entry.edits.ledger.length > HAND_EDITS_LEDGER_MAX) {
      const overflow = entry.edits.ledger.length - HAND_EDITS_LEDGER_MAX;
      entry.edits.ledger.splice(0, overflow);
      entry.edits.dropped += overflow;
    }
  };

  /** Validates the request and computes the change without writing (the pipeline's precheck). */
  const planFakeOp = (entry: FakeDesign, body: Record<string, unknown>): FakeOpPlan => {
    const stamp = String(body.screens ?? '');
    const fileStampOf = (value: unknown): { size?: unknown; mtime?: unknown } | null =>
      typeof value === 'object' && value !== null ? (value as { size?: unknown; mtime?: unknown }) : null;
    switch (body.op) {
      case 'text': {
        const screen = typeof body.screen === 'string' ? body.screen : null;
        const before = String(body.before ?? '');
        const after = String(body.after ?? '');
        const rel = screen === null ? ENTRY_FILE : screenFileOf(screen);
        if (screen !== null && !entry.design.screens.some((s) => s.id === screen)) throw new FakeHttpError('bad-request', BAD_EDIT);
        const text = entry.files[rel];
        if (text === undefined) throw new FakeHttpError('invalid', PLACE_MESSAGE);
        if (String(body.base ?? '') !== fakeHash(text)) throw new FakeHttpError('stale', STALE_TEXT);
        if (after.length > TEXT_EDIT_MAX) throw new FakeHttpError('too-large', TOO_LONG);
        const at = text.indexOf(before);
        if (at === -1) throw new FakeHttpError('invalid', PLACE_MESSAGE);
        // Typed markup stays text (E6).
        const escaped = after.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const newText = text.slice(0, at) + escaped + text.slice(at + before.length);
        const title = screen === null ? entry.design.title : entry.design.screens.find((s) => s.id === screen)?.title ?? screen;
        return {
          label: `Text updated in ${title}`,
          ledger: { kind: 'text', file: rel, screen: screen === null ? null : title, before: quote(before), after: quote(after) },
          reason: 'user-edit',
          files: { [rel]: newText },
          touched: [rel],
          stamps: { file: fakeHash(newText) },
        };
      }
      case 'tokens': {
        const css = entry.files['tokens.css'];
        if (css === undefined) throw new FakeHttpError('invalid', NO_TOKENS);
        if (String(body.base ?? '') !== fakeHash(css)) throw new FakeHttpError('stale', STALE_TOKENS);
        const values = (Array.isArray(body.values) ? body.values : []) as { var?: unknown; value?: unknown }[];
        let newCss = css;
        const changes: { label: string; before: string; after: string }[] = [];
        for (const value of values) {
          const varName = typeof value.var === 'string' ? value.var : '';
          const knob = entry.design.tweaks.find((t) => t.var === varName);
          if (!knob) throw new FakeHttpError('stale', STALE_TWEAKS);
          let formatted: string;
          if (knob.kind === 'number') {
            const num = value.value;
            if (typeof num !== 'number' || !Number.isFinite(num) || num < knob.min || num > knob.max) throw new FakeHttpError('bad-request', BAD_EDIT);
            formatted = `${num}${knob.unit}`;
          } else {
            if (!knob.options.some((option) => option.value === value.value)) throw new FakeHttpError('bad-request', BAD_EDIT);
            formatted = String(value.value);
          }
          const re = new RegExp(`(${varName}\\s*:\\s*)([^;{}]+)(;)`);
          const match = re.exec(newCss);
          if (!match) throw new FakeHttpError('invalid', `tokens.css has no ${varName}.`);
          changes.push({ label: knob.label, before: (match[1] ?? '').trim(), after: formatted });
          newCss = newCss.replace(re, `$1${formatted}$3`);
        }
        return {
          label: 'Tweaks saved to tokens.css',
          ledger: { kind: 'tweaks', changes },
          reason: 'user-edit',
          files: { 'tokens.css': newCss },
          touched: ['tokens.css'],
          stamps: { tokens: fakeHash(newCss) },
        };
      }
      case 'reorder': {
        if (stamp !== screensStampOf(entry)) throw new FakeHttpError('stale', SCREEN_LIST_STALE_MESSAGE);
        const order = (Array.isArray(body.order) ? body.order : []) as string[];
        const current = entry.design.screens;
        const ids = current.map((s) => s.id);
        if (order.length !== ids.length || new Set(order).size !== order.length || !order.every((id) => ids.includes(id))) throw new FakeHttpError('bad-request', BAD_EDIT);
        // Safe: the check above proved `order` is exactly the listed ids, so every find hits.
        const newScreens = order.map((id) => current.find((s) => s.id === id) as Screen);
        const titleOf = (id: string): string => current.find((s) => s.id === id)?.title ?? id;
        const move = describeMove(ids, order);
        const label = move === null ? 'Screens reordered' : move.above === null ? `Moved ${titleOf(move.moved)} to the end` : `Moved ${titleOf(move.moved)} above ${titleOf(move.above)}`;
        const ledger: HandEditBody = move === null ? { kind: 'reorder-many', order: order.map(titleOf) } : { kind: 'reorder', moved: titleOf(move.moved), above: move.above === null ? null : titleOf(move.above) };
        return { label, ledger, reason: 'user-edit', files: {}, screens: newScreens, touched: ['design.json'], stamps: { screens: fakeHash(JSON.stringify(newScreens)) } };
      }
      case 'duplicate': {
        if (stamp !== screensStampOf(entry)) throw new FakeHttpError('stale', SCREEN_LIST_STALE_MESSAGE);
        const id = String(body.id ?? '');
        const source = entry.design.screens.find((s) => s.id === id);
        if (!source) throw new FakeHttpError('bad-request', BAD_EDIT);
        if (entry.design.screens.length >= SCREENS_MAX) throw new FakeHttpError('invalid', SCREENS_CAP_MESSAGE);
        const sourceText = entry.files[source.file];
        if (sourceText === undefined) throw new FakeHttpError('invalid', 'Nothing to copy until the agent writes this screen.');
        const file = fileStampOf(body.file);
        if (!file || file.size !== sourceText.length || file.mtime !== iso(20)) throw new FakeHttpError('stale', SCREEN_LIST_STALE_MESSAGE);
        const taken = new Set([
          ...entry.design.screens.map((s) => s.id),
          ...Object.keys(entry.files).filter((f) => f.startsWith('screens/')).map((f) => f.slice('screens/'.length).replace(/\.html$/, '')),
        ]);
        const copyId = freeCopyId(id, taken);
        if (copyId === null) throw new FakeHttpError('invalid', SCREENS_CAP_MESSAGE);
        const title = copyTitle(source.title);
        const copyFile = screenFileOf(copyId);
        const copy: Screen = { ...source, id: copyId, title, file: copyFile };
        delete copy.direction;
        const at = entry.design.screens.findIndex((s) => s.id === id);
        const newScreens = [...entry.design.screens.slice(0, at + 1), copy, ...entry.design.screens.slice(at + 1)];
        return {
          label: `Duplicated ${source.title}`,
          created: { id: copyId, title },
          ledger: { kind: 'duplicate', screen: source.title, copy: title, file: copyFile },
          reason: 'user-edit',
          files: { [copyFile]: sourceText },
          screens: newScreens,
          touched: [copyFile, 'design.json'],
          stamps: { screens: fakeHash(JSON.stringify(newScreens)) },
        };
      }
      case 'trash-screen': {
        if (stamp !== screensStampOf(entry)) throw new FakeHttpError('stale', SCREEN_LIST_STALE_MESSAGE);
        const id = String(body.id ?? '');
        const source = entry.design.screens.find((s) => s.id === id);
        if (!source) throw new FakeHttpError('bad-request', BAD_EDIT);
        const text = entry.files[source.file];
        const file = fileStampOf(body.file);
        if (text !== undefined && (!file || file.size !== text.length || file.mtime !== iso(20))) throw new FakeHttpError('stale', SCREEN_LIST_STALE_MESSAGE);
        const newScreens = entry.design.screens.filter((s) => s.id !== id);
        const files: Record<string, string | null> = {};
        if (text !== undefined) files[source.file] = null;
        return {
          label: `Moved ${source.title} to trash`,
          ledger: { kind: 'trash', screen: source.title, file: source.file },
          reason: 'user-edit',
          files,
          screens: newScreens,
          touched: [...(text !== undefined ? [source.file] : []), 'design.json'],
          stamps: { screens: fakeHash(JSON.stringify(newScreens)) },
        };
      }
      case 'keep-direction': {
        if (stamp !== screensStampOf(entry)) throw new FakeHttpError('stale', SCREEN_LIST_STALE_MESSAGE);
        const of = String(body.of ?? '');
        const keep = String(body.keep ?? '');
        const group = directionGroups(entry.design.screens).find((g) => g.of === of);
        const ofScreen = entry.design.screens.find((s) => s.id === of);
        if (!group || !ofScreen) throw new FakeHttpError('invalid', BAD_EDIT);
        const members = group.members;
        const keepScreen = keep === of ? ofScreen : members.find((m) => m.id === keep);
        if (!keepScreen) throw new FakeHttpError('bad-request', BAD_EDIT);
        const listed = (Array.isArray(body.files) ? body.files : []) as { id?: unknown; file?: unknown }[];
        for (const item of listed) {
          const screen = entry.design.screens.find((s) => s.id === item.id);
          if (!screen) continue;
          const text = entry.files[screen.file];
          const file = fileStampOf(item.file);
          if (file === null) {
            if (text !== undefined) throw new FakeHttpError('stale', SCREEN_LIST_STALE_MESSAGE);
          } else if (text === undefined || file.size !== text.length || file.mtime !== iso(20)) {
            throw new FakeHttpError('stale', SCREEN_LIST_STALE_MESSAGE);
          }
        }
        const keepText = entry.files[keepScreen.file];
        if (keepText === undefined) throw new FakeHttpError('invalid', 'Not written yet.');
        const files: Record<string, string | null> = {};
        const touched: string[] = [];
        for (const member of members) {
          if (member.id === keep) continue;
          if (entry.files[member.file] !== undefined) {
            files[member.file] = null;
            touched.push(member.file);
          }
        }
        let newComments = entry.design.comments;
        if (keep !== of) {
          if (entry.files[ofScreen.file] !== undefined) touched.push(ofScreen.file);
          files[ofScreen.file] = keepText;
          files[keepScreen.file] = null;
          touched.push(keepScreen.file);
          newComments = entry.design.comments.map((c) => (c.screen === keep ? { ...c, screen: of } : c));
        }
        const newScreens = entry.design.screens.filter((s) => !members.some((m) => m.id === s.id));
        touched.push('design.json');
        const mark = keepScreen.direction;
        return {
          label: keep === of ? `Kept the current ${ofScreen.title}` : `Kept ${mark?.letter ?? ''} for ${ofScreen.title}`,
          detail: keep === of ? 'The directions are in the trash.' : 'The others are in the trash.',
          ledger: { kind: 'keep', screen: ofScreen.title, letter: keep === of ? null : mark?.letter ?? null, name: keep === of ? null : mark?.name ?? null },
          reason: 'keep-direction',
          files,
          screens: newScreens,
          comments: newComments,
          touched,
          stamps: { screens: fakeHash(JSON.stringify(newScreens)) },
        };
      }
      default:
        throw new FakeHttpError('bad-request', BAD_EDIT);
    }
  };

  const applyFakeEdit = (slug: string, body: Record<string, unknown>): EditResponse => {
    const entry = editGet(slug);
    const plan = planFakeOp(entry, body);
    const before = snapshotOf(entry);
    // Version first (E3); a burst with no other writer shares one (AD-4).
    const tree = fakeTree(entry);
    const last = entry.edits.coalesce;
    let version: VersionSummary | null = null;
    let coalesced = false;
    if (plan.reason === 'user-edit' && last !== null && Date.now() - last.at <= USER_EDIT_COALESCE_MS && last.afterTree === tree) {
      coalesced = true;
    } else {
      version = pushVersion(entry, plan.reason, null);
      emit(slug, 'versions');
    }
    for (const [rel, content] of Object.entries(plan.files)) {
      if (content === null) delete entry.files[rel];
      else entry.files[rel] = content;
    }
    if (plan.screens) {
      entry.design.screens = plan.screens;
      touch(entry);
    }
    if (plan.comments) entry.design.comments = plan.comments;
    const editId = newEditId();
    entry.edits.undo.push({ id: editId, label: plan.label, before, after: snapshotOf(entry), touched: plan.touched, screensTouched: plan.screens !== undefined });
    if (entry.edits.undo.length > USER_UNDO_KEEP) entry.edits.undo.shift();
    appendLedger(entry, editId, plan.ledger);
    entry.edits.coalesce = plan.reason === 'user-edit' ? { at: Date.now(), afterTree: fakeTree(entry) } : null;
    // The user's own events, so the build strip never reads them as the agent (E10).
    emit(slug, 'files', plan.touched, 'user');
    if (plan.screens) emit(slug, 'design', undefined, 'user');
    return {
      edit: { id: editId, label: plan.label, ...(plan.detail ? { detail: plan.detail } : {}), files: plan.touched, undoable: true },
      version,
      coalesced,
      stamps: plan.stamps,
      ...(plan.created ? { created: plan.created } : {}),
    };
  };

  const undoFakeEdit = (slug: string, id: string): UndoEditResponse => {
    const entry = editGet(slug);
    if (!EDIT_ID_PATTERN.test(id)) throw new FakeHttpError('bad-request', 'That is not an edit id.');
    const record = entry.edits.undo.find((r) => r.id === id);
    if (!record) throw new FakeHttpError('not-found', UNDO_GONE);
    // E9: a touched file (or the screen list) that moved past what the edit left refuses the undo.
    for (const rel of record.touched) {
      if (rel === 'design.json') continue;
      if ((entry.files[rel] ?? null) !== (record.after.files[rel] ?? null)) throw new FakeHttpError('stale', UNDO_STALE);
    }
    if (record.screensTouched && JSON.stringify(entry.design.screens) !== JSON.stringify(record.after.screens)) throw new FakeHttpError('stale', UNDO_STALE);
    entry.files = { ...record.before.files };
    entry.design.screens = record.before.screens.map((s) => ({ ...s }));
    entry.design.comments = record.before.comments.map((c) => ({ ...c }));
    entry.edits.undo = entry.edits.undo.filter((r) => r.id !== id);
    const at = entry.edits.ledger.findIndex((e) => e.editId === id);
    if (at >= 0) entry.edits.ledger.splice(at, 1);
    else appendLedger(entry, id, { kind: 'undo', of: record.label });
    const version = pushVersion(entry, 'user-edit', null);
    emit(slug, 'versions');
    entry.edits.coalesce = { at: Date.now(), afterTree: fakeTree(entry) };
    emit(slug, 'files', record.touched, 'user');
    if (record.screensTouched) emit(slug, 'design', undefined, 'user');
    const stamps: EditStamps = {};
    if (record.screensTouched) stamps.screens = screensStampOf(entry);
    for (const rel of record.touched) {
      if (rel === 'design.json') continue;
      const content = entry.files[rel];
      if (content === undefined) continue;
      if (rel === 'tokens.css') stamps.tokens = fakeHash(content);
      else stamps.file = fakeHash(content);
    }
    return { files: record.touched, stamps, version };
  };

  const fakeReadTokens = (entry: FakeDesign): TokensResponse => {
    const css = entry.files['tokens.css'];
    const exists = css !== undefined;
    const knobs: TweakState[] = entry.design.tweaks.map((knob): TweakState => {
      if (css === undefined) return { var: knob.var, state: 'no-file', value: null, fileUnit: null, alsoSet: [] };
      const match = new RegExp(`${knob.var}\\s*:\\s*([^;{}]+)[;}]`).exec(css);
      if (!match) return { var: knob.var, state: 'missing', value: null, fileUnit: null, alsoSet: [] };
      const raw = (match[1] ?? '').trim();
      if (raw.includes('(') || raw.includes('!important')) return { var: knob.var, state: 'formula', value: null, fileUnit: null, alsoSet: [] };
      if (knob.kind === 'number') {
        const numMatch = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/.exec(raw);
        if (!numMatch) return { var: knob.var, state: 'formula', value: null, fileUnit: null, alsoSet: [] };
        const num = Number(numMatch[1] ?? '');
        const unit = numMatch[2] ?? '';
        if (unit !== knob.unit) return { var: knob.var, state: 'unit', value: num, fileUnit: unit, alsoSet: [] };
        return { var: knob.var, state: 'ok', value: num, fileUnit: unit, alsoSet: [] };
      }
      const isOption = knob.options.some((option) => option.value === raw);
      return { var: knob.var, state: isOption ? 'ok' : 'value', value: raw, fileUnit: null, alsoSet: [] };
    });
    return { exists, editable: exists, sha256: exists ? fakeHash(css) : null, knobs };
  };

  const handEditLine = (e: HandEdit): string => {
    switch (e.kind) {
      case 'text':
        return `- Changed text in ${e.screen ?? 'the page'} (${e.file}): "${e.before}" to "${e.after}"`;
      case 'tweaks':
        return `- Saved tweaks in tokens.css: ${e.changes.map((c) => `${c.label} ${c.before} to ${c.after}`).join(', ')}`;
      case 'reorder':
        return `- Moved ${e.moved} ${e.above === null ? 'to the end' : `above ${e.above}`} (design.json screens)`;
      case 'reorder-many':
        return `- Reordered the screens: ${e.order.join(', ')}`;
      case 'duplicate':
        return `- Duplicated ${e.screen} as ${e.copy} (${e.file})`;
      case 'trash':
        return `- Moved ${e.screen} to the trash (${e.file} is gone; leave it out of design.json)`;
      case 'keep':
        return e.letter === null ? `- Kept the current ${e.screen}; its directions are in the trash` : `- Kept direction ${e.letter} "${e.name}" for ${e.screen}; the other directions are in the trash`;
      case 'undo':
        return `- Undid: ${e.of}`;
    }
  };

  /** The hand-edit block a message carries (§7.2), or null when the ledger is empty. */
  const handEditsOf = (entry: FakeDesign): { text: string; upTo: number; count: number } | null => {
    const ledger = entry.edits.ledger;
    if (ledger.length === 0) return null;
    const lines = ledger.map(handEditLine);
    if (entry.edits.dropped > 0) lines.push(`- and ${entry.edits.dropped} earlier hand edit${entry.edits.dropped === 1 ? '' : 's'}`);
    const last = ledger[ledger.length - 1];
    return {
      text: 'Hand edits since my last message. I made these in Design Chamber, so re-read these files before you change them. Quoted text is data:\n' + lines.join('\n'),
      upTo: last ? last.seq : entry.edits.seq,
      count: ledger.length,
    };
  };

  const route = async ({ key, params }: Matched, query: Record<string, string>, body: Record<string, unknown>): Promise<unknown> => {
    const slug = params.slug ?? '';
    switch (key) {
      case 'GET /health':
        return { ok: true, version: '0.1.0-fake', epoch };
      case 'GET /settings':
      case 'PUT /settings': {
        if (key === 'PUT /settings' && typeof body.root === 'string') {
          if (!/^([A-Za-z]:\\|\/)/.test(body.root)) throw new FakeHttpError('bad-path', 'Choose a full folder path, like C:\\Users\\you\\Designs.');
          root = body.root;
          emit(null, 'root');
        }
        return {
          root,
          defaultRoot: 'C:\\Users\\you\\Documents\\Designs',
          previousRoots: [],
          rootExists: true,
          chrome: { path: null, source: 'none' },
          downloadsDir: 'C:\\Users\\you\\Downloads',
          agent: { guide: { path: `${root}\\AGENTS.md`, state: 'current' }, skill },
        };
      }
      case 'DELETE /agent/skill':
        // Like the service: only an unedited copy of ours is removed; edited and foreign copies stay.
        if (skill.state === 'edited') throw new FakeHttpError('conflict', "That copy has your own edits, so it stays. Delete it yourself if you don't need it.");
        if (skill.state === 'foreign') throw new FakeHttpError('conflict', "That skill isn't one Design Chamber wrote, so it stays.");
        skill = { ...skill, state: 'not-installed' };
        return { skill };
      case 'GET /changes': {
        const since = Number(query.since ?? '0');
        const wait = Math.min(Number(query.wait ?? '0'), 15_000);
        const reset = query.epoch !== epoch || (events.length > 0 && since < (events[0]?.seq ?? 0) - 1);
        if (!reset && since >= seq && wait > 0) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(done, wait);
            function done(): void {
              clearTimeout(timer);
              waiters.delete(done);
              resolve();
            }
            waiters.add(done);
          });
        }
        const answer: ChangesResponse = { epoch, seq, reset, events: reset ? [] : events.filter((event) => event.seq > since) };
        return answer;
      }
      case 'GET /designs': {
        const list = [...designs.entries()]
          .map(([name, entry]) => summary(name, entry))
          .filter((item) => (!query.kind || item.kind === query.kind) && (!query.q || item.title.toLowerCase().includes(query.q.toLowerCase())))
          .sort((a, b) => b.updated.localeCompare(a.updated));
        return { root, designs: list, loose: looseList() };
      }
      case 'POST /loose/import': {
        const name = String(body.name);
        const file = loose.get(name);
        if (!file) throw new FakeHttpError('not-found', 'That file is no longer in your designs folder.');
        const title = /<title>([^<]*)<\/title>/i.exec(file.text)?.[1] ?? name.replace(/\.html?$/i, '');
        const created = createDesign('page', title, '', {}, file.text);
        loose.delete(name);
        emit(null, 'loose');
        return { slug: created, title, originalMovedTo: `${root}\\.trash\\${name.replace(/\.html?$/i, '')}-20261026180000.html` };
      }
      case 'POST /designs': {
        const kind = body.kind === 'page' ? 'page' : 'canvas';
        const created = createDesign(kind, typeof body.title === 'string' && body.title ? body.title : 'Untitled design', typeof body.brief === 'string' ? body.brief : '', {}, typeof body.html === 'string' ? body.html : undefined);
        return { slug: created, path: `${root}\\${created}`, design: get(created).design };
      }
      case 'GET /designs/:slug': {
        const entry = get(slug);
        const screens: Record<string, ReturnType<typeof fileStatus>> = {};
        for (const screen of entry.design.screens) screens[screen.id] = fileStatus(entry.files[screen.file]);
        return {
          slug,
          path: `${root}\\${slug}`,
          design: entry.design,
          pending: pending(entry),
          files: entry.design.kind === 'page' ? { entry: fileStatus(entry.files['index.html']), screens } : { screens },
          warnings: [],
          screensStamp: fakeHash(JSON.stringify(entry.design.screens)),
          designJson: 'ok',
        };
      }
      case 'PATCH /designs/:slug': {
        const entry = get(slug);
        if (typeof body.title === 'string') entry.design.title = body.title;
        if (body.sessionId === null || typeof body.sessionId === 'string') entry.design.sessionId = body.sessionId;
        if (body.projectDirectory === null || typeof body.projectDirectory === 'string') entry.design.projectDirectory = body.projectDirectory;
        touch(entry);
        emit(slug, 'design');
        return { design: entry.design };
      }
      case 'DELETE /designs/:slug':
        get(slug);
        designs.delete(slug);
        emit(slug, 'removed');
        return { trashedTo: `${root}\\.trash\\${slug}-20261026180000` };
      case 'POST /designs/:slug/comments': {
        const entry = get(slug);
        counter += 1;
        const comment: Comment = {
          id: `c_${counter.toString(36).padStart(4, '0')}${Math.random().toString(36).slice(2, 6)}`,
          screen: (body.screen as string | null) ?? null,
          viewport: String(body.viewport),
          // Safe: fake data for UI development; the real service validates (WP1).
          anchor: body.anchor as Comment['anchor'],
          body: String(body.body),
          status: 'open',
          created: new Date().toISOString(),
          sentAt: null,
          sentVersion: null,
        };
        entry.design.comments.push(comment);
        emit(slug, 'comments');
        return { comment };
      }
      case 'PATCH /designs/:slug/comments/:id':
      case 'DELETE /designs/:slug/comments/:id': {
        const entry = get(slug);
        const comment = entry.design.comments.find((item) => item.id === params.id);
        if (!comment) throw new FakeHttpError('not-found', 'That comment no longer exists.');
        emit(slug, 'comments');
        if (key.startsWith('DELETE')) {
          entry.design.comments = entry.design.comments.filter((item) => item.id !== params.id);
          return { ok: true };
        }
        if (typeof body.body === 'string') comment.body = body.body;
        if (body.status === 'open' || body.status === 'sent' || body.status === 'resolved') comment.status = body.status;
        return { comment };
      }
      case 'POST /designs/:slug/comments/mark-sent': {
        const entry = get(slug);
        const ids = new Set(Array.isArray(body.ids) ? body.ids : []);
        const changed = entry.design.comments.filter((comment) => ids.has(comment.id));
        for (const comment of changed) {
          comment.status = 'sent';
          comment.sentAt = new Date().toISOString();
          comment.sentVersion = typeof body.version === 'number' ? body.version : null;
        }
        emit(slug, 'comments');
        return { comments: changed };
      }
      case 'POST /uploads': {
        counter += 1;
        const uploadId = `u_fake${counter.toString().padStart(8, '0')}`;
        uploads.set(uploadId, { total: Number(body.total), parts: [] });
        return { uploadId };
      }
      case 'PUT /uploads/:id/:index': {
        const upload = uploads.get(params.id ?? '');
        if (!upload) throw new FakeHttpError('not-found', 'The upload expired. Try again.');
        upload.parts[Number(params.index)] = String(body.data);
        const received = upload.parts.join('').length;
        return { received, complete: received === upload.total };
      }
      case 'GET /outbox':
        return { outbox: outbox.value };
      case 'PUT /outbox':
        outbox.value = {
          sessionId: String(body.sessionId),
          slug: String(body.slug),
          text: String(body.text),
          commentIds: Array.isArray(body.commentIds) ? body.commentIds.map(String) : [],
          version: typeof body.version === 'number' ? body.version : null,
          created: new Date().toISOString(),
        };
        return { outbox: outbox.value };
      case 'DELETE /outbox': {
        const taken = outbox.value;
        outbox.value = null;
        return { outbox: taken };
      }
      case 'DELETE /open-request': {
        const taken = openRequest.value;
        openRequest.value = null;
        return { request: taken };
      }
      case 'POST /open-request': {
        const wanted = typeof body.slug === 'string' ? body.slug : '';
        if (!SLUG_PATTERN.test(wanted)) throw new FakeHttpError('bad-slug', 'That is not a design folder name.');
        if (!designs.has(wanted)) throw new FakeHttpError('not-found', 'That design is no longer in your Designs folder.');
        openRequest.value = { slug: wanted, intent: body.intent === 'comment' ? 'comment' : 'view', created: new Date().toISOString() };
        emit(wanted, 'open');
        return { ok: true };
      }
      case 'POST /session-events':
        return { ok: true };
      case 'POST /mentions/search': {
        const wanted = typeof body.query === 'string' ? body.query.trim().toLowerCase() : '';
        const items = [...designs.entries()]
          .filter(([name, entry]) => wanted === '' || name.includes(wanted) || entry.design.title.toLowerCase().includes(wanted))
          .sort(([, a], [, b]) => b.design.updated.localeCompare(a.design.updated))
          .slice(0, 20)
          .map(([name, entry]) => ({ id: name, title: entry.design.title, subtitle: mentionSubtitle(entry) }));
        return { items };
      }
      case 'POST /mentions/resolve': {
        const id = typeof body.id === 'string' ? body.id : '';
        if (!SLUG_PATTERN.test(id)) throw new FakeHttpError('bad-request', 'That is not a design folder name.');
        const entry = designs.get(id);
        if (!entry) throw new FakeHttpError('not-found', 'That design is no longer in your Designs folder.');
        const open = entry.design.comments.filter((comment) => comment.status === 'open');
        return {
          text: [
            `Design "${entry.design.title}" (${entry.design.kind}) from Design Chamber. Its folder: ${root}\\${id}`,
            `Open comments from the user: ${open.length === 0 ? 'none' : open.map((comment) => comment.body).join(' / ')}`,
            'Edit the files in that folder. Do not touch .versions/ or .chamber/.',
          ].join('\n'),
        };
      }
      case 'GET /status/designs': {
        const directory = query.directory ?? '';
        const session = query.session ?? '';
        const matched = [...designs.entries()]
          .filter(([, entry]) => directory === '' || (entry.design.projectDirectory !== null && sameDirectory(entry.design.projectDirectory, directory)))
          .sort(([, a], [, b]) => Number(b.design.sessionId === session && session !== '') - Number(a.design.sessionId === session && session !== '') || b.design.updated.localeCompare(a.design.updated));
        const rows: StatusDesignRow[] = matched.slice(0, STATUS_ROWS_MAX).map(([name, entry]) => ({
          slug: name,
          title: entry.design.title,
          kind: entry.design.kind,
          here: session !== '' && entry.design.sessionId === session,
          agent: null,
          lastFile: null,
          checks: { counts: { errors: 0, warnings: 0, notes: 0 }, render: { state: 'none' }, canRun: false, browser: false },
          pending: pending(entry),
          openComments: entry.design.comments.filter((comment) => comment.status === 'open').length,
        }));
        return { rows, total: matched.length };
      }
      case 'GET /designs/:slug/render': {
        const html = sourceOf(slug, query.screen);
        const renderKey = fakeHash(`${slug}|${query.screen ?? ''}|${query.version ?? ''}|${html}`);
        renders.set(renderKey, html);
        const size = options.renderChunkChars ?? Math.max(1, html.length);
        return {
          key: renderKey,
          chunks: Math.max(1, Math.ceil(html.length / size)),
          bytes: html.length,
          title: /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '',
          missing: [],
          blocked: [],
          external: [],
          warnings: [],
        };
      }
      case 'GET /designs/:slug/render/chunk': {
        const html = renders.get(query.key ?? '');
        if (html === undefined) throw new FakeHttpError('stale', 'The preview changed while loading. Loading it again.');
        const size = options.renderChunkChars ?? Math.max(1, html.length);
        const n = Number(query.n ?? '0');
        return html.slice(n * size, (n + 1) * size);
      }
      case 'GET /designs/:slug/source': {
        const text = sourceOf(slug, query.screen);
        return { text, bytes: text.length, sha256: fakeHash(text), utf8: true, link: false };
      }
      case 'GET /designs/:slug/thumbnail':
        get(slug);
        return { state: 'unavailable', key: null, message: 'No Chrome, Edge or Chromium browser was found; the list shows live previews instead.' };
      case 'POST /designs/:slug/thumbnail/refresh':
        get(slug);
        return { state: 'unavailable' };
      case 'GET /designs/:slug/versions': {
        const entry = get(slug);
        const newest = entry.versions.at(-1);
        return { versions: [...entry.versions], currentTreeHash: newest?.treeHash ?? fakeHash(slug), dirty: false };
      }
      case 'POST /designs/:slug/versions': {
        const entry = get(slug);
        const created = pushVersion(entry, body.reason === 'turn' ? 'turn' : 'manual', typeof body.sessionId === 'string' ? body.sessionId : null);
        if (typeof body.label === 'string') created.label = body.label;
        emit(slug, 'versions');
        return { created };
      }
      case 'POST /versions/turn': {
        const created: { slug: string; id: string }[] = [];
        for (const [name, entry] of designs) {
          if (entry.design.sessionId !== body.sessionId) continue;
          created.push({ slug: name, id: pushVersion(entry, 'turn', String(body.sessionId)).id });
          emit(name, 'versions');
        }
        return { created };
      }
      case 'GET /designs/:slug/versions/:vid/diff':
        get(slug);
        return { files: [] };
      case 'POST /designs/:slug/versions/:vid/restore': {
        const entry = get(slug);
        if (!entry.versions.some((version) => version.id === params.vid)) throw new FakeHttpError('not-found', 'That version no longer exists.');
        const restorePoint = pushVersion(entry, 'restore-point', null);
        const restored = pushVersion(entry, 'restored', null);
        emit(slug, 'versions');
        emit(slug, 'files', Object.keys(entry.files));
        return { restorePoint, restored, before: restorePoint };
      }
      case 'POST /designs/:slug/export': {
        get(slug);
        const format = body.format === 'html' ? 'html' : 'zip';
        return { path: `C:\\Users\\you\\Downloads\\${slug}.${format}`, bytes: 48_213, format };
      }
      case 'POST /reveal':
        return { ok: true };
      case 'GET /designs/:slug/checks':
        get(slug);
        return {
          static: { findings: [], partial: false, at: new Date().toISOString() },
          render: { state: 'none', at: null, artboards: 0, skipped: 0, findings: [] },
          counts: { errors: 0, warnings: 0, notes: 0 },
          canRun: false,
          browser: false,
        };
      case 'POST /designs/:slug/checks/run':
        throw new FakeHttpError('invalid', 'The rendering check is not available in this preview.');
      case 'GET /presets':
        return { presets: PRESETS };
      case 'POST /chip': {
        const kind = body.kind === 'page' ? 'page' : 'canvas';
        const brief = typeof body.brief === 'string' ? body.brief : '';
        const title = brief ? brief.slice(0, 60) : kind === 'page' ? 'Untitled page' : 'Untitled design';
        const created = createDesign(kind, title, brief, {
          projectDirectory: typeof body.projectDirectory === 'string' ? body.projectDirectory : null,
          preset: typeof body.preset === 'string' ? body.preset : null,
        });
        return { slug: created, chip: chipOf(created) };
      }
      case 'POST /designs/:slug/prompt': {
        const entry = get(slug);
        if (body.purpose === 'ask') {
          const words = typeof body.text === 'string' ? body.text.trim() : '';
          if (words === '') throw new FakeHttpError('bad-request', 'Write what you want the agent to do.');
          const element = typeof body.element === 'object' && body.element !== null ? (body.element as { anchor?: { selector?: string } }) : null;
          const lines = [
            `[Design Chamber] Request about the ${entry.design.kind} "${entry.design.title}".`,
            ...(element ? [`About this element: \`${element.anchor?.selector ?? ''}\``] : []),
            words,
          ];
          const hand = handEditsOf(entry);
          const text = lines.join('\n');
          return { text: hand ? `${hand.text}\n\n${text}` : text, commentIds: [], omitted: [], chip: chipOf(slug), handEdits: hand ? { upTo: hand.upTo, count: hand.count } : null };
        }
        const wanted = Array.isArray(body.commentIds) ? new Set(body.commentIds.map(String)) : null;
        // Like the service: no ids means every open comment; named ids are sent whatever their status.
        const comments = entry.design.comments.filter((comment) => (wanted ? wanted.has(comment.id) : comment.status === 'open'));
        if (body.purpose === 'revision' && wanted && comments.length === 0) throw new FakeHttpError('invalid', 'None of those comments exist any more.');
        const text =
          body.purpose === 'revision'
            ? `[Design Chamber] Revise "${entry.design.title}": ${comments.length} comment(s).\n` +
              comments.map((comment, index) => `${index + 1}. element: \`${comment.anchor.selector}\`\n   → ${comment.body}`).join('\n')
            : body.purpose === 'offline'
              ? `[Design Chamber] Make "${entry.design.title}" work offline: bundle remote files into assets/ or remove them.`
              : body.purpose === 'checks'
                ? `[Design Chamber] Fix what the check found in "${entry.design.title}".`
                : `[Design Chamber] Let's continue "${entry.design.title}".`;
        // A continue message carries no hand-edit block (§7.3); the revision/ask/fix purposes do.
        const hand = body.purpose === 'continue' ? null : handEditsOf(entry);
        return { text: hand ? `${hand.text}\n\n${text}` : text, commentIds: body.purpose === 'revision' ? comments.map((comment) => comment.id) : [], omitted: [], chip: chipOf(slug), handEdits: hand ? { upTo: hand.upTo, count: hand.count } : null };
      }
      case 'POST /pages/from-message': {
        const upload = uploads.get(String(body.uploadId));
        if (!upload) throw new FakeHttpError('not-found', 'The upload expired. Try again.');
        const text = upload.parts.join('');
        const html = /```html?\s*\n([\s\S]*?)```/i.exec(text)?.[1];
        if (!html) throw new FakeHttpError('no-html', 'No HTML code block in this message.');
        const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? String(body.sessionTitle || 'Page from chat');
        const created = createDesign('page', title, '', { sessionId: String(body.sessionId) }, html);
        if (body.open === true) openRequest.value = { slug: created, intent: 'view', created: new Date().toISOString() };
        return { slug: created, title };
      }
      // Phase 2 hand edits (T11a): real fake answers over the in-memory designs.
      case 'POST /designs/:slug/edits':
        return applyFakeEdit(slug, body);
      case 'POST /designs/:slug/edits/:id/undo':
        return undoFakeEdit(slug, params.id ?? '');
      case 'GET /designs/:slug/tokens':
        return fakeReadTokens(editGet(slug));
      case 'POST /designs/:slug/hand-edits/clear': {
        const entry = editGet(slug);
        const upTo = body.upTo;
        if (typeof upTo !== 'number' || !Number.isSafeInteger(upTo) || upTo < 1) throw new FakeHttpError('bad-request', 'That hand-edit position is not one Design Chamber handed out.');
        entry.edits.ledger = entry.edits.ledger.filter((item) => item.seq > upTo);
        return { ok: true };
      }
      // Phase 2 page-state seam stub: the service side is built (T8); the fake answers when its
      // controller/UI consumer lands (T11b/U5 develop against their own fakes and the visual harness).
      case 'GET /designs/:slug/page-state':
      case 'PATCH /designs/:slug/page-state':
      case 'DELETE /designs/:slug/page-state':
        get(slug);
        throw new FakeHttpError('internal', 'This part of Design Chamber (page-state) is not built yet.');
    }
  };

  const handle = async (request: GuestRequest): Promise<GuestRequestResult> => {
    requests.push(request);
    const matched = matchRoute(request.method, request.path);
    if (!matched) return { status: 404, body: JSON.stringify({ error: 'not-found', message: 'Unknown route.' }) };
    let body: Record<string, unknown> = {};
    if (request.body) {
      const parsed: unknown = JSON.parse(request.body);
      if (typeof parsed === 'object' && parsed !== null) body = parsed as Record<string, unknown>;
    }
    try {
      const answer = await route(matched, request.query ?? {}, body);
      return { status: 200, body: typeof answer === 'string' ? answer : JSON.stringify(answer) };
    } catch (error) {
      if (error instanceof FakeHttpError) return { status: API_ERROR_STATUS[error.code], body: JSON.stringify({ error: error.code, message: error.message }) };
      throw error;
    }
  };

  return {
    handle,
    designs,
    get outbox() {
      return outbox.value;
    },
    set outbox(value: Outbox | null) {
      outbox.value = value;
    },
    requests,
    emit,
    writeFile: (slug, file, text) => {
      const entry = get(slug);
      entry.files[file] = text;
      touch(entry);
      // An agent write between hand edits forces the next edit's own version (§2.4).
      entry.edits.coalesce = null;
      emit(slug, 'files', [file]);
    },
    writeLooseFile: (name, text) => {
      loose.set(name, { text, mtime: new Date().toISOString() });
      emit(null, 'loose');
    },
  };
};

// ---- Fake host ----

export const FAKE_THEME_TOKENS: HostThemeTokens = {
  background: '#151313',
  elevated: '#1d1b1a',
  foreground: '#ece6df',
  muted: '#a49b91',
  subtle: '#7d756c',
  border: '#34302d',
  hover: '#262321',
  selection: '#3a3430',
  focus: '#d8a25e',
  primary: '#d8a25e',
  mutedSurface: '#1a1817',
  elevatedForeground: '#ece6df',
  active: '#2e2a27',
  selectionForeground: '#ece6df',
  primaryForeground: '#1a1410',
  primaryText: '#e2b47a',
  successText: '#8fc79a',
  warningText: '#e0bb6a',
  errorText: '#ec8b7f',
  infoText: '#86b4e0',
  success: '#5f9f6b',
  warning: '#c79a3c',
  error: '#c4574b',
  info: '#4f84b8',
  font: 'system-ui, sans-serif',
  mono: 'ui-monospace, monospace',
  radius: '6px',
};

export type FakeHostCall = { method: string; args: unknown[] };

/** Per-method overrides; return a value or throw a `HostRequestError` to simulate the host. */
export type FakeHostBehavior = {
  prompt?: (request: PromptRequest) => Promise<PromptResult>;
  startSession?: (request: StartSessionRequest) => Promise<StartSessionResult>;
  openSession?: (sessionId: string) => Promise<void>;
  openSurface?: (surfaceId: string) => Promise<void>;
};

export type FakeHostOptions = {
  service?: FakeService;
  surface?: HostReadyContext['surface'];
  directory?: string | null;
  session?: SessionSnapshot | null;
  projects?: GuestProject[];
  /** Sessions `openSession` accepts; others throw NO_SESSION. */
  knownSessions?: string[];
};

export type FakeHost = HostLike & {
  readonly calls: FakeHostCall[];
  callsOf(method: string): unknown[][];
  behavior: FakeHostBehavior;
  readonly knownSessions: Set<string>;
  projects: GuestProject[];
  /** Push a ready snapshot (merged over the current one). */
  emitReady(patch?: Partial<HostReadyContext>): HostReadyContext;
  setSession(session: SessionSnapshot | null): void;
  setDirectory(directory: string | null): void;
  setItem(item: GuestItem | null): void;
  emitLifecycle(event: SessionLifecycleEvent): void;
  /** Push a sessions snapshot to `onSessions(projectId)` listeners. */
  emitSessions(projectId: string, sessions: GuestSessionRecord[], state?: GuestSessionsSnapshot['state']): void;
  /** The handler the guest registered with `onResolve`. */
  resolver(): Parameters<HostLike['onResolve']>[0] | null;
  /** The handler the guest registered with `onAction`. */
  actionHandler(): Parameters<HostLike['onAction']>[0] | null;
  /** A block frame: the call it draws (replayed to `onBlock` listeners, as the host does). */
  emitBlock(call: GuestBlockCall): void;
  /**
   * Stand-in for the host's click rule: `answerBlock` is refused (`DENIED`) unless this is true,
   * and a block takes one answer. A test sets it right before the click it simulates.
   */
  blockClick: boolean;
  /** What the frame answered the block with; `null` before that. */
  readonly blockAnswer: string | null;
};

export const createFakeHost = (options: FakeHostOptions = {}): FakeHost => {
  const service = options.service ?? createFakeService();
  const calls: FakeHostCall[] = [];
  const record = (method: string, ...args: unknown[]): void => {
    calls.push({ method, args });
  };
  const knownSessions = new Set(options.knownSessions ?? ['ses_fake_coffee']);
  let context: HostReadyContext = {
    theme: { mode: 'dark', tokens: FAKE_THEME_TOKENS },
    locale: 'en',
    directory: options.directory === undefined ? 'C:\\Users\\you\\projects\\shop' : options.directory,
    session: options.session ?? null,
    surface: options.surface ?? 'page',
    connection: { connected: true, account: '' },
    settings: {},
    item: null,
  };
  let emittedReady = false;
  let item: GuestItem | null = null;
  const storage = new Map<string, JsonValue>();
  let resolver: Parameters<HostLike['onResolve']>[0] | null = null;
  let actionHandler: Parameters<HostLike['onAction']>[0] | null = null;
  let block: GuestBlockCall | null = null;
  let blockAnswer: string | null = null;

  const readyListeners = new Set<(ctx: HostReadyContext) => void>();
  const sessionListeners = new Set<(session: SessionSnapshot | null) => void>();
  const directoryListeners = new Set<(directory: string | null) => void>();
  const itemListeners = new Set<(item: GuestItem | null) => void>();
  const lifecycleListeners = new Set<(event: SessionLifecycleEvent) => void>();
  const blockListeners = new Set<(call: GuestBlockCall) => void>();
  const sessionsListeners = new Map<string, Set<(snapshot: GuestSessionsSnapshot) => void>>();
  const sessionsSnapshots = new Map<string, GuestSessionsSnapshot>();

  const listen = <T>(set: Set<(value: T) => void>, listener: (value: T) => void, replay: (() => T) | null): (() => void) => {
    set.add(listener);
    if (replay) listener(replay());
    return () => set.delete(listener);
  };

  const setSession = (session: SessionSnapshot | null): void => {
    context = { ...context, session };
    for (const listener of [...sessionListeners]) listener(session);
  };

  const fake: FakeHost = {
    calls,
    callsOf: (method) => calls.filter((call) => call.method === method).map((call) => call.args),
    behavior: {},
    knownSessions,
    projects: options.projects ?? [{ id: 'proj_shop', name: 'shop', directory: 'C:\\Users\\you\\projects\\shop' }],

    onReady: (listener) => listen(readyListeners, listener, emittedReady ? () => context : null),
    onSession: (listener) => listen(sessionListeners, listener, () => context.session),
    onDirectory: (listener) => listen(directoryListeners, listener, () => context.directory),
    onItem: (listener) => listen(itemListeners, listener, () => item),
    onSessionLifecycle: (listener) => listen(lifecycleListeners, listener, null),
    onBlock: (listener) => {
      blockListeners.add(listener);
      if (block !== null) listener(block);
      return () => void blockListeners.delete(listener);
    },
    answerBlock: async (text) => {
      record('answerBlock', text);
      if (!fake.blockClick) throw new HostRequestError('DENIED', 'A block answers only from a click.');
      if (blockAnswer !== null) throw new HostRequestError('HOST_REJECTED', 'This block already has its answer.');
      fake.blockClick = false;
      blockAnswer = text;
      if (block !== null) block = { ...block, answered: text };
    },
    setHeight: async (height) => record('setHeight', height),
    onResolve: (handler) => {
      resolver = handler;
      return () => {
        resolver = null;
      };
    },
    onAction: (handler) => {
      actionHandler = handler;
      return () => {
        actionHandler = null;
      };
    },

    serviceRequest: (request) => service.handle(request),

    listProjects: async () => ({ kind: 'projects', state: 'ready', projects: fake.projects }),
    onSessions: async (projectId, listener) => {
      const set = sessionsListeners.get(projectId) ?? new Set();
      sessionsListeners.set(projectId, set);
      set.add(listener);
      const current = sessionsSnapshots.get(projectId);
      if (current) listener(current);
      return () => set.delete(listener);
    },

    openSession: async (sessionId) => {
      record('openSession', sessionId);
      if (fake.behavior.openSession) return fake.behavior.openSession(sessionId);
      if (!knownSessions.has(sessionId)) throw new HostRequestError('NO_SESSION', 'That session does not exist.');
      setSession({ id: sessionId, title: 'Chat', busy: false });
    },
    openSurface: async (surfaceId) => {
      record('openSurface', surfaceId);
      if (fake.behavior.openSurface) return fake.behavior.openSurface(surfaceId);
    },
    startSession: async (request) => {
      record('startSession', request);
      if (fake.behavior.startSession) return fake.behavior.startSession(request);
      if (!context.directory && !request.projectId) throw new HostRequestError('NO_DIRECTORY', 'Open a project first.');
      const sessionId = `ses_fake${knownSessions.size + 1}`;
      knownSessions.add(sessionId);
      if (request.navigation === 'open') setSession({ id: sessionId, title: request.title, busy: false });
      return { sessionId, sent: request.text ? 'sent' : 'skipped', directory: context.directory ?? '' };
    },
    prompt: async (request) => {
      record('prompt', request);
      if (fake.behavior.prompt) return fake.behavior.prompt(request);
      if (!context.session) throw new HostRequestError('NO_SESSION', 'No open session.');
      if (request.send && context.session.busy) throw new HostRequestError('SESSION_BUSY', 'Session is busy.');
      return { sent: request.send ? 'sent' : 'skipped' };
    },
    compose: async (request) => record('compose', request),
    attach: async (request) => record('attach', request),
    toast: async (request) => record('toast', request),
    openUrl: async (url) => record('openUrl', url),
    writeClipboard: async (text) => record('writeClipboard', text),
    close: async () => record('close'),
    storage: {
      get: async (key) => storage.get(key),
      set: async (key, value) => {
        storage.set(key, value);
      },
      delete: async (key) => {
        storage.delete(key);
      },
      keys: async () => [...storage.keys()].sort(),
    },

    emitReady: (patch = {}) => {
      context = { ...context, ...patch };
      emittedReady = true;
      if (patch.item !== undefined) item = patch.item;
      for (const listener of [...readyListeners]) listener(context);
      return context;
    },
    setSession,
    setDirectory: (directory) => {
      context = { ...context, directory };
      for (const listener of [...directoryListeners]) listener(directory);
    },
    setItem: (next) => {
      item = next;
      context = { ...context, item: next };
      for (const listener of [...itemListeners]) listener(next);
    },
    emitLifecycle: (event) => {
      for (const listener of [...lifecycleListeners]) listener(event);
    },
    emitSessions: (projectId, sessions, state = 'ready') => {
      const snapshot: GuestSessionsSnapshot = { kind: 'sessions', projectId, state, coverage: [], sessions };
      sessionsSnapshots.set(projectId, snapshot);
      for (const listener of [...(sessionsListeners.get(projectId) ?? [])]) listener(snapshot);
    },
    resolver: () => resolver,
    actionHandler: () => actionHandler,
    emitBlock: (call) => {
      block = call;
      blockAnswer = call.answered;
      for (const listener of [...blockListeners]) listener(call);
    },
    blockClick: false,
    get blockAnswer() {
      return blockAnswer;
    },
  };
  return fake;
};

export type FakeServices = { host: FakeHost; guestHost: GuestHost; client: ServiceClient; service: FakeService };

/** A fake host + service + the real guest-core wrappers over them. */
export const createFakeServices = (options: FakeHostOptions & FakeServiceOptions = {}): FakeServices => {
  const service = options.service ?? createFakeService(options);
  const host = createFakeHost({ ...options, service });
  const guestHost = createGuestHost(host);
  const client = createServiceClient(host);
  return { host, guestHost, client, service };
};
