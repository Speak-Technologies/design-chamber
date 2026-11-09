// `dc check <design>`: the command an agent runs to look at its own work
// (documentation/specs/agent-render-and-check.md §4.7). It runs in the agent's shell, needs no
// service and no token: it reads the design's files, starts its own headless browser, prints what
// it found and exits 0 (no errors), 1 (errors) or 2 (it could not run).
//
// Built to dist/cli/dc.mjs (scripts/build.mjs) with the probe embedded as `__DC_PROBE__`; the
// launcher the service writes (`<root>/.chamber/bin/dc`) calls it with `--root`.

import { readFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CheckInterrupted, CheckUsageError, runCheck } from '../service/check/engine.ts';
import { allFindings, exitCodeOf, formatCheckText, jsonOutput, parseArgs, USAGE } from '../service/check/report-text.ts';
import { CheckOutputError } from '../service/check/output.ts';
import { resolveTarget } from '../service/check/target.ts';
import { resolveBrowser } from '../service/chrome.ts';
import { defaultDesignsRoot, isDesignFolder, isDirectory } from '../service/root.ts';
import { readSettingsFile, settingsFilePath } from '../service/settings.ts';

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
const rootFrom = async (given: string | null): Promise<{ root: string; chromePath: string | undefined }> => {
  const { settings } = await readSettingsFile(settingsFilePath());
  return { root: given ?? settings.root ?? defaultDesignsRoot(), chromePath: settings.chromePath };
};

const main = async (): Promise<number> => {
  const command = parseArgs(process.argv.slice(2));
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
      break;
  }

  const { root, chromePath } = await rootFrom(command.root);
  if (!path.isAbsolute(root)) return fail(`The designs folder must be a full path, not ${root}.`);
  if (!(await isDirectory(root))) return fail(`The designs folder ${root} does not exist.`);
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
