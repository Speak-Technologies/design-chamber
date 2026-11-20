// What the panel of the design system page shows for one section (Phase 2.5 U2, technical design §9.3): its entries, each with the
// value the user can click to edit and a short usage note. Nothing is saved from here: an edit goes into the pending map (the
// page owns it) and the board previews it until the user saves. Every string reaches the DOM through `textContent`.

import { mountBadge } from '@openchamber/sdk/ui';

import type { ColourGroup, SystemDetail, SystemSection, SystemToken, TypeStyle } from '../../shared/types.ts';
import { entryKeyOf } from '../../shared/system-board.ts';
import { SYSTEM_NOTE_MAX, SYSTEM_USAGE_NOTE_MAX } from '../../shared/limits.ts';
import type { TypeField } from '../../shared/token-edit.ts';
import { h } from '../components/dom.ts';
import { btn, iconBtn } from '../components/kit.ts';
import { plural } from '../model/format.ts';
import {
  checkValue,
  noteKey,
  noteProblem,
  purposeKey,
  savedToken,
  savedType,
  textKey,
  textProblem,
  tokenKey,
  typeKey,
  valueLock,
  type PendingChange,
  type PendingMap,
} from '../model/system-edit-model.ts';
import { COLOUR_GROUP_LABEL, NOT_COVERED, isCovered, tokensOf } from '../model/system-page-model.ts';

export type SectionContext = {
  detail: SystemDetail;
  pending: PendingMap;
  /** Why values can't be edited right now (an old version is on show, the system lives in a repo), or null. */
  locked: string | null;
  selectedEntry: string | null;
  /** Put a change in the pending map; `null` drops the change for that key. */
  propose: (key: string, change: PendingChange | null) => void;
  /** Remove a token from the system now (no confirm; the notice offers Undo). */
  removeToken: (name: string) => void;
  selectEntry: (entry: string) => void;
};

const GROUP_ORDER: readonly ColourGroup[] = ['brand', 'surface', 'text', 'border', 'status', 'data', 'other'];

const entryKey = (kind: Parameters<typeof entryKeyOf>[0], id: string): string | null => {
  try {
    return entryKeyOf(kind, id);
  } catch {
    return null;
  }
};

// ---- Inline editor ----

type FieldOptions = {
  /** What the control is for ("Light value of --brand"): the screen reader's name. */
  label: string;
  /** The saved text; `null` when there is none (an empty dark value). */
  saved: string | null;
  /** The unsaved text, when there is a pending change. */
  pending: string | null;
  lock: string | null;
  multiline?: boolean;
  mono?: boolean;
  placeholder: string;
  max: number;
  /** A sentence when the text is not acceptable. */
  check: (text: string) => string | null;
  onChange: (next: string | null) => void;
  /** Keep a stable id so the control gets the keyboard back after the panel repaints. */
  focusKey: string;
};

const fieldEditor = (options: FieldOptions): HTMLElement => {
  const shown = options.pending ?? options.saved;
  const dirty = options.pending !== null;
  const root = h('div', { class: 'dc-sp-field', 'data-dirty': dirty ? 'true' : 'false', 'data-locked': options.lock ? 'true' : 'false' });
  const problem = h('p', { class: 'dc-sp-problem', role: 'alert', hidden: true });

  const display = (): void => {
    root.replaceChildren();
    if (options.lock) {
      root.append(h('span', { class: `dc-sp-value dc-sp-value-locked${options.mono ? ' dc-mono' : ''}`, title: options.lock }, shown ?? 'Not set'), h('span', { class: 'dc-sp-lock' }, options.lock));
      return;
    }
    const button = h(
      'button',
      {
        type: 'button',
        class: `dc-sp-value${options.mono ? ' dc-mono' : ''}`,
        'data-empty': shown === null || shown === '' ? 'true' : 'false',
        'data-focus-key': options.focusKey,
        'aria-label': `${options.label}: ${shown === null || shown === '' ? 'empty' : shown}. Edit`,
        onClick: () => edit(),
      },
      shown === null || shown === '' ? options.placeholder : shown,
      dirty ? h('span', { class: 'dc-sp-dirty-dot', 'aria-hidden': 'true' }) : null,
    );
    root.append(button);
  };

  const edit = (): void => {
    const input: HTMLInputElement | HTMLTextAreaElement = options.multiline
      ? h('textarea', { class: 'oc-sdk-input dc-sp-input', rows: 3 })
      : h('input', { class: 'oc-sdk-input dc-sp-input', type: 'text', autocomplete: 'off', spellcheck: 'false' });
    input.value = shown ?? '';
    input.setAttribute('aria-label', options.label);
    input.maxLength = options.max + 200;
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) return;
      const text = input.value;
      if (commit) {
        const trimmed = text.trim();
        if (trimmed === (options.saved ?? '').trim()) {
          done = true;
          options.onChange(null);
          return;
        }
        const sentence = options.check(trimmed);
        if (sentence) {
          problem.textContent = sentence;
          problem.hidden = false;
          input.setAttribute('aria-invalid', 'true');
          input.focus();
          return;
        }
        done = true;
        options.onChange(trimmed);
        return;
      }
      done = true;
      problem.hidden = true;
      display();
      root.querySelector<HTMLElement>('[data-focus-key]')?.focus();
    };
    (input as HTMLElement).addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      } else if (event.key === 'Enter' && (!options.multiline || event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        finish(true);
      }
    });
    input.addEventListener('blur', () => {
      if (!done && !problem.hidden) return;
      finish(true);
    });
    root.replaceChildren(input, problem);
    input.focus();
    input.select();
  };

  display();
  return root;
};

