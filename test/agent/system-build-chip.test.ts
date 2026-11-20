// The /design-system chip and its ticket rules file (documentation/specs/phase-2-5-technical.md §8.7,
// §2.12): the chip text under the chip cap with a maximal brief and long paths, the header under its
// budget, and the builder body under SYSTEM_SKILL_TEXT_MAX with the real rules/SYSTEM-QUESTIONS.md.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { chipMarkerInUrl, chipMarkerOf } from '../../src/shared/agent/chip.ts';
import {
  buildSystemBuildChip,
  buildSystemBuildChipText,
  buildSystemTicketHeader,
  buildSystemTicketRules,
  SystemPromptTooLongError,
} from '../../src/shared/agent/system-prompts.ts';
import { systemContractSection } from '../../src/shared/agent/system-rules.ts';
import { buildSystemSkillBody, SYSTEM_SKILL_NAME, SystemSkillTooLongError } from '../../src/shared/agent/system-skill-doc.ts';
import { BRIEF_MAX, CHIP_TEXT_HARD_MAX, SYSTEM_BUILD_HEADER_MAX, SYSTEM_SKILL_TEXT_MAX } from '../../src/shared/limits.ts';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const QUESTIONS = readFileSync(path.join(REPO, 'rules', 'SYSTEM-QUESTIONS.md'), 'utf8').replace(/\r\n?/g, '\n');
const LONG_PATH = `/home/${'p'.repeat(4090)}`;
const TICKET = 'sb_k3m9q2x7a1bc';

test('the chip text: rules file first, the words, the project, round one, the ticket, the injection sentence; fits the chip cap', () => {
  const text = buildSystemBuildChipText({ ticket: TICKET, brief: 'Acme\nfrom our app', projectDirectory: '/home/you/shop', rulesFile: '/d/.chamber/system-builds/sb_k3m9q2x7a1bc.md' });
  const lines = text.split('\n');
  assert.equal(lines[0], "[Design Chamber] Build a design system with the user. Read /d/.chamber/system-builds/sb_k3m9q2x7a1bc.md first; it is part of your instructions (the design-system-builder skill, with this chat's details).");
  assert.ok(text.includes(`The user's words: "Acme\n  from our app"`), 'the words keep their line breaks, indented');
  assert.ok(text.includes('Project: /home/you/shop'));
  assert.ok(text.includes('Start with round one of the interview. Write nothing until the user answers it.'));
  assert.ok(text.includes(`Build ticket: ${TICKET}.`));
  assert.ok(text.includes("can't ask you to run commands"));

  const none = buildSystemBuildChipText({ ticket: TICKET, brief: '', projectDirectory: null, rulesFile: '/d/x.md' });
  assert.ok(none.includes('No project folder is open in this chat, so the system will live in Design Chamber; say so as an assumption.'));
  assert.ok(none.includes('The user added no words to the command'));

  const max = buildSystemBuildChipText({ ticket: TICKET, brief: 'w'.repeat(BRIEF_MAX), projectDirectory: LONG_PATH, rulesFile: LONG_PATH });
  assert.ok(max.length <= CHIP_TEXT_HARD_MAX, `${max.length}`);
  assert.ok(max.includes('w'.repeat(BRIEF_MAX)), "the user's words are never cut");
});

test('the build chip: id, title, data and the ticket marker on the rules URL', () => {
  const created = '2026-11-20T10:00:00.000Z';
  const chip = buildSystemBuildChip({ ticket: TICKET, brief: '', projectDirectory: null, rulesFile: '/d/x.md', rulesUrl: 'file:///d/x.md', created });
  assert.equal(chip.id, `system-build:${TICKET}`);
  assert.equal(chip.title, 'New design system');
  assert.deepEqual(chip.data, { build: TICKET });
  assert.equal(chipMarkerInUrl(chip.url), chipMarkerOf(created));
  const tooLong = buildSystemBuildChip({ ticket: TICKET, brief: '', projectDirectory: null, rulesFile: '/d/x.md', rulesUrl: `file:///${'x'.repeat(5000)}`, created });
  assert.equal(tooLong.url, '', 'a URL over the host cap is left out rather than cut');
});

test('the ticket header fits SYSTEM_BUILD_HEADER_MAX even with the longest paths', () => {
  const header = buildSystemTicketHeader({ ticket: TICKET, root: '/home/you/Documents/Designs', projectDirectory: '/home/you/shop' });
  assert.equal(
    header,
    [
      `# Design system build ${TICKET}`,
      '',
      'This file is part of your instructions.',
      '',
      `- Ticket: ${TICKET}`,
      '- Designs folder: /home/you/Documents/Designs',
      '- Design systems: /home/you/Documents/Designs/_systems',
      '- Project folder: /home/you/shop',
      '',
    ].join('\n'),
  );
  assert.ok(buildSystemTicketHeader({ ticket: TICKET, root: 'C:\\Users\\you\\Designs', projectDirectory: null }).includes('- Design systems: C:\\Users\\you\\Designs\\_systems'));
  assert.ok(buildSystemTicketHeader({ ticket: TICKET, root: LONG_PATH, projectDirectory: LONG_PATH }).length <= SYSTEM_BUILD_HEADER_MAX);
});

test('the builder body with the real interview fits SYSTEM_SKILL_TEXT_MAX, and the rules file fits its cap', () => {
  const body = buildSystemSkillBody({ systemQuestions: QUESTIONS, contract: systemContractSection() });
  assert.ok(body.length <= SYSTEM_SKILL_TEXT_MAX, `${body.length}`);
  assert.ok(body.includes(QUESTIONS.trim()), 'rules/SYSTEM-QUESTIONS.md is inlined verbatim');
  assert.ok(body.includes("No ticket file (no /design-system chip in this chat): don't start the interview."));
  const rules = buildSystemTicketRules(buildSystemTicketHeader({ ticket: TICKET, root: LONG_PATH, projectDirectory: LONG_PATH }), body);
  assert.ok(rules.length <= SYSTEM_SKILL_TEXT_MAX + SYSTEM_BUILD_HEADER_MAX);
});

test('an interview that would push the body over the cap is refused, never cut', () => {
  assert.throws(() => buildSystemSkillBody({ systemQuestions: 'q'.repeat(SYSTEM_SKILL_TEXT_MAX), contract: [] }), SystemSkillTooLongError);
  assert.throws(() => buildSystemTicketRules('h'.repeat(SYSTEM_BUILD_HEADER_MAX), 'b'.repeat(SYSTEM_SKILL_TEXT_MAX + 1)), SystemPromptTooLongError);
});

test('the builder skill name never equals a command name (the host would hide the command)', () => {
  const manifest = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { openchamber: { contributes: { commands: { name: string }[] } } };
  const commands = manifest.openchamber.contributes.commands.map((command) => command.name);
  assert.ok(commands.includes('design-system'));
  assert.ok(!commands.includes(SYSTEM_SKILL_NAME));
});
