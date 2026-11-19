// The pure parts of brand files (documentation/specs/phase-2-5-technical.md §5.6): type by extension and
// by content (magic bytes, UTF-8 for text and SVG), kind fit, per-type size caps, the font face and logo
// variant guesses, and the system.json merge that keeps every other key and never writes over a broken file.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { checkAsset, checkAssetMeta, displayName, guessFontFace, guessLogoVariant, isSvgText, withAssetEntries } from '../../../src/service/systems/assets.ts';
import { SYSTEM_DOCUMENT_MAX_BYTES, SYSTEM_FONT_MAX_BYTES, SYSTEM_IMAGE_MAX_BYTES } from '../../../src/shared/limits.ts';

const bytes = (...parts: (string | number[])[]): Buffer =>
  Buffer.concat(parts.map((part) => (typeof part === 'string' ? Buffer.from(part, 'latin1') : Buffer.from(part))));

const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'rest');
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], 'rest');
const WEBP = bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ');
const WOFF2 = bytes('wOF2', [0, 1, 0, 0]);
const WOFF = bytes('wOFF', [0, 1, 0, 0]);
const TTF = bytes([0, 1, 0, 0], 'rest');
const TTF_MAC = bytes('true', 'rest');
const OTF = bytes('OTTO', 'rest');
const PDF = bytes('%PDF-1.7\n');
const SVG = bytes('<svg xmlns="http://www.w3.org/2000/svg"/>');

const ok = (name: string, kind: 'font' | 'logo' | 'source' | null, content: Buffer): void => {
  const answer = checkAsset(name, kind, content);
  assert.equal(answer.ok, true, `${name}: ${answer.ok ? '' : answer.reason}`);
};
const refused = (name: string, kind: 'font' | 'logo' | 'source' | null, content: Buffer): string => {
  const answer = checkAsset(name, kind, content);
  assert.equal(answer.ok, false, `${name} should be refused`);
  return answer.ok ? '' : answer.reason;
};

