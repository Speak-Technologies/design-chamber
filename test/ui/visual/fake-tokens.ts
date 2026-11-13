// Visual harness only: an in-memory tokens.css for the Tweaks panel (Phase 2 feature 09). It answers
// `GET /designs/:slug/tokens` and the `tokens` edit op, and its undo, for designs that declare tweaks: the
// file holds one value per knob (a "formula" knob holds none), the sha changes on every write, and a hook
// lets a scenario play the agent rewriting the file (the stale banner). The real rules (what a value may be,
// how it is spliced into the file) are the service's, tested in test/shared/tokens-css.test.ts.

import type { EditResponse, TokensResponse, TweakState, UndoEditResponse } from '../../../src/shared/api.ts';
import type { Tweak } from '../../../src/shared/types.ts';
import { ServiceError } from './service-error.ts';

type Values = Map<string, number | string>;
type FileRec = { sha: number; values: Values; formula: Set<string>; alsoSet: Map<string, string[]> };

export type FakeTokens = {
  read: (slug: string, tweaks: readonly Tweak[]) => TokensResponse | null;
  has: (slug: string) => boolean;
  edit: (slug: string, base: string, values: Array<{ var: string; value: number | string }>, tweaks: readonly Tweak[]) => EditResponse;
  hasUndo: (id: string) => boolean;
  undo: (slug: string, id: string) => UndoEditResponse;
  /** Test hook: the agent rewrote tokens.css (a new sha, a `files` event). */
  touch: (slug: string) => void;
};

export type FakeTokensDeps = { emit: (slug: string, files: string[]) => void };

const shaOf = (n: number): string => `tok${String(n).padStart(61, '0')}`;

export const createFakeTokens = (deps: FakeTokensDeps): FakeTokens => {
  const files = new Map<string, FileRec>();
  const undos = new Map<string, { slug: string; values: Values }>();
  let editSeq = 0;

  // The coffee canvas: five knobs, one of them a formula the panel cannot tune, one also set for a narrow screen.
  files.set('coffee-subscription', {
    sha: 1,
    values: new Map<string, number | string>([
      ['--accent-h', 17],
      ['--radius', 8],
      ['--space', 64],
      ['--density', '1'],
    ]),
    formula: new Set(['--heading-scale']),
    alsoSet: new Map([['--space', ['@media (max-width: 700px)']]]),
  });

  const stateOf = (rec: FileRec, tweak: Tweak): TweakState => {
    if (rec.formula.has(tweak.var)) return { var: tweak.var, state: 'formula', value: null, fileUnit: null, alsoSet: [] };
    const value = rec.values.get(tweak.var) ?? null;
    return { var: tweak.var, state: 'ok', value, fileUnit: tweak.kind === 'number' ? tweak.unit : null, alsoSet: rec.alsoSet.get(tweak.var) ?? [] };
  };

  return {
    has: (slug) => files.has(slug),
    read: (slug, tweaks) => {
      const rec = files.get(slug);
      return rec ? { exists: true, editable: true, sha256: shaOf(rec.sha), knobs: tweaks.map((tweak) => stateOf(rec, tweak)) } : null;
    },
    edit: (slug, base, values, tweaks) => {
      const rec = files.get(slug);
      if (!rec) throw new ServiceError('invalid', 'This design has no tokens.css.');
      if (base !== shaOf(rec.sha)) throw new ServiceError('stale', 'tokens.css changed since you started. Your values are still shown.');
      const before = new Map(rec.values);
      for (const { var: name, value } of values) {
        if (!tweaks.some((tweak) => tweak.var === name)) throw new ServiceError('stale', 'The tweaks in design.json changed while you were working. Nothing was saved.');
        rec.values.set(name, value);
      }
      rec.sha += 1;
      editSeq += 1;
      const id = `e_tok${String(editSeq).padStart(4, '0')}`;
      undos.set(id, { slug, values: before });
      deps.emit(slug, ['tokens.css']);
      return { edit: { id, label: 'Tweaks saved to tokens.css', files: ['tokens.css'], undoable: true }, version: null, coalesced: false, stamps: { tokens: shaOf(rec.sha) } };
    },
    hasUndo: (id) => undos.has(id),
    undo: (slug, id) => {
      const record = undos.get(id);
      const rec = files.get(slug);
      if (!record || !rec) throw new ServiceError('not-found', "This edit can't be undone any more.");
      undos.delete(id);
      rec.values = record.values;
      rec.sha += 1;
      deps.emit(slug, ['tokens.css']);
      return { files: ['tokens.css'], stamps: { tokens: shaOf(rec.sha) }, version: null };
    },
    touch: (slug) => {
      const rec = files.get(slug);
      if (!rec) return;
      rec.sha += 1;
      deps.emit(slug, ['tokens.css']);
    },
  };
};
