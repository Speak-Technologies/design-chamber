// Design Chamber's app-data folder (documentation/specs/phase-1-5-sdk-2-7.md §U3.3): one pure
// function both sides use. The service writes settings.json and runtime.json there; the OpenCode
// plugin reads runtime.json from it. They must agree although OpenCode may carry an
// XDG_CONFIG_HOME the service never receives (GUEST_SERVICES.md:28).

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';

import { designChamberDataDir, RUNTIME_FILE } from '../../src/shared/app-data.ts';
import { runtimeRecordFile } from '../../src/plugin/check-tool.ts';
import { runtimeRecordPath } from '../../src/service/runtime-record.ts';
import { settingsFilePath } from '../../src/service/settings.ts';

describe('designChamberDataDir', () => {
  test('Windows: %APPDATA%\\Design Chamber, with the roaming folder as the default', () => {
    const join = path.win32.join;
    assert.equal(designChamberDataDir({ platform: 'win32', homeDir: 'C:\\Users\\you', appData: 'D:\\Roam', join }), 'D:\\Roam\\Design Chamber');
    assert.equal(designChamberDataDir({ platform: 'win32', homeDir: 'C:\\Users\\you', join }), 'C:\\Users\\you\\AppData\\Roaming\\Design Chamber');
    assert.equal(designChamberDataDir({ platform: 'win32', homeDir: 'C:\\Users\\you', appData: '  ', join }), 'C:\\Users\\you\\AppData\\Roaming\\Design Chamber');
  });

  test('macOS: ~/Library/Application Support/Design Chamber', () => {
    assert.equal(
      designChamberDataDir({ platform: 'darwin', homeDir: '/Users/you', xdgConfigHome: '/xdg', join: path.posix.join }),
      '/Users/you/Library/Application Support/Design Chamber',
    );
  });

  test('Linux: <XDG_CONFIG_HOME or ~/.config>/design-chamber', () => {
    const join = path.posix.join;
    assert.equal(designChamberDataDir({ platform: 'linux', homeDir: '/home/you', join }), '/home/you/.config/design-chamber');
    assert.equal(designChamberDataDir({ platform: 'linux', homeDir: '/home/you', xdgConfigHome: '/xdg', join }), '/xdg/design-chamber');
    assert.equal(designChamberDataDir({ platform: 'freebsd', homeDir: '/home/you', xdgConfigHome: '', join }), '/home/you/.config/design-chamber');
  });

  test('settingsFilePath still lands in the same folder, on every platform', () => {
    const home = path.join(path.sep, 'home', 'you');
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      const dir = designChamberDataDir({ platform, homeDir: home, appData: 'C:\\AppData', xdgConfigHome: '/xdg', join: path.join });
      assert.equal(settingsFilePath({ APPDATA: 'C:\\AppData', XDG_CONFIG_HOME: '/xdg' }, platform, home), path.join(dir, 'settings.json'));
    }
  });
});

describe('the service and the plugin agree on where runtime.json is', () => {
  test('the service (no XDG_CONFIG_HOME in its env) and the plugin (OpenCode may set one) name the same file', () => {
    const home = path.join(path.sep, 'home', 'you');
    const serviceSide = runtimeRecordPath({}, 'linux', home);
    const pluginSide = runtimeRecordFile({ XDG_CONFIG_HOME: '/somewhere/else', HOME: home }, 'linux', home, path);
    assert.equal(pluginSide, serviceSide);
    assert.equal(path.basename(serviceSide), RUNTIME_FILE);
  });

  test('Windows: both read APPDATA the same way', () => {
    const home = 'C:\\Users\\you';
    const env = { APPDATA: 'C:\\Users\\you\\AppData\\Roaming' };
    assert.equal(runtimeRecordFile(env, 'win32', home, path.win32), path.win32.join(env.APPDATA, 'Design Chamber', 'runtime.json'));
    assert.equal(runtimeRecordFile({}, 'win32', home, path.win32), path.win32.join(home, 'AppData', 'Roaming', 'Design Chamber', 'runtime.json'));
  });

  test('macOS', () => {
    assert.equal(runtimeRecordFile({}, 'darwin', '/Users/you', path.posix), '/Users/you/Library/Application Support/Design Chamber/runtime.json');
  });

  test('the DC_SETTINGS_PATH test seam moves the service record next to that settings file', () => {
    const file = runtimeRecordPath({ DC_SETTINGS_PATH: path.join(path.sep, 'tmp', 'x', 'settings.json') }, 'linux', '/home/you');
    // The service resolves the seam path, so on Windows it gains the current drive letter.
    assert.equal(file, path.resolve(path.sep, 'tmp', 'x', 'runtime.json'));
  });
});
