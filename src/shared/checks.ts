// Design checks, the pure half (documentation/specs/agent-render-and-check.md §2.2, §4.5): the
// ONE place a finding's severity and sentence come from. A finding on disk (`check.json`) is
// `{ code, file, screen, viewport, params, detail, selector }`; anything else in that file is
// dropped, so a forged report can neither choose a severity nor put its own sentence in the UI.
// `detail` and `selector` are the only strings that carry design text: cleaned and clipped here,
// shown as data. No Node imports: the guests can import this file.

import {
  CHECK_DETAIL_MAX,
  CHECK_FILE_MAX_BYTES,
  CHECK_FINDINGS_MAX,
  CHECK_RUN_BUDGET_MS,
  CHECK_SELECTOR_MAX,
  SCREEN_ID_PATTERN,
  SHA256_PATTERN,
  SLUG_PATTERN,
  SYSTEM_CHOICE_VALUE_MAX,
  SYSTEM_NAME_MAX,
  VIEWPORT_ID_PATTERN,
} from './limits.ts';
import { BOARD_LAYOUTS } from './system-json.ts';
import type {
  ArtboardCheck,
  BuildProblemReason,
  CheckBrowser,
  CheckCode,
  CheckFinding,
  CheckFindingData,
  CheckParams,
  CheckReport,
  CheckSeverity,
  ProposalPartName,
  ProposalProblemReason,
  RenderCheckState,
  SecretShapeKind,
  SystemArea,
  SystemDepth,
  Viewport,
} from './types.ts';

// ---- code table ----

type CodeRule = { severity: CheckSeverity; sentence: (f: CheckFindingData, where: string) => string };

const num = (value: number | undefined, digits = 0): string => (value === undefined ? '?' : digits === 0 ? String(Math.round(value)) : value.toFixed(digits));
const fileOf = (f: CheckFindingData): string => f.file ?? 'This design';

/** Why artboards were left out, in the reason's own words; the limit case says how to check the rest. */
const skippedSentence = (f: CheckFindingData): string => {
  const count = Math.round(f.params?.count ?? 0);
  // A system board pass (system-builder-depth D8): the dark pass runs last, so it is the one a short run leaves out.
  if (f.file === 'board.html') {
    const passes = count === 1 ? '1 board pass was' : `${count} board passes were`;
    if (f.params?.reason === 'failures') return `${passes} not drawn (the browser failed three times in a row).`;
    return `${passes} not drawn (the check ran out of time). Check again with --area <area> or --scheme dark.`;
  }
  // System screens (system-builder-depth T12b): the finding names the first screen left out. A design's
  // own note never names a file, so the two can't be confused.
  if (f.file !== null && f.file.startsWith('screens/')) {
    const screens = count === 1 ? '1 screen artboard was' : `${count} screen artboards were`;
    const why =
      f.params?.reason === 'failures'
        ? 'the browser failed three times in a row'
        : f.params?.reason === 'budget'
          ? 'the check ran out of time'
          : `the limit is ${num(f.params?.max)} per check`;
    return `${screens} not drawn (${why}). Use --screen <id> to check the rest.`;
  }
  const what = `${count} ${count === 1 ? 'artboard was' : 'artboards were'} not rendered`;
  if (f.params?.reason === 'budget') return `${what} (the run took longer than ${Math.round(CHECK_RUN_BUDGET_MS / 1000)} seconds).`;
  if (f.params?.reason === 'failures') return `${what} (the browser failed three times in a row).`;
  return `${what} (the limit is ${num(f.params?.max)} per run). Use --screen <id> to check the rest.`;
};

// ---- Phase 2.5: design systems (documentation/specs/phase-2-5-technical.md §10) ----

/** The system's name as the finding carries it; the fallback keeps old reports readable. */
const systemNameOf = (f: CheckFindingData): string => f.params?.system ?? 'the design system';
/** The repo folder's base name ("shop" in the spec's examples). */
const repoNameOf = (f: CheckFindingData): string => f.params?.repo ?? 'the repo';

/** How the coverage gap names a depth ("a full system", "a product core system"). */
const DEPTH_LABELS: Readonly<Record<SystemDepth, string>> = { tokens: 'tokens only', core: 'product core', full: 'full' };
/** `data-dc-variant`, `data-dc-size`, `data-dc-state`: the label attribute each list is matched by. */
const LISTED_SINGULAR: Readonly<Record<NonNullable<CheckParams['listed']>, string>> = { variants: 'variant', sizes: 'size', states: 'state' };

export const AREA_LABELS: Readonly<Record<SystemArea, string>> = {
  foundations: 'Foundations',
  components: 'Components',
  patterns: 'Patterns & voice',
  brand: 'Brand & marketing',
};

const SECRET_KIND_LABELS: Readonly<Record<SecretShapeKind, string>> = {
  'aws-key': 'an AWS key',
  'github-token': 'a GitHub token',
  'openai-style-key': 'an OpenAI-style key',
  'slack-token': 'a Slack token',
  'google-key': 'a Google key',
  'private-key': 'a private key',
};

/** Why the living page could not be generated (§5.11's problem enum, rev 3 adds secret and no-snapshot). */
const LIVING_FAILED_REASONS: Readonly<Record<NonNullable<CheckParams['failed']>, string>> = {
  'too-large': 'it would be too large.',
  bundle: "a file couldn't be embedded.",
  unsafe: "it didn't pass the safety check.",
  'no-snapshot': "the repo hasn't been read yet.",
  secret: 'it would show something shaped like a secret.',
};

