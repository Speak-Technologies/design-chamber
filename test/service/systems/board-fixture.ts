// A design system touching every board section that existed before the coverage areas (T6), plus the
// two S8 sections. Shared by the board snapshot test (old sections byte-identical, T11) and the
// specimen renderer tests.

import { buildSystemDetail, parseSystemState } from '../../../src/shared/system-json.ts';
import type { SystemDetail } from '../../../src/shared/types.ts';

const NOW = '2026-11-20T10:00:00.000Z';

const TOKENS_CSS = `:root {
  --brand: #1a73e8;
  --surface: #ffffff;
  --ink: #1d1d1f;
  --line: #d8d8dc;
  --ok: #188038;
  --chart-1: #8430ce;
  --misc: #abcdef;
  --font-sans: "Inter", sans-serif;
  --space-2: 8px;
  --space-4: 16px;
  --radius-md: 6px;
  --shadow-1: 0 1px 2px rgb(0 0 0 / 0.2);
  --z-base: 1;
  --z-modal: 100;
  --container: 1200px;
  --bp-tablet: 768px;
  --duration-fast: 120ms;
}
@media (prefers-color-scheme: dark) {
  :root { --brand: #8ab4f8; --surface: #121212; --ink: #ececef; }
}
`;

export const BOARD_FIXTURE_JSON = {
  tokens: {
    '--brand': { group: 'brand', note: 'Primary actions.\nNever body text.' },
    '--surface': { group: 'surface' },
    '--ink': { group: 'text' },
    '--line': { group: 'border' },
    '--ok': { group: 'status' },
    '--chart-1': { group: 'data' },
    '--ghost': { note: 'Gone from tokens.css.' },
  },
  type: [
    { id: 'body', name: 'Body', family: 'var(--font-sans)', size: '16px', weight: '400', lineHeight: '1.5', note: 'Paragraphs.' },
    { id: 'eyebrow', name: 'Eyebrow', family: 'Inter', size: '12px', weight: '600', letterSpacing: '0.08em', case: 'upper' },
  ],
  fonts: [
    { file: 'assets/fonts/inter.woff2', family: 'Inter', weight: 400 },
    { file: 'assets/fonts/broken.woff2', family: 'Broken', weight: 700, style: 'italic' },
  ],
  logos: [
    { file: 'assets/logos/mark.svg', variant: 'mark', note: 'On light grounds only.' },
    { file: 'assets/logos/word.png', variant: 'primary' },
  ],
  components: [
    { id: 'button', name: 'Button', purpose: 'Starts an action.', note: 'One primary per view.', variants: ['primary', 'secondary'], states: ['hover'], tokens: ['--brand', '--missing'], source: 'src/Button.tsx', example: 'components/button.html' },
    { id: 'card', name: 'Card', example: 'components/card.html' },
    { id: 'chip', name: 'Chip' },
  ],
  notes: [{ id: 'history', title: 'Why the palette changed' }],
  sources: [{ file: 'sources/brand-guide.pdf', note: '2025 brand book.' }],
  patterns: [
    { id: 'empty-states', kind: 'layout', title: 'Empty states', note: 'Always one action.' },
    { id: 'voice', kind: 'voice', title: 'Voice and tone' },
  ],
  brand: [{ id: 'hero', kind: 'marketing', title: 'Marketing heroes', note: 'One photo, no gradients.' }],
};

export const boardFixture = (json: Record<string, unknown> = BOARD_FIXTURE_JSON): SystemDetail =>
  buildSystemDetail({
    id: 'acme',
    dir: '/tmp/_systems/acme',
    state: { ...parseSystemState({}, 'acme', NOW), name: 'Acme' },
    systemJson: JSON.stringify(json),
    tokensCss: TOKENS_CSS,
    texts: {
      'OVERVIEW.md': 'Calm and clear.\n\nSecond paragraph.',
      'notes/history.md': 'The old blue failed contrast.',
      'patterns/voice.md': 'Plain words.\n\nNo exclamation marks. <b>never markup</b>',
      'brand/hero.md': 'Shot in daylight.',
    },
    files: [
      { rel: 'assets/fonts/inter.woff2', bytes: 10 },
      { rel: 'assets/fonts/broken.woff2', bytes: 10 },
      { rel: 'assets/logos/mark.svg', bytes: 10 },
      { rel: 'assets/logos/word.png', bytes: 10 },
      { rel: 'components/button.html', bytes: 10 },
      { rel: 'components/card.html', bytes: 10 },
      { rel: 'sources/brand-guide.pdf', bytes: 2048 },
    ],
    build: null,
  });
