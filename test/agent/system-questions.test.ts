// The interview parser (documentation/specs/phase-2-5-technical.md §8.9 rev 3, T15): it accepts
// the rules author's R1 file, refuses every broken structure with its sentence, and produces the
// same ids the builder skill inlines, so the SystemAsk block and the skill never drift apart.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { parseSystemQuestions, SYSTEM_QUESTIONS_CLOSING } from '../../src/shared/agent/system-questions.ts';
import { buildSystemSkillBody } from '../../src/shared/agent/system-skill-doc.ts';
import { systemContractSection } from '../../src/shared/agent/system-rules.ts';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const R1 = readFileSync(path.join(REPO, 'rules', 'SYSTEM-QUESTIONS.md'), 'utf8');

/** R1 with one exact replacement; the replacement must occur once, so a mutation never silently no-ops. */
const mutated = (from: string, to: string): string => {
  assert.equal(R1.split(from).length, 2, `the mutation target occurs once: ${from}`);
  return R1.replace(from, to);
};

describe('parseSystemQuestions: R1 accepted', () => {
  const set = parseSystemQuestions(R1);

  test('the round-one topics and choices, with the recommended defaults and the coverage multi-pick', () => {
    assert.deepEqual(
      set.roundOne.map((question) => [question.topic, question.multiple, question.options.map((option) => [option.choice, option.recommended])]),
      [
        ['home', false, [['repo', true], ['internal', false]]],
        ['mode', false, [['fix', true], ['describe', false]]],
        ['coverage', true, [['foundations', true], ['components', true], ['patterns', true], ['brand', true]]],
        ['dark', false, [['not-now', true], ['include', false]]],
      ],
    );
  });

  test('the round-two topics and choices', () => {
    assert.deepEqual(
      set.roundTwo.map((question) => [question.topic, question.options.map((option) => [option.choice, option.recommended])]),
      [
        ['status-colours', [['brand-tuned', true], ['stock', false], ['custom', false]]],
        ['greys', [['brand-tinted', true], ['neutral', false]]],
        ['access', [['dev', true], ['public', false]]],
        ['typography', [['one-font', true], ['display', false]]],
        ['dark-values', [['derive', true], ['hand-tune', false]]],
      ],
    );
    assert.ok(set.roundTwo.every((question) => !question.multiple));
  });

  test('labels and whys are the file\'s own words; the closing sentence is fixed', () => {
    assert.equal(set.roundOne[0]?.label, 'Where should the design system live?');
    assert.equal(set.roundOne[0]?.options[0]?.why, 'The system and its living page ship with your repo, next to the code.');
    assert.equal(set.closing, SYSTEM_QUESTIONS_CLOSING);
    assert.equal(set.closing, 'Reply with changes, or say go to accept the defaults.');
  });

  test('CRLF reads the same as LF', () => {
    assert.deepEqual(parseSystemQuestions(R1.replace(/\n/g, '\r\n')), set);
  });
});