/** §5.9's closed adoption reasons; the finding names one, never free text. */
const BUILD_PROBLEM_SENTENCES: Readonly<Record<BuildProblemReason, (f: CheckFindingData) => string>> = {
  unreadable: () => "BUILD.json isn't valid JSON.",
  'ticket-unknown': () => 'This design system was started from a chat Design Chamber no longer knows. Start it again with /design-system.',
  'ticket-needed': () => "A system that lives in a repo needs a build ticket. Start it with /design-system in the project's chat.",
  'repo-outside-project': () =>
    'The repo must be the project this chat is in, or a folder inside it. To use a folder above it, such as the root of a monorepo, open a chat in that folder and run /design-system there.',
  'repo-overlap': () => 'Another design system already uses this repo folder or living-page path.',
  'living-page-exists': (f) => `The living-page path already exists in ${repoNameOf(f)} and isn't this system's living page. Pick another path.`,
  'code-outside-project': () => 'The code folder must be the project this chat is in, or a folder inside it.',
  'home-changed': (f) => `${systemNameOf(f)} already has files in ${repoNameOf(f)}, so its home can't change. Make a new system to move it.`,
  'ticket-changed': () => 'BUILD.json names another build. Keep the ticket this system started with.',
  'applied-unknown-proposal': (f) => `The agent says it applied a proposal you didn't approve here. Check ${repoNameOf(f)}'s history.`,
  'existing-outside-project': () => 'The existing system folder is outside the project it was found in; it was ignored.',
};

/** §5.14's closed proposal problems; the first one's sentence completes the finding. */
const PROPOSAL_PROBLEM_SENTENCES: Readonly<Record<ProposalProblemReason, string>> = {
  'not-adopted': 'the system has not been adopted from a build yet.',
  round: 'the interview is not finished; a proposal needs round two or done.',
  'path-outside': 'a system file lies outside the system folder.',
  'living-page-path': "the living-page file is not the build's living-page path.",
  'create-exists': 'a file the proposal creates already exists in the repo. The proposal must change it, not create it.',
  'from-missing': 'a proposed file is missing from proposal/.',
  'describe-change': "Describe only never changes the app's code.",
  'internal-parts': "an internal system's proposal can only hold token fixes.",
  'none-fixes': 'a build with no code to fix cannot hold token fixes.',
  rewritten: 'this proposal changed after it was shown. Ask the agent for a new one.',
  unreadable: "PROPOSAL.json isn't valid JSON.",
  // §5.14 step 4: problems of the preview generated from proposal/.
  'preview-too-large': 'the living page it proposes would be too large.',
  'preview-unsafe': "the living page it proposes didn't pass the safety check.",
  'preview-secret': 'the living page it proposes shows something shaped like a secret. Remove it before you approve.',
};

/** The drift sentences name what was compared (rev 3, §5.12); unread files follow when the scan listed any. */
const driftScope = (f: CheckFindingData, core: string): string => {
  const base = `In CSS variables and token JSON, ${core}`;
  const unread = f.params?.unread ?? 0;
  if (unread <= 0) return base;
  return `${base} Design Chamber can't read ${num(unread)} token ${unread === 1 ? 'file' : 'files'}, so differences there aren't counted.`;
};

