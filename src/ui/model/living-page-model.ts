// What the living-page card of a repo-backed design system says (Phase 2.5 U6, technical design §9.6): one label, one
// tone, one sentence and the actions that state allows, each enabled or disabled with its reason. Pure: no DOM, no
// host, no store. The committed page is never shown, only described; the staged page is the one Design Chamber made.

import type { LivingPageState, LivingPageView, SecretShapeKind, SystemDetail } from '../../shared/types.ts';
import { fileSize, plural } from './format.ts';
import { withoutComputerOnly } from './viewer-menu.ts';

export type LivingRepoView = Extract<LivingPageView, { home: 'repo' }>;
export type LivingKind = LivingPageState | 'problem';
export type LivingTone = 'success' | 'warning' | 'error' | 'info';
export type LivingActionId = 'ask' | 'fix' | 'preview' | 'reveal';

export type LivingAction = {
  id: LivingActionId;
  label: string;
  /** `tinted` is the card's one suggested action; `outline` and `ghost` are the plain ones. */
  look: 'tinted' | 'outline' | 'ghost';
  enabled: boolean;
  /** Why it is off, when it is. */
  why: string | null;
};

export type LivingFontsSwitch = { label: string; help: string; checked: boolean; disabled: boolean };

export type LivingCard = {
  kind: LivingKind;
  label: string;
  tone: LivingTone;
  sentence: string;
  /** Up to three reasons, for a page that can't be checked as safe. */
  reasons: string[];
  /** "design-system/index.html · 412 KB · rev 7": the committed path, then the staged page's size and revision. */
  pathLine: string;
  /** "1 font wasn't embedded: too large." */
  omitted: string[];
  /** The warning under any state when the staged page shows something shaped like a secret. */
  secretLine: string | null;
  actions: LivingAction[];
  fonts: LivingFontsSwitch | null;
  regenerating: boolean;
};

/** What the card reads from the system besides the living-page view. */
export type LivingContext = Pick<SystemDetail, 'name' | 'revision' | 'home' | 'build' | 'proposal'>;

export type LivingOptions = {
  now: number;
  locale: string;
  /** The Embed fonts switch was just changed and the `living-page` event hasn't arrived. */
  regenerating?: boolean;
  /** Why every action that changes something is off right now (an old version is open, unsaved changes). */
  locked?: string | null;
  /** On a phone: leave out the actions that act on the computer (`withoutComputerOnly`). */
  phone?: boolean;
};

export const LIVING_TITLE = 'Living page';
export const REGENERATING_LABEL = 'Regenerating…';
export const PREVIEW_NOTE = 'This is the page Design Chamber generated. The copy in shop may differ.';
export const FONTS_LABEL = 'Embed fonts in the living page';
export const FONTS_HELP = 'Turn on only if the fonts’ licences allow publishing them.';
/** How long after an apply the page says it is waiting for the agent's commit. */
export const WAITING_WINDOW_MS = 30_000;

const SECRET_KIND_LABELS: Readonly<Record<SecretShapeKind, string>> = {
  'aws-key': 'an AWS key',
  'github-token': 'a GitHub token',
  'openai-style-key': 'an OpenAI-style key',
  'slack-token': 'a Slack token',
  'google-key': 'a Google key',
  'private-key': 'a private key',
};

const PROBLEM_REASONS: Readonly<Record<string, string>> = {
  'too-large': 'It would be too large.',
  bundle: 'A file couldn’t be embedded.',
  unsafe: 'It didn’t pass the safety check.',
  secret: 'It would show something shaped like a secret.',
  'no-snapshot': 'The repo folder hasn’t been read yet.',
};

const OMITTED_REASONS: Readonly<Record<string, string>> = {
  'too-large': 'too large',
  unsafe: 'not safe to embed',
  budget: 'the page is at its size limit',
  'no-browser': 'Chrome isn’t available',
  'render-failed': 'it couldn’t be drawn',
  licence: 'Embed fonts is off',
};

const NOUN: Readonly<Record<string, readonly [string, string, string]>> = {
  font: ['font', 'fonts', 'embedded'],
  logo: ['logo', 'logos', 'embedded'],
  icon: ['icon', 'icons', 'embedded'],
  example: ['example picture', 'example pictures', 'included'],
};