describe('parseSystemQuestions: broken structures refused', () => {
  const refuses = (md: string, sentence: RegExp): void => {
    assert.throws(() => parseSystemQuestions(md), sentence);
  };

  test('a missing or out-of-order round heading', () => {
    refuses(mutated('## Round one: before you read the code', '## Round 1'), /"## Round one: before you read the code" heading is missing/);
    refuses(mutated('## Round two: after you read the code', '## Round 2'), /"## Round two: after you read the code" heading is missing/);
    refuses(mutated('## After two rounds', '## Done'), /"## After two rounds" heading is missing/);
    refuses(R1.replace('## Round one: before you read the code', '## After two rounds'), /heading is missing|in order/);
  });

  test('a missing question, an unknown topic, a duplicate topic', () => {
    refuses(mutated('### Greys {#greys}', '### Greys'), /needs a \{#topic\} id/);
    refuses(mutated('### Greys {#greys}', '### Greys {#shades}'), /"shades" is not a round two question/);
    refuses(mutated('### Typography {#typography}', '### Greys copy {#greys}\n- **A** {#a}: why\n\n### Typography {#typography}'), /duplicate topic "greys"/);
    refuses(mutated('### Dark values {#dark-values}', '### Dark values {#dark-values-x}'), /"dark-values-x" is not a round two question/);
    // A whole question gone: the topic is then missing.
    const withoutGreys = R1.replace(/### Greys \{#greys\}\n(?:- .*\n)+/, '');
    refuses(withoutGreys, /the round two question "greys" is missing/);
  });

  test('a question with no options, or the wrong number of recommended ones', () => {
    refuses(mutated('- **Brand-tinted greys** {#brand-tinted}: The neutral ramp leans a few degrees toward the brand hue.\n- Keep neutral grey {#neutral}: The current greys stay; only the colours change.', ''), /the question "greys" has no options/);
    refuses(mutated('- **Brand-tinted greys** {#brand-tinted}:', '- Brand-tinted greys {#brand-tinted}:'), /needs exactly one recommended option/);
    refuses(mutated('- Keep neutral grey {#neutral}:', '- **Keep neutral grey** {#neutral}:'), /needs exactly one recommended option/);
  });

  test('a duplicate choice, a bad id, an over-long label or why', () => {
    refuses(mutated('- Keep neutral grey {#neutral}:', '- Keep neutral grey {#brand-tinted}:'), /duplicate choice "brand-tinted"/);
    refuses(mutated('{#brand-tinted}:', '{#Brand-tinted}:'), /must be lower-case letters, digits and dashes/);
    refuses(mutated('### Greys {#greys}', `### ${'G'.repeat(81)} {#greys}`), /label of "greys" is over 80 characters/);
    refuses(mutated('- Keep neutral grey {#neutral}: The current greys stay; only the colours change.', `- Keep neutral grey {#neutral}: ${'w'.repeat(201)}`), /why of "neutral" is over 200 characters/);
    refuses(mutated('- **Repo + living page** {#repo}: The system and its living page ship with your repo, next to the code.', `- **${'R'.repeat(81)}** {#repo}: why`), /label of "repo" is over 80 characters/);
  });

  test('an option line off the shape, and a Pick any. line after the options', () => {
    refuses(mutated('- Keep neutral grey {#neutral}: The current greys stay; only the colours change.', '- Keep neutral grey: no id here'), /not shaped like/);
    refuses(mutated('### Which parts should it cover? {#coverage}\nPick any.', '### Which parts should it cover? {#coverage}'), /needs exactly one recommended option/);
    const late = R1.replace('### Which parts should it cover? {#coverage}\nPick any.\n', '### Which parts should it cover? {#coverage}\n').replace(
      '- **Brand & marketing** {#brand}: Logos, brand guidance and marketing surfaces.',
      '- **Brand & marketing** {#brand}: Logos, brand guidance and marketing surfaces.\nPick any.',
    );
    refuses(late, /"Pick any." line of "coverage" must come before its options/);
  });

  test('a round that does not end with the closing sentence', () => {
    refuses(mutated('Reply with changes, or say go to accept the defaults.\n\n## Round two', 'Say go.\n\n## Round two'), /round one must end with/);
    refuses(R1.replace(/Reply with changes, or say go to accept the defaults\.\n\n## After two rounds/, '\n## After two rounds'), /round two must end with/);
  });
});

describe('the skill and the block read the same ids (AD-25)', () => {
  test('every topic and choice id in the parsed set appears verbatim in the skill body, and vice versa', () => {
    const set = parseSystemQuestions(R1);
    const body = buildSystemSkillBody({ systemQuestions: R1, contract: systemContractSection() });
    const ids = [...set.roundOne, ...set.roundTwo].flatMap((question) => [question.topic, ...question.options.map((option) => option.choice)]);
    for (const id of ids) assert.ok(body.includes(`{#${id}}`), `the skill carries {#${id}}`);
    // The markers in the file are exactly the ids the set holds: no extra question, no lost one.
    const inFile = [...R1.matchAll(/\{#([a-z0-9][a-z0-9-]{0,39})\}/g)].map((match) => match[1]);
    assert.deepEqual([...inFile].sort(), [...ids].sort());
    assert.ok(body.includes(R1.trim()), 'the interview is inlined verbatim, so the wording is one source');
  });
});