/** `<file> @ <Label> <w>×<h>` is built by `whereOf`; the table only places it in a sentence. */
const RULES: Readonly<Record<CheckCode, CodeRule>> = {
  'overflow-x': { severity: 'error', sentence: (f, where) => `${where}: the content is ${num(f.params?.px)}px wide, wider than the ${num(f.params?.width)}px viewport.` },
  'text-clipped': { severity: 'warning', sentence: (_f, where) => `${where}: some text is cut off.` },
  'text-overlap': { severity: 'warning', sentence: (_f, where) => `${where}: two pieces of text overlap.` },
  contrast: {
    severity: 'error',
    sentence: (f, where) => `${where}: text contrast is ${num(f.params?.ratio, 1)}:1, below the ${num(f.params?.min, 1)}:1 that WCAG AA asks for.`,
  },
  'img-alt': { severity: 'error', sentence: (_f, where) => `${where}: an image has no alt text.` },
  'control-label': { severity: 'error', sentence: (_f, where) => `${where}: a form field has no label.` },
  'button-name': { severity: 'error', sentence: (_f, where) => `${where}: a button or link has no name.` },
  'screen-tall': { severity: 'warning', sentence: (f, where) => `${where}: this screen is ${num(f.params?.ratio, 1)} viewports tall. Split it into several screens.` },
  'page-height': { severity: 'info', sentence: (f, where) => `${where}: the page is ${num(f.params?.px)}px tall.` },
  'console-error': { severity: 'error', sentence: (_f, where) => `${where}: a script error.` },
  'request-blocked': { severity: 'error', sentence: (_f, where) => `${where}: a request to the internet was blocked.` },
  'dialog-opened': { severity: 'info', sentence: (_f, where) => `${where}: the page opened an alert or confirm box.` },
  'render-failed': { severity: 'error', sentence: (_f, where) => `${where} could not be rendered.` },
  'render-timeout': { severity: 'warning', sentence: (_f, where) => `${where} took too long to render and was skipped.` },
  'render-skipped': { severity: 'info', sentence: (f) => skippedSentence(f) },
  'browser-missing': { severity: 'info', sentence: () => 'No Chrome, Edge or Chromium was found, so nothing was rendered.' },
  'design-json-missing': { severity: 'error', sentence: () => 'design.json is missing. Write it before the HTML.' },
  'design-json-invalid': { severity: 'error', sentence: () => 'design.json is not valid JSON.' },
  'design-json-field': { severity: 'warning', sentence: (f) => `design.json: "${f.params?.field ?? '?'}" was ignored.` },
  'screen-file-missing': { severity: 'error', sentence: (f) => `${fileOf(f)} is listed in design.json but does not exist.` },
  'screen-unlisted': { severity: 'warning', sentence: (f) => `${fileOf(f)} is not in design.json screens, so the wall does not show it.` },
  'screen-per-viewport': {
    severity: 'warning',
    sentence: (f) => `${fileOf(f)} looks like a device copy of "${f.params?.base ?? '?'}". Use one responsive file per screen.`,
  },
  'entry-missing': { severity: 'error', sentence: () => 'index.html is missing.' },
  'ref-missing': { severity: 'error', sentence: (f) => `${fileOf(f)} links to a file that does not exist.` },
  'ref-outside': { severity: 'error', sentence: (f) => `${fileOf(f)} links to a file outside the design folder.` },
  'remote-ref': { severity: 'error', sentence: (f) => `${fileOf(f)} loads a file from the internet, which the viewer blocks.` },
  'module-import': { severity: 'warning', sentence: (f) => `${fileOf(f)} imports another script file, which can't load here.` },
  'doc-doctype': { severity: 'warning', sentence: (f) => `${fileOf(f)} does not start with <!doctype html>.` },
  'doc-lang': { severity: 'warning', sentence: (f) => `${fileOf(f)} has no lang on <html>.` },
  'doc-viewport': { severity: 'warning', sentence: (f) => `${fileOf(f)} has no viewport meta tag.` },
  'doc-title': { severity: 'warning', sentence: (f) => `${fileOf(f)} has no <title>.` },
  'doc-charset': { severity: 'info', sentence: (f) => `${fileOf(f)} does not declare its charset.` },
  'token-redefined': {
    severity: 'warning',
    sentence: (f) =>
      f.params?.system !== undefined
        ? `${fileOf(f)} redefines ${num(f.params?.count)} tokens from the design system ${f.params.system}. Use the system's values, or ask the user to change the system.`
        : `${fileOf(f)} redefines ${num(f.params?.count)} tokens from tokens.css. Change them in tokens.css.`,
  },
  'token-hardcoded': {
    severity: 'info',
    sentence: (f) =>
      f.params?.system !== undefined
        ? `${fileOf(f)} has ${num(f.params?.count)} hardcoded colours although the design system ${f.params.system} defines colours. Use its tokens.`
        : `${fileOf(f)} has ${num(f.params?.count)} hardcoded colours although tokens.css defines colours.`,
  },
  'tweak-broken': {
    severity: 'warning',
    sentence: (f) => {
      const field = f.params?.field ?? '?';
      if (f.params?.tweak === 'missing') return `design.json: the tweak for ${field} names a variable tokens.css does not define.`;
      if (f.params?.tweak === 'formula') return `design.json: the tweak for ${field} points at a formula in tokens.css (calc() or var()), so it can't be tuned.`;
      if (f.params?.tweak === 'unit') return `design.json: the tweak for ${field} uses a different unit than tokens.css.`;
      // `no-tokens`, and the fallback when a stored finding carries no reason: the one sentence that needs no params.
      return 'design.json declares tweaks, but the design has no tokens.css.';
    },
  },
  'check-partial': { severity: 'info', sentence: () => 'Some files were not checked in time.' },
  // Phase 2.5 §10.1: a design against its linked system.
  'system-drift': {
    severity: 'warning',
    // `part: 'system-files'` when the tokens couldn't be compared (the system no longer holds the
    // copy's original tokens.css) or other copy files changed: the files are counted instead.
    sentence: (f) =>
      f.params?.part === 'system-files'
        ? `This design's copy of ${systemNameOf(f)} was changed: ${num(f.params?.count)} ${f.params?.count === 1 ? 'file differs' : 'files differ'} from revision ${num(f.params?.revision)}. Put them back, or keep the changes in this design's own tokens.css.`
        : `This design's copy of ${systemNameOf(f)} was changed: ${num(f.params?.count)} tokens differ from revision ${num(f.params?.revision)}. Put them back, or keep them as this design's own overrides.`,
  },
  'system-copy-missing': {
    severity: 'warning',
    sentence: (f) => `This design's copy of ${systemNameOf(f)} is missing ${num(f.params?.count)} files.`,
  },
  'system-copy-invalid': {
    severity: 'warning',
    sentence: () => "system/COPY.json can't be read, so Design Chamber can't tell which system this design uses.",
  },
  'system-choice': {
    severity: 'warning',
    sentence: (f) =>
      f.params?.choice === 'draft'
        ? `design.json asks for the design system "${f.params?.value ?? '?'}", which isn't ready yet.`
        : `design.json asks for the design system "${f.params?.value ?? '?'}", which isn't a Ready system in this Designs folder.`,
  },
  // Phase 2.5 §10.3: checking a system.
  'system-unreadable': {
    severity: 'error',
    sentence: () => "Design Chamber can't read this design system. system.json isn't valid JSON.",
  },
  'system-entry-invalid': {
    severity: 'warning',
    sentence: () => "system.json has entries Design Chamber can't read.",
  },
  'system-value-invalid': {
    severity: 'error',
    sentence: () => "tokens.css holds a value that isn't valid for its section.",
  },
  'system-font-missing': {
    severity: 'error',
    sentence: (f) => `${fileOf(f)} is listed as a font but is missing or can't be used.`,
  },
  'system-overview-empty': { severity: 'warning', sentence: () => 'The system has no overview yet.' },
  'system-overview-long': {
    severity: 'warning',
    sentence: () => 'Keep the overview under 4 000 characters. Move detail into a note.',
  },
  'system-note-long': {
    severity: 'warning',
    sentence: () => 'A note is over 20 000 characters. Shorten it or split it.',
  },
  'system-example-remote': {
    severity: 'error',
    sentence: (f) => `${fileOf(f)} loads files from the internet, which the living page can't use.`,
  },
  'system-token-undefined': {
    severity: 'warning',
    sentence: () => "A component names a token the system doesn't define.",
  },
  'system-token-cap': {
    severity: 'warning',
    sentence: () => "Design systems hold up to 2 000 tokens. The rest weren't read.",
  },
  // Phase 2.5 §10.4: the repo-backed system (S8, with the rev 3 wording).
  'system-living-missing': {
    severity: 'warning',
    sentence: (f) => `${systemNameOf(f)} lives in ${repoNameOf(f)} but has no living page yet.`,
  },
  'system-living-stale': {
    severity: 'warning',
    sentence: (f) => `The living page was generated from revision ${num(f.params?.from)}; ${systemNameOf(f)} is at revision ${num(f.params?.revision)}.`,
  },
  'system-living-changed': {
    severity: 'warning',
    sentence: () => 'The living page in the repo differs from the one Design Chamber generated.',
  },
  'system-living-unsafe': {
    severity: 'error',
    sentence: () => "The living page has markup Design Chamber didn't generate and can't check as safe.",
  },
  'system-living-failed': {
    severity: 'warning',
    sentence: (f) => `Design Chamber couldn't generate the living page: ${LIVING_FAILED_REASONS[f.params?.failed ?? 'too-large']}`,
  },
  'system-repo-unreadable': {
    severity: 'error',
    sentence: (f) => `Design Chamber can't read ${repoNameOf(f)}'s design system folder. Choose another folder on the system page.`,
  },
  'system-snapshot-changed': {
    severity: 'warning',
    sentence: (f) => `${systemNameOf(f)}'s snapshot was changed outside Design Chamber. Re-sync to read ${repoNameOf(f)} again.`,
  },
  'system-code-drift': {
    severity: 'warning',
    sentence: (f) => driftScope(f, `${num(f.params?.count)} tokens differ from ${systemNameOf(f)}. Ask the agent to reconcile.`),
  },
  'system-code-differs': {
    severity: 'warning',
    sentence: (f) => driftScope(f, `${num(f.params?.count)} tokens still differ from what ${systemNameOf(f)} describes.`),
  },
  'system-build-invalid': {
    severity: 'warning',
    sentence: (f) => {
      const reason = f.params?.build;
      const sentence = reason !== undefined ? BUILD_PROBLEM_SENTENCES[reason](f) : 'Ask the agent to fix it.';
      return `BUILD.json can't be used: ${sentence}`;
    },
  },
  'system-coverage-empty': {
    severity: 'warning',
    sentence: (f) => `${systemNameOf(f)} covers ${AREA_LABELS[f.params?.area ?? 'foundations']} but has nothing there yet.`,
  },
  // Phase 2.5 rev 3 (§10.4).
  'system-living-reformatted': {
    severity: 'info',
    sentence: () => 'The living page may have been reformatted since it was generated. Its values are current.',
  },
  'system-living-secret': {
    // Error unless the page is dev-only; `severityOf` reads the validated `access` param.
    severity: 'error',
    sentence: (f) => {
      const count = Math.max(1, Math.round(f.params?.count ?? 1));
      const label = SECRET_KIND_LABELS[f.params?.kind ?? 'aws-key'];
      const what = count === 1 ? `something shaped like a secret (${label})` : `${num(count)} things shaped like secrets (${label})`;
      return `The living page shows ${what}. Remove ${count === 1 ? 'it' : 'them'} from the system.`;
    },
  },
  'system-landed-differs': {
    severity: 'warning',
    sentence: (f) =>
      f.params?.part !== undefined
        ? `The agent says it applied ${f.params.part}, but Design Chamber found none in ${repoNameOf(f)}.`
        : `What landed in ${repoNameOf(f)} differs from the proposal you approved in ${num(f.params?.count)} files.`,
  },
  'system-proposal-invalid': {
    severity: 'warning',
    sentence: (f) => {
      const reason = f.params?.proposal;
      // An unreadable file's own sentence is in the detail; the closed one would only guess at it.
      if (reason === undefined || (reason === 'unreadable' && f.detail !== undefined)) return "PROPOSAL.json can't be used. Ask the agent to fix it.";
      return `PROPOSAL.json can't be used: ${PROPOSAL_PROBLEM_SENTENCES[reason]}`;
    },
  },
  // Board layout hints and the visual system check (documentation/specs/system-board-layout-and-visual-check.md §B.6).
  'system-layout-invalid': {
    severity: 'warning',
    sentence: (f) => {
      const count = Math.round(f.params?.count ?? 0);
      const misplaced = Math.min(count, Math.round(f.params?.misplaced ?? 0));
      const tail = 'so those entries use the default. Each one listed says what its place takes.';
      if (misplaced === 0) return `system.json asks for ${num(count)} board layouts Design Chamber doesn't know, ${tail}`;
      if (misplaced === count) return `system.json asks for ${num(count)} board layouts in places that don't take them, ${tail}`;
      return `system.json asks for ${num(count)} board layouts it can't use (${num(count - misplaced)} Design Chamber doesn't know, ${num(misplaced)} in places that don't take them), ${tail}`;
    },
  },
  'system-board-overflow': {
    severity: 'warning',
    sentence: (f, where) => `${where}: the board is ${num(f.params?.px)}px wide, wider than the ${num(f.params?.width)}px it has, so it scrolls sideways.`,
  },
  'system-board-preview-wide': {
    severity: 'warning',
    sentence: (f, where) => `${where}: this example is ${num(f.params?.px)}px wide but the board can give it ${num(f.params?.width)}px, so it scrolls sideways in its card.`,
  },
  'system-board-preview-outside': {
    severity: 'warning',
    sentence: (f, where) => `${where}: part of this example sits ${num(f.params?.px)}px outside its card, so it's cut off or covers other entries.`,
  },
  'system-board-text-outside': {
    severity: 'warning',
    sentence: (f, where) => `${where}: text runs ${num(f.params?.px)}px outside its card.`,
  },
  'system-board-hint-small': {
    severity: 'info',
    sentence: (f, where) => `${where}: this entry is set to ${f.params?.layout ?? 'card'} but needed the full width. Set its layout to full.`,
  },
  // system-builder-depth §4.5: what the files say about completeness, labels and contrast.
  'system-example-missing': {
    // Info for a core system, a warning for a full one: `severityOf` reads the validated `depth` param.
    severity: 'info',
    sentence: (f) => {
      const count = Math.max(1, Math.round(f.params?.count ?? 1));
      return count === 1 ? '1 entry has no live example yet, so the board shows only its words.' : `${num(count)} entries have no live example yet, so the board shows only their words.`;
    },
  },
  'system-states-missing': {
    severity: 'warning',
    sentence: (f) => {
      const count = Math.max(1, Math.round(f.params?.count ?? 1));
      const listed = f.params?.listed ?? 'states';
      const what = count === 1 ? `1 ${LISTED_SINGULAR[listed]} listed in system.json has` : `${num(count)} ${listed} listed in system.json have`;
      return `${what} no labelled instance in ${count === 1 ? 'its' : 'their'} example. Label each one with data-dc-${LISTED_SINGULAR[listed]}.`;
    },
  },
  'system-contrast-low': {
    severity: 'warning',
    sentence: (f) => {
      const count = Math.max(1, Math.round(f.params?.count ?? 1));
      const scheme = f.params?.scheme === 'dark' ? 'dark' : 'light';
      return count === 1 ? `1 colour pair is under its contrast level on the ${scheme} scheme.` : `${num(count)} colour pairs are under their contrast level on the ${scheme} scheme.`;
    },
  },
  'system-coverage-gap': {
    // Info for a core system, a warning for a full one, as `system-example-missing`.
    severity: 'info',
    sentence: (f) => {
      const count = Math.max(1, Math.round(f.params?.count ?? 1));
      return `${AREA_LABELS[f.params?.area ?? 'foundations']} is missing ${count === 1 ? '1 thing' : `${num(count)} things`} a ${DEPTH_LABELS[f.params?.depth ?? 'core']} system covers.`;
    },
  },
  // ---- system-builder-depth Phase 2, Wave 0 (§13 T10a, T11): nothing raises these yet ----
  'system-motion-no-reduced': {
    severity: 'warning',
    sentence: (f) => {
      const count = Math.max(1, Math.round(f.params?.count ?? 1));
      return count === 1
        ? '1 example moves but has no prefers-reduced-motion rule.'
        : `${num(count)} examples move but have no prefers-reduced-motion rule.`;
    },
  },
  'system-icons-mixed': {
    severity: 'info',
    sentence: () => 'The icons mix viewBox sizes or stroke widths, so they may not look like one set.',
  },
  // ---- end system-builder-depth Phase 2 ----
  // ---- system-builder-depth Phase 3 (§13 T16): `count` is the states in this example that changed nothing ----
  'system-state-unstyled': {
    severity: 'warning',
    sentence: (f) => {
      const count = Math.max(1, Math.round(f.params?.count ?? 1));
      const base =
        count === 1
          ? "The example labels a state its CSS doesn't style: forced on the element, it changes nothing you can see. Style it, or remove the label."
          : `The example labels ${num(count)} states its CSS doesn't style: forced on the element, they change nothing you can see. Style them, or remove the labels.`;
      const hint = f.params?.hint;
      const rest = hint === 'rest' || hint === 'both' ? ' There is no resting copy beside the labelled one to force the state on: add one labelled data-dc-state="rest" with the same variant and size.' : '';
      const focus = hint === 'focus-visible' || hint === 'both' ? ' It is labelled focus but its CSS styles :focus-visible: label it focus-visible, or style :focus too.' : '';
      return `${base}${rest}${focus}`;
    },
  },
  // T18: `px` = the source's width when no viewport matches; `reason` limit or budget with `count` (and `max`); neither = unreadable.
  'system-compare-skipped': {
    severity: 'info',
    sentence: (f) => {
      const count = Math.max(1, Math.round(f.params?.count ?? 1));
      const sheets = count === 1 ? '1 compare sheet was' : `${num(count)} compare sheets were`;
      if (f.params?.reason === 'limit') return `${sheets} not made (the limit is ${num(f.params.max)} per check). Use --screen <id> to compare the rest.`;
      if (f.params?.reason === 'budget' || f.params?.reason === 'failures') return `${sheets} not made (the check ran out of time). Use --screen <id> to compare the rest.`;
      if (f.params?.px !== undefined) return `The source picture is ${num(f.params.px)} px wide; no viewport of this screen matches. Save a screenshot as wide as one of its viewports.`;
      return "The source picture can't be read as a PNG or JPEG, so no compare sheet was made.";
    },
  },
  // ---- end system-builder-depth Phase 3 ----
  'system-board-partial': {
    severity: 'info',
    sentence: (f) => {
      const count = Math.round(f.params?.count ?? 0);
      const areas = count === 1 ? '1 area' : `${num(count)} areas`;
      const its = count === 1 ? 'its' : 'their';
      switch (f.params?.pictured) {
        case 'entries':
          return `Only the first ${num(f.params?.max)} entries were measured.`;
        case 'motion':
          if (count === 0) return 'No motion strip was taken: the check ran out of time for them.';
          return count === 1
            ? 'Only the first motion strip was taken; the other moving elements were not pictured.'
            : `Only the first ${num(count)} motion strips were taken; the other moving elements were not pictured.`;
        case 'states':
          if (count === 0) return 'No labelled state was forced and pictured: the check ran out of time for them.';
          return count === 1
            ? 'Only the first labelled state was forced and pictured; the others were not checked.'
            : `Only the first ${num(count)} labelled states were forced and pictured; the others were not checked.`;
        case 'gap':
          return `${count === 1 ? 'Part of 1 area is' : `Parts of ${areas} are`} in no picture (the picture limit for one check); the parts are listed. All of the board was measured, so the findings cover them.`;
        case 'no-overview':
          return `${areas} ${count === 1 ? 'has' : 'have'} no overview picture (it couldn't be made); ${its} full-size pictures show all of ${count === 1 ? 'it' : 'them'}.`;
        case 'overview':
          return `The overview of ${areas} stops early; ${its} full-size pictures show the rest, and all of the board was measured.`;
        default:
          return `${areas} ${count === 1 ? 'has' : 'have'} full-size pictures for only part of ${its} length (the picture limit for one check); ${its} overview shows the rest, and all of the board was measured.`;
      }
    },
  },
};

