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
} from '../../../src/shared/api.ts';
import { CHIP_PROVIDER_ID, type ChangeEvent, type SystemDetail, type SystemSection, type SystemSummary } from '../../../src/shared/types.ts';
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
    'POST /systems/:id/prompt': (req: Req & { body: { purpose: string } }) => SystemPromptResponse;
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
        if ('name' in body) row.name = checkName(body.name, row.id);
        else if ('status' in body) row.status = body.status;
        row.updated = new Date().toISOString();
        deps.emit(null, 'system');
        return { system: { ...row } };
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
      'POST /systems/:id/prompt': ({ params }) => {
        const row = find(params.id);
        log.prompts += 1;
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
      setDefaultId: (id) => {
        rows = rows.map((row) => ({ ...row, isDefault: row.id === id }));
        deps.emit(null, 'system');
      },
    },
  };
};