const noteField = (ctx: SectionContext, path: 'tokens' | 'components' | 'patterns' | 'brand' | 'type', id: string, saved: string, label: string): HTMLElement => {
  const key = noteKey(path, id);
  const change = ctx.pending.get(key);
  return fieldEditor({
    label: `${label} usage note`,
    saved,
    pending: change?.kind === 'note' ? change.value : null,
    lock: ctx.locked,
    multiline: true,
    placeholder: 'Add a note on when to use it',
    max: SYSTEM_USAGE_NOTE_MAX,
    check: (text) => noteProblem(text),
    onChange: (next) => ctx.propose(key, next === null ? null : { kind: 'note', path, id, value: next }),
    focusKey: key,
  });
};

const wrapRow = (ctx: SectionContext, entry: string | null, children: Array<HTMLElement | null>): HTMLElement => {
  const row = h('li', { class: 'dc-sp-entry', 'data-entry': entry ?? null, 'aria-current': entry !== null && ctx.selectedEntry === entry ? 'true' : null }, ...children);
  if (entry !== null) {
    row.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('button, input, textarea, a')) return;
      ctx.selectEntry(entry);
    });
  }
  return row;
};

const labelled = (label: string, control: HTMLElement): HTMLElement => h('div', { class: 'dc-sp-labelled' }, h('span', { class: 'dc-sp-label' }, label), control);

// ---- Tokens ----

const swatch = (value: string | null): HTMLElement => {
  const node = h('span', { class: 'dc-sp-swatch', 'aria-hidden': 'true' });
  if (value !== null && checkValue('colours', null, value).ok) node.style.setProperty('background-color', value);
  else node.dataset.empty = 'true';
  return node;
};

const tokenRow = (ctx: SectionContext, token: SystemToken): HTMLElement => {
  const isColour = token.section === 'colours';
  const modes: Array<'light' | 'dark'> = token.dark !== null || isColour ? ['light', 'dark'] : ['light'];
  const fields = modes.map((mode) => {
    const key = tokenKey(token.name, mode);
    const value = mode === 'light' ? token.light : token.dark;
    const change = ctx.pending.get(key);
    const pendingText = change?.kind === 'token' ? change.value : null;
    const lock = ctx.locked ?? (value ? valueLock(value.editable) : null);
    const section = token.section;
    return labelled(
      mode === 'light' ? 'Light' : 'Dark',
      fieldEditor({
        label: `${mode === 'light' ? 'Light' : 'Dark'} value of ${token.name}`,
        saved: savedToken(token, mode),
        pending: pendingText,
        lock,
        mono: true,
        placeholder: mode === 'dark' ? 'Add a dark value' : 'Add a value',
        max: 100,
        check: (text) => {
          const answer = checkValue(section, null, text);
          return answer.ok ? null : answer.sentence;
        },
        onChange: (next) => ctx.propose(key, next === null ? null : { kind: 'token', name: token.name, mode, value: next, section, existed: value !== null }),
        focusKey: key,
      }),
    );
  });
  const preview = isColour ? swatch(ctx.pending.get(tokenKey(token.name, 'light'))?.kind === 'token' ? (ctx.pending.get(tokenKey(token.name, 'light')) as { value: string }).value : (token.light?.text ?? null)) : null;
  const remove = ctx.locked
    ? null
    : iconBtn({ icon: 'trash', label: `Remove ${token.name}`, size: 'sm', onClick: () => ctx.removeToken(token.name) });
  const flags = h('span', { class: 'dc-sp-flags' });
  if (token.alsoSet.length > 0) flags.append(h('span', { class: 'dc-muted' }, `Also set in ${token.alsoSet.join(', ')}`));
  if (token.breakpoint) flags.append(h('span', { class: 'dc-muted' }, 'Changes with the screen size'));
  return wrapRow(ctx, entryKey('token', token.name), [
    h('div', { class: 'dc-sp-entry-head' }, preview, h('code', { class: 'dc-sp-name' }, token.name), flags, remove),
    token.problem ? h('p', { class: 'dc-sp-problem' }, token.problem) : null,
    h('div', { class: 'dc-sp-fields' }, ...fields),
    labelled('Note', noteField(ctx, 'tokens', token.name, token.note, token.name)),
  ]);
};

