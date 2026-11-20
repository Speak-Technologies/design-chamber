// Visual harness only: an in-memory design systems book (Phase 2.5 U1) behind the `/systems`, `/system-scans`, `/uploads` and
// brand-file routes, with hooks so a scenario can seed the list, make it fail, slow the scan, refuse a file or make the
// agent request fail. The real rules (names, caps, file checks, scans) are the service's (test/service/systems/*.test.ts);
// this answers the same shapes with the same sentences for the screens.

import type {
  AddSystemAssetResponse,
  AssetsFromFolderResponse,
  CreateSystemResponse,
  CreateUploadResponse,
  DeleteSystemResponse,
  OkResponse,
  PatchSystemBody,
  PatchSystemResponse,
  PutUploadChunkResponse,
  ScanSummary,
  SystemListResponse,
  SystemPromptResponse,
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
import { CHIP_PROVIDER_ID, type ChangeEvent, type SystemDetail, type SystemSection, type SystemSummary, type SystemToken, type VersionSummary } from '../../../src/shared/types.ts';
import { SYSTEM_NAME_MAX, SYSTEMS_MAX } from '../../../src/shared/limits.ts';
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
  ...over,
});

/** The five systems of the 360 px mockup: every badge, the folding, the shared-repo notice. */
export const sampleSystems = (): SystemSummary[] => [
  blank({
    id: 'tidepool',
    name: 'Tidepool',
    status: 'ready',
    changesToReview: true,
    isDefault: true,
    pinnedFor: [SHOP],
    usedBy: 4,
    updated: ago(2 * HOUR),
    revision: 9,
    home: { repo: 'tidepool-web', directory: TIDEPOOL },
    sources: { code: { directory: TIDEPOOL, lastScan: ago(DAY), partial: false }, brand: 0, description: false },
    sharedRepoWith: 'Acme',
  }),
  blank({ id: 'acme', name: 'Acme', status: 'draft', building: true, updated: ago(MINUTE / 2), home: { repo: 'tidepool-web', directory: TIDEPOOL }, sharedRepoWith: 'Tidepool' }),
  blank({
    id: 'harbor',
    name: 'Harbor',
    status: 'ready',
    changesToReview: true,
    pinnedFor: [SHOP],
    usedBy: 2,
    updated: ago(DAY),
    revision: 4,
    sources: { code: null, brand: 3, description: true },
  }),
  blank({ id: 'field-notes', name: 'Field notes', status: 'ready', usedBy: 1, updated: ago(3 * DAY), revision: 2, sources: { code: null, brand: 0, description: true } }),
  blank({
    id: 'juniper',
    name: 'Juniper',
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
  counts: { colours: 48, typography: 9, spacing: 12, radius: 4, shadows: 3, layers: 0, sizes: 0, other: 0, fonts: 3, logos: 2 },
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
});

const EMPTY_SCAN = (directory: string): ScanSummary => ({
  directory,
  counts: { colours: 0, typography: 0, spacing: 0, radius: 0, shadows: 0, layers: 0, sizes: 0, other: 0, fonts: 0, logos: 0 },
  files: [],
  skipped: [],
  assets: [],
  forAgent: [],
  refused: 0,
  partial: false,
});

const SECTIONS: readonly SystemSection[] = ['overview', 'colours', 'typography', 'spacing', 'radius', 'shadows', 'layers', 'sizes', 'components', 'patterns', 'brand', 'assets'];

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
    { id: 'button', name: 'Button', purpose: 'Starts or confirms one action.', note: '', variants: ['Filled', 'Outline', 'Ghost'], states: ['Hover', 'Disabled', 'Loading'], tokens: ['--brand', '--radius-md'], source: 'src/ui/Button.tsx', example: null, undefinedTokens: [] },
    { id: 'card', name: 'Card', purpose: 'Groups related content on a raised surface.', note: 'Never nest a card in a card.', variants: ['Plain'], states: [], tokens: ['--surface-raised', '--border'], source: null, example: null, undefinedTokens: ['--card-pad'] },
  ];
  detail.notes = [{ id: 'accessibility', title: 'Accessibility', text: 'Text keeps 4.5 to 1 contrast on its background.', problem: null }];
  detail.patterns = [{ id: 'forms', kind: 'pattern', title: 'Forms', note: '', text: 'Labels sit above fields. Errors sit under the field in plain words.', problem: null }];
  detail.brand = [{ id: 'voice', kind: 'voice', title: 'Voice', note: '', text: 'Plain and warm. Short sentences.', problem: null }];
  detail.fonts = [{ file: 'inter.woff2', family: 'Inter', weight: 400, style: 'normal' }];
  detail.logos = [{ file: 'mark.svg', variant: 'Mark', note: 'Use on light surfaces.' }];
  detail.stamps = { tokens: 'tk:1', systemJson: 'sj:1', overview: 'ov:1', notes: { accessibility: 'nt:1' } };
};

