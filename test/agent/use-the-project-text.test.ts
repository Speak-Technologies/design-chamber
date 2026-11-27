// Use the project (documentation/specs/use-the-project-and-native-agent.md §1.6, §2.5): what RULES.md, the chip
// and the instructions note say when a design follows its project, or links the project's own system. The Phase 0
// and linked texts stay byte-identical (their golden samples and system-instructions.test.ts hold that).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SERVICE_INSTRUCTIONS_MAX } from '@openchamber/sdk';

import { buildChipText } from '../../src/shared/agent/chip.ts';
import { noPatterns, noProject, SYSTEM_GUIDANCE_ONLY, type AgentContext, type AgentSystem, type ProjectRules } from '../../src/shared/agent/context.ts';
import { buildInstructions } from '../../src/shared/agent/instructions.ts';
import { buildRulesDoc } from '../../src/shared/agent/rules-doc.ts';
import { CHIP_TEXT_HARD_MAX } from '../../src/shared/limits.ts';
import { baseContext } from './helpers.ts';

const FILES = { designRules: '# Design rules\n\nRule text.\n', questions: '# Questions\n\nAsk text.\n' };
const PROJECT_DIR = '/home/you/code/shop';
const LAYER_2 = "### Layer 2: this project's design system and patterns (this design follows the project)";
const FOLLOWS = `This design follows ${PROJECT_DIR}. Build it the way the project already looks.`;

const scanned = (over: Partial<ProjectRules> = {}): ProjectRules => ({
  state: 'scanned',
  directory: PROJECT_DIR,
  note: null,
  sources: [
    { path: 'DESIGN.md', kind: 'design-doc', why: 'design document' },
    { path: 'tailwind.config.ts', kind: 'tokens', why: 'Tailwind config' },
  ],
  sourcesOmitted: 0,
  breakpoints: [],
  viewports: [],
  truncated: false,
  patterns: { components: ['src/components', 'src/ui', 'packages/kit/components'], screens: ['app', 'src/views', 'index.html'], stories: 12 },
  ...over,
});

const follows = (over: Partial<AgentContext> = {}, draft: { id: string; name: string } | null = null): AgentContext =>
  baseContext({ project: scanned(), system: { state: 'project', draft }, ...over });

const layerTwo = (rules: string): string => {
  const start = rules.indexOf(LAYER_2);
  assert.ok(start >= 0, 'layer 2 heading');
  return rules.slice(start, rules.indexOf('### Layer 3', start));
};