export const CHECK_CODES: readonly CheckCode[] = Object.freeze(Object.keys(RULES) as CheckCode[]);

export const isCheckCode = (value: unknown): value is CheckCode => typeof value === 'string' && Object.hasOwn(RULES, value);

/**
 * The severity of a code. Only this table decides it, from the code and validated params
 * alone: `system-living-secret` is a warning on a dev-only page, an error otherwise
 * (rev 3 §10.4). A forged report can still never choose its own severity.
 */
export const severityOf = (code: CheckCode, params?: CheckParams): CheckSeverity => {
  if (code === 'system-living-secret' && params?.access === 'dev') return 'warning';
  // The user's decision 4 (system-builder-depth): completeness warns only for full systems.
  if ((code === 'system-example-missing' || code === 'system-coverage-gap') && params?.depth === 'full') return 'warning';
  // Automatic pairs on a system made before builder depth: a note, never a new warning.
  if (code === 'system-contrast-low' && params?.pairs === 'auto') return 'info';
  return RULES[code].severity;
};

/** Codes whose sentence starts with the artboard (`file @ Label w×h`) rather than a bare file. */
const ARTBOARD_CODES: ReadonlySet<CheckCode> = new Set<CheckCode>([
  'overflow-x',
  'text-clipped',
  'text-overlap',
  'contrast',
  'img-alt',
  'control-label',
  'button-name',
  'screen-tall',
  'page-height',
  'console-error',
  'request-blocked',
  'dialog-opened',
  'render-failed',
  'render-timeout',
  'system-board-overflow',
  'system-board-preview-wide',
  'system-board-preview-outside',
  'system-board-text-outside',
  'system-board-hint-small',
  'system-board-partial',
]);

