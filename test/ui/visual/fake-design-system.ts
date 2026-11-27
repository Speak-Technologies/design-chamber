// Visual harness only: each design's system link (Phase 2.5 U4) behind `GET/POST /designs/:slug/system`,
// `GET .../system/preview` and the `token-reset` edit, plus the settings answer (default and pins) and the
// list summary's `system`. The rules (stamps, revisions, diffs) are the service's (test/service/**); this
// answers the same shapes with the same sentences so the chip, banner, popover and sheets can be looked at.

import type {
  CopyRecordView,
  DesignSystemActionBody,
  DesignSystemActionResponse,
  DesignSystemView,
  EditResponse,
  Override,
  SettingsResponse,
  SystemPreviewResponse,
} from '../../../src/shared/api.ts';
import type { ChangeEvent, DesignSystemSummary, SystemChoiceView, SystemDefaultSetting, SystemPinSetting, SystemPinView, SystemSummary, VersionSummary } from '../../../src/shared/types.ts';
import { ServiceError } from './service-error.ts';

const MINUTE = 60_000;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

type Linked = {
  kind: 'linked';
  id: string;
  name: string;
  revision: number;
  by: 'user' | 'agent' | 'creation';
  at: string;
  before: string | null;
  overrides: Override[];
  missing: string[];
  drift: string[];
  invalid: boolean;
  ownTokens: number;
};
type State = Linked | { kind: 'none' } | { kind: 'ask' } | { kind: 'unset' };

export type FakeDesignSystem = {
  handlers: {
    'GET /designs/:slug/system': (req: Req) => DesignSystemView;
    'GET /designs/:slug/system/preview': (req: Req) => SystemPreviewResponse;
    'POST /designs/:slug/system': (req: Req & { body: DesignSystemActionBody }) => DesignSystemActionResponse;
  };
  /** The settings answer's `systems` part, and what a PUT changes. */
  settings: () => NonNullable<SettingsResponse['systems']>;
  putSettings: (body: { systemDefault?: SystemDefaultSetting | null; systemPins?: SystemPinSetting[] | null }) => void;
  summary: (slug: string) => DesignSystemSummary | null;
  resetTokens: (slug: string, base: string, names: string[]) => EditResponse;
  /** The design's files were put back to a version (Undo): its system record goes back too. */
  restored: (slug: string, versionId: string) => void;
  hooks: {
    /** Link a design to a system at a copy revision (default: the system's own). */
    link: (slug: string, id: string, options?: { revision?: number; overrides?: Override[]; missing?: string[]; drift?: string[]; by?: 'user' | 'agent' }) => void;
    unlink: (slug: string, kind: 'none' | 'ask' | 'unset') => void;
    /** The agent switches the design to another system while it is open (a `files` event on the design). */
    agentSwitch: (slug: string, id: string) => void;
    /** A system's revision goes up (a `system` event), so linked designs have an update. */
    bump: (id: string) => void;
    staleNext: () => void;
    failNext: (message: string) => void;
    log: () => { sets: Array<{ slug: string; to: string }>; updates: Array<{ slug: string; toRevision: number }>; resets: Array<{ slug: string; names: string[] }>; gets: number };
    settingsNotices: (notices: string[]) => void;
  };
};

type Req = { params: Record<string, string>; query: Record<string, string> };

const TOKEN_NAMES = ['--color-accent', '--color-accent-hover', '--color-surface', '--color-surface-raised', '--color-text', '--color-text-muted', '--color-border', '--radius-md', '--radius-lg', '--space-4', '--space-6', '--font-body'];

