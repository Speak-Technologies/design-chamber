// DirectionPick (documentation/specs/phase-1-5-sdk-2-7.md §U8): "Which direction?" with 2 to 4
// designs side by side, each its own folder. A click on a tile is the answer and starts the agent's
// next turn; the app adds its own note field under the block, and a note alone answers too. The
// tiles are a group of buttons named by the question: arrows move between them, Enter or Space picks.

import { mountSpinner } from '@openchamber/sdk/ui';

import { h } from '../components/dom.ts';
import { icon } from '../components/icons.ts';
import type { DirectionOption } from '../model/block-args.ts';
import { pickerView, type PickerState } from '../model/block-view-model.ts';
import { createPicker } from './block-data.ts';
import type { BlockContext, BlockView } from './block-view.ts';
import { mountPreview, type PreviewHandle } from './preview.ts';

export const REFUSED_TEXT = 'Couldn’t send your choice. Type it in the chat instead.';

type Tile = { el: HTMLButtonElement; spin: HTMLElement; mark: HTMLElement; missing: boolean };

export const mountDirectionPick = (root: HTMLElement, ctx: BlockContext, question: string, options: readonly DirectionOption[], answered: string | null): BlockView => {
  const previews: PreviewHandle[] = [];
  const tiles: Tile[] = [];
  const questionId = 'dcb-question';
  const group = h('div', { class: 'dcb-tiles', role: 'group', 'aria-labelledby': questionId, 'data-count': options.length });
  group.style.setProperty('--dcb-count', String(options.length));
  const caption = h('p', { class: 'dcb-caption', role: 'status', 'aria-live': 'polite' });
  let focusIndex = 0;

  const nameOf = (option: DirectionOption, tile: Tile): string => `${option.letter}: ${option.label}${tile.missing ? '. Not found in your Designs folder' : ''}`;

  const paint = (state: PickerState): void => {
    const view = pickerView(state, options);
    caption.textContent = view.caption;
    view.tiles.forEach((tileView, index) => {
      const tile = tiles[index];
      if (!tile) return;
      tile.el.setAttribute('aria-pressed', String(tileView.pressed));
      // aria-disabled, not disabled: an answered question stays readable and reachable by keyboard.
      tile.el.setAttribute('aria-disabled', String(tileView.disabled));
      tile.el.toggleAttribute('data-dimmed', tileView.dimmed);
      tile.el.setAttribute('aria-busy', String(tileView.busy));
      tile.spin.hidden = !tileView.busy;
      tile.mark.hidden = !tileView.pressed;
    });
    if (state.phase === 'answered' && state.picked !== null) focusIndex = state.picked;
    tiles.forEach((tile, index) => (tile.el.tabIndex = index === focusIndex ? 0 : -1));
  };

  const picker = createPicker((text) => ctx.host.answerBlock(text), options, paint);

  const onPick = (index: number): void => {
    // Called inside the click: the host takes an answer only with the user's activation.
    void picker.pick(index).then((outcome) => {
      if (typeof outcome === 'object') ctx.toast('error', REFUSED_TEXT);
    });
  };

  const moveFocus = (index: number): void => {
    const count = tiles.length;
    focusIndex = ((index % count) + count) % count;
    tiles.forEach((tile, i) => (tile.el.tabIndex = i === focusIndex ? 0 : -1));
    tiles[focusIndex]?.el.focus();
  };

  options.forEach((option, index) => {
    const spin = h('span', { class: 'dcb-tile-spin', hidden: true });
    mountSpinner(spin, { size: 'sm' });
    const mark = h('span', { class: 'dcb-tile-mark', hidden: true }, icon('check', 14));
    const el = h('button', { type: 'button', class: 'dcb-tile', title: `${option.label} (${option.slug})` });
    const tile: Tile = { el, spin, mark, missing: false };
    const preview = mountPreview({
      client: ctx.client,
      slug: option.slug,
      kind: null,
      onView: (view) => {
        tile.missing = view?.state === 'note' && view.reason === 'missing';
        el.setAttribute('aria-label', nameOf(option, tile));
      },
    });
    previews.push(preview);
    el.append(
      h('span', { class: 'dcb-tile-preview' }, preview.el, mark),
      h('span', { class: 'dcb-tile-head' }, h('span', { class: 'dcb-letter', 'aria-hidden': 'true' }, option.letter), h('span', { class: 'dcb-tile-label' }, option.label), spin),
    );
    el.addEventListener('click', () => onPick(index));
    el.addEventListener('focus', () => (focusIndex = index));
    tiles.push(tile);
    group.append(el);
  });

  group.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      moveFocus(focusIndex + step);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      moveFocus(event.key === 'Home' ? 0 : tiles.length - 1);
    }
  });

  root.replaceChildren(h('section', { class: 'dcb-block dcb-pick', 'aria-labelledby': questionId }, h('h2', { class: 'dcb-question', id: questionId }, question), group, caption));
  paint(picker.state());
  picker.restore(answered);

  return {
    update: (next) => picker.restore(next),
    dispose: () => {
      for (const preview of previews) preview.dispose();
      root.replaceChildren();
    },
  };
};