// ---- Typography ----

const TYPE_FIELDS: ReadonlyArray<{ field: TypeField; label: string }> = [
  { field: 'family', label: 'Family' },
  { field: 'size', label: 'Size' },
  { field: 'weight', label: 'Weight' },
  { field: 'lineHeight', label: 'Line height' },
  { field: 'letterSpacing', label: 'Letter spacing' },
];

const typeRow = (ctx: SectionContext, style: TypeStyle): HTMLElement => {
  const fields = TYPE_FIELDS.map(({ field, label }) => {
    const key = typeKey(style.id, field);
    const change = ctx.pending.get(key);
    return labelled(
      label,
      fieldEditor({
        label: `${label} of ${style.name}`,
        saved: savedType(style, field),
        pending: change?.kind === 'type' ? change.value : null,
        lock: ctx.locked,
        mono: true,
        placeholder: 'Set a value',
        max: 100,
        check: (text) => {
          const answer = checkValue('typography', field, text);
          return answer.ok ? null : answer.sentence;
        },
        onChange: (next) => ctx.propose(key, next === null ? null : { kind: 'type', id: style.id, field, value: next }),
        focusKey: key,
      }),
    );
  });
  return wrapRow(ctx, entryKey('type', style.id), [
    h('div', { class: 'dc-sp-entry-head' }, h('span', { class: 'dc-sp-name' }, style.name), style.case !== 'none' ? h('span', { class: 'dc-muted' }, style.case === 'upper' ? 'Uppercase' : style.case === 'lower' ? 'Lowercase' : 'Title case') : null),
    h('div', { class: 'dc-sp-fields' }, ...fields),
    labelled('Note', noteField(ctx, 'type', style.id, style.note, style.name)),
  ]);
};

// ---- Components, overview, patterns, brand, assets ----

const chips = (label: string, items: readonly string[]): HTMLElement | null =>
  items.length === 0 ? null : h('div', { class: 'dc-sp-chips' }, h('span', { class: 'dc-sp-label' }, label), ...items.map((item) => h('span', { class: 'dc-sp-chip' }, item)));

const componentRow = (ctx: SectionContext, id: string): HTMLElement | null => {
  const component = ctx.detail.components.find((entry) => entry.id === id);
  if (!component) return null;
  const purpose = ctx.pending.get(purposeKey(component.id));
  return wrapRow(ctx, entryKey('component', component.id), [
    h('div', { class: 'dc-sp-entry-head' }, h('span', { class: 'dc-sp-name' }, component.name), component.source ? h('code', { class: 'dc-muted dc-mono' }, component.source) : null),
    labelled(
      'Purpose',
      fieldEditor({
        label: `Purpose of ${component.name}`,
        saved: component.purpose,
        pending: purpose?.kind === 'purpose' ? purpose.value : null,
        lock: ctx.locked,
        multiline: true,
        placeholder: 'Say what it is for',
        max: SYSTEM_USAGE_NOTE_MAX,
        check: (text) => noteProblem(text),
        onChange: (next) => ctx.propose(purposeKey(component.id), next === null ? null : { kind: 'purpose', id: component.id, value: next }),
        focusKey: purposeKey(component.id),
      }),
    ),
    labelled('Note', noteField(ctx, 'components', component.id, component.note, component.name)),
    chips('Variants', component.variants),
    chips('States', component.states),
    chips('Uses', component.tokens),
    component.undefinedTokens.length > 0 ? h('p', { class: 'dc-sp-problem' }, `Uses ${plural(component.undefinedTokens.length, 'value')} this system doesn’t define: ${component.undefinedTokens.join(', ')}.`) : null,
  ]);
};