export const createFakeDesignSystem = (deps: {
  emit: (slug: string | null, kind: ChangeEvent['kind'], files?: string[]) => void;
  rows: () => SystemSummary[];
  checkpoint: (slug: string) => VersionSummary;
  exists: (slug: string) => boolean;
  setRows: (rows: SystemSummary[]) => void;
}): FakeDesignSystem => {
  const states = new Map<string, State>();
  const snapshots = new Map<string, State>();
  const tokensN = new Map<string, number>();
  const copyN = new Map<string, number>();
  let staleOnce = false;
  let failure: string | null = null;
  let notices: string[] = [];
  let settingsDefault: SystemDefaultSetting = { choice: 'ask' };
  let settingsPins: SystemPinSetting[] = [];
  const log: ReturnType<FakeDesignSystem['hooks']['log']> = { sets: [], updates: [], resets: [], gets: 0 };

  const row = (id: string): SystemSummary | undefined => deps.rows().find((entry) => entry.id === id);
  const stateOf = (slug: string): State => states.get(slug) ?? { kind: 'unset' };
  const tok = (slug: string): number => tokensN.get(slug) ?? 1;
  const cop = (slug: string): number => copyN.get(slug) ?? 1;
  const stampOf = (slug: string): string => `copy${String(cop(slug)).padStart(59, '0')}:tok${String(tok(slug)).padStart(61, '0')}`;

  const linkState = (state: Linked): 'ok' | 'draft' | 'deleted' => {
    const system = row(state.id);
    return system === undefined ? 'deleted' : system.status === 'draft' ? 'draft' : 'ok';
  };
  const nameOf = (state: Linked): string => row(state.id)?.name ?? state.name;

  const view = (slug: string): DesignSystemView => {
    const state = stateOf(slug);
    const base = { copy: { complete: true, missing: [] as string[], drift: [] as string[], invalid: false }, stamp: stampOf(slug), choiceProblem: null };
    if (state.kind !== 'linked') return { ...base, status: { state: state.kind }, link: null, systemRevision: null, updateAvailable: false, overrides: [], ownTokens: 0 };
    const system = row(state.id);
    const ls = linkState(state);
    const link: CopyRecordView = { v: 1, id: state.id, name: nameOf(state), revision: state.revision, treeHash: 'tree', at: state.at, by: state.by, before: state.before, fileCount: 14 };
    return {
      ...base,
      copy: { complete: state.missing.length === 0 && !state.invalid, missing: state.missing, drift: state.drift, invalid: state.invalid },
      status: { state: 'linked', id: state.id, name: nameOf(state), linkState: ls },
      link,
      systemRevision: system?.revision ?? null,
      updateAvailable: ls === 'ok' && system !== undefined && system.revision > state.revision,
      overrides: state.overrides,
      ownTokens: state.ownTokens,
    };
  };

  const diffOf = (names: string[], take: number): { name: string; from: string; to: string }[] => names.slice(0, take).map((name, index) => ({ name, from: `#${(0x3a6ea5 + index * 4001).toString(16).padStart(6, '0')}`, to: `#${(0x2f5d8a + index * 5003).toString(16).padStart(6, '0')}` }));

  const preview = (slug: string, to: string): SystemPreviewResponse => {
    const state = stateOf(slug);
    const own = state.kind === 'linked' ? state.ownTokens : 0;
    const overrides = state.kind === 'linked' ? state.overrides.map((entry) => entry.name) : [];
    const stamp = stampOf(slug);
    if (to === 'none') {
      return { fromRevision: state.kind === 'linked' ? state.revision : null, toRevision: null, tokens: { changed: [], added: [], removed: TOKEN_NAMES.slice(0, 5), totals: { changed: 0, added: 0, removed: 5 } }, components: { changed: [], added: [], removed: ['Button', 'Card'], totals: { changed: 0, added: 0, removed: 2 } }, overrides, ownTokens: own, bytes: 0, stamp };
    }
    const system = row(to);
    if (system === undefined) throw new ServiceError('not-found', 'That design system is not there any more.');
    if (state.kind === 'linked' && state.id === to) {
      const from = state.revision;
      const newer = system.revision > from;
      return {
        fromRevision: from,
        toRevision: system.revision,
        tokens: newer
          ? { changed: diffOf(TOKEN_NAMES, 5), added: ['--color-focus', '--space-8'], removed: ['--shadow-old'], totals: { changed: 5, added: 2, removed: 1 } }
          : { changed: [], added: [], removed: [], totals: { changed: 0, added: 0, removed: 0 } },
        components: newer ? { changed: ['Button', 'Field'], added: ['Toast'], removed: [], totals: { changed: 2, added: 1, removed: 0 } } : { changed: [], added: [], removed: [], totals: { changed: 0, added: 0, removed: 0 } },
        overrides,
        ownTokens: own,
        bytes: newer ? 6_400 : 0,
        stamp,
      };
    }
    return {
      fromRevision: state.kind === 'linked' ? state.revision : null,
      toRevision: system.revision,
      tokens: { changed: diffOf(TOKEN_NAMES, 12), added: ['--color-focus', '--space-8', '--font-display', '--radius-sm'], removed: [], totals: { changed: 12, added: 4, removed: 0 } },
      components: { changed: ['Button', 'Card', 'Field'], added: ['Toast'], removed: [], totals: { changed: 3, added: 1, removed: 0 } },
      overrides,
      ownTokens: own || 6,
      bytes: 22_000,
      stamp,
    };
  };

  const stalely = (slug: string, stamp: string): void => {
    if (staleOnce) {
      staleOnce = false;
      throw new ServiceError('stale', 'This design changed while the update was open. Reload and try again.');
    }
    if (stamp !== stampOf(slug)) throw new ServiceError('stale', 'This design changed while the update was open. Reload and try again.');
  };

  const guard = (slug: string | undefined): string => {
    if (slug === undefined || !deps.exists(slug)) throw new ServiceError('not-found', 'That design is not there any more.');
    return slug;
  };

  const touchCopy = (slug: string): void => {
    copyN.set(slug, cop(slug) + 1);
    tokensN.set(slug, tok(slug) + 1);
  };

  const seedLink = (slug: string, id: string, options: { revision?: number; overrides?: Override[]; missing?: string[]; drift?: string[]; by?: 'user' | 'agent' } = {}): void => {
    const system = row(id);
    states.set(slug, {
      kind: 'linked',
      id,
      name: system?.name ?? id,
      revision: options.revision ?? system?.revision ?? 1,
      by: options.by ?? 'user',
      at: new Date().toISOString(),
      before: null,
      overrides: options.overrides ?? [],
      missing: options.missing ?? [],
      drift: options.drift ?? [],
      invalid: false,
      ownTokens: 6,
    });
  };

  // Nothing is waiting by default, so the other scenarios see no update banner; design-system-chip.mjs links Harbor at revision 3 (hooks.link).
  seedLink('coffee-subscription', 'tidepool');
  seedLink('northwind-pricing', 'tidepool');
  states.set('invoice-template', { kind: 'none' });
  states.set('launch-announcement', { kind: 'ask' });

  const choiceOf = (setting: SystemDefaultSetting): SystemChoiceView => {
    if (setting.choice !== 'system') return { ...setting, state: 'ok', sentence: null };
    const system = row(setting.id);
    if (system === undefined) return { ...setting, state: 'deleted', sentence: `${setting.name} was deleted. New designs ask you in chat.` };
    if (system.status === 'draft') return { ...setting, name: system.name, state: 'draft', sentence: `${system.name} is a draft. New designs ask you in chat until it is Ready.` };
    return { ...setting, name: system.name, state: 'ok', sentence: null };
  };
  const pinOf = (pin: SystemPinSetting): SystemPinView => {
    if (pin.choice !== 'system' || pin.id === undefined) return { ...pin, state: 'ok', sentence: null };
    const system = row(pin.id);
    if (system === undefined) return { ...pin, state: 'deleted', sentence: `${pin.name ?? pin.id} was deleted. This project uses the default.` };
    if (system.status === 'draft') return { ...pin, name: system.name, state: 'draft', sentence: `${system.name} is a draft. This project uses the default until it is Ready.` };
    return { ...pin, name: system.name, state: 'ok', sentence: null };
  };

  return {
    handlers: {
      'GET /designs/:slug/system': ({ params }) => {
        log.gets += 1;
        return view(guard(params.slug));
      },
      'GET /designs/:slug/system/preview': ({ params, query }) => preview(guard(params.slug), query.to ?? ''),
      'POST /designs/:slug/system': ({ params, body }) => {
        const slug = guard(params.slug);
        if (failure !== null) {
          const message = failure;
          failure = null;
          throw new ServiceError('internal', message);
        }
        stalely(slug, body.stamp);
        const state = stateOf(slug);
        if (body.action === 'update') {
          if (state.kind !== 'linked') throw new ServiceError('invalid', 'This design has no system to update.');
          const system = row(state.id);
          if (system === undefined || system.revision <= state.revision) return { before: null, status: view(slug).status, notice: 'unchanged' };
          log.updates.push({ slug, toRevision: body.toRevision });
          const before = deps.checkpoint(slug);
          snapshots.set(before.id, JSON.parse(JSON.stringify(state)) as State);
          states.set(slug, { ...state, revision: system.revision, at: new Date().toISOString(), by: 'user', before: before.id });
          touchCopy(slug);
          deps.emit(slug, 'files', ['system/COPY.json']);
          return { before, status: view(slug).status, notice: 'updated' };
        }
        log.sets.push({ slug, to: body.to });
        if (state.kind === 'linked' && state.id === body.to) return { before: null, status: view(slug).status, notice: 'unchanged' };
        const before = deps.checkpoint(slug);
        snapshots.set(before.id, JSON.parse(JSON.stringify(state)) as State);
        if (body.to === 'none') {
          states.set(slug, { kind: 'none' });
          touchCopy(slug);
          deps.emit(slug, 'files', ['system/COPY.json']);
          return { before, status: view(slug).status, notice: 'removed' };
        }
        const system = row(body.to);
        if (system === undefined) throw new ServiceError('not-found', 'That design system is not there any more.');
        const was = state.kind === 'linked';
        seedLink(slug, body.to, { by: 'user' });
        const next = states.get(slug);
        if (next?.kind === 'linked') next.before = before.id;
        touchCopy(slug);
        deps.emit(slug, 'files', ['system/COPY.json']);
        return { before, status: view(slug).status, notice: was ? 'switched' : 'linked' };
      },
    },
    settings: () => ({ default: choiceOf(settingsDefault), pins: settingsPins.map(pinOf), notices }),
    putSettings: (body) => {
      if (body.systemDefault !== undefined) {
        settingsDefault = body.systemDefault ?? { choice: 'ask' };
        const chosen = settingsDefault;
        deps.setRows(deps.rows().map((entry) => ({ ...entry, isDefault: chosen.choice === 'system' && chosen.id === entry.id })));
      }
      if (body.systemPins !== undefined) settingsPins = body.systemPins ?? [];
      notices = [];
    },
    summary: (slug) => {
      const state = stateOf(slug);
      if (state.kind !== 'linked') return null;
      const system = row(state.id);
      const ls = linkState(state);
      return { id: state.id, name: nameOf(state), revision: state.revision, state: ls, updateAvailable: ls === 'ok' && system !== undefined && system.revision > state.revision };
    },
    resetTokens: (slug, base, names) => {
      guard(slug);
      if (base !== `tok${String(tok(slug)).padStart(61, '0')}`) throw new ServiceError('stale', 'This override changed since you opened the update. Reload and try again.');
      const state = stateOf(slug);
      if (state.kind !== 'linked') throw new ServiceError('invalid', 'This design has no system.');
      log.resets.push({ slug, names });
      state.overrides = state.overrides.filter((entry) => !names.includes(entry.name));
      tokensN.set(slug, tok(slug) + 1);
      deps.emit(slug, 'files', ['tokens.css']);
      return { edit: { id: `e_sys${tok(slug)}`, label: 'Reset to the system’s value', files: ['tokens.css'], undoable: true }, version: null, coalesced: false, stamps: { tokens: `tok${String(tok(slug)).padStart(61, '0')}` } };
    },
    restored: (slug, versionId) => {
      const snapshot = snapshots.get(versionId);
      if (snapshot === undefined) return;
      states.set(slug, JSON.parse(JSON.stringify(snapshot)) as State);
      touchCopy(slug);
    },
    hooks: {
      link: (slug, id, options) => {
        seedLink(slug, id, options);
        touchCopy(slug);
        deps.emit(slug, 'files', ['system/COPY.json']);
      },
      unlink: (slug, kind) => {
        states.set(slug, { kind });
        touchCopy(slug);
        deps.emit(slug, 'files', ['system/COPY.json']);
      },
      agentSwitch: (slug, id) => {
        const state = stateOf(slug);
        const before = deps.checkpoint(slug);
        snapshots.set(before.id, JSON.parse(JSON.stringify(state)) as State);
        seedLink(slug, id, { by: 'agent' });
        const next = states.get(slug);
        if (next?.kind === 'linked') {
          next.before = before.id;
          next.at = ago(-MINUTE / 60);
        }
        touchCopy(slug);
        deps.emit(slug, 'files', ['system/COPY.json']);
      },
      bump: (id) => {
        deps.setRows(deps.rows().map((entry) => (entry.id === id ? { ...entry, revision: entry.revision + 1 } : entry)));
        deps.emit(null, 'system');
      },
      staleNext: () => {
        staleOnce = true;
      },
      failNext: (message) => {
        failure = message;
      },
      log: () => log,
      settingsNotices: (next) => {
        notices = next;
      },
    },
  };
};