const LABEL: Readonly<Record<LivingKind, { text: (repo: string) => string; tone: LivingTone }>> = {
  fresh: { text: () => 'Up to date', tone: 'success' },
  'out-of-date': { text: () => 'Out of date', tone: 'warning' },
  missing: { text: (repo) => `Not in ${repo} yet`, tone: 'warning' },
  changed: { text: (repo) => `Changed in ${repo}`, tone: 'warning' },
  reformatted: { text: () => 'Reformatted', tone: 'info' },
  unsafe: { text: () => 'Can’t check as safe', tone: 'error' },
  unreadable: { text: () => 'Can’t read', tone: 'error' },
  problem: { text: () => 'Couldn’t generate', tone: 'error' },
};

export const UNSAFE_SENTENCE = 'The living page has markup Design Chamber didn’t generate and can’t check as safe.';
export const WAITING_SENTENCE = 'Design Chamber is waiting for the agent to commit it.';
const CANT_PREVIEW = 'There is no generated page to preview yet.';
const CANT_ASK_UNREADABLE = 'The repo can’t be read.';
const CANT_ASK_PROBLEM = 'Design Chamber couldn’t generate the page yet.';

const repoOf = (context: LivingContext): string => (context.home.kind === 'repo' ? context.home.label : 'the repo');

/** The wording for a staged problem code (an unknown code reads as a plain sentence, never as raw text). */
export const problemReason = (problem: string): string => (Object.hasOwn(PROBLEM_REASONS, problem) ? (PROBLEM_REASONS[problem] as string) : 'Something went wrong.');

export const kindOf = (view: LivingRepoView): LivingKind => (view.staged !== null && view.staged.problem !== null ? 'problem' : view.committed.state);

const waitingForCommit = (context: LivingContext, now: number): boolean => {
  const at = context.build?.applied?.at;
  if (at === undefined) return false;
  const then = Date.parse(at);
  return Number.isFinite(then) && now - then >= 0 && now - then <= WAITING_WINDOW_MS;
};

