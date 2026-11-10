// DesignCard (documentation/specs/phase-1-5-sdk-2-7.md §U7): a design the agent finished, in its
// reply. Preview, title and kind, screens or viewports, the viewer's Checks badge, and Open / Comment,
// which open the rail viewer on it. On mount it only reads; the buttons are the first side effect.

import { mountBadge, mountButton, mountSpinner, type ButtonHandle, type Tone } from '@openchamber/sdk/ui';

import { openInRail } from '../../guest/flows.ts';
import type { OpenIntent } from '../../shared/api.ts';
import { errorText, h } from '../components/dom.ts';
import { cardView } from '../model/block-view-model.ts';
import type { BadgeTone } from '../model/checks-model.ts';
import { readCard, type CardRead } from './block-data.ts';
import { notice, type BlockContext, type BlockView } from './block-view.ts';
import { mountPreview, type PreviewHandle } from './preview.ts';

const TONES: Record<BadgeTone, Tone> = { success: 'success', warning: 'warning', error: 'error', neutral: 'neutral' };

export const GONE_TEXT = 'This design is no longer in your Designs folder.';

export const mountDesignCard = (root: HTMLElement, ctx: BlockContext, slug: string): BlockView => {
  let disposed = false;
  let preview: PreviewHandle | null = null;
  let generation = 0;

  const clear = (): void => {
    preview?.dispose();
    preview = null;
    root.replaceChildren();
  };

  const showGone = (): void => {
    clear();
    root.append(notice({ icon: 'folder', text: GONE_TEXT, detail: 'It may have been renamed or moved to the trash.' }));
  };

  const showError = (paused: boolean): void => {
    clear();
    root.append(
      notice(
        paused
          ? { icon: 'alert', text: 'Design Chamber is paused.', detail: 'Turn it back on in Settings → Extensions, then try again.', action: { label: 'Try again', onClick: load } }
          : { icon: 'alert', text: 'Design Chamber isn’t responding.', detail: 'It may still be starting.', action: { label: 'Try again', onClick: load } },
      ),
    );
  };

  /** Matches the ready card's layout, so nothing jumps when it arrives. */
  const showLoading = (): void => {
    clear();
    const spot = h('span', { class: 'dcb-preview-spin' });
    root.append(
      h(
        'article',
        { class: 'dcb-block dcb-card', 'data-state': 'loading', 'aria-busy': 'true', 'aria-label': 'Loading design' },
        h('div', { class: 'dcb-preview', 'data-state': 'loading', 'aria-hidden': 'true' }, spot),
        h(
          'div',
          { class: 'dcb-card-body', 'aria-hidden': 'true' },
          h('span', { class: 'dcb-skel', 'data-size': 'title' }),
          h('span', { class: 'dcb-skel', 'data-size': 'line' }),
          h('span', { class: 'dcb-skel', 'data-size': 'badge' }),
          h('span', { class: 'dcb-skel-actions' }, h('span', { class: 'dcb-skel', 'data-size': 'button' }), h('span', { class: 'dcb-skel', 'data-size': 'button' })),
        ),
      ),
    );
    mountSpinner(spot, { size: 'sm' });
  };

  const showReady = (read: Extract<CardRead, { state: 'ready' }>): void => {
    clear();
    const view = cardView(read.detail, read.checks);
    preview = mountPreview({ client: ctx.client, slug, kind: view.kind });

    const titleId = `dcb-title-${slug}`;
    const badgeSlot = h('span', { class: 'dcb-checks' });
    if (view.badge) {
      const visible = h('span', { 'aria-hidden': 'true', title: view.badge.ariaLabel });
      badgeSlot.append(visible, h('span', { class: 'dcb-sr' }, view.badge.ariaLabel));
      mountBadge(visible, { label: view.badge.label, tone: TONES[view.badge.tone] });
    }

    const openSlot = h('span', { class: 'dcb-action' });
    const commentSlot = h('span', { class: 'dcb-action' });
    const article = h(
      'article',
      { class: 'dcb-block dcb-card', 'data-state': 'ready', 'aria-labelledby': titleId },
      preview.el,
      h(
        'div',
        { class: 'dcb-card-body' },
        h('div', { class: 'dcb-card-head' }, h('h2', { class: 'dcb-card-title', id: titleId, title: read.detail.design.title }, view.title), h('span', { class: 'dcb-kind' }, view.kindLabel)),
        h('p', { class: 'dcb-card-line' }, view.detailLine),
        view.badge ? badgeSlot : null,
        h('div', { class: 'dcb-actions' }, openSlot, commentSlot),
      ),
    );
    root.append(article);

    let busy = false;
    const buttons: { open: ButtonHandle | null; comment: ButtonHandle | null } = { open: null, comment: null };
    const open = async (intent: OpenIntent): Promise<void> => {
      if (busy || disposed) return;
      busy = true;
      const mine = intent === 'view' ? buttons.open : buttons.comment;
      const other = intent === 'view' ? buttons.comment : buttons.open;
      mine?.update({ loading: true });
      other?.update({ disabled: true });
      try {
        const outcome = await openInRail({ client: ctx.client, host: ctx.host }, slug, intent);
        if (outcome === 'gone') {
          showGone();
          return;
        }
        if (outcome === 'not-here') ctx.toast('info', 'Open Design Chamber from the rail to see it.');
      } catch (error) {
        ctx.toast('error', `Couldn’t open the design. ${errorText(error)}`);
      } finally {
        busy = false;
        mine?.update({ loading: false });
        other?.update({ disabled: false });
      }
    };
    buttons.open = mountButton(openSlot, { label: 'Open', variant: 'default', size: 'sm', onClick: () => void open('view') });
    buttons.comment = mountButton(commentSlot, { label: 'Comment', variant: 'outline', size: 'sm', onClick: () => void open('comment') });
    openSlot.querySelector('button')?.setAttribute('data-emphasis', 'primary');
    openSlot.querySelector('button')?.setAttribute('aria-describedby', titleId);
    commentSlot.querySelector('button')?.setAttribute('aria-describedby', titleId);
  };

  function load(): void {
    const mine = ++generation;
    showLoading();
    void readCard(ctx.client, slug).then((read) => {
      if (disposed || mine !== generation) return;
      if (read.state === 'ready') showReady(read);
      else if (read.state === 'gone') showGone();
      else showError(read.paused);
    });
  }

  load();

  return {
    update: () => undefined,
    dispose: () => {
      disposed = true;
      clear();
    },
  };
};
