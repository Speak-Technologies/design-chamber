// A fake headless browser for the living page's example pictures (T14). It plays the CDP conversation
// `living-examples.ts` holds: the document request is paused and answered by the service, every
// reference in the served document is requested next (as a browser would), then load fires, and the
// screenshot is a PNG header of the clip's size at the page's device scale. Every command and every answer to a paused request
// is recorded, so a test can say scripts were disabled and nothing left.

import type { CdpEvent, CdpSession } from '../../../src/service/check/cdp.ts';
import { CdpUnavailable } from '../../../src/service/check/cdp.ts';

export type FakeSend = { method: string; params: Record<string, unknown>; sessionId: string | null };
export type FakeRequest = { url: string; answer: 'fulfill' | 'continue' | 'fail' };

export type FakeBrowser = {
  /** Pass as `openBrowser`. */
  open: () => Promise<CdpSession>;
  sends: FakeSend[];
  /** Every request the pages made, with how the service answered it. */
  requests: FakeRequest[];
  /** Each document the service served, with its response headers. */
  served: { url: string; html: string; headers: { name: string; value: string }[] }[];
  opened: number;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Buffer): number => {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Buffer): Buffer => {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
};

/** A PNG with a real header of `width`×`height` (the pixels are not drawn; only the size is read). `seed` varies the bytes. */
export const pngOfSize = (width: number, height: number, seed = 0): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('tEXt', Buffer.from(`seed\0${seed}`)), chunk('IEND', Buffer.alloc(0))]);
};

/** The references a browser would fetch from a document: `src`, `href`, `srcset`, `url()` and `@import`. */
const referencesOf = (html: string): string[] => {
  const out: string[] = [];
  for (const match of html.matchAll(/\s(?:src|href|srcset|poster|data)\s*=\s*["']?([^"'\s>]+)/gi)) out.push(match[1] ?? '');
  for (const match of html.matchAll(/url\(\s*["']?([^"')\s]+)/gi)) out.push(match[1] ?? '');
  for (const match of html.matchAll(/@import\s+["']([^"']+)/gi)) out.push(match[1] ?? '');
  return out.filter((url) => url !== '' && !url.startsWith('#'));
};

export type FakeBrowserOptions = {
  /** The content height the page reports, from the served document. Default: a `height: Npx` it names, else 120. */
  heightOf?: (html: string) => number;
  /** Documents whose load never fires (a hung page). */
  hangs?: (html: string) => boolean;
  /** How long after its references a document's load fires (a slow machine). Default: at once. */
  loadDelayMs?: (html: string) => number;
  /** Each start of the browser throws this many times first. */
  failStarts?: number;
};

export const createFakeBrowser = (options: FakeBrowserOptions = {}): FakeBrowser => {
  const fake: FakeBrowser = { open: async () => session(), sends: [], requests: [], served: [], opened: 0 };
  let startsLeft = options.failStarts ?? 0;
  const heightOf = options.heightOf ?? ((html: string) => Number(/height:\s*(\d+)px/.exec(html)?.[1] ?? 120));

  const session = (): CdpSession => {
    if (startsLeft > 0) {
      startsLeft -= 1;
      throw new CdpUnavailable('no browser here');
    }
    fake.opened += 1;
    const listeners = new Map<string, Set<(event: CdpEvent) => void>>();
    const emit = (event: CdpEvent): void => {
      for (const listener of [...(listeners.get(event.method) ?? [])]) listener(event);
    };
    let exited = false;
    let next = 0;
    const pending = new Map<string, (answer: FakeRequest['answer'], params: Record<string, unknown>) => void>();
    const html = new Map<string, string>();
    const scales = new Map<string, number>();
    const pause = (sessionId: string, url: string, then: (answer: FakeRequest['answer'], params: Record<string, unknown>) => void): void => {
      next += 1;
      const requestId = `r${next}`;
      pending.set(requestId, then);
      setImmediate(() => emit({ method: 'Fetch.requestPaused', sessionId, params: { requestId, request: { url } } }));
    };
    const answer = (requestId: unknown, kind: FakeRequest['answer'], params: Record<string, unknown>): void => {
      const then = pending.get(String(requestId));
      pending.delete(String(requestId));
      then?.(kind, params);
    };

    const s: CdpSession = {
      get exited() {
        return exited;
      },
      on(method, listener) {
        let set = listeners.get(method);
        if (set === undefined) listeners.set(method, (set = new Set()));
        set.add(listener);
        return () => set.delete(listener);
      },
      onExit: () => () => undefined,
      close: async () => {
        exited = true;
      },
      async send<T>(method: string, params: object = {}, sendOptions: { sessionId?: string } = {}): Promise<T> {
        const p = params as Record<string, unknown>;
        const sessionId = sendOptions.sessionId ?? null;
        fake.sends.push({ method, params: p, sessionId });
        const reply = (value: object): T => value as T;
        switch (method) {
          case 'Target.createTarget':
            return reply({ targetId: `t${fake.sends.length}` });
          case 'Target.attachToTarget':
            return reply({ sessionId: `s-${String(p.targetId)}` });
          case 'Page.navigate': {
            const url = String(p.url);
            const sid = sessionId ?? '';
            pause(sid, url, (kind, answered) => {
              fake.requests.push({ url, answer: kind });
              if (kind !== 'fulfill') return;
              const doc = Buffer.from(String(answered.body ?? ''), 'base64').toString('utf8');
              html.set(sid, doc);
              fake.served.push({ url, html: doc, headers: (answered.responseHeaders as { name: string; value: string }[] | undefined) ?? [] });
              const refs = referencesOf(doc);
              let left = refs.length;
              const loaded = (): void => {
                if (options.hangs?.(doc) !== true) setTimeout(() => emit({ method: 'Page.loadEventFired', sessionId: sid, params: {} }), options.loadDelayMs?.(doc) ?? 0);
              };
              if (left === 0) loaded();
              for (const ref of refs) {
                const absolute = /^[a-z][a-z0-9+.-]*:/i.test(ref) ? ref : new URL(ref, url).href;
                pause(sid, absolute, (refKind) => {
                  fake.requests.push({ url: absolute, answer: refKind });
                  left -= 1;
                  if (left === 0) loaded();
                });
              }
            });
            return reply({ frameId: 'f1' });
          }
          case 'Fetch.fulfillRequest':
            answer(p.requestId, 'fulfill', p);
            return reply({});
          case 'Fetch.continueRequest':
            answer(p.requestId, 'continue', p);
            return reply({});
          case 'Fetch.failRequest':
            answer(p.requestId, 'fail', p);
            return reply({});
          case 'Emulation.setDeviceMetricsOverride':
            scales.set(sessionId ?? '', Number(p.deviceScaleFactor));
            return reply({});
          case 'Page.getLayoutMetrics': {
            const height = heightOf(html.get(sessionId ?? '') ?? '');
            return reply({ cssContentSize: { width: 720, height } });
          }
          case 'Page.captureScreenshot': {
            const clip = p.clip as { width: number; height: number };
            const doc = html.get(sessionId ?? '') ?? '';
            const scale = scales.get(sessionId ?? '') ?? 1;
            return reply({ data: pngOfSize(clip.width * scale, clip.height * scale, doc.length).toString('base64') });
          }
          default:
            return reply({});
        }
      },
    };
    return s;
  };
  return fake;
};

/** The commands a page sent before its first navigation, in order. */
export const beforeFirstNavigate = (fake: FakeBrowser): string[] => {
  const at = fake.sends.findIndex((send) => send.method === 'Page.navigate');
  return fake.sends.slice(0, at === -1 ? fake.sends.length : at).map((send) => send.method);
};
