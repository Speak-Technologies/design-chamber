// The two pure pieces of build-activity that more than the guest needs: the restore echo window and
// the filter that says which paths in a `files` event the agent wrote. No DOM, no host imports, so
// the service (Work Status rows) and the guest (the build strip) read the same rule. The guest
// re-exports both from `src/guest/build-activity.ts`, so its callers are unchanged.

/**
 * After a user's restore (a `files` event with no list) the folder watcher re-reports every file
 * the restore wrote, a debounce later and in batches. Listed file events inside this window are
 * the restore's echo, not the agent writing.
 */
export const RESTORE_QUIET_MS = 3_000;

const SERVICE_FOLDERS = ['.versions/', '.chamber/', '.trash/'];

/** Paths the agent wrote, from a `files` event's list: the service's own folders, design.json and temp files (`index.html.2bba59ef828e.tmp`, mid-write) are not the agent's output. A display filter, not a security check. */
export const agentFiles = (files: readonly string[]): string[] => [
  ...new Set(files.filter((file) => file !== 'design.json' && !file.endsWith('.tmp') && !SERVICE_FOLDERS.some((folder) => file.startsWith(folder)))),
];
