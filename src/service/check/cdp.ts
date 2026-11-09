// A minimal Chrome DevTools Protocol client over `--remote-debugging-pipe`
// (documentation/specs/agent-render-and-check.md D4, §4.1). No listening socket another local
// process could attach to, and no dependency on a global WebSocket. The browser reads commands
// from fd 3 and writes answers and events to fd 4: JSON messages, each ended by a NUL byte.

import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

export class CdpError extends Error {
  readonly method: string;
  constructor(method: string, message: string) {
    super(`${method}: ${message}`);
    this.name = 'CdpError';
    this.method = method;
  }
}

/** The browser could not be started or driven (exited, refused the pipe, never answered). */
export class CdpUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CdpUnavailable';
  }
}

// ---- framing (pure) ----

export const encodeMessage = (message: object): Buffer => Buffer.from(`${JSON.stringify(message)}\0`, 'utf8');

/** Collect chunks and hand out complete NUL-terminated messages as text. */
export const createFrameParser = (onMessage: (text: string) => void): ((chunk: Buffer) => void) => {
  let pending: Buffer = Buffer.alloc(0);
  return (chunk) => {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    for (;;) {
      const end = pending.indexOf(0);
      if (end < 0) return;
      const text = pending.subarray(0, end).toString('utf8');
      pending = pending.subarray(end + 1);
      if (text !== '') onMessage(text);
    }
  };
};

// ---- browser command line (pure) ----

export type BrowserArgsInput = {
  /** Throwaway folder; the profile lives in `<workDir>/profile`. */
  workDir: string;
  platform: NodeJS.Platform;
  /** Chromium refuses its sandbox as root (Linux containers); only then it is switched off. */
  isRoot: boolean;
  /** Joined with the platform's separator by the caller's path module. */
  join: (...parts: string[]) => string;
};

/**
 * The command line of the check's browser. The network is cut four ways (spec §7): the document
 * is served from memory with a CSP, every other request is failed by the engine, host names do not
 * resolve, and the proxy is dead (which also stops IP-literal URLs; loopback is not exempt).
 */
/**
 * Cuts the network for a browser that opens untrusted design HTML (the check and the thumbnails):
 * no name resolves, the proxy is dead and loopback is not exempt from it, and WebRTC may not send UDP.
 * Chrome 157 honours `--webrtc-ip-handling-policy` (QA measured STUN packets reaching a listener with
 * only the `--force-` spelling), so both are given.
 */
export const OFFLINE_NETWORK_ARGS: readonly string[] = [
  '--host-resolver-rules=MAP * ~NOTFOUND',
  '--proxy-server=http://dc-check.invalid:1',
  '--proxy-bypass-list=<-loopback>',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
];

export const checkBrowserArgs = (input: BrowserArgsInput): string[] => [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--mute-audio',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--disable-default-apps',
  '--password-store=basic',
  '--use-mock-keychain',
  '--remote-debugging-pipe',
  ...OFFLINE_NETWORK_ARGS,
  ...(input.platform === 'linux' && input.isRoot ? ['--no-sandbox'] : []),
  `--user-data-dir=${input.join(input.workDir, 'profile')}`,
  'about:blank',
];

// ---- the session ----

export type CdpEvent = { method: string; params: Record<string, unknown>; sessionId?: string };

export type SendOptions = { sessionId?: string; timeoutMs?: number };

export type CdpSession = {
  send<T = Record<string, unknown>>(method: string, params?: object, options?: SendOptions): Promise<T>;
  /** Listen for an event by method name; answers the unsubscribe function. */
  on(method: string, listener: (event: CdpEvent) => void): () => void;
  /** Fires once when the browser process is gone. */
  onExit(listener: () => void): () => void;
  readonly exited: boolean;
  /** Ask the browser to close, then end the process (and its group on POSIX). Safe to call twice. */
  close(): Promise<void>;
};

export type OpenOptions = {
  /** How long the first answer may take. */
  timeoutMs: number;
  /** Default timeout of one command. */
  commandTimeoutMs?: number;
  /** Injectable for tests. */
  spawnImpl?: typeof spawn;
};

const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;
const CLOSE_GRACE_MS = 1500;