describe('checkAsset: type by extension and content', () => {
  test('every accepted type passes with its magic bytes', () => {
    ok('a.woff2', 'font', WOFF2);
    ok('a.woff', 'font', WOFF);
    ok('a.ttf', 'font', TTF);
    ok('a.ttf', 'font', TTF_MAC);
    ok('a.otf', 'font', OTF);
    ok('a.png', 'logo', PNG);
    ok('a.jpg', 'logo', JPEG);
    ok('a.JPEG', 'logo', JPEG);
    ok('a.webp', 'logo', WEBP);
    ok('a.svg', 'logo', SVG);
    ok('guide.pdf', 'source', PDF);
    ok('notes.md', 'source', Buffer.from('# Brand\n\nCalm and plain. Café ✓\n', 'utf8'));
    ok('notes.txt', 'source', bytes(''));
    ok('photo.png', 'source', PNG);
  });

  test('a mismatch between the extension and the content is refused', () => {
    assert.equal(refused('Inter.woff2', 'font', WOFF), "This font file can't be used.");
    assert.equal(refused('Inter.ttf', 'font', OTF), "This font file can't be used.");
    assert.equal(refused('Inter.otf', 'font', PNG), "This font file can't be used.");
    assert.equal(refused('Inter.woff2', 'font', bytes('')), "This font file can't be used.", 'empty');
    assert.equal(refused('logo.png', 'logo', JPEG), "logo.png isn't a real PNG file.");
    assert.equal(refused('logo.jpg', 'logo', PNG), "logo.jpg isn't a real JPEG file.");
    assert.equal(refused('logo.webp', 'logo', bytes('RIFF', [0, 0, 0, 0], 'WAVE')), "logo.webp isn't a real WebP file.");
    assert.equal(refused('logo.svg', 'logo', bytes('<html><svg/></html>')), "logo.svg isn't a real SVG file.");
    assert.equal(refused('guide.pdf', 'source', bytes('%PDX')), "guide.pdf isn't a real PDF file.");
    assert.equal(refused('notes.md', 'source', bytes('a', [0], 'b')), "notes.md isn't a real Markdown file.", 'NUL');
    assert.equal(refused('notes.txt', 'source', bytes([0xc3, 0x28])), "notes.txt isn't a real text file.", 'invalid UTF-8');
    // A renamed executable or archive never passes as a picture.
    assert.equal(refused('evil.png', 'logo', bytes('MZ\x90\x00')), "evil.png isn't a real PNG file.");
  });

  test('a type design systems do not use is refused by its name', () => {
    assert.equal(refused('brand.key', 'source', PDF), "brand.key isn't a file type design systems use.");
    assert.equal(refused('logo.gif', 'logo', bytes('GIF89a')), "logo.gif isn't a file type design systems use.");
    assert.equal(refused('.env', null, bytes('A=1')), ".env isn't a file type design systems use.");
    assert.equal(refused('README', null, bytes('x')), "README isn't a file type design systems use.");
    assert.equal(refused('page.html', 'source', bytes('<p>')), "page.html isn't a file type design systems use.");
  });

  test('the kind must fit: fonts are fonts, logos are pictures, a source may be any accepted type', () => {
    assert.equal(refused('logo.png', 'font', PNG), "logo.png isn't a font file.");
    assert.equal(refused('Inter.ttf', 'logo', TTF), "Inter.ttf isn't a logo picture. Use SVG, PNG, JPEG or WebP.");
    assert.equal(refused('guide.pdf', 'logo', PDF), "guide.pdf isn't a logo picture. Use SVG, PNG, JPEG or WebP.");
    ok('Inter.ttf', 'source', TTF);
    const inferred = checkAsset('Inter.ttf', null, TTF);
    assert.deepEqual(inferred, { ok: true, group: 'font', kind: 'font' });
    assert.deepEqual(checkAsset('logo.svg', null, SVG), { ok: true, group: 'image', kind: 'logo' });
    assert.deepEqual(checkAsset('guide.pdf', null, PDF), { ok: true, group: 'document', kind: 'source' });
  });

  test('size caps per type: fonts 5 MB, pictures 10 MB, documents 20 MB', () => {
    assert.equal(checkAssetMeta('a.woff2', 'font', SYSTEM_FONT_MAX_BYTES).ok, true);
    assert.deepEqual(checkAssetMeta('a.woff2', 'font', SYSTEM_FONT_MAX_BYTES + 1), { ok: false, reason: 'a.woff2 is too large. Fonts can be up to 5 MB.' });
    assert.equal(checkAssetMeta('a.png', 'logo', SYSTEM_IMAGE_MAX_BYTES).ok, true);
    assert.deepEqual(checkAssetMeta('a.png', 'logo', SYSTEM_IMAGE_MAX_BYTES + 1), { ok: false, reason: 'a.png is too large. Pictures can be up to 10 MB.' });
    assert.equal(checkAssetMeta('a.pdf', 'source', SYSTEM_DOCUMENT_MAX_BYTES).ok, true);
    assert.deepEqual(checkAssetMeta('a.pdf', 'source', SYSTEM_DOCUMENT_MAX_BYTES + 1), { ok: false, reason: 'a.pdf is too large. Documents can be up to 20 MB.' });
    // The cap follows the type, not the kind: a picture kept as a source is still a picture.
    assert.equal(checkAssetMeta('a.png', 'source', SYSTEM_IMAGE_MAX_BYTES + 1).ok, false);
    // With bytes: a real WOFF2 one byte over the cap.
    const big = Buffer.alloc(SYSTEM_FONT_MAX_BYTES + 1);
    big.write('wOF2', 0, 'latin1');
    assert.equal(refused('big.woff2', 'font', big), 'big.woff2 is too large. Fonts can be up to 5 MB.');
  });

  test('isSvgText allows a BOM, an XML declaration, comments and a doctype before <svg', () => {
    assert.equal(isSvgText(bytes([0xef, 0xbb, 0xbf], '<?xml version="1.0"?>\n<!-- made by hand -->\n<!DOCTYPE svg PUBLIC "x" "y">\n<svg viewBox="0 0 1 1"></svg>')), true);
    assert.equal(isSvgText(bytes('<svg>')), true);
    assert.equal(isSvgText(bytes('<svgx>')), false);
    assert.equal(isSvgText(bytes('<!-- open comment <svg>')), false);
    assert.equal(isSvgText(bytes('<SVG>')), false);
    assert.equal(isSvgText(bytes('<svg', [0], '>')), false);
  });

  test('a hostile name is shown as its base name without control characters', () => {
    assert.equal(displayName('../../etc/pass\nwd.png'), 'pass' + 'wd.png');
    assert.equal(displayName('C:\\x\\a.png'), 'a.png');
    assert.equal(displayName('\u0001'), 'This file');
    assert.equal(displayName(`${'a'.repeat(100)}.png`).length, 80);
  });
});