/** `screens/home.html @ Phone 390×844`, or the file alone when the viewport is not known. */
export const whereOf = (finding: CheckFindingData, viewports: readonly Pick<Viewport, 'id' | 'label' | 'width' | 'height'>[]): string => {
  const file = finding.file ?? 'This design';
  if (finding.viewport === null) return file;
  const viewport = viewports.find((candidate) => candidate.id === finding.viewport);
  return viewport === undefined ? `${file} @ ${finding.viewport}` : `${file} @ ${viewport.label} ${viewport.width}×${viewport.height}`;
};

/** The sentence for a finding, from `code` and `params` only. */
export const findingMessage = (finding: CheckFindingData, viewports: readonly Pick<Viewport, 'id' | 'label' | 'width' | 'height'>[] = []): string =>
  RULES[finding.code].sentence(finding, ARTBOARD_CODES.has(finding.code) ? whereOf(finding, viewports) : fileOf(finding));

/** A stored finding with the severity and sentence the service derives from its code. */
export const withMessage = (finding: CheckFindingData, viewports: readonly Pick<Viewport, 'id' | 'label' | 'width' | 'height'>[] = []): CheckFinding => ({
  ...finding,
  severity: severityOf(finding.code, finding.params),
  message: findingMessage(finding, viewports),
});