const killTree = (child: ChildProcess, platform: NodeJS.Platform): void => {
  const { pid } = child;
  try {
    // POSIX: the browser leads its own process group (`detached`), so the zygote, GPU and renderer children go too.
    if (platform !== 'win32' && pid !== undefined) process.kill(-pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
};

/** Start the browser with the pipe attached and prove it answers (`Browser.getVersion`). */
export const openCdp = async (browserPath: string, args: string[], options: OpenOptions): Promise<CdpSession> => {
  const platform = process.platform;
  const child = (options.spawnImpl ?? spawn)(browserPath, args, {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    detached: platform !== 'win32',
    windowsHide: true,
  });
  // Safe: stdio entries 3 and 4 are pipes by the option above.
  const toBrowser = child.stdio[3] as Writable | null | undefined;
  const fromBrowser = child.stdio[4] as Readable | null | undefined;

  let exited = false;
  const exitListeners = new Set<() => void>();
  const pending = new Map<number, { method: string; resolve: (value: never) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  const eventListeners = new Map<string, Set<(event: CdpEvent) => void>>();
  let seq = 0;

  const failAll = (reason: string): void => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new CdpUnavailable(reason));
      pending.delete(id);
    }
  };
  const markExited = (): void => {
    if (exited) return;
    exited = true;
    failAll('The browser closed.');
    for (const listener of exitListeners) listener();
  };

  child.on('error', () => markExited());
  child.on('exit', () => markExited());
  toBrowser?.on('error', () => undefined);
  fromBrowser?.on('error', () => undefined);

  const parse = createFrameParser((text) => {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null) return;
    const record = message as { id?: unknown; result?: unknown; error?: { message?: unknown }; method?: unknown; params?: unknown; sessionId?: unknown };
    if (typeof record.id === 'number') {
      const entry = pending.get(record.id);
      if (entry === undefined) return;
      pending.delete(record.id);
      clearTimeout(entry.timer);
      if (record.error !== undefined) entry.reject(new CdpError(entry.method, String(record.error.message ?? 'failed')));
      else entry.resolve((record.result ?? {}) as never);
      return;
    }
    if (typeof record.method === 'string') {
      const listeners = eventListeners.get(record.method);
      if (listeners === undefined) return;
      const event: CdpEvent = {
        method: record.method,
        params: typeof record.params === 'object' && record.params !== null ? (record.params as Record<string, unknown>) : {},
        ...(typeof record.sessionId === 'string' ? { sessionId: record.sessionId } : {}),
      };
      for (const listener of [...listeners]) listener(event);
    }
  });
  fromBrowser?.on('data', parse);

  const session: CdpSession = {
    send<T>(method: string, params: object = {}, sendOptions: SendOptions = {}): Promise<T> {
      if (exited || toBrowser === null || toBrowser === undefined) return Promise.reject(new CdpUnavailable('The browser closed.'));
      seq += 1;
      const id = seq;
      const timeoutMs = sendOptions.timeoutMs ?? options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new CdpError(method, `no answer in ${timeoutMs} ms`));
        }, timeoutMs);
        pending.set(id, { method, resolve: resolve as (value: never) => void, reject, timer });
        toBrowser.write(encodeMessage({ id, method, params, ...(sendOptions.sessionId ? { sessionId: sendOptions.sessionId } : {}) }), (error) => {
          if (error) {
            clearTimeout(timer);
            pending.delete(id);
            reject(new CdpUnavailable('The browser closed.'));
          }
        });
      });
    },
    on(method, listener) {
      const set = eventListeners.get(method) ?? new Set();
      set.add(listener);
      eventListeners.set(method, set);
      return () => set.delete(listener);
    },
    onExit(listener) {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
    get exited() {
      return exited;
    },
    async close() {
      if (!exited) {
        await session.send('Browser.close', {}, { timeoutMs: CLOSE_GRACE_MS }).catch(() => undefined);
        await new Promise<void>((resolve) => {
          if (exited) return resolve();
          const timer = setTimeout(resolve, CLOSE_GRACE_MS);
          const off = session.onExit(() => {
            clearTimeout(timer);
            off();
            resolve();
          });
        });
      }
      // Whatever is left (a hung renderer, a browser that ignored Browser.close) goes now.
      killTree(child, platform);
      try {
        toBrowser?.destroy();
        fromBrowser?.destroy();
      } catch {
        /* already closed */
      }
    },
  };

  try {
    await session.send('Browser.getVersion', {}, { timeoutMs: options.timeoutMs });
  } catch (error) {
    await session.close();
    throw new CdpUnavailable(error instanceof Error ? error.message : 'The browser did not answer.');
  }
  return session;
};