describe('font faces and logo variants', () => {
  test('guessFontFace reads family, weight and style from the name', () => {
    assert.deepEqual(guessFontFace('assets/fonts/Inter-SemiBoldItalic.woff2'), { family: 'Inter', weight: 600, style: 'italic' });
    assert.deepEqual(guessFontFace('Inter-Regular.woff2'), { family: 'Inter', weight: 400, style: 'normal' });
    assert.deepEqual(guessFontFace('Open Sans Bold.ttf'), { family: 'Open Sans', weight: 700, style: 'normal' });
    assert.deepEqual(guessFontFace('OpenSansBold.ttf'), { family: 'OpenSans', weight: 700, style: 'normal' });
    assert.deepEqual(guessFontFace('IBMPlexSans-ExtraLight.otf'), { family: 'IBMPlexSans', weight: 200, style: 'normal' });
    assert.deepEqual(guessFontFace('Brand_700.woff'), { family: 'Brand', weight: 700, style: 'normal' });
    assert.deepEqual(guessFontFace('Boldonse-Black.woff2'), { family: 'Boldonse', weight: 900, style: 'normal' }, 'a weight word at the start is part of the family');
    assert.deepEqual(guessFontFace('Lora-Italic.ttf'), { family: 'Lora', weight: 400, style: 'italic' });
    assert.deepEqual(guessFontFace('Inter-VariableFont_slnt-wght.ttf'), { family: 'Inter', weight: 400, style: 'normal' });
    assert.deepEqual(guessFontFace('Sohne.woff2'), { family: 'Sohne', weight: 400, style: 'normal' });
    assert.deepEqual(guessFontFace('Bold.woff2'), { family: 'Bold', weight: 400, style: 'normal' });
    assert.deepEqual(guessFontFace('_.woff2'), { family: 'Brand font', weight: 400, style: 'normal' });
  });

  test('guessLogoVariant picks a variant word, else primary', () => {
    assert.equal(guessLogoVariant('assets/logos/acme-mark.svg'), 'mark');
    assert.equal(guessLogoVariant('Acme Logo White.png'), 'white');
    assert.equal(guessLogoVariant('acme_dark_mono.svg'), 'dark');
    assert.equal(guessLogoVariant('acme.svg'), 'primary');
    assert.equal(guessLogoVariant('benchmark.svg'), 'primary', 'a word inside a word does not count');
  });
});

describe('withAssetEntries: the system.json merge', () => {
  test('appends to each list, keeps every other key and the order of entries', () => {
    const current = JSON.stringify({ version: 1, tokens: { '--x': { note: 'n' } }, fonts: [{ file: 'assets/fonts/Old.woff2', family: 'Old', weight: 400, style: 'normal' }], custom: { kept: true } });
    const next = withAssetEntries(current, [
      { rel: 'assets/fonts/Inter-Bold.woff2', kind: 'font' },
      { rel: 'assets/logos/acme-mark.svg', kind: 'logo' },
      { rel: 'sources/guide.pdf', kind: 'source' },
    ]);
    assert.ok(next !== null);
    const parsed = JSON.parse(next) as Record<string, unknown>;
    assert.deepEqual(parsed.tokens, { '--x': { note: 'n' } });
    assert.deepEqual(parsed.custom, { kept: true });
    assert.deepEqual(parsed.fonts, [
      { file: 'assets/fonts/Old.woff2', family: 'Old', weight: 400, style: 'normal' },
      { file: 'assets/fonts/Inter-Bold.woff2', family: 'Inter', weight: 700, style: 'normal' },
    ]);
    assert.deepEqual(parsed.logos, [{ file: 'assets/logos/acme-mark.svg', variant: 'mark' }]);
    assert.deepEqual(parsed.sources, [{ file: 'sources/guide.pdf' }]);
    assert.ok(next.endsWith('}\n'));
  });

  test('an absent system.json starts at version 1; a listed file is not added twice', () => {
    const next = withAssetEntries(null, [{ rel: 'sources/a.md', kind: 'source' }]);
    assert.deepEqual(JSON.parse(next ?? ''), { version: 1, sources: [{ file: 'sources/a.md' }] });
    assert.equal(withAssetEntries(next, [{ rel: 'sources/a.md', kind: 'source' }]), next);
  });

  test('a broken file or a list key that is not a list is never written over', () => {
    assert.equal(withAssetEntries('{ not json', [{ rel: 'sources/a.md', kind: 'source' }]), null);
    assert.equal(withAssetEntries('[]', [{ rel: 'sources/a.md', kind: 'source' }]), null);
    assert.equal(withAssetEntries('{"fonts": {"x": 1}}', [{ rel: 'assets/fonts/a.woff2', kind: 'font' }]), null);
    // A wrong-typed key the addition does not touch is left as it is.
    assert.equal(JSON.parse(withAssetEntries('{"logos": 5}', [{ rel: 'sources/a.md', kind: 'source' }]) ?? '').logos, 5);
  });
});