describe('RULES.md when a design follows the project', () => {
  test('layer 2 names the files, the components, the screens and the stories, then the guidance sentence', () => {
    const rules = buildRulesDoc(follows(), FILES);
    const layer = layerTwo(rules);
    const expected = [
      LAYER_2,
      '',
      FOLLOWS,
      '',
      `Design Chamber found these in ${PROJECT_DIR} (paths relative to it; read them yourself, since you are working in that project):`,
      '',
      '- `DESIGN.md`: design document',
      '- `tailwind.config.ts`: Tailwind config',
      '',
      "Its components live in: `src/components`, `src/ui`, `packages/kit/components`. Read the ones you need and copy their structure, class names and states into this design's HTML. Don't import or run them.",
      'Its existing screens live in: `app`, `src/views`, `index.html`. Match their layout, spacing and copy tone unless the user asks for something new.',
      "It has 12 Storybook stories; read a component's story before you draw it.",
      'Copy the values you use into tokens.css with a comment naming the source file.',
      SYSTEM_GUIDANCE_ONLY,
      '',
      '',
    ].join('\n');
    assert.equal(layer, expected);
  });

  test('the header step 2 points at the files first, then components and screens', () => {
    const rules = buildRulesDoc(follows(), FILES);
    assert.ok(rules.includes("2. Read the project's design files FIRST (Precedence, layer 2), then its components and screens. Tell the user what you are following in 2 to 4 lines, citing files."));
  });

  test('layers 1, 3, 4 and 5 are those of a design with no system', () => {
    const plain = buildRulesDoc(baseContext({ project: scanned() }), FILES);
    const project = buildRulesDoc(follows(), FILES);
    assert.equal(project.slice(project.indexOf('### Layer 3')), plain.slice(plain.indexOf('### Layer 3')));
    assert.equal(project.slice(project.indexOf('### Layer 1'), project.indexOf('### Layer 2')), plain.slice(plain.indexOf('### Layer 1'), plain.indexOf('### Layer 2')));
    // No systemChoice row: the agent has nothing to record.
    assert.ok(!project.includes('`systemChoice`'));
  });

  test('without patterns only the files; one story is singular', () => {
    const none = layerTwo(buildRulesDoc(follows({ project: scanned({ patterns: noPatterns() }) }), FILES));
    assert.ok(!none.includes('Its components'));
    assert.ok(!none.includes('Its existing screens'));
    assert.ok(!none.includes('Storybook'));
    const one = layerTwo(buildRulesDoc(follows({ project: scanned({ patterns: { components: [], screens: [], stories: 1 } }) }), FILES));
    assert.ok(one.includes("It has 1 Storybook story; read a component's story before you draw it."));
  });

  test('a draft project system is named, and the agent is kept out of its folder', () => {
    const layer = layerTwo(buildRulesDoc(follows({}, { id: 'shop-ui', name: 'Shop UI' }), FILES));
    assert.ok(layer.includes("The project's design system Shop UI is still a draft, so it isn't linked. Follow the files above; don't read _systems/shop-ui/."));
  });

  test('an unreadable project keeps the unreadable text, under the follow heading', () => {
    const project = { ...noProject('the folder does not exist', PROJECT_DIR), state: 'unreadable' as const };
    const layer = layerTwo(buildRulesDoc(follows({ project }), FILES));
    assert.ok(layer.includes(FOLLOWS));
    assert.ok(layer.includes(`The project folder ${PROJECT_DIR} could not be read (the folder does not exist). Look at the project yourself.`));
    assert.ok(layer.includes(SYSTEM_GUIDANCE_ONLY));
  });

  test('a path from the project cannot break out of its code span', () => {
    const layer = layerTwo(buildRulesDoc(follows({ project: scanned({ patterns: { components: ['odd`name'], screens: [], stories: 0 } }) }), FILES));
    assert.ok(layer.includes('Its components live in: `` odd`name ``.'), layer);
  });
});

describe("RULES.md when the project's own system is linked", () => {
  const linked = (over: Partial<Extract<AgentSystem, { state: 'linked' }>> = {}): AgentSystem => ({
    state: 'linked', id: 'shop-ui', name: 'Shop UI', revision: 4, folder: '/home/you/Documents/Designs/pricing-page/system',
    complete: true, missing: [], overviewEmpty: false, breakpoints: [], repo: '/home/you/code/shop', ...over,
  });

  test('one sentence after the first line of layer 2 says why; without the mark the text is unchanged', () => {
    const own = buildRulesDoc(baseContext({ project: scanned(), system: linked({ ownedByProject: true }) }), FILES);
    const plain = buildRulesDoc(baseContext({ project: scanned(), system: linked() }), FILES);
    const sentence = "Design Chamber picked this system because it is shop's own design system.";
    assert.ok(own.includes(sentence));
    assert.ok(!plain.includes(sentence));
    assert.equal(own.replace(`\n\n${sentence}`, ''), plain);
    const layer = own.slice(own.indexOf("### Layer 2: this design's design system"));
    assert.ok(layer.indexOf(sentence) < layer.indexOf(SYSTEM_GUIDANCE_ONLY));
  });
});

