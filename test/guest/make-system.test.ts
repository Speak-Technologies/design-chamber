import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RouteKey } from '../../src/shared/api.ts';
import { createMakeSystem, MAKE_MESSAGES, type MakeSystemInput } from '../../src/guest/make-system.ts';
import type { GuestHost } from '../../src/guest/host.ts';
import { ServiceError, type ServiceClient } from '../../src/guest/service-client.ts';
import { CHIP_PROVIDER_ID } from '../../src/shared/types.ts';

type Call = { key: string; params?: Record<string, string>; body?: unknown };

type Rig = {
  calls: Call[];
  started: unknown[];
  attached: unknown[];
  composed: unknown[];
  uploaded: string[];
  make: ReturnType<typeof createMakeSystem>;
};

type Options = {
  /** Routes that fail, by key, with the service's sentence. */
  fail?: Partial<Record<RouteKey, string>>;
  session?: { id: string } | null;
  directory?: string | null;
  projects?: Array<{ id: string; directory: string }>;
  refuseUpload?: string[];
  startSessionId?: string | null;
};

const chipFor = (id: string) => ({ providerId: CHIP_PROVIDER_ID, id: `system:${id}`, title: 'Acme', url: '', text: 'Write this system.', data: { system: id } });

const rig = (options: Options = {}): Rig => {
  const calls: Call[] = [];
  const started: unknown[] = [];
  const attached: unknown[] = [];
  const composed: unknown[] = [];
  const uploaded: string[] = [];
  const fail = options.fail ?? {};
  // Safe: the flow calls only the routes answered below; the stub is typed by the one signature it needs.
  const client = {
    call: async (key: RouteKey, request?: { params?: Record<string, string>; body?: { name?: string; uploadId?: string } }) => {
      calls.push({ key, params: request?.params, body: request?.body });
      const failure = fail[key];
      if (failure) throw new ServiceError('internal', failure);
      if (key === 'POST /systems') return { id: 'acme', system: { id: 'acme', name: request?.body?.name ?? 'Acme' } };
      if (key === 'POST /systems/:id/assets') {
        const name = request?.body?.name ?? '';
        if (options.refuseUpload?.includes(name)) throw new ServiceError('invalid', `${name} isn’t a real file.`);
        return { asset: { file: name.toLowerCase(), kind: 'logo', bytes: 1 }, refused: null };
      }
      if (key === 'POST /systems/:id/assets/from-folder') return { added: [{ file: 'guide.pdf', kind: 'source' }], refused: [{ name: 'x.key', reason: 'x.key isn’t a file type design systems use.' }] };
      if (key === 'POST /systems/:id/prompt') return { text: 'Write the system.', chip: chipFor('acme'), handEdits: null };
      return { system: {} };
    },
    uploadBinary: async (file: Blob) => {
      uploaded.push(`blob:${file.size}`);
      return `u_${uploaded.length}`;
    },
  } as unknown as ServiceClient;
  // Safe: only the members the flow reads.
  const host = {
    client: {
      listProjects: async () => ({ projects: options.projects ?? [{ id: 'proj_shop', directory: 'C:\\work\\shop' }] }),
      startSession: async (request: unknown) => {
        started.push(request);
        const sessionId = options.startSessionId === undefined ? 'ses_new' : options.startSessionId;
        return sessionId === null ? { sessionId: null, sent: 'skipped' } : { sessionId, sent: 'sent' };
      },
      attach: async (request: unknown) => void attached.push(request),
      compose: async (request: unknown) => void composed.push(request),
    },
    session: { get: () => (options.session === undefined ? { id: 'ses_current', busy: false, title: 'Chat' } : options.session) },
    directory: { get: () => (options.directory === undefined ? 'C:\\work\\shop' : options.directory) },
  } as unknown as GuestHost;
  return { calls, started, attached, composed, uploaded, make: createMakeSystem({ host, client }) };
};

const input = (over: Partial<MakeSystemInput> = {}): MakeSystemInput => ({
  name: 'Acme',
  code: null,
  description: { text: 'Calm.', preset: null },
  brand: null,
  destination: 'new-chat',
  ...over,
});

const keys = (calls: readonly Call[]): string[] => calls.map((call) => call.key);

test('a new chat: create, ask, start the chat in the scanned project with the system chip, remember the chat', async () => {
  const t = rig();
  const result = await t.make.make(input({ code: { scanId: 'sc_1234567890123456', assets: ['fonts/a.woff2'], directory: 'C:\\work\\shop' } }));
  assert.deepEqual(keys(t.calls), ['POST /systems', 'POST /systems/:id/prompt', 'PATCH /systems/:id']);
  assert.deepEqual(t.calls[0]?.body, { name: 'Acme', code: { scanId: 'sc_1234567890123456', assets: ['fonts/a.woff2'] }, description: { text: 'Calm.', preset: null } });
  assert.deepEqual(t.calls[1]?.body, { purpose: 'make' });
  assert.deepEqual(t.calls[2]?.body, { sessionId: 'ses_new' });
  const request = t.started[0] as { projectId?: string; navigation?: string; text: string; id: string; data: unknown };
  assert.equal(request.projectId, 'proj_shop');
  assert.equal(request.navigation, 'open');
  assert.equal(request.text, 'Write the system.');
  assert.equal(request.id, 'system:acme');
  assert.deepEqual(request.data, { system: 'acme' });
  assert.deepEqual(result.agent, { outcome: 'new-session', sessionId: 'ses_new', reason: null, text: null });
});

