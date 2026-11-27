// `dc check <design>`: the command an agent runs to look at its own work
// (documentation/specs/agent-render-and-check.md §4.7). It runs in the agent's shell, needs no
// service and no token: it reads the design's files, starts its own headless browser, prints what
// it found and exits 0 (no errors), 1 (errors) or 2 (it could not run).
// `dc list` and `dc read <design>` (use-the-project spec §2.3) only read: the library, one design's
// pins, hand edits, system and last check, and what the user has open. Exit 0 or 2.
//
// Built to dist/cli/dc.mjs (scripts/build.mjs) with the probe embedded as `__DC_PROBE__`; the
// launcher the service writes (`<root>/.chamber/bin/dc`) calls it with `--root`.

import { readFileSync } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CheckInterrupted, CheckUsageError, runCheck } from '../service/check/engine.ts';
import { allFindings, exitCodeOf, formatCheckText, formatSystemCheckText, jsonOutput, parseArgs, systemFindingsOf, systemJsonOutput, USAGE } from '../service/check/report-text.ts';
import { CheckOutputError } from '../service/check/output.ts';
import { cliSystemStore, runSystemCheck } from '../service/check/system-run.ts';
import { resolveSystemTarget, resolveTarget } from '../service/check/target.ts';
import { resolveBrowser } from '../service/chrome.ts';
import { defaultDesignsRoot, isDesignFolder, isDirectory } from '../service/root.ts';
import { readSettingsFile, settingsFilePath } from '../service/settings.ts';
import { listDesigns, readOneDesign } from '../service/agent-read.ts';
import { formatListText, formatReadText, listJson, parseReadArgs, readJson, type ReadCommand } from '../shared/agent/read-text.ts';
import type { SettingsFile, SystemArea } from '../shared/types.ts';
import type { CheckScheme } from '../service/check/report-text.ts';

const out = (text: string): void => {
  process.stdout.write(text);
};
const fail = (message: string): number => {
  process.stderr.write(`${message}\n`);
  return 2;
};

const versionOf = (): string => {
  try {
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const parsed: unknown = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed && typeof parsed.version === 'string') return parsed.version;
  } catch {
    /* an unreadable package.json is not worth failing a check for */
  }
  return '0.0.0';
};

/** The designs root: `--root` (the launcher passes it), else the setting, else the default. */
const rootFrom = async (given: string | null): Promise<{ root: string; chromePath: string | undefined; settings: SettingsFile }> => {
  const { settings } = await readSettingsFile(settingsFilePath());
  return { root: given ?? settings.root ?? defaultDesignsRoot(), chromePath: settings.chromePath, settings };
};

const isRealDirectory = async (dir: string): Promise<boolean> => {
  const info = await lstat(dir).catch(() => null);
  return info !== null && info.isDirectory() && !info.isSymbolicLink();
};

/**
 * `dc check --system <id>`: draw the board at two widths (and dark), then every screen at its viewports, and
 * save the pictures; `--screen` draws only those screens; `--static` checks the files only.
 */