describe('the chip when a design follows the project', () => {
  test('step 2 names at most two component and two screen folders and says to build it the way the project looks', () => {
    const chip = buildChipText(follows(), 'new');
    const step2 = chip.split('\n').find((line) => line.startsWith('2. ')) ?? '';
    assert.ok(step2.includes('Its components live in src/components, src/ui; its screens in app, src/views.'), step2);
    assert.ok(!step2.includes('packages/kit/components'));
    assert.ok(step2.includes('Build it the way the project already looks.'));
  });

  test('step 3 lists this project\'s design system and patterns as the second layer', () => {
    const step3 = buildChipText(follows(), 'new').split('\n').find((line) => line.startsWith('3. ')) ?? '';
    assert.ok(step3.includes("the user's words in this chat · this project's design system and patterns (step 2) · style preset (none chosen)"), step3);
  });

  test('a design that does not follow the project keeps the old step 2', () => {
    const plain = buildChipText(baseContext({ project: scanned() }), 'new');
    assert.ok(!plain.includes('Build it the way the project already looks.'));
    assert.ok(!plain.includes('Its components live in'));
  });

  test('stays under the chip cap with a long Windows root and long pattern paths', () => {
    const long = (i: number): string => `packages/${'very-long-folder-name/'.repeat(8)}components-${i}`;
    const context = follows({
      folder: `C:\\Users\\${'u'.repeat(40)}\\Documents\\Designs\\${'s'.repeat(63)}`,
      designsRoot: `C:\\${'r'.repeat(1000)}`,
      project: scanned({ directory: `D:\\${'p'.repeat(400)}`, patterns: { components: [long(1), long(2), long(3), long(4)], screens: [long(5), long(6), long(7), long(8)], stories: 999 } }),
    }, { id: 'x', name: 'X'.repeat(80) });
    const chip = buildChipText(context, 'new');
    assert.ok(chip.length <= CHIP_TEXT_HARD_MAX, `${chip.length} characters`);
  });
});

describe('the instructions note (§2.5)', () => {
  const FOLLOW_LINE = '- A new design for a project follows the project: its own design system if Design Chamber has one, else its design files, components and screens. Read them before you draw.';
  const TOOLS_LINE = "- To see the library, the user's pins and what they have open, use design_list and design_read.";

  test('the two lines come last', () => {
    const lines = buildInstructions({ root: '/home/you/Documents/Designs', platform: 'linux', checkCommand: null }).split('\n');
    assert.deepEqual(lines.slice(-2), [FOLLOW_LINE, TOOLS_LINE]);
  });

  test('a root too long for the full note drops the command clause first, then these two lines, then throws', () => {
    const root = `/home/you/${'a'.repeat(1014)}`;
    const text = buildInstructions({ root, platform: 'linux', checkCommand: `sh ${root}/.chamber/bin/dc check <slug>` });
    assert.ok(text.length <= SERVICE_INSTRUCTIONS_MAX, `${text.length} characters`);
    assert.ok(!text.includes(FOLLOW_LINE));
    assert.ok(text.includes('check it with the design_check tool.'));
    const middle = `/home/you/${'a'.repeat(700)}`;
    const kept = buildInstructions({ root: middle, platform: 'linux', checkCommand: `sh ${middle}/.chamber/bin/dc check <slug>` });
    assert.ok(kept.includes(FOLLOW_LINE) && !kept.includes('.chamber/bin/dc'), 'the command clause goes before these lines');
  });

  test('a long Windows root with its check command stays within the host limit', () => {
    const longWin = `C:\\Users\\you\\${'very-long-folder-name\\'.repeat(11)}Designs`;
    const command = `"${longWin}\\.chamber\\bin\\dc.cmd" check <slug>`;
    const text = buildInstructions({ root: longWin, platform: 'win32', checkCommand: command });
    assert.ok(text.length <= SERVICE_INSTRUCTIONS_MAX, `${text.length} characters`);
    assert.ok(text.includes(FOLLOW_LINE));
    assert.ok(text.includes(TOOLS_LINE));
  });
});
