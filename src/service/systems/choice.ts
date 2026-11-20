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
};

export type ChoiceReconciler = {
  /** Act on the design's current `systemChoice` (the hub listener calls this; tests await it). */
  reconcile(slug: string): Promise<void>;
  /** Resolves when every queued reconcile has finished (tests). */
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

  const setProblem = (slug: string, problem: SystemChoiceProblem | null): Promise<ServiceState> =>
    ctx.store.updateSystemState(slug, (state) => {
      if (problem === null) {
        if (state.systemChoiceProblem === undefined) return null;
        const next: ServiceState = { ...state };
        delete next.systemChoiceProblem;
        return next;
      }
      const same = state.systemChoiceProblem?.value === problem.value && state.systemChoiceProblem.reason === problem.reason;
      return same ? null : { ...state, systemChoiceProblem: problem };
    });

  /** The link itself, after the seen record; a refusal is recorded as the design's choice problem. */
  const act = async (slug: string, choice: string, retry: boolean): Promise<void> => {
    const value = choice.slice(0, SYSTEM_CHOICE_VALUE_MAX);
    const designDir = await ctx.store.dir(slug);
    const copy = await readCopyRecord(designDir);
    if (choice === 'none') {
      if (copy.kind === 'absent') {
        await ctx.store.updateSystemState(slug, (state) => {
          const next: ServiceState = { ...state, systemDecision: 'none' };
          delete next.systemChoiceProblem;
          return next;
        });
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

  const unsubscribe = ctx.hub.subscribe((event) => {
    if (stopped || event.slug === null || event.origin === 'user') return;
    if (event.kind !== 'design' && event.kind !== 'added') return;
    const slug = event.slug;
    void enqueue(slug, () => reconcile(slug));
  });

  return {
    reconcile: (slug) => enqueue(slug, () => reconcile(slug)),
    async idle() {
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

/** Subscribes to design events; returns the unsubscribe. */
export const startChoiceReconciler = (ctx: ServiceContext): (() => void) => {
  const reconciler = createChoiceReconciler({ ctx });
  return () => reconciler.stop();
};
