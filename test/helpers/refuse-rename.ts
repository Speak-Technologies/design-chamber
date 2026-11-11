// Windows refuses to rename a file over one another handle has open at that moment (EPERM,
// sometimes EBUSY or EACCES): a reader of state.json, an antivirus scan. Linux never does, so
// tests reproduce it by swapping `fs.promises.rename` (or the synchronous `fs.renameSync` /
// `fs.readFileSync` the compare-and-swap writers use) for a refusing one. The service imports
// them as named ESM bindings; `syncBuiltinESMExports` makes those bindings follow the swap.

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import type { TestContext } from 'node:test';

export type RenameRefusal = {
  /** Every rename attempted while the refusal was in place, by destination path. */
  readonly attempts: string[];
};

/**
 * Refuse renames onto a destination `refuse(destination, attemptNumber)` says yes to, with
 * `code`; every other rename goes through. Restored after the test.
 */
export const refuseRenames = (t: TestContext, refuse: (destination: string, attempt: number) => boolean, code = 'EPERM'): RenameRefusal => {
  const original = fsPromises.rename;
  const attempts: string[] = [];
  fsPromises.rename = async (from, to) => {
    const destination = String(to);
    attempts.push(destination);
    if (refuse(destination, attempts.filter((entry) => entry === destination).length)) {
      throw Object.assign(new Error(`${code}: operation not permitted, rename '${String(from)}' -> '${destination}'`), { code, syscall: 'rename' });
    }
    return original(from, to);
  };
  syncBuiltinESMExports();
  t.after(() => {
    fsPromises.rename = original;
    syncBuiltinESMExports();
  });
  return { attempts };
};

const refusal = (code: string, syscall: string, target: string): Error =>
  Object.assign(new Error(`${code}: operation not permitted, ${syscall} '${target}'`), { code, syscall });

/** `refuseRenames` for the synchronous `fs.renameSync` (the hash compare-and-swap's final rename). */
export const refuseSyncRenames = (t: TestContext, refuse: (destination: string, attempt: number) => boolean, code = 'EPERM'): RenameRefusal => {
  const original = fs.renameSync;
  const attempts: string[] = [];
  fs.renameSync = (from, to) => {
    const destination = String(to);
    attempts.push(destination);
    if (refuse(destination, attempts.filter((entry) => entry === destination).length)) throw refusal(code, 'rename', destination);
    original(from, to);
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs.renameSync = original;
    syncBuiltinESMExports();
  });
  return { attempts };
};

/** Refuse `fs.readFileSync` of the files `refuse` says yes to (another program holding the file locked), with `code`. */
export const refuseSyncReads = (t: TestContext, refuse: (file: string) => boolean, code = 'EBUSY'): void => {
  const original = fs.readFileSync;
  const patched = (...args: Parameters<typeof fs.readFileSync>): ReturnType<typeof fs.readFileSync> => {
    if (refuse(String(args[0]))) throw refusal(code, 'open', String(args[0]));
    return original(...args);
  };
  // Safe: `patched` forwards every overload's arguments to the original unchanged.
  fs.readFileSync = patched as typeof fs.readFileSync;
  syncBuiltinESMExports();
  t.after(() => {
    fs.readFileSync = original;
    syncBuiltinESMExports();
  });
};