type Req = { params: Record<string, string> };

export type FakeSystems = {
  handlers: {
    'GET /systems': () => SystemListResponse;
    'POST /systems': (req: { body: { name: string; code?: { scanId: string; assets: string[] }; description?: { text: string; preset: string | null }; brand?: true } }) => CreateSystemResponse;
    'PATCH /systems/:id': (req: Req & { body: PatchSystemBody }) => PatchSystemResponse;
    'DELETE /systems/:id': (req: Req) => DeleteSystemResponse;
    'POST /system-scans': (req: { body: { directory: string } }) => CreateSystemScanResponse;
    'GET /system-scans/:scanId': (req: Req) => SystemScanResponse;
    'DELETE /system-scans/:scanId': (req: Req) => OkResponse;
    'POST /uploads': (req: { body: { total: number; encoding?: 'text' | 'base64' } }) => CreateUploadResponse;
    'PUT /uploads/:id/:index': (req: Req & { body: { data: string } }) => PutUploadChunkResponse;
    'POST /systems/:id/assets': (req: Req & { body: { uploadId: string; name: string; kind: 'font' | 'logo' | 'source' } }) => AddSystemAssetResponse;
    'POST /systems/:id/assets/from-folder': (req: Req & { body: { directory: string } }) => AssetsFromFolderResponse;
    'POST /systems/:id/prompt': (req: Req & { body: { purpose: string; text?: string; entry?: string; section?: string } }) => SystemPromptResponse;
    'GET /systems/:id': (req: Req) => SystemDetail;
    'POST /systems/:id/edits': (req: Req & { body: SystemEditRequest }) => SystemEditResponse;
    'POST /systems/:id/edits/:eid/undo': (req: Req) => SystemUndoEditResponse;
    'POST /systems/:id/hand-edits/clear': (req: Req) => Ok;
    'GET /systems/:id/board': (req: Req & { query: { version?: string; scheme?: string } }) => RenderMeta;
    'GET /systems/:id/board/chunk': (req: Req & { query: { key?: string } }) => RenderChunkResponse;
    'GET /systems/:id/versions': (req: Req) => VersionListResponse;
    'GET /systems/:id/versions/:vid/diff': (req: Req) => VersionDiffResponse;
    'POST /systems/:id/versions/:vid/restore': (req: Req) => RestoreVersionResponse;
  };
  hooks: {
    /** The list now (no event). */
    seed: (systems: SystemSummary[]) => void;
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
    /** A system with this coverage (areas), to show the uncovered sentence. */
    setCoverage: (id: string, coverage: SystemDetail['coverage']) => void;
    /** What saves, undos, reviews and prompts reached the service. */
    pageLog: () => { saves: SystemEditRequest[]; undos: string[]; reviews: Array<{ section: string; state: string }>; asks: Array<{ purpose: string; text?: string; entry?: string; section?: string }> };
  };
};

