// A system written before the builder-depth contract (documentation/specs/system-builder-depth.md §4.3):
// no depth, pairs, sizes, outOfScope or pattern and brand examples. `old-system-detail.json` is its
// detail and section fingerprints as the 0.7.0 reader (`68bc8a8`) produced them, so the new reader can
// be held to "reads the same, plus empty new fields".

import { parseSystemState, type SystemDetailSource } from '../../../src/shared/system-json.ts';

const NOW = '2026-11-19T10:00:00.000Z';

const tokensCss = [
  ':root {',
  '  --bg: #ffffff;',
  '  --surface: #f6f6f4;',
  '  --fg: #1b1b1b;',
  '  --accent: #2456d6;',
  '  --accent-fg: #ffffff;',
  '  --on-brand: #ffffff;',
  '  --brand: #c2410c;',
  '  --success: #15803d;',
  '  --space-2: 8px;',
  '  --space-4: 16px;',
  '  --radius-md: 8px;',
  '  --shadow-1: 0 1px 2px rgb(0 0 0 / 0.2);',
  '  --z-modal: 100;',
  '  --control-md: 40px;',
  '}',
  '@media (prefers-color-scheme: dark) {',
  '  :root { --bg: #111111; --fg: #f2f2f2; --accent: #7aa2ff; }',
  '}',
  '',
].join('\n');

const systemJson = JSON.stringify({
  schema: 'design-chamber/system@1',
  tokens: {
    '--bg': { group: 'surface', note: 'Page ground.' },
    '--surface': { group: 'surface' },
    '--fg': { group: 'text' },
    '--accent': { group: 'brand', note: 'Primary actions.' },
    '--accent-fg': { group: 'text' },
    '--brand': { group: 'brand' },
    '--on-brand': { group: 'text' },
    '--success': { group: 'status' },
  },
  type: [
    { id: 'body', name: 'Body', family: 'Inter', size: '16px', weight: 400, lineHeight: '1.5' },
    { id: 'heading', name: 'Heading', size: '28px', weight: 600, case: 'none', note: 'Page titles.' },
  ],
  fonts: [{ file: 'assets/fonts/inter.woff2', family: 'Inter', weight: 400 }],
  logos: [{ file: 'assets/logos/mark.svg', variant: 'mark', note: 'Small spaces.' }],
  components: [
    { id: 'button', name: 'Button', purpose: 'Actions.', variants: ['primary', 'ghost'], states: ['hover', 'disabled'], tokens: ['--accent'], example: 'components/button.html', layout: 'compact' },
    { id: 'card', name: 'Card', tokens: ['--surface', '--missing'] },
  ],
  notes: [{ id: 'history', title: 'History' }],
  patterns: [
    { id: 'voice', kind: 'voice', title: 'Voice', note: 'Plain words.' },
    { id: 'grid', kind: 'layout', title: 'Grid', layout: 'full' },
  ],
  brand: [{ id: 'hero', kind: 'marketing', title: 'Heroes' }],
  coverage: ['foundations', 'components', 'patterns', 'brand'],
  layout: { colours: 'compact' },
  futureKey: { kept: true },
});

const files = [
  { rel: 'system.json', bytes: systemJson.length },
  { rel: 'tokens.css', bytes: tokensCss.length },
  { rel: 'OVERVIEW.md', bytes: 20 },
  { rel: 'assets/fonts/inter.woff2', bytes: 1000 },
  { rel: 'assets/logos/mark.svg', bytes: 200 },
  { rel: 'components/button.html', bytes: 120 },
  { rel: 'notes/history.md', bytes: 10 },
  { rel: 'patterns/voice.md', bytes: 12 },
];

export const OLD_SYSTEM_HASHES: Record<string, string> = {
  'assets/fonts/inter.woff2': '1'.repeat(64),
  'assets/logos/mark.svg': '2'.repeat(64),
  'components/button.html': '3'.repeat(64),
};

export const oldSystemSource = (): SystemDetailSource => ({
  id: 'acme',
  dir: '/designs/_systems/acme',
  state: parseSystemState({ name: 'Acme', created: NOW, updated: NOW }, 'acme', NOW),
  systemJson,
  tokensCss,
  texts: { 'OVERVIEW.md': 'Calm and plain.', 'notes/history.md': 'Why.', 'patterns/voice.md': 'Short words.' },
  files,
  build: null,
  hashes: OLD_SYSTEM_HASHES,
});
