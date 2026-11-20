// The interview structure the build and the SystemAsk block rely on (documentation/specs/
// phase-2-5-technical.md §8.9 rev 3, AD-25): `rules/SYSTEM-QUESTIONS.md` parsed into a
// SystemQuestionSet. The skill inlines the same file verbatim, so the ids an agent reads in the
// interview are the ids the block draws and BUILD.json records. Pure, no Node imports: the build
// runs it under Node's type stripping and the blocks bundle bakes its answer at build time.
//
// The wording between the headings is the rules author's and is never checked; the structure is:
// the three round headings, one level-3 question per topic (`### Label {#topic}`), an optional
// `Pick any.` line, options as `- **Label** {#choice}: why` (recommended) or `- Label {#choice}: why`,
// and each round ending with the closing sentence. Anything else is refused with its sentence, so
// a broken file fails the build instead of reaching a chat.

import type { SystemQuestion, SystemQuestionSet } from '../types.ts';

/** Topics and choices share the `calls` rule (§2.13). */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const LABEL_MAX = 80;
const WHY_MAX = 200;

export const SYSTEM_QUESTIONS_CLOSING = 'Reply with changes, or say go to accept the defaults.';
export const SYSTEM_QUESTIONS_FILE = 'rules/SYSTEM-QUESTIONS.md';

const ROUND_ONE_HEADING = '## Round one: before you read the code';
const ROUND_TWO_HEADING = '## Round two: after you read the code';
const AFTER_HEADING = '## After two rounds';

/** The closed topic set of each round (§8.9); the file's order is kept. */
const ROUND_ONE_TOPICS: readonly string[] = ['home', 'mode', 'coverage', 'dark'];
const ROUND_TWO_TOPICS: readonly string[] = ['status-colours', 'greys', 'access', 'typography', 'dark-values'];

const fail = (sentence: string): Error => new Error(`${SYSTEM_QUESTIONS_FILE}: ${sentence}`);

type Option = SystemQuestion['options'][number];

/** One option line: `- **Label** {#choice}: why` or `- Label {#choice}: why`; null when it is neither. */
const parseOption = (line: string): Option | null => {
  const bold = /^-\s+\*\*([^*]+)\*\*\s+\{#([^}]+)\}:\s*(.*)$/.exec(line);
  const plain = bold === null ? /^-\s+([^*{]+?)\s+\{#([^}]+)\}:\s*(.*)$/.exec(line) : null;
  const match = bold ?? plain;
  if (match === null) return null;
  const [, rawLabel = '', choice = '', rawWhy = ''] = match;
  const label = rawLabel.trim();
  const why = rawWhy.trim();
  if (label === '') return null;
  return { choice, label, why, recommended: bold !== null };
};

/** The questions of one round section, in file order, with the round's closing sentence checked. */
const parseRound = (lines: readonly string[], expected: readonly string[], roundName: string): SystemQuestion[] => {
  const questions: SystemQuestion[] = [];
  const seenTopics = new Set<string>();
  let current: { question: SystemQuestion; body: string[] } | null = null;

  const finish = (): void => {
    if (current === null) return;
    const { question, body } = current;
    current = null;
    // `Pick any.` marks a multiple-choice question and comes before its options.
    const trimmedBody = body.map((line) => line.trim());
    const pickAt = trimmedBody.indexOf('Pick any.');
    const firstOptionAt = trimmedBody.findIndex((line) => line.startsWith('- '));
    const multiple = pickAt >= 0 && (firstOptionAt < 0 || pickAt < firstOptionAt);
    if (pickAt >= 0 && !multiple) throw fail(`the "Pick any." line of "${question.topic}" must come before its options.`);
    const optionLines = trimmedBody.filter((line) => line.startsWith('- '));
    const options: Option[] = [];
    const seenChoices = new Set<string>();
    for (const line of optionLines) {
      const one = parseOption(line);
      if (one === null) throw fail(`an option of "${question.topic}" is not shaped like "- **Label** {#choice}: why".`);
      if (!ID_PATTERN.test(one.choice)) throw fail(`the choice id "${one.choice}" of "${question.topic}" must be lower-case letters, digits and dashes, up to 40 characters.`);
      if (seenChoices.has(one.choice)) throw fail(`duplicate choice "${one.choice}" in "${question.topic}".`);
      seenChoices.add(one.choice);
      if (one.label.length > LABEL_MAX) throw fail(`the label of "${one.choice}" is over ${LABEL_MAX} characters.`);
      if (one.why.length > WHY_MAX) throw fail(`the why of "${one.choice}" is over ${WHY_MAX} characters.`);
      options.push(one);
    }
    if (options.length === 0) throw fail(`the question "${question.topic}" has no options.`);
    const recommended = options.filter((option) => option.recommended).length;
    if (!multiple && recommended !== 1) throw fail(`the question "${question.topic}" needs exactly one recommended option (in bold), or the "Pick any." line.`);
    questions.push({ ...question, multiple, options });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('### ')) {
      finish();
      const heading = /^###\s+(.*?)\s*\{#([^}]+)\}\s*$/.exec(trimmed);
      if (heading === null) throw fail(`the question heading "${trimmed.slice(4)}" needs a {#topic} id.`);
      const [, rawLabel = '', topic = ''] = heading;
      const label = rawLabel.trim();
      if (label === '') throw fail(`a ${roundName} question has no label.`);
      if (label.length > LABEL_MAX) throw fail(`the label of "${topic}" is over ${LABEL_MAX} characters.`);
      if (!ID_PATTERN.test(topic)) throw fail(`the topic id "${topic}" must be lower-case letters, digits and dashes, up to 40 characters.`);
      if (seenTopics.has(topic)) throw fail(`duplicate topic "${topic}".`);
      if (!expected.includes(topic)) throw fail(`"${topic}" is not a ${roundName} question the SystemAsk block knows.`);
      seenTopics.add(topic);
      current = { question: { topic, label, multiple: false, options: [] }, body: [] };
      continue;
    }
    if (current !== null) current.body.push(line);
  }
  finish();

  for (const topic of expected) {
    if (!seenTopics.has(topic)) throw fail(`the ${roundName} question "${topic}" is missing.`);
  }
  const last = lines.map((line) => line.trim()).filter((line) => line !== '').at(-1);
  if (last !== SYSTEM_QUESTIONS_CLOSING) throw fail(`${roundName} must end with "${SYSTEM_QUESTIONS_CLOSING}"`);
  return questions;
};

/**
 * `rules/SYSTEM-QUESTIONS.md` as the SystemQuestionSet the build bakes into the blocks bundle.
 * Throws with a plain sentence on any broken structure; the wording between the structure is free.
 */
export const parseSystemQuestions = (markdown: string): SystemQuestionSet => {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const headingAt = (heading: string): number => {
    const at = lines.findIndex((line) => line.trim() === heading);
    if (at < 0) throw fail(`the "${heading}" heading is missing.`);
    return at;
  };
  const one = headingAt(ROUND_ONE_HEADING);
  const two = headingAt(ROUND_TWO_HEADING);
  const after = headingAt(AFTER_HEADING);
  if (!(one < two && two < after)) throw fail('the round headings must come in order: round one, round two, after two rounds.');
  return {
    roundOne: parseRound(lines.slice(one + 1, two), ROUND_ONE_TOPICS, 'round one'),
    roundTwo: parseRound(lines.slice(two + 1, after), ROUND_TWO_TOPICS, 'round two'),
    closing: SYSTEM_QUESTIONS_CLOSING,
  };
};
