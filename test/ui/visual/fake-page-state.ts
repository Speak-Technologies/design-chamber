// Visual harness only: an in-memory saved page data store for feature 19 (docs/SPEC and phase-2-technical §8.2). One map per
// design, a `gen` that moves on every Clear (a PATCH made before a Clear is refused as stale), the 1 MB cap, and hooks so a
// scenario can seed data, play another surface clearing it, and count the writes. The real rules are the service's
// (test/service/page-state*.test.ts); this only has to behave the same way for the viewer.

import type { PageStateClearResponse, PageStatePatchResponse, PageStateResponse } from '../../../src/shared/api.ts';
import { PAGE_STATE_MAX_CHARS } from '../../../src/shared/limits.ts';
import type { ChangeEvent } from '../../../src/shared/types.ts';
import { ServiceError } from './service-error.ts';

type Rec = { items: Map<string, string>; clears: number };
type Req = { params: Record<string, string> };

export type FakePageState = {
  handlers: {
    'GET /designs/:slug/page-state': (req: Req) => PageStateResponse;
    'PATCH /designs/:slug/page-state': (req: Req & { body: { gen: string; clear?: boolean; changes?: [string, string | null][]; uploadId?: string } }) => PageStatePatchResponse;
    'DELETE /designs/:slug/page-state': (req: Req) => PageStateClearResponse;
  };
  /** Test hooks (shoot.mjs reaches them through `window.__dcFake.pageState`). */
  hooks: {
    /** Set the design's saved data as it stands on disk (no event). */
    seed: (slug: string, items: Array<[string, string]>) => void;
    /** The saved data now, in order. */
    items: (slug: string) => Array<[string, string]>;
    /** How many PATCHes were accepted (a scenario proves a tick reached the service). */
    patches: () => number;
    /** Another surface cleared the data: the data goes, `gen` moves on, a `page-state` event says so. */
    clearElsewhere: (slug: string) => void;
  };
};

const sizeOf = (items: ReadonlyMap<string, string>): number => {
  let total = 0;
  for (const [key, value] of items) total += key.length + value.length;
  return total;
};

export const createFakePageState = (deps: { emit: (slug: string, kind: ChangeEvent['kind']) => void; exists: (slug: string) => void }): FakePageState => {
  const recs = new Map<string, Rec>();
  let patches = 0;
  const rec = (slug: string | undefined): Rec => {
    deps.exists(slug ?? ''); // throws not-found for a design that is gone
    const key = slug ?? '';
    let found = recs.get(key);
    if (!found) {
      found = { items: new Map(), clears: 0 };
      recs.set(key, found);
    }
    return found;
  };
  const genOf = (r: Rec): string => `fake:${r.clears}`;
  const countOf = (gen: string): number => Number(gen.split(':')[1] ?? 0);

  return {
    handlers: {
      'GET /designs/:slug/page-state': ({ params }) => {
        const r = rec(params.slug);
        return { items: [...r.items], chars: sizeOf(r.items), gen: genOf(r) };
      },
      'PATCH /designs/:slug/page-state': ({ params, body }) => {
        const r = rec(params.slug);
        if (countOf(body.gen) < r.clears) throw new ServiceError('stale', 'This page data was cleared elsewhere.');
        const next = new Map(body.clear ? [] : r.items);
        for (const [key, value] of body.changes ?? []) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        if (sizeOf(next) > PAGE_STATE_MAX_CHARS) throw new ServiceError('too-large', "This design tried to save more than 1 MB of page data. The extra wasn't saved.");
        r.items = next;
        patches += 1;
        deps.emit(params.slug ?? '', 'page-state');
        return { chars: sizeOf(next), gen: genOf(r) };
      },
      'DELETE /designs/:slug/page-state': ({ params }) => {
        const r = rec(params.slug);
        r.items = new Map();
        r.clears += 1;
        deps.emit(params.slug ?? '', 'page-state');
        return { ok: true, gen: genOf(r) };
      },
    },
    hooks: {
      seed: (slug, items) => {
        rec(slug).items = new Map(items);
      },
      items: (slug) => [...rec(slug).items],
      patches: () => patches,
      clearElsewhere: (slug) => {
        const r = rec(slug);
        r.items = new Map();
        r.clears += 1;
        deps.emit(slug, 'page-state');
      },
    },
  };
};
