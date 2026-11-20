// The specimen board of one design system (Phase 2.5 U2, technical design §9.3): the service renders it as a
// page (`GET /systems/:id/board`), and it runs in the same sandboxed artboard frame a design does, never with
// `allow-same-origin`. The page reads the frame's messages as advice only: a click asks the frame which board
// entry is under the pointer (`hit-test`), a section chosen in the panel asks it to scroll to one (`resolve-anchors`
// then `scroll-to` and `highlight`), and the host theme and the pending edits reach it as `set-tokens`.
// Nothing here writes a file.

import { artboardIdOf, type FrameToPageMessage, type TokenVar } from '../../shared/bridge-protocol.ts';
import { TOKEN_PREVIEW_NAME_PATTERN, TOKEN_PREVIEW_VALUE_PATTERN, TOKEN_PREVIEW_VARS_MAX } from '../../shared/limits.ts';
import { h } from '../components/dom.ts';
import { btn, loadingRow } from '../components/kit.ts';
import { client, host } from '../guest.ts';
import { boardScheme, entrySelector } from '../model/system-page-model.ts';
import { setSlotTokens } from '../model/slot-seed.ts';
import { createFrameSlot, type SlotState } from '../wall/frame-slot.ts';

export type BoardHandle = {
  el: HTMLElement;
  state: () => SlotState;
  /** Load the board again (a revision landed, the scheme changed, "Try again"). The scroll position stays. */
  reload: () => void;
  /** Show an old version of the system (read only), or the live one with `null`. */
  setVersion: (versionId: string | null) => void;
  /** The pending edits, previewed on the board; `[]` clears them. */
  setPreview: (vars: readonly TokenVar[]) => void;
  /** Scroll to an entry and outline it (`null` clears the outline). */
  focusEntry: (entry: string | null) => void;
  dispose: () => void;
};

export type BoardOptions = {
  id: string;
  name: () => string;
  /** The user clicked an entry on the board (the key is the frame's advice: the caller checks it). */
  onEntry: (entry: string | undefined) => void;
  onState: (state: SlotState) => void;
};

const VIEWPORT = 'board';
const FILE = 'board.html';

/** The host's colours and type as the board's own variables, so it reads as part of OpenChamber in either theme. */
const themeVars = (): TokenVar[] => {
  const tokens = host.snapshot()?.theme.tokens;
  if (!tokens) return [];
  const wanted: Array<[string, string]> = [
    ['--dc-board-bg', tokens.background],
    ['--dc-board-card', tokens.elevated],
    ['--dc-board-fg', tokens.foreground],
    ['--dc-board-muted', tokens.muted],
    ['--dc-board-border', tokens.border],
    ['--dc-board-font', tokens.font],
    ['--dc-board-radius', tokens.radius],
  ];
  return wanted.filter(([name, value]) => TOKEN_PREVIEW_NAME_PATTERN.test(name) && TOKEN_PREVIEW_VALUE_PATTERN.test(value)).map(([name, value]) => ({ name, value }));
};

