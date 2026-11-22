// The agent's recorded choice (documentation/specs/phase-2-5-technical.md §5.5, AD-6): the agent
// writes the user's answer into design.json `systemChoice` (an id or "none"); the service checks it
// and performs the link itself, so an agent can only ask for a link, never forge one.
//
// On a design's `design` event that is not the user's own: read the parsed `systemChoice` (an
// unparseable design.json never triggers a link). When it is set and differs from
// `systemChoiceSeen`, it is recorded as seen FIRST (so a failure never loops), then:
//   "none"        → unlink when the design has a copy, else only `systemDecision = "none"`;
//   a Ready id    → link when the copy names another system or none; already linked → nothing;
//   unknown/Draft → `systemChoiceProblem` (`unknown` / `draft`), shown as a design warning;
//   a refusal     → its reason (`being-changed` retries once after the quiet period, then stays).
// One chain per design, so two quick writes of `systemChoice` are acted on in order, once each.
// A choice written while the service was down, or sitting in a designs folder the user switches to,
// is acted on by one sweep after the watcher's baseline (the same rule as `folder-requests.ts`).

import { SYSTEM_CHOICE_VALUE_MAX, SYSTEM_QUIET_MS } from '../../shared/limits.ts';
import type { ServiceState, SystemChoiceProblem } from '../../shared/types.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError } from '../http.ts';
import { readCopyRecord } from '../store.ts';
import { ensureLinkService, LinkRefusal, type LinkService } from './link.ts';

export type ChoiceReconcilerDeps = {
  ctx: ServiceContext;
  link?: LinkService;
  /** Wait before the one retry of a being-changed refusal; `SYSTEM_QUIET_MS` outside tests. */
  retryMs?: number;
  /**
   * The watcher's current baseline (`() => watcher.ready`). Given: every design is swept once after it
   * settles, and again after each root change. Absent (unit tests): only events drive the reconciler.
   */
  ready?: () => Promise<void>;
};

