// tokens.css, the pure half (Phase 2 technical design §4.2). T0 lands the one helper both
// design.json's knob validation and the bridge's set-tokens validator need; the tolerant CSS
// scanner (`scanTokens`, `readTweakValues`) is T5's work in this same file.
// No Node imports: the guests can import this file.

/**
 * True when a value holds an even count of `'` and an even count of `"`. An unbalanced quote
 * would open a string that swallows the declarations after it, so choice values and preview
 * values must pass this before they are written or set (§4.2).
 */
export const isBalancedQuotes = (value: string): boolean => {
  let single = 0;
  let double = 0;
  for (const char of value) {
    if (char === "'") single += 1;
    else if (char === '"') double += 1;
  }
  return single % 2 === 0 && double % 2 === 0;
};