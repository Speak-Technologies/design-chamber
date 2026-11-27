// What a repo-backed design system says about its home (Phase 2.5 U6, technical design §9.6): the banners and their
// stacking, the read-only line, the header line, the two drift numbers, the landed line and the repo re-sync review.
// Pure: no DOM, no host, no store. The service has the last word on every fact; this only words and orders them.

import type { RepoResyncReview, SystemDetail } from '../../shared/types.ts';
import { relativeTime, plural } from './format.ts';
import { secretLine, UNSAFE_SENTENCE } from './living-page-model.ts';
import { homeTitle, scopeParts } from './system-page-model.ts';

export type HomeDetail = Pick<SystemDetail, 'name' | 'home' | 'unreadable' | 'buildProblem' | 'snapshot' | 'landed' | 'livingPage' | 'changesToReview' | 'codeDrift' | 'agentDrift' | 'build'>;

export type BannerId = 'unreadable' | 'repoProblem' | 'tampered' | 'buildProblem' | 'landed' | 'living' | 'changes';
export type BannerActionId = 'choose-folder' | 'resync' | 'build-continue' | 'ask-landed' | 'ask-living';
export type BannerSpec = {
  id: BannerId;
  tone: 'error' | 'warning' | 'info';
  title: string;
  body: string;
  action: { id: BannerActionId; label: string } | null;
};

export type BannerOptions = {
  now: number;
  locale: string;
  /** Secret shapes the staged living page shows (from GET /systems/:id/living-page); the detail doesn't carry them. */
  secrets?: { kind: string; where: string }[];
};

export type BannerStack = { shown: BannerSpec[]; more: BannerSpec[]; moreLabel: string | null };

/** At most this many banners show; the rest sit under one "+N more" line, never dropped (§9.6). */
export const BANNER_MAX = 2;

const ACTION_LABEL: Readonly<Record<BannerActionId, string>> = {
  'choose-folder': 'Choose another folder…',
  resync: 'Re-sync',
  'build-continue': 'Ask the agent to fix it',
  'ask-landed': 'Ask the agent about it',
  'ask-living': 'Ask the agent to update it',
};

const action = (id: BannerActionId): { id: BannerActionId; label: string } => ({ id, label: ACTION_LABEL[id] });

/** A later banner never repeats an earlier banner's button: two that share an action show it once. */
export const withoutRepeatedActions = (banners: readonly BannerSpec[]): BannerSpec[] => {
  const seen = new Set<BannerActionId>();
  return banners.map((banner) => {
    if (banner.action === null) return banner;
    if (seen.has(banner.action.id)) return { ...banner, action: null };
    seen.add(banner.action.id);
    return banner;
  });
};

const repoOf = (detail: Pick<HomeDetail, 'home'>): string => (detail.home.kind === 'repo' ? detail.home.label : 'the repo');

/** Highest first: what stops reading, then what is wrong with the build, then what to look at. */
const candidates = (detail: HomeDetail, options: BannerOptions): BannerSpec[] => {
  const out: BannerSpec[] = [];
  const repo = detail.home.kind === 'repo' ? detail.home : null;
  if (detail.unreadable) out.push({ id: 'unreadable', tone: 'error', title: `${detail.name} can’t be read`, body: detail.unreadable, action: null });
  if (repo !== null && !repo.readable) {
    const ago = repo.lastRead === null ? '' : relativeTime(repo.lastRead, options.now, options.locale);
    const parts = [repo.problem ?? '', ago === '' ? '' : `Showing the last scan from ${ago}.`, 'Re-sync and the living-page actions are off until it reads again.'];
    out.push({ id: 'repoProblem', tone: 'error', title: 'The repo can’t be read.', body: parts.filter((part) => part !== '').join(' '), action: action('choose-folder') });
  }
  if (repo !== null && detail.snapshot?.tampered === true) {
    out.push({ id: 'tampered', tone: 'warning', title: `${detail.name}’s snapshot was changed outside Design Chamber.`, body: `Re-sync to read ${repo.label} again.`, action: action('resync') });
  }
  if (detail.buildProblem) out.push({ id: 'buildProblem', tone: 'warning', title: 'The build has a problem.', body: detail.buildProblem, action: action('build-continue') });
  if (detail.landed !== null && !detail.landed.matches && detail.landed.sentence) {
    out.push({ id: 'landed', tone: 'warning', title: 'What landed differs from what you approved.', body: detail.landed.sentence, action: action('ask-landed') });
  }
  if (repo !== null) {
    const secret = options.secrets !== undefined && options.secrets.length > 0 ? secretLine(options.secrets) : null;
    if (detail.livingPage?.state === 'unsafe') {
      out.push({ id: 'living', tone: 'error', title: 'The living page can’t be checked as safe.', body: UNSAFE_SENTENCE, action: action('ask-living') });
    } else if (secret !== null) {
      // A page for developers only may show a secret shape as a warning; a public page may not (§10.4).
      out.push({ id: 'living', tone: detail.build?.access === 'dev' ? 'warning' : 'error', title: 'The living page shows something shaped like a secret.', body: secret, action: action('ask-living') });
    }
  }
  if (detail.changesToReview) {
    out.push({ id: 'changes', tone: 'info', title: 'Some values changed since you marked it ready.', body: 'Look at what changed, then mark it ready again.', action: null });
  }
  return out;
};

