// The Design Chamber OpenCode plugin (documentation/specs/phase-1-5-sdk-2-7.md §U3.3): one tool,
// `design_check`. Built to dist/plugin/index.js by scripts/build.mjs, which fails if the output
// imports anything: OpenCode loads it with a bare import() where nothing is installed. Node
// built-ins therefore come from `process.getBuiltinModule`, and only when the tool runs, so a
// runtime without them fails that one call with a sentence instead of failing to load.

import { createDesignCheckTool, type SpawnedChild, type ToolDeps } from './check-tool.ts';

type ToolRegistry = { add(tool: unknown): unknown };
type PluginContext = { tool: { transform(edit: (tools: ToolRegistry) => void): unknown } };

/** A built-in by name; throws with a code the tool reports when the runtime lacks it. */
const builtin = <T>(id: string): T => {
  const get = (process as { getBuiltinModule?: (name: string) => unknown }).getBuiltinModule;
  const module = typeof get === 'function' ? get(id) : undefined;
  if (module === undefined || module === null) throw Object.assign(new Error(`${id} is not available`), { code: 'NO_BUILTIN' });
  return module as T;
};

const nodeDeps = (): ToolDeps => {
  const fs = builtin<typeof import('node:fs')>('node:fs');
  const path = builtin<typeof import('node:path')>('node:path');
  const os = builtin<typeof import('node:os')>('node:os');
  const url = builtin<typeof import('node:url')>('node:url');
  const childProcess = builtin<typeof import('node:child_process')>('node:child_process');
  return {
    platform: process.platform,
    path,
    env: process.env,
    homeDir: os.homedir(),
    opencodeExecPath: process.execPath,
    // Ships in the same package as this file, so the CLI and the plugin are always one version.
    cliPath: url.fileURLToPath(new URL('../cli/dc.mjs', import.meta.url)),
    async readText(file, maxBytes) {
      let handle: Awaited<ReturnType<typeof fs.promises.open>>;
      try {
        handle = await fs.promises.open(file, 'r');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      try {
        const buffer = new Uint8Array(maxBytes + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
        return bytesRead > maxBytes ? '' : new TextDecoder().decode(buffer.subarray(0, bytesRead));
      } finally {
        await handle.close();
      }
    },
    realpath: (file) => fs.promises.realpath(file).catch(() => null),
    isFile: (file) => fs.promises.stat(file).then((info) => info.isFile(), () => false),
    // A Node ChildProcess has every member SpawnedChild names; the cast narrows it to them.
    spawn: (command, args, options) => childProcess.spawn(command, [...args], options) as unknown as SpawnedChild,
  };
};

export default {
  id: 'design-chamber',
  setup: async (ctx: PluginContext): Promise<void> => {
    await ctx.tool.transform((tools) => {
      tools.add(createDesignCheckTool(nodeDeps));
    });
  },
};