export type ChoiceReconciler = {
  /** Act on the design's current `systemChoice` (the hub listener calls this; tests await it). */
  reconcile(slug: string): Promise<void>;
  /** Resolves when the current sweep and every queued reconcile have finished (tests, shutdown). */
  idle(): Promise<void>;
  stop(): void;
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const createChoiceReconciler = (deps: ChoiceReconcilerDeps): ChoiceReconciler => {
  const { ctx } = deps;
  const link = deps.link ?? ensureLinkService(ctx);
  const retryMs = deps.retryMs ?? SYSTEM_QUIET_MS;
  const chains = new Map<string, Promise<void>>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;
  /** Bumped on each root change, so a sweep of the old folder stops queueing. */
  let generation = 0;
  let sweeping: Promise<void> = Promise.resolve();

  // state.json changed but design.json did not, so no watcher event tells the guests. `comments`
  // makes the guest store refetch the list and the open design; no reconciler acts on it and the
  // versions service does not count it as content, so it can neither loop nor make a version.
  const announce = (slug: string): void => {
    if (!stopped) ctx.hub.emit({ slug, kind: 'comments' });
  };

  const setProblem = async (slug: string, problem: SystemChoiceProblem | null): Promise<void> => {
    let changed = false;
    await ctx.store.updateSystemState(slug, (state) => {
      if (problem === null) {
        if (state.systemChoiceProblem === undefined) return null;
        const next: ServiceState = { ...state };
        delete next.systemChoiceProblem;
        changed = true;
        return next;
      }
      const same = state.systemChoiceProblem?.value === problem.value && state.systemChoiceProblem.reason === problem.reason;
      if (same) return null;
      changed = true;
      return { ...state, systemChoiceProblem: problem };
    });
    if (changed) announce(slug);
  };

  /** The link itself, after the seen record; a refusal is recorded as the design's choice problem. */
  const act = async (slug: string, choice: string, retry: boolean): Promise<void> => {
    const value = choice.slice(0, SYSTEM_CHOICE_VALUE_MAX);
    const designDir = await ctx.store.dir(slug);
    const copy = await readCopyRecord(designDir);
    if (choice === 'none') {
      if (copy.kind === 'absent') {
        let changed = false;
        await ctx.store.updateSystemState(slug, (state) => {
          changed = state.systemDecision !== 'none' || state.systemChoiceProblem !== undefined;
          const next: ServiceState = { ...state, systemDecision: 'none' };
          delete next.systemChoiceProblem;
          return next;
        });
        if (changed) announce(slug);
        return;
      }
      try {
        await link.link(slug, { to: 'none', by: 'agent', reason: 'system-change' });
      } catch (error) {
        if (!(error instanceof ApiError)) ctx.log.warn('systems.choice-unlink-failed', { slug, error: messageOf(error) });
        await setProblem(slug, { value, reason: 'failed' });
      }
      return;
    }
    const system = (await link.indexed(true)).find((one) => one.id === choice);
    if (system === undefined) {
      await setProblem(slug, { value, reason: 'unknown' });
      return;
    }
    if (system.status !== 'ready') {
      await setProblem(slug, { value, reason: 'draft' });
      return;
    }
    if (copy.kind === 'ok' && copy.record.id === choice) {
      await setProblem(slug, null);
      return;
    }
    try {
      await link.link(slug, { to: choice, by: 'agent', reason: 'system-change' });
    } catch (error) {
      const reason = error instanceof LinkRefusal ? error.reason : 'failed';
      if (reason === 'being-changed' && !retry && !stopped) {
        // One more try once the system has been quiet for a while (§5.5); the problem shows meanwhile.
        await setProblem(slug, { value, reason });
        const timer = setTimeout(() => {
          timers.delete(timer);
          enqueue(slug, () => retryIfStill(slug, choice));
        }, retryMs);
        timer.unref?.();
        timers.add(timer);
        return;
      }
      if (!(error instanceof ApiError)) ctx.log.warn('systems.choice-link-failed', { slug, error: messageOf(error) });
      await setProblem(slug, { value, reason });
    }
  };

  /** The retry acts only while the agent's answer is still the one that was refused. */
  const retryIfStill = async (slug: string, choice: string): Promise<void> => {
    const record = await ctx.store.get(slug);
    if (record.designJson !== 'ok' || record.design.systemChoice !== choice) return;
    await act(slug, choice, true);
  };

  const reconcile = async (slug: string): Promise<void> => {
    const record = await ctx.store.get(slug);
    if (record.designJson !== 'ok') return; // an unparseable design.json never triggers a link
    const choice = record.design.systemChoice;
    if (choice === undefined || choice === record.state.systemChoiceSeen) return;
    // Seen first: whatever happens next, the same value is never acted on twice.
    await ctx.store.updateSystemState(slug, (state) => (state.systemChoiceSeen === choice ? null : { ...state, systemChoiceSeen: choice }));
    await act(slug, choice, false);
  };

  const enqueue = (slug: string, task: () => Promise<void>): Promise<void> => {
    const previous = chains.get(slug) ?? Promise.resolve();
    const run = previous.then(task).catch((error: unknown) => {
      // A design removed meanwhile is normal; anything else is worth a line.
      if (error instanceof ApiError && error.code === 'not-found') return;
      ctx.log.warn('systems.choice-failed', { slug, error: messageOf(error) });
    });
    chains.set(slug, run);
    void run.then(() => {
      if (chains.get(slug) === run) chains.delete(slug);
    });
    return run;
  };

  /**
   * Once after the baseline and after each root change: a choice written while the service was down
   * (or in the folder just switched to) is acted on now. One design at a time on the per-design
   * chains; `reconcile` reads each and acts only where `systemChoice` differs from the seen one.
   */
  const sweep = async (ready: () => Promise<void>): Promise<void> => {
    const mine = generation;
    // The watcher replaces its baseline promise right after it emits `root`: read it a turn later.
    await Promise.resolve();
    await ready();
    if (stopped || mine !== generation) return;
    let designs: { slug: string }[];
    try {
      designs = await ctx.store.list();
    } catch (error) {
      ctx.log.warn('systems.choice-sweep-failed', { error: messageOf(error) });
      return;
    }
    for (const { slug } of designs) {
      if (stopped || mine !== generation) return;
      await enqueue(slug, () => reconcile(slug));
    }
  };

  const startSweep = (): void => {
    const ready = deps.ready;
    if (ready === undefined) return;
    sweeping = sweep(ready).catch((error: unknown) => ctx.log.warn('systems.choice-sweep-failed', { error: messageOf(error) }));
  };

  const unsubscribe = ctx.hub.subscribe((event) => {
    if (stopped) return;
    if (event.kind === 'root') {
      generation += 1;
      startSweep();
      return;
    }
    if (event.slug === null || event.origin === 'user') return;
    if (event.kind !== 'design' && event.kind !== 'added') return;
    const slug = event.slug;
    void enqueue(slug, () => reconcile(slug));
  });
  startSweep();

  return {
    reconcile: (slug) => enqueue(slug, () => reconcile(slug)),
    async idle() {
      await sweeping;
      while (chains.size > 0) await Promise.all([...chains.values()]);
    },
    stop() {
      stopped = true;
      unsubscribe();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
};

/**
 * Subscribes to design events now (the watcher's baseline seed emits none) and sweeps every design
 * once `ready` settles. Returns the stop, which waits for the queued reconciles.
 */
export const startChoiceReconciler = (ctx: ServiceContext, ready?: () => Promise<void>): (() => Promise<void>) => {
  const reconciler = createChoiceReconciler({ ctx, ...(ready !== undefined ? { ready } : {}) });
  return async () => {
    reconciler.stop();
    await reconciler.idle();
  };
};