export const mountBoard = (options: BoardOptions): BoardHandle => {
  const key = `system:${options.id}`;
  let version: string | null = null;
  let preview: readonly TokenVar[] = [];
  let scheme = boardScheme(host.snapshot()?.theme.mode);
  let waiting: { entry: string } | null = null;
  let scrollTo: ((entry: string) => void) | null = null;
  let hit: { x: number; y: number } | null = null;

  const slot = createFrameSlot({
    slug: key,
    loadDoc: (_screen, versionId) => client.loadBoard(options.id, versionId, scheme),
    artboardId: artboardIdOf(null, VIEWPORT),
    title: `${options.name()} specimen board`,
    mode: () => 'edit',
    scroll: () => ({ x: 0, y: 0 }),
    onState: (state) => {
      paintState();
      options.onState(state);
    },
  });
  slot.iframe.classList.add('dc-sys-frame');

  const overlay = h('div', { class: 'dc-sys-hit', 'aria-hidden': 'true' });
  const status = h('div', { class: 'dc-sys-board-state' });
  const el = h('div', { class: 'dc-sys-board', 'data-state': 'idle' }, slot.iframe, overlay, status);

  const vars = (): TokenVar[] => [...themeVars(), ...preview].slice(0, TOKEN_PREVIEW_VARS_MAX);
  const sendTokens = (): void => {
    const all = vars();
    setSlotTokens(key, all);
    slot.post({ type: 'set-tokens', vars: all });
  };

  const load = (): void => {
    setSlotTokens(key, vars());
    void slot.load(null, version, FILE);
  };

  function paintState(): void {
    const state = slot.state();
    el.dataset.state = state;
    status.replaceChildren();
    if (state === 'loading' || state === 'idle') status.append(loadingRow('Loading the board…'));
    else if (state === 'missing' || state === 'error') {
      status.append(
        h('p', { class: 'dc-sys-board-message' }, state === 'missing' ? 'The board isn’t ready yet.' : 'The board didn’t load.'),
        h('p', { class: 'dc-muted' }, slot.error() ?? 'Try again in a moment.'),
        btn({ label: 'Try again', variant: 'outline', size: 'sm', onClick: () => load() }).el,
      );
    }
  }

  const unsubscribe = slot.channel.subscribe((message: FrameToPageMessage) => {
    if (message.type === 'ready') {
      sendTokens();
      if (waiting) scrollTo?.(waiting.entry);
    } else if (message.type === 'hit') {
      if (!hit || hit.x !== message.x || hit.y !== message.y) return;
      hit = null;
      options.onEntry(message.element?.entry ?? undefined);
    } else if (message.type === 'anchors') {
      const found = message.results.find((result) => result.id === 'entry' && result.found && result.rect);
      if (found?.rect) slot.post({ type: 'scroll-to', x: 0, y: Math.max(0, Math.round(found.rect.y) - 72) });
    }
  });

  scrollTo = (entry) => {
    const selector = entrySelector(entry);
    slot.post({ type: 'resolve-anchors', anchors: [{ id: 'entry', selector, text: '', html: '' }] });
    slot.post({ type: 'highlight', selector });
  };

  overlay.addEventListener('click', (event) => {
    if (slot.state() !== 'ready') return;
    const rect = slot.iframe.getBoundingClientRect();
    hit = { x: Math.round(event.clientX - rect.left), y: Math.round(event.clientY - rect.top) };
    slot.post({ type: 'hit-test', x: hit.x, y: hit.y });
  });
  overlay.addEventListener(
    'wheel',
    (event) => {
      if (slot.state() !== 'ready' || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      slot.post({ type: 'scroll-by', dx: Math.round(event.deltaX), dy: Math.round(event.deltaY) });
    },
    { passive: false },
  );

  // The scheme follows the host: a switch loads the board again in the other one; a colour change in the same scheme only moves the variables.
  const stopReady = host.onReady((context) => {
    const next = boardScheme(context.theme.mode);
    if (next !== scheme) {
      scheme = next;
      load();
    } else if (slot.state() === 'ready') sendTokens();
  });

  paintState();
  load();

  return {
    el,
    state: () => slot.state(),
    reload: () => load(),
    setVersion: (next) => {
      version = next;
      load();
    },
    setPreview: (next) => {
      preview = next;
      if (slot.state() === 'ready') sendTokens();
      else setSlotTokens(key, vars());
    },
    focusEntry: (entry) => {
      if (entry === null) {
        waiting = null;
        slot.post({ type: 'highlight', selector: null });
        return;
      }
      waiting = { entry };
      if (slot.state() === 'ready') scrollTo?.(entry);
    },
    dispose: () => {
      unsubscribe();
      stopReady();
      slot.dispose();
      setSlotTokens(key, []);
      el.remove();
    },
  };
};