const textField = (ctx: SectionContext, file: 'OVERVIEW.md' | `notes/${string}.md`, saved: string, label: string): HTMLElement => {
  const key = textKey(file);
  const change = ctx.pending.get(key);
  return fieldEditor({
    label,
    saved,
    pending: change?.kind === 'text' ? change.value : null,
    lock: ctx.locked,
    multiline: true,
    placeholder: 'Write something',
    max: SYSTEM_NOTE_MAX,
    check: (text) => textProblem(text) ?? (file === 'OVERVIEW.md' && text.trim() === '' ? 'The overview can’t be empty.' : null),
    onChange: (next) => ctx.propose(key, next === null ? null : { kind: 'text', file, value: next }),
    focusKey: key,
  });
};

const overviewRows = (ctx: SectionContext): HTMLElement[] => {
  const rows: HTMLElement[] = [];
  const { overview, notes } = ctx.detail;
  if (overview) rows.push(wrapRow(ctx, 'overview', [h('div', { class: 'dc-sp-entry-head' }, h('span', { class: 'dc-sp-name' }, 'Overview')), overview.problem ? h('p', { class: 'dc-sp-problem' }, overview.problem) : null, textField(ctx, 'OVERVIEW.md', overview.text, 'Overview text')]));
  for (const note of notes) {
    rows.push(wrapRow(ctx, entryKey('note', note.id), [h('div', { class: 'dc-sp-entry-head' }, h('span', { class: 'dc-sp-name' }, note.title)), note.problem ? h('p', { class: 'dc-sp-problem' }, note.problem) : null, textField(ctx, `notes/${note.id}.md`, note.text, `${note.title} text`)]));
  }
  return rows;
};

const entryTextRows = (ctx: SectionContext, kind: 'pattern' | 'brand'): HTMLElement[] => {
  const list = kind === 'pattern' ? ctx.detail.patterns : ctx.detail.brand;
  return list.map((entry) =>
    wrapRow(ctx, entryKey(kind, entry.id), [
      h('div', { class: 'dc-sp-entry-head' }, h('span', { class: 'dc-sp-name' }, entry.title), h('span', { class: 'dc-muted' }, entry.kind)),
      entry.problem ? h('p', { class: 'dc-sp-problem' }, entry.problem) : null,
      entry.text ? h('p', { class: 'dc-sp-body' }, entry.text) : null,
      labelled('Note', noteField(ctx, kind === 'pattern' ? 'patterns' : 'brand', entry.id, entry.note, entry.title)),
    ]),
  );
};

const assetRows = (ctx: SectionContext): HTMLElement[] => {
  const { fonts, sourceFiles } = ctx.detail;
  const rows: HTMLElement[] = [];
  fonts.forEach((font, index) =>
    rows.push(wrapRow(ctx, entryKey('font', String(index)), [h('div', { class: 'dc-sp-entry-head' }, h('span', { class: 'dc-sp-name' }, font.family), h('span', { class: 'dc-muted' }, `${font.weight} ${font.style}`)), h('code', { class: 'dc-muted dc-mono' }, font.file)])),
  );
  for (const source of sourceFiles) rows.push(wrapRow(ctx, null, [h('div', { class: 'dc-sp-entry-head' }, h('code', { class: 'dc-mono' }, source.file), h('span', { class: 'dc-muted' }, 'Source file'))]));
  return rows;
};

const logoRows = (ctx: SectionContext): HTMLElement[] =>
  ctx.detail.logos.map((logo, index) =>
    wrapRow(ctx, entryKey('logo', String(index)), [h('div', { class: 'dc-sp-entry-head' }, h('span', { class: 'dc-sp-name' }, logo.variant), h('span', { class: 'dc-muted' }, 'Logo')), h('code', { class: 'dc-muted dc-mono' }, logo.file), logo.note ? h('p', { class: 'dc-sp-body' }, logo.note) : null]),
  );