const SEVERITY_ORDER: Readonly<Record<CheckSeverity, number>> = { error: 0, warning: 1, info: 2 };

/** Errors first, then warnings, then notes; the original order is kept within a severity. */
export const sortFindings = <T extends { severity: CheckSeverity }>(findings: readonly T[]): T[] =>
  findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity] || a.index - b.index)
    .map((entry) => entry.finding);

export type CheckCounts = { errors: number; warnings: number; notes: number };

export const countFindings = (findings: readonly { severity: CheckSeverity }[]): CheckCounts => {
  const counts: CheckCounts = { errors: 0, warnings: 0, notes: 0 };
  for (const finding of findings) {
    if (finding.severity === 'error') counts.errors += 1;
    else if (finding.severity === 'warning') counts.warnings += 1;
    else counts.notes += 1;
  }
  return counts;
};

// ---- text from the design: cleaned, one line, clipped ----

/** Control characters and line separators become spaces; the result is trimmed and cut to `max`. */
export const cleanDetail = (text: string, max: number): string => {
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/ {2,}/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};

// ---- URLs ----

/**
 * One remote reference as a canonical URL, or `null` when it does not parse. Protocol-relative
 * refs (`//fonts.googleapis.com/…`) are read as https, which is how a browser outside the
 * sandbox would load them. `new URL` also drops tabs and newlines, so an entry never adds a
 * line to a prompt.
 */
export const normalizeExternalUrl = (raw: string): string | null => {
  const ref = raw.trim();
  try {
    return new URL(ref.startsWith('//') ? `https:${ref}` : ref).href;
  } catch {
    return null;
  }
};

