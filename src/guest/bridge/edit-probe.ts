// What the bridge reports about the element under an edit-probe point (Phase 2 technical
// design §3.1). Pure over the same minimal element interface as `anchor.ts`, so it runs in the
// design frame and in unit tests. The answer is advisory: the page uses it to find the element
// in the source the service reads, and it can only make "Edit text" unavailable, never write.

import type { EditProbe } from '../../shared/bridge-protocol.ts';
import { BRIDGE_TAG_MAX, EDIT_PROBE_ID_MAX, EDIT_PROBE_SCAN_MAX, TEXT_EDIT_MAX } from '../../shared/limits.ts';
import { normalizeText, type AnchorElement } from './anchor.ts';
import { tagNameOf } from './selector.ts';

export interface ProbeElement extends AnchorElement {
  readonly parentElement: ProbeElement | null;
  readonly children: ArrayLike<ProbeElement>;
}

/** A DOM `Document` satisfies it. */
export interface ProbeRoot<E extends ProbeElement> {
  getElementsByTagName(tag: string): ArrayLike<E>;
}

/** The probe without the parts only a browser can measure (`dir`, `rect`); the bridge adds those. */
export type EditProbeCounts = Omit<EditProbe, 'dir' | 'rect'>;

/** Elements the source scanner treats as foreign or inert content, never as editable text. */
const OUTSIDE_TEXT = new Set(['svg', 'math', 'template']);

const isOutsideText = (element: ProbeElement): boolean => {
  for (let current: ProbeElement | null = element; current; current = current.parentElement) {
    if (OUTSIDE_TEXT.has(tagNameOf(current).toLowerCase())) return true;
  }
  return false;
};

const isOverlay = (element: ProbeElement): boolean => element.getAttribute('data-dc-overlay') !== null;

/**
 * The probe for `element`, or null when the answer could not describe it faithfully: the
 * overlay, a tag longer than `BRIDGE_TAG_MAX`, or an id that is empty or longer than
 * `EDIT_PROBE_ID_MAX`. (Reporting such an id as "none" would let the source locator pick a
 * different element that has no id and the same text.)
 *
 * `sameCount` counts the leaves of the same tag with the same id (or both none) and the same
 * normalised text, outside svg, math and template content, in document order; `sameIndex` is
 * this element's place among them. Both are 0 when the element is not one of them itself, or
 * when the tag has more than `scanMax` elements (not counted).
 */
export const editProbeOf = <E extends ProbeElement>(element: E, root: ProbeRoot<E>, scanMax: number = EDIT_PROBE_SCAN_MAX): EditProbeCounts | null => {
  if (isOverlay(element)) return null;
  const tagName = tagNameOf(element);
  const tag = tagName.toLowerCase();
  if (tag === '' || tag.length > BRIDGE_TAG_MAX) return null;
  const id = element.getAttribute('id');
  if (id !== null && (id === '' || id.length > EDIT_PROBE_ID_MAX)) return null;

  const fullText = normalizeText(element.textContent ?? '');
  const truncated = fullText.length > TEXT_EDIT_MAX;
  const leaf = element.children.length === 0;
  const probe: EditProbeCounts = {
    tag,
    id,
    leaf,
    text: truncated ? fullText.slice(0, TEXT_EDIT_MAX + 1) : fullText,
    truncated,
    sameIndex: 0,
    sameCount: 0,
  };

  const isSame = (other: E): boolean =>
    other.children.length === 0 &&
    other.getAttribute('id') === id &&
    !isOverlay(other) &&
    !isOutsideText(other) &&
    normalizeText(other.textContent ?? '') === fullText;

  if (!leaf || !isSame(element)) return probe;
  const candidates = root.getElementsByTagName(tagName);
  if (candidates.length > scanMax) return probe;
  let index = -1;
  let count = 0;
  for (let at = 0; at < candidates.length; at += 1) {
    const other = candidates[at];
    if (!other || !isSame(other)) continue;
    if (other === element) index = count;
    count += 1;
  }
  // The element itself is always among the candidates in a real document; if a fake root
  // misses it, not counted is the honest answer.
  return index === -1 ? probe : { ...probe, sameIndex: index, sameCount: count };
};
