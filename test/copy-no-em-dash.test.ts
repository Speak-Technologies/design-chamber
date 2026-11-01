// The owner's copy rule: no em dashes in any text a user or an agent reads (KI-7). Every string
// literal and template piece under src/ is checked; code comments are not text anyone sees.
// `src/guest/fake-services.ts` is skipped: it is a dev-only stand-in whose sample designs are
// design content, not app copy, and no production entry imports it.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
const SKIPPED = new Set(['guest/fake-services.ts']);

const isTextNode = (node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateLiteralLikeNode =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);

/** `file:line: text` for every string piece in `text` holding an em dash. */
const emDashStrings = (file: string, text: string): string[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (isTextNode(node) && node.text.includes('—')) {
      found.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${node.text.slice(0, 120)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

test('the scanner finds an em dash in a string and ignores one in a comment', () => {
  const sample = "// a comment — fine\nconst a = 'one — two';\nconst b = `x ${a} — y`;\n";
  assert.equal(emDashStrings('sample.ts', sample).length, 2);
});

test('no string in src/ carries an em dash', () => {
  const files = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
    .map((entry) => entry.split(path.sep).join('/'))
    .filter((entry) => entry.endsWith('.ts') && !SKIPPED.has(entry));
  assert.ok(files.length > 20, 'the source tree was found');
  const found = files.flatMap((entry) => emDashStrings(entry, readFileSync(path.join(srcDir, entry), 'utf8')));
  assert.deepEqual(found, [], 'reword these without an em dash (a full stop, comma, colon or brackets)');
});
