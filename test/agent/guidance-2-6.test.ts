// Phase 2.6 G1 (documentation/specs/phase-2-6-technical.md §7.7, §16.1): folders and projects are
// the user's own tags, so no rule input reads them. The precedence text of a design with no system
// and the chip text are pinned byte for byte (the hashes were taken from the shipped text before
// G1 touched src/shared/agent), and the guide edits never change a pin line.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';

import { buildChipText } from '../../src/shared/agent/chip.ts';
import { buildPinInstruction, PIN_INSTRUCTION_MAX } from '../../src/shared/agent/instructions.ts';
import { buildRulesDoc } from '../../src/shared/agent/rules-doc.ts';
import { baseContext, REPO_RULES } from './helpers.ts';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const read = (name: string): Promise<string> => readFile(path.join(REPO_RULES, name), 'utf8');

/** The `## Precedence` section of a RULES.md: from its heading to the next level-2 heading. */
const precedenceOf = (doc: string): string => {
  const start = doc.indexOf('## Precedence');
  assert.ok(start >= 0, 'the precedence heading is there');
  const next = doc.indexOf('\n## ', start + 1);
  return doc.slice(start, next < 0 ? undefined : next);
};

describe('Phase 2.6 §7.7: precedence and the pin lines are not touched by the folders work', () => {
  test('the precedence section of a design with no system is byte-identical to the shipped text', async () => {
    const doc = buildRulesDoc(baseContext(), { designRules: await read('DESIGN-RULES.md'), questions: await read('QUESTIONS.md') });
    const precedence = precedenceOf(doc);
    assert.ok(precedence.includes('### Layer 1'), 'layers are there');
    assert.equal(sha(precedence), PRECEDENCE_SHA256, 'the precedence text changed: it must stay as shipped');
  });

  test('the chip text of a design with no system is byte-identical to the shipped text (new and continue)', () => {
    assert.equal(sha(buildChipText(baseContext(), 'new')), CHIP_NEW_SHA256, 'the new-design chip text changed: it must stay as shipped');
    assert.equal(sha(buildChipText(baseContext(), 'continue')), CHIP_CONTINUE_SHA256, 'the continue chip text changed: it must stay as shipped');
  });

  test('the pin line comes from the system name alone, capped as before', () => {
    assert.equal(buildPinInstruction('Acme'), 'Designs for this project use the design system "Acme" in Design Chamber.');
    assert.ok(buildPinInstruction('x'.repeat(500)).length <= PIN_INSTRUCTION_MAX);
  });
});

const PRECEDENCE_SHA256 = '5bceeea9c1aa1ade1316cf9904da127062aa69d68be9a88e1e025685215e0426';
const CHIP_NEW_SHA256 = 'bce0cc0b7be0e60e33920f9af893942e792fa250af6860f1e8cb00179b97b9fd';
const CHIP_CONTINUE_SHA256 = 'af029d2d3b9754c259f9ffed63c9ae3ea712de7b5aa88197e4012647f6c1e2f1';
