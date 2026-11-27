// Host calls (documentation/specs/phase-1-5-sdk-2-7.md §3.3): without the host callback the
// answer is `unavailable` (logged once, no call made); a host refusal is `refused` with its code
// logged and never its message; nothing logged ever carries the service token.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ServiceHostError, type ServiceHost, type ServiceMark } from '@openchamber/sdk';

import type { Logger } from '../../../src/service/context.ts';
import { createHostCalls } from '../../../src/service/host-calls.ts';

const TOKEN = 'secret-service-token-1234';

/** A host client for the seam; a call the test does not name fails loudly. */
const client = (calls: Partial<Pick<ServiceHost, 'setInstructions' | 'setMark'>>): Pick<ServiceHost, 'setInstructions' | 'setMark'> => ({
  setInstructions: calls.setInstructions ?? (async () => assert.fail('setInstructions was not expected')),
  setMark: calls.setMark ?? (async () => assert.fail('setMark was not expected')),
});

const recorder = () => {
  const lines: { level: string; event: string; fields: Readonly<Record<string, unknown>> | undefined }[] = [];
  const log: Logger = {
    info: (event, fields) => void lines.push({ level: 'info', event, fields }),
    warn: (event, fields) => void lines.push({ level: 'warn', event, fields }),
    error: (event, fields) => void lines.push({ level: 'error', event, fields }),
  };
  return { log, lines };
};

test('no callback URL: unavailable, logged once, the host is never called', async () => {
  const { log, lines } = recorder();
  let connected = 0;
  const calls = createHostCalls({
    env: { OPENCHAMBER_SERVICE_TOKEN: TOKEN },
    log,
    connect: () => {
      connected += 1;
      return client({ setInstructions: async () => ({ saved: true as const }) });
    },
  });
  assert.equal(await calls.setInstructions('hello'), 'unavailable');
  assert.equal(await calls.setInstructions('hello again'), 'unavailable');
  assert.equal(connected, 0);
  assert.equal(lines.filter((line) => line.event === 'host-calls.unavailable').length, 1);
});

test('saved: the text goes to every session (directory null)', async () => {
  const { log } = recorder();
  const sent: [string | null, string][] = [];
  const calls = createHostCalls({
    env: { OPENCHAMBER_HOST_CALLBACK_URL: 'http://127.0.0.1:9/cb', OPENCHAMBER_SERVICE_TOKEN: TOKEN },
    log,
    connect: () =>
      client({
      setInstructions: async (directory, text) => {
        sent.push([directory, text]);
        return { saved: true as const };
      },
      }),
  });
  assert.equal(await calls.setInstructions('Design Chamber is on.'), 'saved');
  assert.deepEqual(sent, [[null, 'Design Chamber is on.']]);
});

test('a host refusal answers refused and logs the code, never the message or the token', async () => {
  const { log, lines } = recorder();
  const calls = createHostCalls({
    env: { OPENCHAMBER_HOST_CALLBACK_URL: 'http://127.0.0.1:9/cb', OPENCHAMBER_SERVICE_TOKEN: TOKEN },
    log,
    connect: () =>
      client({
      setInstructions: async () => {
        throw new ServiceHostError(`Refused for ${TOKEN}`, 'NOT_APPROVED', 403);
      },
      }),
  });
  assert.equal(await calls.setInstructions('x'), 'refused');
  const refused = lines.find((line) => line.event === 'host-calls.refused');
  assert.equal(refused?.fields?.code, 'NOT_APPROVED');
  assert.ok(!JSON.stringify(lines).includes(TOKEN), 'the token never reaches a log line');
  assert.ok(!JSON.stringify(lines).includes('Refused for'), 'the host message is not logged');
});

test('the host not answering is unavailable, and an unexpected error is refused; neither throws', async () => {
  const { log } = recorder();
  const env = { OPENCHAMBER_HOST_CALLBACK_URL: 'http://127.0.0.1:9/cb', OPENCHAMBER_SERVICE_TOKEN: TOKEN };
  const down = createHostCalls({
    env,
    log,
    connect: () =>
      client({
      setInstructions: async () => {
        throw new ServiceHostError('OpenChamber did not answer.', 'HOST_UNAVAILABLE', 0);
      },
      }),
  });
  assert.equal(await down.setInstructions('x'), 'unavailable');
  const odd = createHostCalls({
    env,
    log,
    connect: () =>
      client({
      setInstructions: async () => {
        throw new TypeError('boom');
      },
      }),
  });
  assert.equal(await odd.setInstructions('x'), 'refused');
});

