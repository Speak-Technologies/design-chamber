// Visual harness only: the checks routes of the fake service (documentation/specs/agent-render-and-check.md §3, §9).
// One state per sample design so each badge state can be screenshot:
//   coffee-subscription   canvas  2 errors, 1 warning, 1 note, rendering stale (2 older findings); Check rendering turns them into real ones
//   northwind-pricing     page    passes, rendering fresh
//   invoice-template      page    1 warning, rendering never checked
//   habit-tracker         canvas  no browser: rendering unavailable, passes
//   onboarding-flow       canvas  3 screens not written yet (errors) until the agent writes them
//   launch-announcement   page    passes; the only design a "service error" can be switched on for
// Sentences come from the real table in src/shared/checks.ts, so the screenshots show the shipped copy.

import type { ChecksRenderState, ChecksResponse, ChecksRunResponse } from '../../../src/shared/api.ts';
import { countFindings, sortFindings, withMessage } from '../../../src/shared/checks.ts';
import type { ChangeEvent, CheckFinding, CheckFindingData, Viewport } from '../../../src/shared/types.ts';
import { ServiceError } from './service-error.ts';

const MINUTE = 60_000;

type Info = { viewports: readonly Viewport[]; unwritten: readonly string[] };

type Deps = {
  emit: (slug: string, kind: ChangeEvent['kind']) => void;
  /** The design's viewports and the screen files not written yet; throws `not-found`. */
  info: (slug: string) => Info;
};

type Report = { state: ChecksRenderState; at: string; artboards: number; findings: CheckFindingData[] };

const data = (code: CheckFindingData['code'], over: Partial<CheckFindingData> = {}): CheckFindingData => ({ code, file: null, screen: null, viewport: null, ...over });

const COFFEE_STATIC: CheckFindingData[] = [
  data('ref-missing', { file: 'screens/pricing.html', screen: 'pricing', detail: 'assets/beans-hero.webp' }),
  data('remote-ref', { file: 'screens/home.html', screen: 'home', detail: 'https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600&display=swap' }),
  data('doc-title', { file: 'screens/checkout.html', screen: 'checkout' }),
  data('doc-charset', { file: 'screens/home.html', screen: 'home' }),
];

const COFFEE_RENDER: CheckFindingData[] = [
  data('overflow-x', { file: 'screens/home.html', screen: 'home', viewport: 'phone', params: { px: 452, width: 390 }, selector: 'section.hero > .plans-row' }),
  data('contrast', { file: 'screens/pricing.html', screen: 'pricing', viewport: 'laptop', params: { ratio: 3.1, min: 4.5 }, detail: 'Everyday · most picked', selector: '.card.featured > .tag' }),
];

export type FakeChecks = {
  handlers: {
    'GET /designs/:slug/checks': (req: { params: Record<string, string> }) => ChecksResponse;
    'POST /designs/:slug/checks/run': (req: { params: Record<string, string> }) => ChecksRunResponse;
  };
  prompt: (slug: string) => { text: string };
  /** Test hooks (shoot.mjs reaches them through `window.__dcFake.checks`). */
  hooks: { setRunMs: (ms: number) => void; setFail: (on: boolean) => void; /** A `checks` change event for the design, as if the agent's CLI had just written a report. */ touch: (slug: string) => void; /** How many times the checks of a design were asked for. */ gets: (slug: string) => number };
};

export const createFakeChecks = (deps: Deps): FakeChecks => {
  const reports = new Map<string, Report>();
  const running = new Set<string>();
  let runMs = 800;
  let failing = false;
  const getCounts = new Map<string, number>();
  const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

  reports.set('coffee-subscription', { state: 'stale', at: ago(35 * MINUTE), artboards: 6, findings: COFFEE_RENDER });
  reports.set('northwind-pricing', { state: 'fresh', at: ago(12 * MINUTE), artboards: 1, findings: [] });
  reports.set('habit-tracker', { state: 'unavailable', at: ago(2 * MINUTE), artboards: 0, findings: [data('browser-missing')] });

  const staticFor = (slug: string, info: Info): CheckFindingData[] => {
    switch (slug) {
      case 'coffee-subscription':
        return COFFEE_STATIC;
      case 'invoice-template':
        return [data('doc-lang', { file: 'index.html' })];
      case 'onboarding-flow':
        return info.unwritten.map((file) => data('screen-file-missing', { file }));
      default:
        return [];
    }
  };

  const build = (slug: string): ChecksResponse => {
    if (failing && slug === 'launch-announcement') throw new ServiceError('internal', 'The local service didn’t answer.');
    const info = deps.info(slug);
    const message = (finding: CheckFindingData): CheckFinding => withMessage(finding, info.viewports);
    const staticFindings = sortFindings(staticFor(slug, info).map(message));
    const report = reports.get(slug);
    const isRunning = running.has(slug);
    const state: ChecksRenderState = isRunning ? 'running' : (report?.state ?? 'none');
    const renderFindings = sortFindings((report?.findings ?? []).map(message));
    // Counted like the service does: only findings about the files as they are now.
    const counted = [...staticFindings, ...(state === 'fresh' || state === 'unavailable' ? renderFindings : [])];
    return {
      static: { findings: staticFindings, partial: false, at: ago(1000) },
      render: { state, at: report?.at ?? null, artboards: report?.artboards ?? 0, skipped: 0, findings: renderFindings },
      counts: countFindings(counted),
      canRun: !isRunning && slug !== 'habit-tracker',
    };
  };

  return {
    handlers: {
      'GET /designs/:slug/checks': ({ params }) => {
        getCounts.set(params.slug ?? '', (getCounts.get(params.slug ?? '') ?? 0) + 1);
        return build(params.slug ?? '');
      },
      'POST /designs/:slug/checks/run': ({ params }) => {
        const slug = params.slug ?? '';
        deps.info(slug);
        if (running.size > 0 && !running.has(slug)) throw new ServiceError('conflict', 'Another design is being checked. Try again in a moment.');
        running.add(slug);
        deps.emit(slug, 'checks');
        setTimeout(() => {
          running.delete(slug);
          reports.set(slug, { state: 'fresh', at: new Date().toISOString(), artboards: slug === 'coffee-subscription' ? 6 : 1, findings: slug === 'coffee-subscription' ? COFFEE_RENDER : [] });
          deps.emit(slug, 'checks');
        }, runMs);
        return { state: 'running' };
      },
    },
    prompt: (slug) => {
      const info = deps.info(slug);
      const lines = staticFor(slug, info).map((finding, index) => `${index + 1}. ${withMessage(finding, info.viewports).message}`);
      return { text: `[Design Chamber] Fix what the check found in "${slug}".\n${lines.join('\n')}` };
    },
    hooks: {
      setRunMs: (ms) => void (runMs = ms),
      setFail: (on) => void (failing = on),
      touch: (slug) => deps.emit(slug, 'checks'),
      gets: (slug) => getCounts.get(slug) ?? 0,
    },
  };
};
