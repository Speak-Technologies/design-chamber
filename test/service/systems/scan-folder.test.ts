// `validateLocation` (documentation/specs/phase-2-6-technical.md §5.6, §11): the one resolver of a folder
// inside a project. The matrix: relative and absolute input, both slash styles, `..` escaping, a link
// out (refused) and a link inside (followed), the project root, the Designs folder inside the project,
// a drive root, web addresses (and `C:/x`, `C:\x` not taken for one), UNC with a local project,
// trailing separators, a gone folder, and the case rule (folded on win32 and darwin, exact on linux).

import assert from 'node:assert/strict';
import { mkdir, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import { ApiError } from '../../../src/service/http.ts';
import {
  lexicalLocation,
  LOCATION_GONE_SENTENCE,
  LOCATION_URL_SENTENCE,
  locationInside,
  looksLikeUrl,
  recheckLocation,
  SCAN_FOLDER_IN_ROOT,
  validateLocation,
} from '../../../src/service/systems/scan-folder.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const refusal = async (run: () => Promise<unknown> | unknown, sentence: string | RegExp): Promise<void> => {
  await assert.rejects(
    async () => run(),
    (error: unknown) => {
      assert.ok(error instanceof ApiError, String(error));
      assert.equal(error.code, 'bad-path');
      if (typeof sentence === 'string') assert.equal(error.message, sentence);
      else assert.match(error.message, sentence);
      return true;
    },
  );
};

const rig = async (t: TestContext) => {
  const tmp = await useTmpRoot(t, 'dc-location-');
  const project = path.join(tmp.root, 'shop');
  await tmp.write('shop/design-system/tokens.css', ':root { --a: #fff; }\n');
  await tmp.write('shop/packages/ui/tokens/base.json', '{}\n');
  await tmp.write('outside/secret-system/tokens.css', ':root {}\n');
  await mkdir(path.join(project, 'Designs'), { recursive: true });
  const root = path.join(tmp.root, 'Designs');
  await mkdir(root, { recursive: true });
  return { tmp, project, root };
};

test('looksLikeUrl: schemes of two or more letters, www. and localhost; a drive letter stays a path', () => {
  for (const url of ['https://speakappi.com/design-system', 'http://localhost:3000/design-system', 'file:///x', 'www.example.com/ds', 'localhost:5173/design-system', 'localhost', 'git+ssh://host/repo']) {
    assert.equal(looksLikeUrl(url), true, url);
  }
  for (const local of ['C:/x', 'C:\\x', 'c://x', 'design-system', './design-system', '/Users/sam/app', 'localhost-tools/ds', 'wwwroot/ds']) {
    assert.equal(looksLikeUrl(local), false, local);
  }
});

test('relative and absolute input, either slash, trailing separators and the project root', async (t) => {
  const { project, root } = await rig(t);
  const expected = { real: path.join(project, 'design-system'), rel: 'design-system' };
  for (const raw of ['design-system', 'design-system/', './design-system', 'design-system\\', `${project}/design-system`, path.join(project, 'design-system') + path.sep, '  design-system  ']) {
    assert.deepEqual(await validateLocation(raw, project, root), expected, raw);
  }
  assert.deepEqual(await validateLocation('packages\\ui\\tokens', project, root), { real: path.join(project, 'packages', 'ui', 'tokens'), rel: 'packages/ui/tokens' });
  assert.deepEqual(await validateLocation('.', project, root), { real: project, rel: '' });
  assert.deepEqual(await validateLocation(project, project, root), { real: project, rel: '' });
});

test('escaping: .. out of the project, an absolute folder elsewhere, a link out are refused; a link inside is followed', async (t) => {
  const { tmp, project, root } = await rig(t);
  const pickInside = 'Pick a folder inside shop.';
  await refusal(() => validateLocation('../outside/secret-system', project, root), pickInside);
  await refusal(() => validateLocation(tmp.at('outside/secret-system'), project, root), pickInside);
  await refusal(() => validateLocation('design-system/../../outside', project, root), pickInside);
  // `..` that stays inside is fine: the realpath decides, not the spelling.
  assert.deepEqual(await validateLocation('packages/../design-system', project, root), { real: path.join(project, 'design-system'), rel: 'design-system' });
  await symlink(tmp.at('outside/secret-system'), path.join(project, 'linked-out'), 'dir');
  await refusal(() => validateLocation('linked-out', project, root), pickInside);
  await symlink(path.join(project, 'design-system'), path.join(project, 'linked-in'), 'dir');
  assert.deepEqual(await validateLocation('linked-in', project, root), { real: path.join(project, 'design-system'), rel: 'design-system' });
});

