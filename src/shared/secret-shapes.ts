// Text shaped like a secret, found in a generated living page (documentation/specs/phase-2-5-technical.md
// §5.11, rev 3). Pure: the generator, the state route and the CLI check (`dc check --system`) all run it.
// A hit is recorded by its kind and the entry it came from, never by its value, and is never logged
// with the match.
//
// T0 seam: the shapes are the contract (fixed by the spec); T14 fills `findSecretShapes`, which runs
// over the page's text and attribute values excluding `data:` URL payloads (base64 picture and font
// bytes would give false hits), at most `SECRET_SHAPES_MAX` hits.

import type { SecretShapeKind } from './types.ts';

const NOT_BUILT = 'This part of Design Chamber (design systems) is not built yet.';

/** High-confidence shapes only, each a fixed pattern with a word boundary (§5.11). No `g` flag: a shared regex keeps no `lastIndex` state; the scanner copies it with the flags it needs. */
export const SECRET_SHAPES: readonly { kind: SecretShapeKind; pattern: RegExp }[] = Object.freeze([
  { kind: 'aws-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/ },
  { kind: 'github-token', pattern: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/ },
  { kind: 'openai-style-key', pattern: /\bsk-(?:[A-Za-z0-9]+-)*[A-Za-z0-9_]{20,}\b/ },
  { kind: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { kind: 'google-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
]);

export type SecretShapeHit = { kind: SecretShapeKind; index: number };

export const findSecretShapes = (text: string): SecretShapeHit[] => {
  throw new Error(NOT_BUILT);
};