test('the system is created first: a failed creation rejects with the service’s sentence and nothing else runs', async () => {
  const t = rig({ fail: { 'POST /systems': 'You already have a system called Acme.' } });
  await assert.rejects(() => t.make.make(input()), /You already have a system called Acme\./);
  assert.deepEqual(keys(t.calls), ['POST /systems']);
  assert.equal(t.started.length, 0);
});

test('brand files go up one at a time, each as an upload then an asset; a refused file is named and the rest are kept', async () => {
  const t = rig({ refuseUpload: ['broken.png'] });
  const steps: string[] = [];
  const result = await t.make.make(
    input({
      description: null,
      brand: {
        files: [
          { file: new Blob(['a']), name: 'Mark.svg', kind: 'logo' },
          { file: new Blob(['bb']), name: 'broken.png', kind: 'logo' },
          { file: new Blob(['ccc']), name: 'Inter.woff2', kind: 'font' },
        ],
        folder: null,
      },
    }),
    (step) => steps.push(step.phase === 'files' ? `files ${step.done}/${step.total}` : step.phase),
  );
  assert.deepEqual(t.calls[0]?.body, { name: 'Acme', brand: true });
  assert.deepEqual(keys(t.calls).slice(1, 4), ['POST /systems/:id/assets', 'POST /systems/:id/assets', 'POST /systems/:id/assets']);
  assert.deepEqual(t.uploaded, ['blob:1', 'blob:2', 'blob:3']);
  assert.deepEqual(result.files.added, ['mark.svg', 'inter.woff2']);
  assert.deepEqual(result.files.refused, [{ name: 'broken.png', reason: 'broken.png isn’t a real file.' }]);
  assert.deepEqual(steps, ['creating', 'files 0/3', 'files 1/3', 'files 2/3', 'asking']);
  assert.equal(result.agent.outcome, 'new-session', 'a refused file never stops the request to the agent');
});

test('a brand folder adds its files and names the ones it refused', async () => {
  const t = rig();
  const result = await t.make.make(input({ description: null, brand: { files: [], folder: 'C:\\Brand' } }));
  assert.deepEqual(t.calls[1], { key: 'POST /systems/:id/assets/from-folder', params: { id: 'acme' }, body: { directory: 'C:\\Brand' } });
  assert.deepEqual(result.files.added, ['guide.pdf']);
  assert.deepEqual(result.files.refused, [{ name: 'x.key', reason: 'x.key isn’t a file type design systems use.' }]);
});

test('a folder the service refuses is one refused entry named by the path, not a failed make', async () => {
  const t = rig({ fail: { 'POST /systems/:id/assets/from-folder': 'Pick a folder outside your Designs folder.' } });
  const result = await t.make.make(input({ description: null, brand: { files: [], folder: 'C:\\Designs' } }));
  assert.deepEqual(result.files.refused, [{ name: 'C:\\Designs', reason: 'Pick a folder outside your Designs folder.' }]);
  assert.equal(result.id, 'acme');
});

test('the request to the agent failing leaves the Draft: not-sent with the reason and no request to copy', async () => {
  const t = rig({ fail: { 'POST /systems/:id/prompt': 'This part of Design Chamber (design systems) is not built yet.' } });
  const result = await t.make.make(input());
  assert.equal(result.id, 'acme');
  assert.deepEqual(result.agent, { outcome: 'not-sent', sessionId: null, reason: 'This part of Design Chamber (design systems) is not built yet.', text: null });
  assert.equal(t.started.length, 0);
});

test('with no project to start a chat in, the request is returned for Copy request', async () => {
  const t = rig({ directory: null, projects: [] });
  const result = await t.make.make(input());
  assert.deepEqual(result.agent, { outcome: 'not-sent', sessionId: null, reason: MAKE_MESSAGES.noProject, text: 'Write the system.' });
});

test('a host that starts no session is a not-sent with the request to copy', async () => {
  const t = rig({ startSessionId: null });
  const result = await t.make.make(input());
  assert.equal(result.agent.outcome, 'not-sent');
  assert.equal(result.agent.text, 'Write the system.');
  assert.ok(!keys(t.calls).includes('PATCH /systems/:id'), 'no chat to remember');
});

test('the current chat: the chip is attached, the request is composed, the chat is remembered', async () => {
  const t = rig();
  const result = await t.make.make(input({ destination: 'current-chat' }));
  assert.equal(t.started.length, 0);
  assert.equal(t.attached.length, 1);
  assert.deepEqual(t.composed, [{ text: 'Write the system.', mode: 'append' }]);
  assert.deepEqual(t.calls.at(-1)?.body, { sessionId: 'ses_current' });
  assert.deepEqual(result.agent, { outcome: 'composed', sessionId: 'ses_current', reason: null, text: null });
});

test('the current chat with no chat open: not-sent, with the request to copy', async () => {
  const t = rig({ session: null });
  const result = await t.make.make(input({ destination: 'current-chat' }));
  assert.deepEqual(result.agent, { outcome: 'not-sent', sessionId: null, reason: MAKE_MESSAGES.noChat, text: 'Write the system.' });
  assert.equal(t.attached.length, 0);
});

test('Try again asks only the agent: no second system, no second upload', async () => {
  const t = rig();
  const outcome = await t.make.askToMake({ id: 'acme', destination: 'new-chat', directory: null });
  assert.equal(outcome.outcome, 'new-session');
  assert.deepEqual(keys(t.calls), ['POST /systems/:id/prompt', 'PATCH /systems/:id']);
  assert.equal(t.uploaded.length, 0);
});

test('a chat that can’t be linked back does not undo a request that already reached it', async () => {
  const t = rig({ fail: { 'PATCH /systems/:id': 'The system moved.' } });
  const result = await t.make.make(input());
  assert.equal(result.agent.outcome, 'new-session');
});