test('the Designs folder (inside the project or as given), a drive root, a gone folder, a URL, control characters', async (t) => {
  const { project, root } = await rig(t);
  await refusal(() => validateLocation('Designs', project, path.join(project, 'Designs')), SCAN_FOLDER_IN_ROOT);
  await refusal(() => validateLocation(root, project, root), SCAN_FOLDER_IN_ROOT);
  await refusal(() => validateLocation(path.parse(project).root, project, root), /whole drive|inside shop/);
  await refusal(() => validateLocation('no-such-folder', project, root), /doesn't exist/);
  await refusal(() => validateLocation('https://speakappi.com/design-system', project, root), LOCATION_URL_SENTENCE);
  await refusal(() => validateLocation('http://localhost:3000/design-system', project, root), LOCATION_URL_SENTENCE);
  await refusal(() => validateLocation('www.speakappi.com', project, root), LOCATION_URL_SENTENCE);
  await refusal(() => validateLocation('design\u0000system', project, root), 'That folder path contains an invalid character.');
  await refusal(() => validateLocation('', project, root), 'Choose a folder.');
  await refusal(() => validateLocation(42, project, root), 'Choose a folder.');
  await refusal(() => validateLocation('a'.repeat(4097), project, root), 'That folder path is too long.');
});

test('UNC: a share is refused for a local project before anything is touched (both slash styles, both flavours)', () => {
  for (const raw of ['\\\\server\\share\\ds', '//server/share/ds']) {
    assert.throws(() => lexicalLocation(raw, '/Users/sam/shop'), /Pick a folder inside shop\./, raw);
    assert.throws(() => lexicalLocation(raw, 'C:\\work\\shop', path.win32), /Pick a folder inside shop\./, raw);
  }
  // A project on a share may name a folder on it.
  assert.equal(lexicalLocation('\\\\server\\share\\shop\\ds', '\\\\server\\share\\shop', path.win32), '\\\\server\\share\\shop\\ds');
});

test('win32 flavour: drive paths are paths, either slash, case folded inside the project', () => {
  const project = 'C:\\Work\\Shop';
  assert.equal(lexicalLocation('C:/Work/Shop/design-system', project, path.win32), 'C:\\Work\\Shop\\design-system');
  assert.equal(lexicalLocation('C:\\Work\\Shop\\design-system\\', project, path.win32), 'C:\\Work\\Shop\\design-system');
  assert.equal(lexicalLocation('packages/ui\\tokens', project, path.win32), 'C:\\Work\\Shop\\packages\\ui\\tokens');
  assert.equal(locationInside(project, 'c:\\work\\shop\\Design-System', path.win32, 'win32'), 'Design-System');
  assert.equal(locationInside(project, 'C:\\Work\\Shop', path.win32, 'win32'), '');
  assert.throws(() => locationInside(project, 'C:\\Work\\Shopping\\ds', path.win32, 'win32'), /Pick a folder inside Shop\./);
  assert.throws(() => locationInside(project, 'D:\\Work\\Shop\\ds', path.win32, 'win32'), /Pick a folder inside Shop\./);
});

test('the case rule: folded on darwin, exact on linux', () => {
  assert.equal(locationInside('/Users/sam/Shop', '/users/sam/shop/design-system', path.posix, 'darwin'), 'design-system');
  assert.throws(() => locationInside('/home/sam/Shop', '/home/sam/shop/design-system', path.posix, 'linux'), /Pick a folder inside Shop\./);
  assert.equal(locationInside('/home/sam/Shop', '/home/sam/Shop/design-system', path.posix, 'linux'), 'design-system');
});

test('recheckLocation: a folder that went says so; one that moved out keeps its own sentence', async (t) => {
  const { tmp, project, root } = await rig(t);
  assert.deepEqual(await recheckLocation('design-system', project, root), { real: path.join(project, 'design-system'), rel: 'design-system' });
  assert.deepEqual(await recheckLocation('', project, root), { real: project, rel: '' });
  await rm(path.join(project, 'design-system'), { recursive: true });
  await refusal(() => recheckLocation('design-system', project, root), LOCATION_GONE_SENTENCE);
  await symlink(tmp.at('outside/secret-system'), path.join(project, 'design-system'), 'dir');
  await refusal(() => recheckLocation('design-system', project, root), 'Pick a folder inside shop.');
});
