// Windows refuses to rename a file over one another handle has open at that moment (EPERM,
// sometimes EBUSY or EACCES): a reader of state.json, an antivirus scan. Linux never does, so
// tests reproduce it by swapping `fs.promises.rename` for a refusing one. The service imports
// `rename` as a named ESM binding; `syncBuiltinESMExports` makes that binding follow the swap.

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
