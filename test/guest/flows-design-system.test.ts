// `/design-system` and Build with the agent… (documentation/specs/phase-2-5-technical.md §8.7) against the
// fake host + fake service: the slash command asks POST /systems/chip with the frame's project and session,
// other names stay `unknown-command`, and buildSystem's destinations and its not-sent answer.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HostRequestError, type PromptRequest, type StartSessionRequest } from '@openchamber/sdk';

import { createFakeServices } from '../../src/guest/fake-services.ts';
import { BUILD_SYSTEM_DEFAULT_TEXT, createFlows, FlowError, MESSAGES, type Flows } from '../../src/guest/flows.ts';
import { createServiceClient } from '../../src/guest/service-client.ts';

type Setup = ReturnType<typeof createFakeServices> & { flows: Flows };
const setup = (options: Parameters<typeof createFakeServices>[0] = {}): Setup => {
  const fakes = createFakeServices(options);
  fakes.host.emitReady();
  return { ...fakes, flows: createFlows({ host: fakes.guestHost, client: fakes.client }) };
};
const lastBody = (s: Setup): unknown => JSON.parse(s.service.requests.at(-1)?.body ?? '{}');

test('/design-system resolves to the build chip via POST /systems/chip with the frame directory + session', async () => {
  const s = setup({ surface: 'background', session: { id: 'ses_here', title: 'Here', busy: false } });
  const chip = await s.flows.resolveSlashCommand({ command: 'design-system', args: '  for the shop app  ' });
  assert.equal(s.service.requests.at(-1)?.path, '/systems/chip');
  assert.deepEqual(lastBody(s), { brief: 'for the shop app', projectDirectory: 'C:\\Users\\you\\projects\\shop', sessionId: 'ses_here' });
  assert.equal(chip.providerId, 'design-chamber');
  assert.match(chip.id, /^system-build:sb_[a-z0-9]{12}$/);
  assert.equal(chip.title, 'New design system');
  assert.deepEqual(chip.data, { build: chip.id.slice('system-build:'.length) });
});

test('any other command name is unknown-command and calls nothing; /design and /page are unchanged', async () => {
  const s = setup({ surface: 'background' });
  const before = s.service.requests.length;
  for (const command of ['design-systems', 'system', 'Design-System', 'design_system', 'deploy', '']) {
    await assert.rejects(s.flows.resolveSlashCommand({ command, args: 'x' }), (error: unknown) => {
      assert.ok(error instanceof FlowError);
      assert.equal(error.code, 'unknown-command');
      assert.equal(error.message, MESSAGES.unknownCommand);
      return true;
    });
  }
  assert.equal(s.service.requests.length, before);
  assert.equal(MESSAGES.unknownCommand, 'Design Chamber knows /design, /page and /design-system only.');
  assert.deepEqual((await s.flows.resolveSlashCommand({ command: 'page', args: '' })).data, { slug: 'untitled-page', kind: 'page' });
});

test('/design-system: a service refusal reaches the host as a plain Error with the sentence', async () => {
  const fakes = createFakeServices();
  const client = createServiceClient({
    serviceRequest: async () => ({ status: 409, body: JSON.stringify({ error: 'conflict', message: 'You have 50 design systems. Delete one to make another.' }) }),
  });
  const flows = createFlows({ host: fakes.guestHost, client });
  await assert.rejects(flows.resolveSlashCommand({ command: 'design-system', args: '' }), (error: unknown) => {
    assert.ok(error instanceof Error && !(error instanceof FlowError));
    assert.equal(error.message, 'You have 50 design systems. Delete one to make another.');
    return true;
  });
});

test('buildSystem in a new chat: a ticket for the project, then startSession(open) with the chip and the words', async () => {
  const s = setup();
  const result = await s.flows.buildSystem({ brief: '  Acme  ', destination: 'new-chat' });
  assert.deepEqual(lastBody(s), { brief: 'Acme', projectDirectory: 'C:\\Users\\you\\projects\\shop', sessionId: null });
  const [request] = s.host.callsOf('startSession')[0] as [StartSessionRequest];
  assert.equal(request.text, 'Acme');
  assert.equal(request.navigation, 'open');
  assert.match(request.id, /^system-build:/);
  assert.equal(result.outcome, 'new-session');
  assert.ok(result.outcome === 'new-session' && result.sessionId !== null && result.ticket === request.id.slice('system-build:'.length));

  await s.flows.buildSystem({ brief: '   ', destination: 'new-chat' });
  assert.equal((s.host.callsOf('startSession')[1]?.[0] as StartSessionRequest).text, BUILD_SYSTEM_DEFAULT_TEXT);
});

test('buildSystem in a new chat without a project: no-project, no ticket asked for', async () => {
  const s = setup({ directory: null });
  const before = s.service.requests.length;
  await assert.rejects(s.flows.buildSystem({ brief: 'x', destination: 'new-chat' }), (error: unknown) => error instanceof FlowError && error.code === 'no-project');
  assert.equal(s.service.requests.length, before);
});

test('buildSystem in the current chat: attach and send; busy → composed; the page closes', async () => {
  const s = setup({ surface: 'page', session: { id: 'ses_cur', title: 'Current', busy: false } });
  const result = await s.flows.buildSystem({ brief: 'Acme', destination: 'current-chat' });
  assert.deepEqual(lastBody(s), { brief: 'Acme', projectDirectory: 'C:\\Users\\you\\projects\\shop', sessionId: 'ses_cur' });
  assert.equal(s.host.callsOf('attach').length, 1);
  assert.deepEqual(s.host.callsOf('prompt')[0], [{ text: 'Acme', send: true } satisfies PromptRequest]);
  assert.equal(s.host.callsOf('close').length, 1);
  assert.equal(result.outcome, 'sent');

  const busy = setup({ surface: 'panel', session: { id: 'ses_cur', title: 'Current', busy: true } });
  assert.equal((await busy.flows.buildSystem({ brief: '', destination: 'current-chat' })).outcome, 'composed');
  assert.deepEqual(busy.host.callsOf('compose')[0], [{ text: BUILD_SYSTEM_DEFAULT_TEXT, mode: 'append' }]);
});

test('buildSystem: no chat selected → no-session; a send the host refuses → not-sent with the request text', async () => {
  const none = setup({ session: null });
  await assert.rejects(none.flows.buildSystem({ brief: 'x', destination: 'current-chat' }), (error: unknown) => error instanceof FlowError && error.code === 'no-session');

  const refused = setup({ session: { id: 'ses_cur', title: 'Current', busy: false } });
  refused.host.behavior.prompt = async () => {
    throw new HostRequestError('DENIED', 'No.');
  };
  const result = await refused.flows.buildSystem({ brief: 'Acme', destination: 'current-chat' });
  assert.equal(result.outcome, 'not-sent');
  assert.ok(result.outcome === 'not-sent' && result.text.startsWith('[Design Chamber] Build a design system'));

  const failed = setup();
  failed.host.behavior.startSession = async () => {
    throw new HostRequestError('HOST_UNAVAILABLE', 'Gone.');
  };
  assert.equal((await failed.flows.buildSystem({ brief: 'Acme', destination: 'new-chat' })).outcome, 'not-sent');
});
