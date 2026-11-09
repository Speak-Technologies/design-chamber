// The ask bar's message: the user's own words, optionally about one element they selected on the
// wall. The host caps prompt text at 16 000 chars (F13), and the user's words are never cut: if
// the whole message is over, the element detail goes first (drop `html`, shorten the element
// `text`, drop the element block), and only then is the user told to shorten their message.
//
// The element comes from an agent-written page, so it is data: selector and html in code spans,
// text as one escaped line inside quotes (same stance as the revision prompt).

import { HOST_TEXT_MAX } from '../limits.ts';
import type { CommentAnchor, DesignKind, Screen, Viewport } from '../types.ts';
import { clip, codeSpan, oneLine, rulesPathOf } from './context.ts';
import { locationLabel } from './revision-prompt.ts';

export type AskPromptInput = {
  title: string;
  kind: DesignKind;
  /** Absolute design folder. */
  folder: string;
  screens: readonly Screen[];
  viewports: readonly Viewport[];
  /** What the user typed, already trimmed; kept verbatim. */
  text: string;
  /** The element the user attached, or null. */
  element: { screen: string | null; viewport: string; anchor: CommentAnchor } | null;
  /** Default `HOST_TEXT_MAX`. */
  maxChars?: number;
};

/** Even without the element the message does not fit; `over` is how many characters to remove. */
export class AskTooLongError extends Error {
  readonly over: number;
  constructor(over: number) {
    super(`The message is ${over} characters over the host limit.`);
    this.name = 'AskTooLongError';
    this.over = over;
  }
}

/** Element `text` is cut to this many characters at the last detail step. */
const SHORT_TEXT_MAX = 40;
const TITLE_MAX = 120;

type Detail = 'full' | 'no-html' | 'short';

const FOOTER = 'Change only what this asks; keep everything else. Update design.json "updated".';

const header = (input: AskPromptInput): string =>
  `[Design Chamber] Request about the ${input.kind} "${clip(oneLine(input.title), TITLE_MAX)}". Folder: ${input.folder}. Rules: ${rulesPathOf(input.folder)}`;

const elementLines = (input: AskPromptInput, detail: Detail): string[] => {
  const { element } = input;
  if (element === null) return [];
  const { anchor } = element;
  const text = oneLine(detail === 'short' ? clip(anchor.text, SHORT_TEXT_MAX) : anchor.text);
  const parts = [
    ...(text === '' ? [] : [`text: ${JSON.stringify(text)}`]),
    ...(detail === 'full' && anchor.html !== '' ? [`html: ${codeSpan(anchor.html)}`] : []),
  ];
  return [
    `About this element: ${locationLabel(input, element)}`,
    `   element: ${codeSpan(anchor.selector)}`,
    ...(parts.length > 0 ? [`   ${parts.join('  ')}`] : []),
  ];
};

const render = (input: AskPromptInput, detail: Detail | null): string =>
  [header(input), ...(detail === null ? [] : elementLines(input, detail)), input.text, FOOTER].join('\n');

/** The message for the chat, or `AskTooLongError` when the user's words alone do not fit. */
export const buildAskPrompt = (input: AskPromptInput): { text: string } => {
  const max = input.maxChars ?? HOST_TEXT_MAX;
  const steps: (Detail | null)[] = input.element === null ? [null] : ['full', 'no-html', 'short', null];
  for (const detail of steps) {
    const text = render(input, detail);
    if (text.length <= max) return { text };
  }
  throw new AskTooLongError(render(input, null).length - max);
};