export const systemBanners = (detail: HomeDetail, options: BannerOptions): BannerStack => {
  const all = withoutRepeatedActions(candidates(detail, options));
  const shown = all.slice(0, BANNER_MAX);
  const more = all.slice(BANNER_MAX);
  return { shown, more, moreLabel: more.length === 0 ? null : `+${more.length} more` };
};

/** The panel's first line for a repo-backed system. Never a banner, never folded. */
export const readOnlyLine = (detail: Pick<HomeDetail, 'name' | 'home'>): { lead: string; rest: string } | null =>
  detail.home.kind === 'repo' ? { lead: `${detail.name} lives in ${detail.home.label}.`, rest: 'Change the values there, or ask the agent here.' } : null;

/** "Repo · shop · design-system/ · Core system", the full path (and what was left out) as its tooltip. */
export const repoHeaderLine = (detail: Pick<HomeDetail, 'home'> & Parameters<typeof scopeParts>[0]): { text: string; title: string } | null =>
  detail.home.kind === 'repo' ? { text: [`Repo · ${detail.home.label} · ${detail.home.folder.replace(/\/+$/, '')}/`, ...scopeParts(detail)].join(' · '), title: homeTitle(detail) } : null;

// ---------------------------------------------------------------- drift (§5.12)

export type DriftLines = { sentence: string | null; unread: string | null; agent: string | null; canReconcile: boolean };

const NAME_MAX = 80;
const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** "a.ts, b.ts, c.ts and 2 more": at most three names. */
const nameList = (files: readonly string[]): string => {
  const shown = files.slice(0, 3).map((file) => clip(file, NAME_MAX));
  return files.length > 3 ? `${shown.join(', ')} and ${files.length - 3} more` : shown.join(', ');
};

export const driftLines = (detail: Pick<HomeDetail, 'name' | 'codeDrift' | 'agentDrift'>): DriftLines => {
  const code = detail.codeDrift;
  const agent = detail.agentDrift;
  let sentence: string | null = null;
  let unread: string | null = null;
  if (code !== null) {
    if (code.differ > 0) {
      sentence =
        code.mode === 'fix'
          ? `In CSS variables and token JSON, ${plural(code.differ, 'token')} ${code.differ === 1 ? 'differs' : 'differ'} from ${detail.name}.`
          : `In CSS variables and token JSON, ${plural(code.differ, 'token')} still ${code.differ === 1 ? 'differs' : 'differ'} from what ${detail.name} describes.`;
      if (code.unread.length > 0) unread = `Design Chamber can’t read ${nameList(code.unread)}, so differences there aren’t counted.`;
    } else if (code.unread.length > 0) {
      // Never "matches" when a token file couldn't be read.
      sentence = `No differences in CSS variables or token JSON. Design Chamber can’t check ${nameList(code.unread)}.`;
    }
  }
  let agentLine: string | null = null;
  if (agent !== null && agent.differ > 0) {
    const kinds = agent.kinds.map((kind) => clip(kind, NAME_MAX)).filter((kind) => kind !== '').join(', ');
    const note = clip(agent.note, 300);
    const count = plural(agent.differ, 'difference');
    agentLine =
      note === ''
        ? `The agent reports ${count}${kinds === '' ? '' : ` in ${kinds}`} that Design Chamber can’t count.`
        : `The agent reports: “${note}” (${count}${kinds === '' ? '' : ` in ${kinds}`}; Design Chamber can’t count these).`;
  }
  return { sentence, unread, agent: agentLine, canReconcile: (code?.differ ?? 0) > 0 || (agent?.differ ?? 0) > 0 };
};