export const createFakeSystems = (deps: { emit: (slug: string | null, kind: ChangeEvent['kind']) => void }): FakeSystems => {
  let rows: SystemSummary[] = sampleSystems();
  let failing = false;
  let promptFailure: string | null = null;
  let slowPolls = 2;
  let scanN = 0;
  let uploadN = 0;
  const scans = new Map<string, { directory: string; polls: number }>();
  const uploads = new Map<string, { total: number; chunks: number; encoding: string }>();
  const log: ReturnType<FakeSystems['hooks']['log']> = { created: [], uploads: [], assets: [], prompts: 0, scanDirectories: [], cancelled: 0 };
  const details = new Map<string, SystemDetail>();
  const undos = new Map<string, string>();
  const versions = new Map<string, VersionSummary[]>();
  const pageLog: ReturnType<FakeSystems['hooks']['pageLog']> = { saves: [], undos: [], reviews: [], asks: [] };
  let staleOnce = false;
  let detailFailing = false;
  let editN = 0;

  const detailFor = (row: SystemSummary): SystemDetail => {
    let detail = details.get(row.id);
    if (!detail) {
      detail = detailOf(row);
      if (!row.empty && !row.unreadable && row.id !== 'field-notes') fillIn(detail, row.id === 'juniper' ? ['foundations', 'components'] : ['foundations', 'components', 'patterns', 'brand']);
      if (row.id === 'harbor') for (const section of ['colours', 'typography'] as const) detail.review[section] = { state: 'looks-good', note: null };
      details.set(row.id, detail);
    }
    detail.name = row.name;
    detail.status = row.status;
    detail.updated = row.updated;
    return detail;
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
    return `<!doctype html><html><head><meta charset="utf-8"><title>${detail.name}</title><style>body{margin:0;padding:28px;background:${bg};color:${fg};font:15px system-ui,sans-serif}h1{margin:0 0 16px;font-size:26px}h2{font-size:13px;margin:26px 0 10px;opacity:.7}.row{display:flex;flex-wrap:wrap;gap:12px}.sw{margin:0;width:110px}.sw span{display:block;height:64px;border-radius:10px;border:1px solid #8884}.sw figcaption{font-size:12px;margin-top:4px}.cmp{padding:12px 18px;border:1px solid #8886;border-radius:10px}[data-dc-entry]{cursor:pointer}</style></head><body><h1>${detail.name}</h1><h2>Colours</h2><div class="row">${colours}</div><h2>Typography</h2>${types}<h2>Components</h2><div class="row">${parts}</div></body></html>`;
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
      'GET /systems': () => {
        if (failing) throw new ServiceError('internal', 'The design systems list could not be read.');
        return { systems: rows.map((row) => ({ ...row })), total: rows.length, max: SYSTEMS_MAX };
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
        scanN += 1;
        const scanId = `sc_fakescan${String(scanN).padStart(10, '0')}`;
        scans.set(scanId, { directory, polls: 0 });
        log.scanDirectories.push(directory);
        return { scanId };
      },
      'GET /system-scans/:scanId': ({ params }) => {
        const scan = scans.get(params.scanId ?? '');
        if (!scan) throw new ServiceError('not-found', 'That scan is gone. Read the project again.');
        scan.polls += 1;
        if (scan.polls <= slowPolls) return { state: 'running', seen: scan.polls * 240 };
        if (/unreadable/i.test(scan.directory)) return { state: 'failed', message: `Design Chamber can’t read ${scan.directory}. Permission denied.` };
        return { state: 'done', summary: /empty/i.test(scan.directory) ? EMPTY_SCAN(scan.directory) : sampleScan(scan.directory) };
      },
      'DELETE /system-scans/:scanId': ({ params }) => {
        scans.delete(params.scanId ?? '');
        log.cancelled += 1;
        return { ok: true };
      },
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
      'POST /systems/:id/hand-edits/clear': ({ params }) => {
        find(params.id);
        return { ok: true };
      },
      'GET /systems/:id/board': ({ params, query }) => {
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
        pageLog.asks.push({ purpose: body.purpose, ...(body.text ? { text: body.text } : {}), ...(body.entry ? { entry: body.entry } : {}), ...(body.section ? { section: body.section } : {}) });
        if (promptFailure !== null) throw new ServiceError('internal', promptFailure);
        return {
          text: `[Design Chamber] Write the design system "${row.name}". Its folder is _systems/${row.id}. Write only there.`,
          chip: { providerId: CHIP_PROVIDER_ID, id: `system:${row.id}`, title: row.name, url: '', text: 'Write this design system.', data: { system: row.id } },
          handEdits: null,
        };
      },
    },
    hooks: {
      seed: (next) => {
        rows = next.map((row) => ({ ...row }));
      },
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
      failDetail: (fail) => {
        detailFailing = fail;
      },
      setCoverage: (id, coverage) => {
        detailFor(find(id)).coverage = coverage;
      },
      pageLog: () => pageLog,
      setDefaultId: (id) => {
        rows = rows.map((row) => ({ ...row, isDefault: row.id === id }));
        deps.emit(null, 'system');
      },
    },
  };
};