// ---- parsing check.json (untrusted) ----

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A design-relative path with `/` separators and no `..` step. */
export const FILE_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;
const FIELD_PATTERN = /^[A-Za-z0-9_.[\]-]{1,80}$/;
const PNG_PATTERN = /^\.chamber\/check\/r-[0-9]{14}-[0-9a-f]{6}\/[A-Za-z0-9@._-]{1,120}\.png$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export const isDesignRelativeFile = (value: unknown): value is string =>
  typeof value === 'string' && FILE_PATTERN.test(value) && !value.split('/').some((part) => part === '..' || part === '');

const ARTBOARDS_MAX = 400;
const PNGS_MAX = 4;
const ENTRIES_MAX = 200;
const PX_MAX = 1_000_000;

const PARAM_NUMBERS = ['px', 'width', 'ratio', 'min', 'count', 'max', 'revision', 'from', 'unread', 'misplaced'] as const;

const AREAS: readonly SystemArea[] = ['foundations', 'components', 'patterns', 'brand'];
const SECRET_KINDS: readonly SecretShapeKind[] = ['aws-key', 'github-token', 'openai-style-key', 'slack-token', 'google-key', 'private-key'];
const PART_NAMES: readonly ProposalPartName[] = ['system-files', 'token-fixes', 'docs', 'living-page'];
const BUILD_REASONS: readonly BuildProblemReason[] = [
  'unreadable', 'ticket-unknown', 'ticket-needed', 'repo-outside-project', 'repo-overlap',
  'living-page-exists', 'code-outside-project', 'home-changed', 'ticket-changed', 'applied-unknown-proposal',
  'existing-outside-project',
];
const PROPOSAL_REASONS: readonly ProposalProblemReason[] = [
  'not-adopted', 'round', 'path-outside', 'living-page-path', 'create-exists', 'from-missing',
  'describe-change', 'internal-parts', 'none-fixes', 'rewritten', 'unreadable',
  'preview-too-large', 'preview-unsafe', 'preview-secret',
];
const PICTURED: readonly NonNullable<CheckParams['pictured']>[] = ['tiles', 'overview', 'no-overview', 'gap', 'entries', 'states', 'motion'];
const DEPTHS: readonly SystemDepth[] = ['tokens', 'core', 'full'];
const LISTED: readonly NonNullable<CheckParams['listed']>[] = ['variants', 'sizes', 'states'];
const LIVING_FAILED: readonly NonNullable<CheckParams['failed']>[] = ['too-large', 'bundle', 'unsafe', 'no-snapshot', 'secret'];

/** One of a closed enum, else null: a forged param never reaches a sentence. */
const oneOf = <T extends string>(value: unknown, options: readonly T[]): T | null =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : null;

/** A name the sentence quotes: one line, clipped, never empty. */
const nameParam = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const cleaned = cleanDetail(value, max);
  return cleaned === '' ? null : cleaned;
};

const parseParams = (value: unknown): CheckParams | undefined => {
  if (!isRec(value)) return undefined;
  const out: CheckParams = {};
  for (const key of PARAM_NUMBERS) {
    const entry = value[key];
    if (typeof entry === 'number' && Number.isFinite(entry) && Math.abs(entry) <= 1e9) out[key] = entry;
  }
  if (typeof value.field === 'string' && FIELD_PATTERN.test(value.field)) out.field = value.field;
  if (typeof value.base === 'string' && SCREEN_ID_PATTERN.test(value.base)) out.base = value.base;
  if (value.reason === 'limit' || value.reason === 'budget' || value.reason === 'failures') out.reason = value.reason;
  if (value.tweak === 'missing' || value.tweak === 'formula' || value.tweak === 'unit' || value.tweak === 'no-tokens') out.tweak = value.tweak;
  // Phase 2.5: names are cleaned and clipped; every other new param is a closed enum (§10).
  const system = nameParam(value.system, SYSTEM_NAME_MAX);
  if (system !== null) out.system = system;
  const repo = nameParam(value.repo, SYSTEM_NAME_MAX);
  if (repo !== null) out.repo = repo;
  const choiceValue = nameParam(value.value, SYSTEM_CHOICE_VALUE_MAX);
  if (choiceValue !== null) out.value = choiceValue;
  const area = oneOf(value.area, AREAS);
  if (area !== null) out.area = area;
  const kind = oneOf(value.kind, SECRET_KINDS);
  if (kind !== null) out.kind = kind;
  if (value.access === 'dev' || value.access === 'public') out.access = value.access;
  const part = oneOf(value.part, PART_NAMES);
  if (part !== null) out.part = part;
  if (value.choice === 'unknown' || value.choice === 'draft') out.choice = value.choice;
  const failed = oneOf(value.failed, LIVING_FAILED);
  if (failed !== null) out.failed = failed;
  const build = oneOf(value.build, BUILD_REASONS);
  if (build !== null) out.build = build;
  const proposal = oneOf(value.proposal, PROPOSAL_REASONS);
  if (proposal !== null) out.proposal = proposal;
  const layout = oneOf(value.layout, BOARD_LAYOUTS);
  if (layout !== null) out.layout = layout;
  const pictured = oneOf(value.pictured, PICTURED);
  if (pictured !== null) out.pictured = pictured;
  const depth = oneOf(value.depth, DEPTHS);
  if (depth !== null) out.depth = depth;
  if (value.scheme === 'light' || value.scheme === 'dark') out.scheme = value.scheme;
  const listed = oneOf(value.listed, LISTED);
  if (listed !== null) out.listed = listed;
  if (value.hint === 'rest' || value.hint === 'focus-visible' || value.hint === 'both') out.hint = value.hint;
  if (value.pairs === 'auto') out.pairs = 'auto';
  return Object.keys(out).length > 0 ? out : undefined;
};

