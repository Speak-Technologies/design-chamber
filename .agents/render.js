#!/usr/bin/env node
/**
 * Project render wrapper. Re-render the agent team with this, not the skill's script directly:
 *
 *   node .agents/render.js            # from the repo root
 *
 * It runs the agent-team-generator renderer on .agents/team.json, then does the two things the
 * skill's templates cannot be told to do:
 *   1. applies the exact-text replacements listed in team.json `post_render.replace` (generic
 *      database wording that does not fit this project); a replacement that matches nothing
 *      stops the run, so a template change is noticed instead of silently dropped;
 *   2. replaces every em dash left in a generated file (house style: no em dashes).
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

const rendered = spawnSync(process.execPath, [path.join(skillDir, 'scripts', 'render-team.cjs'), teamPath, '--no-verify'], { cwd: root, encoding: 'utf8' });
if (rendered.status !== 0) die(`the skill's renderer failed:\n${rendered.stdout}${rendered.stderr}`);
// What the skill owns this run: its manifest, plus AGENTS.md (only the team block is the skill's, but the
// house-style sweep covers the whole file).
const owned = JSON.parse(fs.readFileSync(path.join(root, '.agents', '.rendered.json'), 'utf8')).files;
const generated = [...new Set([...owned, 'AGENTS.md'])].filter((rel) => /\.md$/.test(rel) && !rel.startsWith('documentation/'));

const team = JSON.parse(fs.readFileSync(path.join(root, teamPath), 'utf8'));
const replacements = (team.post_render && team.post_render.replace) || [];
for (const { from, to } of replacements) {
  let hits = 0;
  for (const rel of generated) {
    const abs = path.join(root, rel);
    const text = fs.readFileSync(abs, 'utf8');
    if (!text.includes(from)) continue;
    hits += text.split(from).length - 1;
    fs.writeFileSync(abs, text.split(from).join(to));
  }
  if (hits === 0) die(`post_render replacement matched nothing (the skill's template changed?): ${JSON.stringify(from)}`);
}

// An em dash becomes the punctuation the sentence wants: a colon in a heading or after a bold lead-in
// or the word FOUND, "none" for an empty table cell, commas around a pair (an aside), and a semicolon
// for a single break between two clauses.
const PAIR_SPAN = 160;
const deDashParagraph = (para) => {
  const dashes = [...para.matchAll(/ — /g)].map((m) => m.index);
  const pairAt = new Set();
  for (let i = 0; i + 1 < dashes.length; i += 1) {
    if (dashes[i + 1] - dashes[i] <= PAIR_SPAN && !pairAt.has(dashes[i])) { pairAt.add(dashes[i]); pairAt.add(dashes[i + 1]); i += 1; }
  }
  return para.replace(/ — /g, (match, offset) => (pairAt.has(offset) ? ', ' : '; '));
};
const deDash = (text) => text
  .replace(/^(#+ .*?) — /gm, '$1: ')
  .replace(/\| — \|/g, '| none |')
  .replace(/(\*\*[^*\n]+\*\*) — /g, '$1: ')
  .replace(/(\*\*[^*\n]*?) — ([^*\n]*?:\*\*)/g, '$1, $2')
  .replace(/(\*\*[^*\n]*?) — ([^*\n]*?\*\*)/g, '$1: $2')
  .replace(/(\*[^*\n]+\*) — /g, '$1: ')
  .replace(/ — (?=not )/g, ', ')
  .replace(/ —\n/g, ':\n')
  .replace(/NOT FOUND — /g, 'NOT FOUND: ')
  .replace(/\n(\s*)— /g, ';\n$1')
  .split(/\n{2,}/).map(deDashParagraph).join('\n\n')
  .replace(/—/g, '-');
for (const rel of generated) {
  const abs = path.join(root, rel);
  const text = fs.readFileSync(abs, 'utf8');
  if (text.includes('—')) fs.writeFileSync(abs, deDash(text));
}
const left = generated.filter((rel) => fs.readFileSync(path.join(root, rel), 'utf8').includes('—'));
if (left.length) die(`em dash still present in: ${left.join(', ')}`);

const verifyPath = path.join(root, '.agents', 'verify-team.cjs');
console.log(`rendered; patched ${replacements.length} replacements and em dashes in ${generated.length} files\n`);
const checked = spawnSync(process.execPath, [verifyPath, root], { stdio: 'inherit' });
process.exit(checked.status === null ? 1 : checked.status);
