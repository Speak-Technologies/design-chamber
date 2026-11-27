// `ready.device` is host data and optional: an older host, or a garbled value, must read as a desktop with a
// mouse and no insets (native-extras §2.2). The phone sentences differ by whether the panel opens on the phone.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyDevice } from '../../src/ui/components/device.ts';
import { DESKTOP_DEVICE, deviceOf, openHelp, type Device } from '../../src/ui/model/device-model.ts';

const insets = (top = 0, right = 0, bottom = 0, left = 0) => ({ top, right, bottom, left });
const device = (over: Record<string, unknown> = {}): { device: unknown } => ({
  device: { formFactor: 'phone', pointer: 'coarse', insets: insets(47, 0, 34, 0), keyboard: 0, ...over },
});

test('no device (an older host) is a desktop with a fine pointer and no insets', () => {
  assert.deepEqual(deviceOf({}), { form: 'desktop', coarse: false, insets: insets(), keyboard: 0 });
  assert.deepEqual(deviceOf({ device: undefined }), DESKTOP_DEVICE);
});

test('a malformed device is a desktop, never a throw', () => {
  for (const bad of [null, 'phone', 7, [], {}, { formFactor: 'watch', pointer: 'coarse' }, { formFactor: 'phone', pointer: 'touch' }, { formFactor: 'phone' }, { pointer: 'coarse' }]) {
    assert.deepEqual(deviceOf({ device: bad }), DESKTOP_DEVICE, JSON.stringify(bad));
  }
});

test('phone, tablet and desktop keep their form and pointer', () => {
  assert.deepEqual(deviceOf(device()), { form: 'phone', coarse: true, insets: insets(47, 0, 34, 0), keyboard: 0 });
  assert.equal(deviceOf(device({ formFactor: 'tablet' })).form, 'tablet');
  const mouse = deviceOf(device({ formFactor: 'desktop', pointer: 'fine' }));
  assert.deepEqual([mouse.form, mouse.coarse], ['desktop', false]);
});

test('insets and keyboard are rounded and clamped to 0..400', () => {
  const read = deviceOf(device({ insets: { top: -5, right: 12.6, bottom: 9000, left: Number.NaN }, keyboard: 321.4 }));
  assert.deepEqual(read.insets, insets(0, 13, 400, 0));
  assert.equal(read.keyboard, 321);
  assert.equal(deviceOf(device({ keyboard: Number.POSITIVE_INFINITY })).keyboard, 0);
  assert.equal(deviceOf(device({ keyboard: -1 })).keyboard, 0);
  assert.equal(deviceOf(device({ keyboard: 401 })).keyboard, 400);
});

test('missing or non-number insets read as zero; a string never reaches CSS', () => {
  assert.deepEqual(deviceOf(device({ insets: undefined, keyboard: undefined })).insets, insets());
  assert.deepEqual(deviceOf(device({ insets: { bottom: '34px; color: red' }, keyboard: '10' })), { form: 'phone', coarse: true, insets: insets(), keyboard: 0 });
});

const of = (form: Device['form']): Device => ({ ...DESKTOP_DEVICE, form, coarse: form !== 'desktop' });

test('desktop and tablet keep today’s words, whatever the panel does on a phone', () => {
  for (const form of ['desktop', 'tablet'] as const) {
    for (const panelOnPhone of [true, false]) {
      const help = openHelp(of(form), panelOnPhone);
      assert.equal(help.notHere, 'Open Design Chamber from the rail to see it.');
      assert.equal(help.serviceDown, 'Design Chamber isn’t responding.');
      assert.equal(help.fullScreenHint, 'Full screen: sidebar → Extension pages → Design Chamber');
      assert.deepEqual(help.firstRunTip, { title: 'Open Design Chamber full screen', body: 'In the sidebar, open Extension pages and pick Design Chamber. Canvases get the whole window there.' });
    }
  }
});

test('phone with the panel: points at the More menu and says the service is on the computer', () => {
  const help = openHelp(of('phone'), true);
  assert.equal(help.notHere, 'Design Chamber can’t open here yet. Open it from the More menu in your chats list.');
  assert.equal(help.serviceDown, 'Design Chamber isn’t responding on your computer. Try again in a moment.');
  assert.equal(help.fullScreenHint, 'Full screen: chats list → More → Design Chamber');
  assert.deepEqual(help.firstRunTip, { title: 'Open Design Chamber full screen', body: 'In your chats list, open More and pick Design Chamber.' });
});

test('phone without the panel: no hint or tip, and the way in is the More menu', () => {
  const help = openHelp(of('phone'), false);
  assert.equal(help.notHere, 'Open Design Chamber from the More menu in your chats list.');
  assert.equal(help.serviceDown, 'Design Chamber isn’t responding on your computer. Try again in a moment.');
  assert.equal(help.fullScreenHint, null);
  assert.equal(help.firstRunTip, null);
});

test('applyDevice writes the form, the pointer and pixel variables, and follows a later ready', () => {
  const style = new Map<string, string>();
  // Just the two members applyDevice writes; there is no DOM under node:test.
  const root = { dataset: {} as Record<string, string>, style: { setProperty: (name: string, value: string) => void style.set(name, value) } };
  const el = root as unknown as HTMLElement;
  applyDevice(deviceOf(device({ keyboard: 300 })), el);
  assert.deepEqual(root.dataset, { dcForm: 'phone', dcPointer: 'coarse', dcKeyboard: 'up' });
  assert.deepEqual([style.get('--dc-inset-top'), style.get('--dc-inset-bottom'), style.get('--dc-keyboard')], ['47px', '34px', '300px']);
  applyDevice(deviceOf({}), el);
  assert.deepEqual(root.dataset, { dcForm: 'desktop', dcPointer: 'fine', dcKeyboard: 'down' });
  assert.deepEqual([style.get('--dc-inset-bottom'), style.get('--dc-keyboard')], ['0px', '0px']);
});
