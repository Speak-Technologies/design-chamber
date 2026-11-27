#!/usr/bin/env node
/**
 * Project render wrapper. Re-render the agent team with this, not the skill's script directly:
 *
 *   node .agents/render.js            # from the repo root
 *
 * It runs the agent-team-generator renderer on .agents/team.json, then does the two things the
 * skill's templates cannot be told to do:
 *   1. applies the exact-text replacements listed in team.json `post_render.replace` (template
 *      wording that does not fit this project, or reads badly once its em dashes are gone). They
 *      run before the em-dash pass, so a `from` may contain the template's em dash (write it as
 *      \u2014 in the JSON). A replacement that matches nothing stops the run, so a template change
 *      is noticed instead of silently dropped; an empty or non-string `from` is refused before
 *      anything is rendered;
 *   2. replaces every em dash left in a generated file, by context (house style: no em dashes).
 * Then it runs the verifier (.agents/verify-team.cjs). The skill itself is never edited.
 * AGENT_TEAM_SKILL_DIR overrides the skill location (default ~/.claude/skills/agent-team-generator).
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.cwd();
const skillDir = process.env.AGENT_TEAM_SKILL_DIR || path.join(os.homedir(), '.claude', 'skills', 'agent-team-generator');
const teamPath = path.join('.agents', 'team.json');
const die = (msg) => { console.error(`render: ${msg}`); process.exit(1); };

// The replacement list is checked first, so a bad entry never leaves a half-processed tree.
const team = JSON.parse(fs.readFileSync(path.join(root, teamPath), 'utf8'));
const replacements = (team.post_render && team.post_render.replace) || [];
replacements.forEach((entry, index) => {
  const shape = entry && typeof entry === 'object' ? entry : {};
  if (typeof shape.from !== 'string' || shape.from === '') die(`post_render.replace[${index}]: "from" must be a non-empty string`);
  if (typeof shape.to !== 'string') die(`post_render.replace[${index}]: "to" must be a string`);
});

const rendered = spawnSync(process.execPath, [path.join(skillDir, 'scripts', 'render-team.cjs'), teamPath, '--no-verify'], { cwd: root, encoding: 'utf8' });
if (rendered.status !== 0) die(`the skill's renderer failed:\n${rendered.stdout}${rendered.stderr}`);
// What the skill owns this run: its manifest, plus AGENTS.md (only the team block is the skill's, but the
// house-style sweep covers the whole file).
const owned = JSON.parse(fs.readFileSync(path.join(root, '.agents', '.rendered.json'), 'utf8')).files;
const generated = [...new Set([...owned, 'AGENTS.md'])].filter((rel) => /\.md$/.test(rel) && !rel.startsWith('documentation/'));

const contents = new Map(generated.map((rel) => [rel, fs.readFileSync(path.join(root, rel), 'utf8')]));
replacements.forEach(({ from, to }, index) => {
  let hits = 0;
  for (const [rel, text] of contents) {
    if (!text.includes(from)) continue;
    hits += text.split(from).length - 1;
    contents.set(rel, text.split(from).join(to));
  }
  if (hits === 0) die(`post_render.replace[${index}] matched nothing (the skill's template changed?): ${JSON.stringify(from)}`);
});

// ---------------------------------------------------------------- em dashes, by context
// What follows the dash decides the punctuation. In order:
//   heading, or a bold or italic lead-in ........ ": "            ## Title: text · **Lead-in**: text
//   inside a bold span that later has a colon ... " (...)"        **Red flags (stop here):**
//   after a bold span, or a list item or table cell that is a short label ... ": "
//   inside a parenthesis ........................ ", "            (the session itself, no file)
//   a capital letter follows .................... ". "
//   two dashes close together (an aside) ........ ", " and ", "
//   a connective follows (and, not, after ...) .. ", "
//   anything else ............................... "; "
const CONNECTIVE = /^(?:and|or|but|then|so|yet|after|before|while|which|who|that|when|if|not|because|with|without|even|also|incl\.?|including|tests|only)\b/i;
const PAIR_SPAN = 220;
const boldOpen = (before) => (before.match(/\*\*/g) || []).length % 2 === 1;
const listItemStart = /\n\s*(?:[-*|]\s|\d+\.\s)/;
const shortListItem = (before) => /^\s*[-*]\s+[^.;:,()"]{1,40}$/.test(before);
const tableCell = (before) => /^\s*\|/.test(before) && before.length - before.lastIndexOf('|') <= 48;
const leadIn = (before) => /^\s*(?:[-*]\s+|\d+\.\s+)?(?:\*\*[^*\n]+\*\*|\*[^*\n]+\*)(?:\s*\*\([^)\n]*\)\*)?$/.test(before);
// Where the list item (or paragraph) holding position `at` begins, so a bold span is counted within it only.
const itemStart = (paragraph, at) => {
  let start = 0;
  for (const m of paragraph.slice(0, at).matchAll(/\n\s*(?:[-*|]\s|\d+\.\s)/g)) start = m.index;
  return start;
};
const dashesOf = (paragraph) => [...paragraph.matchAll(/ \u2014(?=[ \n])/g)].map((m) => m.index);