test('the real SDK client is used by default and fails safe against a closed port', async () => {
  const { log } = recorder();
  // Port 9 (discard) is closed on loopback: fetch fails at once and the SDK answers HOST_UNAVAILABLE.
  const calls = createHostCalls({ env: { OPENCHAMBER_HOST_CALLBACK_URL: 'http://127.0.0.1:9', OPENCHAMBER_SERVICE_TOKEN: TOKEN }, log });
  assert.equal(await calls.setInstructions('x'), 'unavailable');
});

// ---- setMark (native-extras §4.2) ----

const HOST_ENV = { OPENCHAMBER_HOST_CALLBACK_URL: 'http://127.0.0.1:9/cb', OPENCHAMBER_SERVICE_TOKEN: TOKEN };
const MARK: ServiceMark = { icon: 'palette', tone: 'warning', text: 'Secret pricing: 1 check error' };

test('setMark: saved passes the session target and mark through, null removes', async () => {
  const { log, lines } = recorder();
  const sent: unknown[] = [];
  const calls = createHostCalls({
    env: HOST_ENV,
    log,
    connect: () =>
      client({
        setMark: async (target, mark) => {
          sent.push([target, mark]);
          return { saved: true as const };
        },
      }),
  });
  assert.equal(await calls.setMark({ sessionId: 'ses_a' }, MARK), 'saved');
  assert.equal(await calls.setMark({ sessionId: 'ses_a' }, null), 'saved');
  assert.deepEqual(sent, [[{ sessionId: 'ses_a' }, MARK], [{ sessionId: 'ses_a' }, null]]);
  assert.equal(lines.length, 0, 'a saved mark logs nothing');
});

test('setMark without a callback URL: unavailable, logged once, no call', async () => {
  const { log, lines } = recorder();
  const calls = createHostCalls({ env: { OPENCHAMBER_SERVICE_TOKEN: TOKEN }, log, connect: () => assert.fail('no client without a callback') });
  assert.equal(await calls.setMark({ sessionId: 'ses_a' }, MARK), 'unavailable');
  assert.equal(await calls.setMark({ sessionId: 'ses_b' }, null), 'unavailable');
  assert.equal(lines.filter((line) => line.event === 'host-calls.unavailable').length, 1);
});

test('setMark maps every host answer and never throws; only the code is logged', async () => {
  const cases: [unknown, string, string][] = [
    [new ServiceHostError(`slow down ${TOKEN}`, 'TOO_MANY_EVENTS', 429), 'limited', 'TOO_MANY_EVENTS'],
    [new ServiceHostError('full', 'TOO_MANY_MARKS', 409), 'limited', 'TOO_MANY_MARKS'],
    [new ServiceHostError('no code', 'HOST_UNAVAILABLE', 429), 'limited', 'HOST_UNAVAILABLE'],
    [new ServiceHostError('OpenChamber did not answer.', 'HOST_UNAVAILABLE', 0), 'unavailable', 'HOST_UNAVAILABLE'],
    [new ServiceHostError(`not approved for ${TOKEN}`, 'NOT_GRANTED', 403), 'refused', 'NOT_GRANTED'],
    [new TypeError('boom'), 'refused', 'TypeError'],
    ['a string', 'refused', 'unknown'],
  ];
  for (const [thrown, expected, code] of cases) {
    const { log, lines } = recorder();
    const calls = createHostCalls({
      env: HOST_ENV,
      log,
      connect: () =>
        client({
          setMark: async () => {
            throw thrown;
          },
        }),
    });
    assert.equal(await calls.setMark({ sessionId: 'ses_a' }, MARK), expected, `${code} → ${expected}`);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.fields?.code, code);
    assert.equal(lines[0]?.fields?.call, 'setMark');
    const logged = JSON.stringify(lines);
    assert.ok(!logged.includes(TOKEN), 'the token never reaches a log line');
    assert.ok(!logged.includes('Secret pricing'), 'the mark text never reaches a log line');
    assert.ok(!logged.includes('ses_a'), 'the session id is not logged');
    if (thrown instanceof Error) assert.ok(!logged.includes(thrown.message), 'the host message is not logged');
  }
});

test('setMark through the real SDK client fails safe against a closed port', async () => {
  const { log } = recorder();
  const calls = createHostCalls({ env: { OPENCHAMBER_HOST_CALLBACK_URL: 'http://127.0.0.1:9', OPENCHAMBER_SERVICE_TOKEN: TOKEN }, log });
  assert.equal(await calls.setMark({ sessionId: 'ses_a' }, MARK), 'unavailable');
});