const checkSystem = async (input: {
  root: string;
  settings: SettingsFile;
  id: string;
  json: boolean;
  staticOnly: boolean;
  chromePath: string | undefined;
  area: SystemArea | null;
  scheme: CheckScheme | null;
  /** `--screen` (T12b): only these system screens, no board. */
  screens: string[];
}): Promise<number> => {
  const target = await resolveSystemTarget({ id: input.id, root: input.root }, { path, realpath, isRealDirectory, platform: process.platform });
  if (!target.ok) return fail(target.message);
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const browser = input.staticOnly ? { path: null } : resolveBrowser(input.chromePath === undefined ? {} : { chromePath: input.chromePath });
  const store = cliSystemStore(target.root, input.settings);
  try {
    const result = await runSystemCheck(store, target.id, {
      now: new Date(),
      tool: 'cli',
      ...(input.staticOnly
        ? {}
        : {
            render: {
              browserPath: browser.path,
              probeSource: typeof __DC_PROBE__ === 'string' ? __DC_PROBE__ : '',
              platform: process.platform,
              isRoot: process.getuid?.() === 0,
              signal: controller.signal,
              area: input.area,
              scheme: input.scheme,
              screens: input.screens,
            },
          }),
    });
    // Every picture of a run sits in one run folder: printed once, the pictures by name inside it.
    const firstPng = result.pngs[0];
    const runDir = firstPng === undefined ? null : path.dirname(firstPng);
    const text = { report: result.report, name: result.detail.name, reportPath: result.reportPath, pngs: result.pngs, runDir };
    out(input.json ? systemJsonOutput(text) : formatSystemCheckText(text));
    return exitCodeOf(systemFindingsOf(result.report));
  } catch (error) {
    // An unknown --screen id is refused before anything is drawn (CheckUsageError): exit 2 with its sentence.
    if (error instanceof CheckInterrupted || error instanceof CheckOutputError || error instanceof CheckUsageError) return fail(error.message);
    return fail(`The check could not run: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await store.dispose();
  }
};

/**
 * `dc list` and `dc read` (use-the-project spec §2.3): read the designs folder and answer.
 * Nothing is written; exit 0 when answered, 2 when it could not run.
 */
const readCommand = async (command: Exclude<ReadCommand, { kind: 'error' }>): Promise<number> => {
  const settingsFile = settingsFilePath();
  const { root, settings } = await rootFrom(command.root);
  if (!path.isAbsolute(root)) return fail(`The designs folder must be a full path, not ${root}.`);
  if (!(await isDirectory(root))) return fail(`The designs folder ${root} does not exist.`);
  // view.json sits beside settings.json (§2.4), so a DC_SETTINGS_PATH test seam moves both.
  const dataDir = path.dirname(settingsFile);
  const now = new Date();
  try {
    if (command.kind === 'list') {
      const answer = await listDesigns({ root, settings, dataDir, now, project: command.project, kind: command.designKind, text: command.text });
      out(command.json ? listJson(answer) : formatListText(answer));
      return 0;
    }
    const result = await readOneDesign({ root, settings, dataDir, now, slug: command.slug });
    if (!result.ok) return fail(result.message);
    out(command.json ? readJson(result.answer) : formatReadText(result.answer));
    return 0;
  } catch (error) {
    return fail(`Design Chamber couldn't read the designs folder: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const main = async (): Promise<number> => {
  const argv = process.argv.slice(2);
  const read = parseReadArgs(argv, path.isAbsolute);
  if (read !== null) return read.kind === 'error' ? fail(read.message) : readCommand(read);
  const command = parseArgs(argv);
  switch (command.kind) {
    case 'help':
      out(`${USAGE}\n`);
      return 0;
    case 'version':
      out(`${versionOf()}\n`);
      return 0;
    case 'error':
      return fail(command.message);
    case 'check':
    case 'check-system':
      break;
  }

  const { root, chromePath, settings } = await rootFrom(command.root);
  if (!path.isAbsolute(root)) return fail(`The designs folder must be a full path, not ${root}.`);
  if (!(await isDirectory(root))) return fail(`The designs folder ${root} does not exist.`);
  if (command.kind === 'check-system') {
    return checkSystem({ root, settings, id: command.system, json: command.json, staticOnly: command.staticOnly, chromePath, area: command.area, scheme: command.scheme, screens: command.screens });
  }
  const target = await resolveTarget({ arg: command.target, root, cwd: process.cwd() }, { path, realpath, isDesignFolder, platform: process.platform });
  if (!target.ok) return fail(target.message);

  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  const browser = command.staticOnly ? { path: null } : resolveBrowser(chromePath === undefined ? {} : { chromePath });
  let result;
  try {
    result = await runCheck({
      designDir: target.dir,
      slug: target.slug,
      ...(command.screens.length > 0 ? { screens: command.screens } : {}),
      staticOnly: command.staticOnly,
      tool: 'cli',
      browserPath: browser.path,
      probeSource: typeof __DC_PROBE__ === 'string' ? __DC_PROBE__ : '',
      platform: process.platform,
      isRoot: process.getuid?.() === 0,
      now: () => new Date(),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof CheckUsageError || error instanceof CheckOutputError || error instanceof CheckInterrupted) return fail(error.message);
    return fail(`The check could not run: ${error instanceof Error ? error.message : String(error)}`);
  }

  const input = { report: result.report, design: result.design, pngs: result.pngs, reportPath: result.reportPath };
  out(command.json ? jsonOutput(input) : formatCheckText(input));
  return exitCodeOf(allFindings(result.report, result.design.viewports));
};

process.exitCode = await main();