const deDashParagraph = (paragraph) => {
  const marks = dashesOf(paragraph);
  const kinds = marks.map((at) => {
    const lineStart = paragraph.lastIndexOf('\n', at) + 1;
    const before = paragraph.slice(lineStart, at);
    const after = paragraph.slice(at + 3).replace(/^\s+/, '');
    if (/^#+ /.test(before) || leadIn(before) || /NOT FOUND$/.test(before)) return 'colon';
    if (boldOpen(paragraph.slice(itemStart(paragraph, at), at))) return /^[^*\n]*:\*\*/.test(after) ? 'paren' : 'colon';
    if (/\*\*$/.test(before)) return CONNECTIVE.test(after) ? 'comma' : 'colon';
    if (shortListItem(before) || tableCell(before)) return 'colon';
    if ((before.match(/\(/g) || []).length > (before.match(/\)/g) || []).length) return 'comma';
    if (/^[A-Z]/.test(after)) return 'stop';
    return 'plain';
  });
  for (let i = 0; i + 1 < marks.length; i += 1) {
    if (kinds[i] === 'plain' && kinds[i + 1] === 'plain' && marks[i + 1] - marks[i] <= PAIR_SPAN
      && !/[.!?:;] /.test(paragraph.slice(marks[i] + 3, marks[i + 1])) && !listItemStart.test(paragraph.slice(marks[i], marks[i + 1]))) { kinds[i] = 'comma'; kinds[i + 1] = 'comma'; i += 1; }
  }
  let out = ''; let pos = 0;
  marks.forEach((at, i) => {
    const after = paragraph.slice(at + 3).replace(/^\s+/, '');
    let kind = kinds[i];
    if (kind === 'plain') kind = CONNECTIVE.test(after) ? 'comma' : 'semi';
    const mark = { colon: ':', stop: '.', comma: ',', semi: ';', paren: ' (' }[kind];
    out += paragraph.slice(pos, at) + mark;
    pos = at + 2;
    if (kind === 'paren') {
      // The bold span ends at its colon: "**A (b):**".
      const close = paragraph.indexOf(':**', pos);
      out += paragraph.slice(pos, close).replace(/^\s+/, '') + ')';
      pos = close;
    }
  });
  return out + paragraph.slice(pos);
};
const deDash = (text) => text
  .replace(/\| \u2014 \|/g, '| none |')
  .replace(/\n(\s*)\u2014 /g, ' \u2014\n$1')
  .split(/\n{2,}/).map(deDashParagraph).join('\n\n')
  .replace(/\u2014/g, '-');
for (const [rel, text] of contents) if (text.includes('\u2014')) contents.set(rel, deDash(text));
const left = [...contents].filter(([, text]) => text.includes('\u2014')).map(([rel]) => rel);
if (left.length) die(`em dash still present in: ${left.join(', ')}`);

for (const [rel, text] of contents) fs.writeFileSync(path.join(root, rel), text);

const verifyPath = path.join(root, '.agents', 'verify-team.cjs');
console.log(`rendered; applied ${replacements.length} replacements and the em-dash pass to ${generated.length} files\n`);
const checked = spawnSync(process.execPath, [verifyPath, root], { stdio: 'inherit' });
process.exit(checked.status === null ? 1 : checked.status);