/** One stored finding, or `null` when its code, file, screen or viewport is not valid. */
export const parseFindingData = (value: unknown): CheckFindingData | null => {
  if (!isRec(value) || !isCheckCode(value.code)) return null;
  const file = value.file === null || value.file === undefined ? null : isDesignRelativeFile(value.file) ? value.file : undefined;
  if (file === undefined) return null;
  const screen = value.screen === null || value.screen === undefined ? null : typeof value.screen === 'string' && SCREEN_ID_PATTERN.test(value.screen) ? value.screen : undefined;
  if (screen === undefined) return null;
  const viewport = value.viewport === null || value.viewport === undefined ? null : typeof value.viewport === 'string' && VIEWPORT_ID_PATTERN.test(value.viewport) ? value.viewport : undefined;
  if (viewport === undefined) return null;
  const finding: CheckFindingData = { code: value.code, file, screen, viewport };
  const params = parseParams(value.params);
  if (params !== undefined) finding.params = params;
  if (typeof value.detail === 'string') {
    const detail = cleanDetail(value.detail, CHECK_DETAIL_MAX);
    if (detail !== '') finding.detail = detail;
  }
  if (typeof value.selector === 'string') {
    const selector = cleanDetail(value.selector, CHECK_SELECTOR_MAX);
    if (selector !== '') finding.selector = selector;
  }
  return finding;
};

const parseFindingList = (value: unknown): CheckFindingData[] => {
  if (!Array.isArray(value)) return [];
  const out: CheckFindingData[] = [];
  for (const entry of value) {
    if (out.length >= CHECK_FINDINGS_MAX) break;
    const finding = parseFindingData(entry);
    if (finding !== null) out.push(finding);
  }
  return out;
};

const boundedInt = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= PX_MAX ? Math.round(value) : null;

const parseArtboard = (value: unknown): ArtboardCheck | null => {
  if (!isRec(value)) return null;
  const screen = value.screen === null ? null : typeof value.screen === 'string' && SCREEN_ID_PATTERN.test(value.screen) ? value.screen : undefined;
  if (screen === undefined) return null;
  if (typeof value.viewport !== 'string' || !VIEWPORT_ID_PATTERN.test(value.viewport)) return null;
  const width = boundedInt(value.width);
  const height = boundedInt(value.height);
  const docHeight = boundedInt(value.docHeight);
  const ms = boundedInt(value.ms);
  if (width === null || height === null || docHeight === null || ms === null || typeof value.ok !== 'boolean') return null;
  const pngs = Array.isArray(value.pngs) ? value.pngs.filter((png): png is string => typeof png === 'string' && PNG_PATTERN.test(png)).slice(0, PNGS_MAX) : [];
  return { screen, viewport: value.viewport, width, height, docHeight, pngs, ok: value.ok, ms };
};

const RENDER_STATES: ReadonlySet<unknown> = new Set<RenderCheckState>(['done', 'partial', 'unavailable', 'failed']);
const BROWSERS: ReadonlySet<unknown> = new Set<CheckBrowser>(['chrome', 'msedge', 'chromium', 'brave', 'other']);

const parseKeys = (value: unknown): { design: string; entries: Record<string, string> } | null => {
  if (!isRec(value) || typeof value.design !== 'string' || !SHA256_PATTERN.test(value.design) || !isRec(value.entries)) return null;
  const entries: Record<string, string> = {};
  for (const [rel, key] of Object.entries(value.entries).slice(0, ENTRIES_MAX)) {
    if (isDesignRelativeFile(rel) && typeof key === 'string' && SHA256_PATTERN.test(key)) entries[rel] = key;
  }
  return { design: value.design, entries };
};

/**
 * Validate a parsed `check.json`. `null` when the whole file is unusable (not an object, wrong
 * version, bad slug or time, a render part whose state or keys cannot be trusted); inside a
 * usable report, invalid findings and artboards are dropped, never fatal.
 */
export const parseCheckReport = (value: unknown): CheckReport | null => {
  if (!isRec(value) || value.version !== 1) return null;
  if (typeof value.slug !== 'string' || !SLUG_PATTERN.test(value.slug)) return null;
  if (value.kind !== 'page' && value.kind !== 'canvas') return null;
  if (typeof value.createdAt !== 'string' || !ISO_PATTERN.test(value.createdAt) || Number.isNaN(Date.parse(value.createdAt))) return null;
  if (value.tool !== 'cli' && value.tool !== 'service') return null;
  const staticPart = isRec(value.static) ? parseFindingList(value.static.findings) : [];

  let render: CheckReport['render'] = null;
  if (value.render !== null && value.render !== undefined) {
    if (!isRec(value.render) || !RENDER_STATES.has(value.render.state)) return null;
    const keys = parseKeys(value.render.keys);
    if (keys === null) return null;
    const browser = value.render.browser === null ? null : BROWSERS.has(value.render.browser) ? (value.render.browser as CheckBrowser) : undefined;
    if (browser === undefined) return null;
    const artboards: ArtboardCheck[] = [];
    if (Array.isArray(value.render.artboards)) {
      for (const entry of value.render.artboards.slice(0, ARTBOARDS_MAX)) {
        const artboard = parseArtboard(entry);
        if (artboard !== null) artboards.push(artboard);
      }
    }
    render = {
      // Safe: membership in RENDER_STATES was checked above.
      state: value.render.state as RenderCheckState,
      browser,
      keys,
      artboards,
      skipped: boundedInt(value.render.skipped) ?? 0,
      findings: parseFindingList(value.render.findings),
    };
  }
  return { version: 1, slug: value.slug, kind: value.kind, createdAt: value.createdAt, tool: value.tool, static: { findings: staticPart }, render };
};

/** Parse the text of a `check.json`: `null` when over the size cap or not JSON. */
export const parseCheckReportText = (text: string): CheckReport | null => {
  if (text.length > CHECK_FILE_MAX_BYTES) return null;
  try {
    return parseCheckReport(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
};
