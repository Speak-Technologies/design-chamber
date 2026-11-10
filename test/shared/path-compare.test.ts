// The disk-free path comparisons shared by the service, the guest and the OpenCode plugin
// (documentation/specs/phase-1-5-sdk-2-7.md §3.7). The same cases also run through the
// service's re-exports in test/service/core/paths.test.ts; here the path module and the
// platform are always passed, as a bundle without `node:path` must.

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';

import { foldsCase, isInsideOrEqual, isStrictlyInside, sameDirectory, samePath } from '../../src/shared/path-compare.ts';

describe('path-compare with an explicit path module and platform', () => {
  test('foldsCase: the win32 flavour always, darwin always, linux never', () => {
    assert.equal(foldsCase(path.win32, 'linux'), true);
    assert.equal(foldsCase(path.posix, 'darwin'), true);
    assert.equal(foldsCase(path.posix, 'linux'), false);
  });

  test('samePath folds case on win32 and darwin, exact on linux', () => {
    assert.equal(samePath('C:\\Designs', 'c:\\designs\\', path.win32, 'win32'), true);
    assert.equal(samePath('C:\\Designs', 'C:\\Designs2', path.win32, 'win32'), false);
    assert.equal(samePath('/data/Designs', '/data/designs', path.posix, 'linux'), false);
    assert.equal(samePath('/Users/you/Documents', '/users/YOU/documents', path.posix, 'darwin'), true);
  });

  test('isInsideOrEqual covers the base itself and descendants, refuses escapes and look-alike siblings', () => {
    assert.equal(isInsideOrEqual('C:\\Designs', 'C:\\Designs', path.win32, 'win32'), true);
    assert.equal(isInsideOrEqual('C:\\Designs', 'c:\\designs\\slug\\index.html', path.win32, 'win32'), true);
    assert.equal(isInsideOrEqual('C:\\Designs', 'C:\\DesignsEvil', path.win32, 'win32'), false);
    assert.equal(isInsideOrEqual('/data/designs', '/data/other', path.posix, 'linux'), false);
    assert.equal(isInsideOrEqual('/Users/you', '/users/you/Designs', path.posix, 'linux'), false);
  });

  test('isStrictlyInside excludes the base itself, other drives, UNC paths and `..` steps', () => {
    assert.equal(isStrictlyInside('C:\\Designs\\art', 'C:\\Designs\\art', path.win32, 'win32'), false);
    assert.equal(isStrictlyInside('C:\\Designs\\art', 'c:\\designs\\ART\\assets\\x.png', path.win32, 'win32'), true);
    assert.equal(isStrictlyInside('C:\\Designs\\art', 'C:\\Designs\\art\\..foo', path.win32, 'win32'), true, 'a name starting with ".." is not a step up');
    assert.equal(isStrictlyInside('C:\\Designs\\art', 'D:\\Designs\\art\\x.png', path.win32, 'win32'), false);
    assert.equal(isStrictlyInside('C:\\Designs\\art', '\\\\server\\share\\x.png', path.win32, 'win32'), false);
    assert.equal(isStrictlyInside('/opt/OpenChamber', '/opt/OpenChamber/openchamber', path.posix, 'linux'), true);
    assert.equal(isStrictlyInside('/opt/OpenChamber', '/opt/OpenChamber/../evil/openchamber', path.posix, 'linux'), false);
    assert.equal(isStrictlyInside('/data/art', '/data/Art/x.png', path.posix, 'linux'), false);
  });
});

describe('sameDirectory (folder paths from the host and from design.json)', () => {
  test('Windows paths compare case-insensitively with either slash and a trailing separator', () => {
    assert.ok(sameDirectory('C:\\A\\b\\', 'c:/a/B'));
    assert.ok(sameDirectory('C:\\Users\\you\\projects\\shop', 'c:/users/YOU/projects/shop/'));
    assert.ok(!sameDirectory('C:\\Users\\you\\shop', 'C:\\Users\\you\\shop2'));
  });

  test('posix paths compare exactly, a trailing slash aside', () => {
    assert.ok(!sameDirectory('/home/a', '/home/A'));
    assert.ok(sameDirectory('/home/a/', '/home/a'));
  });
});