const sentenceOf = (kind: LivingKind, view: LivingRepoView, context: LivingContext, now: number): string => {
  const repo = repoOf(context);
  const revision = view.committed.revision;
  switch (kind) {
    case 'fresh':
      return `Generated from revision ${revision ?? context.revision}, the current one.`;
    case 'out-of-date':
      return `Generated from revision ${revision ?? '?'}; ${context.name} is at revision ${context.revision}.`;
    case 'missing':
      return waitingForCommit(context, now) ? `No living page in ${repo} yet. ${WAITING_SENTENCE}` : `No living page in ${repo} yet.`;
    case 'changed':
      return `The page in ${repo} differs from the one Design Chamber generated.`;
    case 'reformatted':
      return `The living page may have been reformatted since it was generated. Its values are from revision ${revision ?? context.revision}, the current one.`;
    case 'unsafe':
      return UNSAFE_SENTENCE;
    case 'unreadable':
      // The service's own sentence names the reason ("Design Chamber can't read the living page: …").
      return view.committed.sentence.replace(/'/g, '’');
    case 'problem':
      return `Design Chamber couldn’t generate the living page. ${problemReason(view.staged?.problem ?? '')}`;
  }
};

/** "an AWS key in brand/press" and up to two more, then a count. */
export const secretLine = (secrets: NonNullable<LivingRepoView['staged']>['secrets']): string | null => {
  if (secrets.length === 0) return null;
  const shown = secrets.slice(0, 2).map((secret) => `${SECRET_KIND_LABELS[secret.kind as SecretShapeKind] ?? 'a secret'} in ${secret.where}`);
  const rest = secrets.length - shown.length;
  const list = rest > 0 ? `${shown.join(', ')} and ${plural(rest, 'more')}` : shown.join(' and ');
  return `The page shows something shaped like a secret (${list}). Remove it before anyone else sees the page.`;
};

/** "1 font wasn't embedded: too large.", one line per kind and reason, in the order they were left out. */
export const omittedLines = (omitted: readonly { what: string; name: string; reason: string }[]): string[] => {
  const order: string[] = [];
  const groups = new Map<string, { what: string; reason: string; count: number }>();
  for (const item of omitted) {
    const key = `${item.what}\u0000${item.reason}`;
    const found = groups.get(key);
    if (found) found.count += 1;
    else {
      groups.set(key, { what: item.what, reason: item.reason, count: 1 });
      order.push(key);
    }
  }
  return order.map((key) => {
    const group = groups.get(key) as { what: string; reason: string; count: number };
    const [one, many, verb] = NOUN[group.what] ?? ['item', 'items', 'included'];
    const reason = Object.hasOwn(OMITTED_REASONS, group.reason) ? (OMITTED_REASONS[group.reason] as string) : 'left out';
    return `${plural(group.count, one, many)} ${group.count === 1 ? 'wasn’t' : 'weren’t'} ${verb}: ${reason}.`;
  });
};

/** Which staged page the preview opens: the proposal's while one waits and was generated, else the staged page. */
export const previewTarget = (view: LivingRepoView, context: Pick<LivingContext, 'proposal'>): { which: 'staged' | 'preview'; proposal: string | null } | null => {
  const staged = view.staged;
  if (staged === null) return null;
  if (context.proposal !== null && context.proposal.state === 'current' && staged.preview !== null && staged.preview.problem === null) return { which: 'preview', proposal: staged.preview.proposal };
  return staged.problem === null ? { which: 'staged', proposal: null } : null;
};

const ACTIONS: Readonly<Record<LivingKind, readonly LivingActionId[]>> = {
  fresh: ['preview', 'reveal'],
  'out-of-date': ['ask', 'preview', 'reveal'],
  missing: ['ask', 'preview'],
  changed: ['ask', 'preview', 'reveal'],
  reformatted: ['preview', 'reveal'],
  unsafe: ['ask', 'reveal'],
  unreadable: ['reveal'],
  problem: ['fix', 'ask'],
};

const ACTION_COPY: Readonly<Record<LivingActionId, { label: string; look: LivingAction['look'] }>> = {
  ask: { label: 'Ask the agent to update it', look: 'tinted' },
  fix: { label: 'Ask the agent to fix it', look: 'tinted' },
  preview: { label: 'Preview living page', look: 'outline' },
  reveal: { label: 'Reveal living page', look: 'ghost' },
};

export const livingCard = (view: LivingRepoView, context: LivingContext, options: LivingOptions): LivingCard => {
  const kind = kindOf(view);
  const staged = view.staged;
  const regenerating = options.regenerating === true;
  const locked = options.locked ?? null;
  const repo = repoOf(context);
  const preview = previewTarget(view, context);

  const gate = (id: LivingActionId): { enabled: boolean; why: string | null } => {
    if (id === 'reveal') return { enabled: true, why: null };
    if (regenerating) return { enabled: false, why: REGENERATING_LABEL };
    if (id === 'preview') return preview === null ? { enabled: false, why: CANT_PREVIEW } : { enabled: true, why: null };
    if (locked !== null) return { enabled: false, why: locked };
    if (!view.repoReadable) return { enabled: false, why: CANT_ASK_UNREADABLE };
    if (id === 'ask' && kind === 'problem') return { enabled: false, why: CANT_ASK_PROBLEM };
    return { enabled: true, why: null };
  };

  const all = ACTIONS[kind].map((id): LivingAction => ({ id, ...ACTION_COPY[id], ...gate(id) }));
  // Reveal opens a folder on the computer that runs OpenChamber, which a phone's user can't see.
  const actions = options.phone ? withoutComputerOnly(all) : all;
  const parts = [view.path];
  if (staged !== null) parts.push(fileSize(staged.bytes, options.locale), `rev ${staged.revision}`);

  const access = context.build?.access ?? null;
  return {
    kind,
    label: LABEL[kind].text(repo),
    tone: LABEL[kind].tone,
    sentence: sentenceOf(kind, view, context, options.now),
    reasons: kind === 'unsafe' ? view.committed.reasons.slice(0, 3) : [],
    pathLine: parts.join(' · '),
    omitted: staged === null ? [] : omittedLines(staged.omitted),
    secretLine: staged === null ? null : secretLine(staged.secrets),
    actions,
    fonts: access === 'dev' ? null : { label: FONTS_LABEL, help: FONTS_HELP, checked: view.embedFonts, disabled: locked !== null || regenerating },
    regenerating,
  };
};

/** The band over the preview: the staged page or the proposal's. */
export const previewBand = (target: { which: 'staged' | 'preview'; proposal: string | null }): string =>
  target.which === 'preview' && target.proposal !== null ? `Preview of proposal ${target.proposal}` : 'Preview of the generated living page';