// ---------------------------------------------------------------- what landed (§5.14)

export const landedLine = (detail: Pick<HomeDetail, 'landed'>): { sentence: string; action: string } | null =>
  detail.landed !== null && !detail.landed.matches && detail.landed.sentence ? { sentence: detail.landed.sentence, action: ACTION_LABEL['ask-landed'] } : null;

// ---------------------------------------------------------------- the repo re-sync sheet (§7.4, §9.6)

export type RepoReviewRow = { name: string; tag: string | null; from: string | null; to: string | null; note: string | null };
export type RepoReviewSection = { id: 'changed' | 'added' | 'removed' | 'files' | 'skipped'; title: string; count: number; rows: RepoReviewRow[]; /** Rows the service counted but didn't list. */ more: number };
export type RepoReviewModel = {
  title: string;
  intro: string;
  repoint: string | null;
  sections: RepoReviewSection[];
  refused: string | null;
  /** Why Apply is off, when it is. */
  blocked: string | null;
  nothingChanged: boolean;
  matches: string;
};

export type RepoReviewContext = { systemName: string; repo: string; folder: string; hasSnapshot: boolean };

const row = (name: string, patch: Partial<RepoReviewRow> = {}): RepoReviewRow => ({ name, tag: null, from: null, to: null, note: null, ...patch });

export const repoReviewModel = (review: RepoResyncReview, context: RepoReviewContext): RepoReviewModel => {
  const { tokens, files } = review;
  const sections: RepoReviewSection[] = [];
  const add = (id: RepoReviewSection['id'], title: string, count: number, rows: RepoReviewRow[]): void => {
    if (count > 0 || rows.length > 0) sections.push({ id, title, count: Math.max(count, rows.length), rows, more: Math.max(0, count - rows.length) });
  };
  add(
    'changed',
    'Changed',
    tokens.totals.changed,
    tokens.changed.map((one) => row(one.name, { tag: one.mode === 'light' ? 'Light' : 'Dark', from: one.from, to: one.to })),
  );
  add('added', `New in ${context.repo}`, tokens.totals.added, tokens.added.map((name) => row(name)));
  add('removed', `No longer in ${context.repo}`, tokens.totals.removed, tokens.removed.map((name) => row(name)));
  const fileRows = [
    ...files.changed.map((name) => row(name, { tag: 'Changed' })),
    ...files.added.map((name) => row(name, { tag: 'New' })),
    ...files.removed.map((name) => row(name, { tag: 'Removed' })),
  ];
  add('files', 'Other files changed', fileRows.length, fileRows);
  add('skipped', 'Skipped', review.skipped.length, review.skipped.map((one) => row(one.path, { note: one.reason })));

  const hasChange = sections.some((section) => section.id !== 'skipped') || review.directoryChanged;
  return {
    title: context.hasSnapshot ? `Re-sync ${context.systemName} from ${context.repo}` : `Read ${context.systemName} from ${context.repo}`,
    intro: `Design Chamber will show ${context.repo} as it is now. To go back, change ${context.repo} and re-sync.`,
    repoint: review.directoryChanged ? `${context.systemName} will read from ${review.directory} from now on.` : null,
    sections,
    refused: review.refused > 0 ? `${plural(review.refused, 'file')} ${review.refused === 1 ? 'isn’t a type' : 'aren’t a type'} design systems use, so ${review.refused === 1 ? 'it was' : 'they were'} left out.` : null,
    blocked: review.folderFound ? null : `${context.repo} has no ${context.folder} folder yet.`,
    nothingChanged: !hasChange,
    matches: `${context.repo} matches what Design Chamber shows.`,
  };
};
