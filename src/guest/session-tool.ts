// The boundary reader for the `tool` a session record carries (documentation/specs/native-extras.md
// §1.2): the call running now, or the one that ended last while the agent thinks. The host shapes
// it, but the name comes from OpenCode and the target from the agent's own tool input, so both are
// untrusted text. The target is only ever shown: it is never opened, sent to the service or
// compared with the disk. Pure: no DOM, no host.

import { SESSION_TOOL_NAME_MAX, SESSION_TOOL_TARGET_MAX } from '../shared/limits.ts';

/** `target` is the file or folder the call names, as the host gave it; `null` when it names none. */
export type SessionTool = { name: string; target: string | null };

const NAME_PATTERN = /^[A-Za-z0-9_.:-]+$/;
/** C0, DEL, C1, and the two Unicode separators that would break a line. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

const readTarget = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const target = raw.replace(CONTROL_CHARS, '').trim();
  return target.length >= 1 && target.length <= SESSION_TOOL_TARGET_MAX ? target : null;
};

/** `null` when there is no usable name: older hosts leave `tool` out, and it is `null` off a running session. */
export const readSessionTool = (raw: unknown): SessionTool | null => {
  if (typeof raw !== 'object' || raw === null || !('name' in raw) || typeof raw.name !== 'string') return null;
  const name = raw.name.trim();
  if (name.length > SESSION_TOOL_NAME_MAX || !NAME_PATTERN.test(name)) return null;
  return { name, target: readTarget('target' in raw ? raw.target : null) };
};
