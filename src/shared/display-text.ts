// Untrusted text that is about to be shown: file names, tool targets, design titles. All of it can
// come from an agent, so none of it may carry a character that breaks the line or reorders what the
// user reads. Pure, and safe in the guest, the service and the CLI.

/**
 * C0, DEL and C1; the line and paragraph separators; and every bidi control (the marks, embeddings,
 * overrides and isolates). Written as escapes on purpose: a raw one here would be invisible in review.
 */
const DISPLAY_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/**
 * `text` without those characters. Nothing else changes, and nothing is trimmed or cut. Tabs and
 * newlines are C0, so they are removed, not turned into spaces: flatten multi-line text first.
 */
export const stripDisplayControls = (text: string): string => text.replace(DISPLAY_CONTROLS, '');
