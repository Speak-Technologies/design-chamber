// The design-warnings band: problems the service found in what the agent wrote to the open
// design (a folder it asked for that does not exist, a design system it could not copy, a bad
// design.json field). One calm line per warning, in the service's own words, above the wall.
//
// Mount it once per design view and call `set(detail.warnings)` on every new answer. It is a
// polite live region that exists from the start (a screen reader hears a line when it first
// appears), it never takes focus, and it takes no space while there is nothing to say.

import type { DesignWarning } from '../../shared/types.ts';
import { bandLabel, moreLabel, warningLines } from '../model/design-warnings-model.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';

export type DesignWarningsHandle = {
  /** The region: put it between the toolbar and the wall. */
  el: HTMLElement;
  /** Show these warnings (an empty list hides the band). The same list again changes nothing. */
  set: (warnings: readonly DesignWarning[]) => void;
  dispose: () => void;
};

export const mountDesignWarnings = (): DesignWarningsHandle => {
  const list = h('ul', { class: 'dc-warnings-list' });
  let expanded = false;
  let key = '';
  let lines: string[] = [];
  let shownCount = 0;

  const toggle = h('button', { type: 'button', class: 'dc-warnings-more', 'aria-expanded': 'false', hidden: true });
  const el = h('div', { class: 'dc-warnings', role: 'status', 'aria-live': 'polite', hidden: true }, list, toggle);

  // Which lines are visible follows `expanded`; the lines themselves are only rebuilt when the sentences change.
  const paintExpanded = (): void => {
    [...list.children].forEach((item, index) => {
      if (item instanceof HTMLElement) item.hidden = !expanded && index >= shownCount;
    });
    const more = lines.length - shownCount;
    toggle.hidden = more <= 0;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.textContent = moreLabel(more, expanded);
  };

  toggle.addEventListener('click', () => {
    expanded = !expanded;
    paintExpanded();
  });

  return {
    el,
    set: (warnings) => {
      const next = warningLines(warnings);
      const nextKey = JSON.stringify(next.all);
      if (nextKey === key) return;
      key = nextKey;
      lines = next.all;
      shownCount = next.shown.length;
      if (lines.length <= shownCount) expanded = false;
      list.replaceChildren(...lines.map((line) => h('li', { class: 'dc-warnings-line' }, icon('warning', 14), h('span', { class: 'dc-warnings-text' }, line))));
      el.hidden = lines.length === 0;
      if (lines.length > 0) el.setAttribute('aria-label', bandLabel(lines.length));
      else el.removeAttribute('aria-label');
      paintExpanded();
    },
    dispose: () => el.remove(),
  };
};