const group = (title: string, rows: HTMLElement[]): HTMLElement =>
  h('section', { class: 'dc-sp-group', 'aria-label': title }, h('h3', { class: 'dc-sp-group-title' }, title), h('ul', { class: 'dc-sp-entries' }, ...rows));

const emptyNote = (section: SystemSection): HTMLElement => {
  const text: Partial<Record<SystemSection, string>> = {
    overview: 'No overview or notes yet. Ask the agent to write them.',
    components: 'No components yet. Ask the agent to add the ones your designs use.',
    patterns: 'No patterns yet. Ask the agent to describe how things are put together.',
    brand: 'No brand entries yet. Ask the agent to add the voice and the logo rules.',
    assets: 'No fonts or logos yet.',
  };
  return h('p', { class: 'dc-muted dc-sp-none' }, text[section] ?? 'Nothing here yet. Ask the agent to add some.');
};

/** The panel body for one section: groups of rows, or the plain sentence when the system doesn't cover it. */
export const renderSection = (ctx: SectionContext, section: SystemSection): HTMLElement => {
  const root = h('div', { class: 'dc-sp-section', 'data-section': section });
  if (!isCovered(ctx.detail, section)) {
    root.append(h('p', { class: 'dc-muted dc-sp-none' }, NOT_COVERED));
    return root;
  }
  const detail = ctx.detail;
  switch (section) {
    case 'overview': {
      const rows = overviewRows(ctx);
      root.append(rows.length === 0 ? emptyNote(section) : h('ul', { class: 'dc-sp-entries' }, ...rows));
      break;
    }
    case 'typography': {
      if (detail.type.length === 0) root.append(emptyNote(section));
      else root.append(h('ul', { class: 'dc-sp-entries' }, ...detail.type.map((style) => typeRow(ctx, style))));
      break;
    }
    case 'components': {
      const rows = detail.components.map((component) => componentRow(ctx, component.id)).filter((row): row is HTMLElement => row !== null);
      root.append(rows.length === 0 ? emptyNote(section) : h('ul', { class: 'dc-sp-entries' }, ...rows));
      break;
    }
    case 'patterns': {
      const rows = entryTextRows(ctx, 'pattern');
      root.append(rows.length === 0 ? emptyNote(section) : h('ul', { class: 'dc-sp-entries' }, ...rows));
      break;
    }
    case 'brand': {
      const rows = [...entryTextRows(ctx, 'brand'), ...logoRows(ctx)];
      root.append(rows.length === 0 ? emptyNote(section) : h('ul', { class: 'dc-sp-entries' }, ...rows));
      break;
    }
    case 'assets': {
      const rows = assetRows(ctx);
      root.append(rows.length === 0 ? emptyNote(section) : h('ul', { class: 'dc-sp-entries' }, ...rows));
      break;
    }
    case 'colours': {
      const tokens = tokensOf(detail, 'colours');
      if (tokens.length === 0) root.append(h('p', { class: 'dc-muted dc-sp-none' }, 'No colours yet. Ask the agent to add some.'));
      for (const name of GROUP_ORDER) {
        const rows = tokens.filter((token) => (token.group ?? 'other') === name).map((token) => tokenRow(ctx, token));
        if (rows.length > 0) root.append(group(COLOUR_GROUP_LABEL[name], rows));
      }
      break;
    }
    default: {
      const tokens = tokensOf(detail, section);
      if (tokens.length === 0) root.append(h('p', { class: 'dc-muted dc-sp-none' }, 'Nothing here yet. Ask the agent to add some.'));
      else root.append(h('ul', { class: 'dc-sp-entries' }, ...tokens.map((token) => tokenRow(ctx, token))));
    }
  }
  return root;
};

/** A badge for a review state in the section list. */
export const reviewBadge = (state: 'not-reviewed' | 'looks-good' | 'needs-work'): HTMLElement => {
  const holder = h('span', { class: 'dc-sp-state', 'data-state': state });
  if (state === 'looks-good') mountBadge(holder, { label: 'Looks good', tone: 'success' });
  else if (state === 'needs-work') mountBadge(holder, { label: 'Needs work', tone: 'warning' });
  return holder;
};

/** The primary button that is only a styled helper for rows' tiny actions; kept here so the page file stays about the page. */
export const smallButton = (label: string, onClick: () => void): HTMLElement => btn({ label, variant: 'ghost', size: 'xs', onClick }).el;
