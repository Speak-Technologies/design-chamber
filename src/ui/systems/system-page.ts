// One design system, open (Phase 2.5 U2, technical design §9.3). On the full-screen page: a header (back, name, status,
// Mark ready, Versions), the specimen board on a quiet stage with the ask bar under it, and a 360px panel of sections.
// In the rail (`surface: 'panel'`): the same system without value editing, as a compact view (board, section list,
// review, Mark ready, Continue in chat).
//
// Nothing here writes a file on its own: a value goes into the pending map and the board previews it; Save sends one
// edit request (version first, on the service's side); a stale stamp is refused and the user chooses what happens next.

import { mountBadge } from '@openchamber/sdk/ui';

import type { SystemEditResponse, SystemExportResponse } from '../../shared/api.ts';
import { sectionLabel } from '../../shared/agent/system-prompts.ts';
import { toServiceError } from '../../guest/service-client.ts';
import type { AskOutcome } from '../../guest/flows.ts';
import type { SystemArea, SystemDetail, SystemSection } from '../../shared/types.ts';
import { SYSTEM_SECTIONS, AREA_OF_SECTION } from '../../shared/system-json.ts';
import { reveal, toast, type ActionContext } from '../components/actions.ts';
import { createScope, errorText, h } from '../components/dom.ts';
import { attachMenu, banner, bannerWithActions, btn, iconBtn, loadingRow, openSheet, type BtnHandle } from '../components/kit.ts';
import { createAskBar, type AskBarHandle } from '../components/ask-bar.ts';
import { createNotices } from '../components/notices.ts';
import { systems } from '../components/systems-store.ts';
import { client, feed, guestHost, host } from '../guest.ts';
import { askResultText } from '../model/ask-bar-model.ts';
import { RESTORE_NOTICE_MS, SHORT_NOTICE_MS } from '../model/findability-model.ts';
import { folderName, plural, relativeTime } from '../model/format.ts';
import { systemNameProblem } from '../model/new-system-model.ts';
import type { Version } from '../model/restore-core.ts';
import {
  OLD_VERSION_SENTENCE,
  STALE_ACTION,
  previewVars,
  saveRequest,
  staleSentence,
  type PendingChange,
  type PendingMap,
} from '../model/system-edit-model.ts';
import {
  REVIEW_BUTTON,
  REVIEW_LABEL,
  areaGroups,
  entryLabel,
  entrySelector,
  firstEntryOf,
  homeLine,
  homeTitle,
  isCovered,
  livingPagePill,
  railHint,
  readyControl,
  readyNotice,
  reviewFoot,
  reviewProgress,
  sectionOfHit,
  screensSource,
  screensTabShown,
  sourceText,
  unreviewedSections,
  type PhoneView,
  type StageView,
} from '../model/system-page-model.ts';
import { RESYNC_NOTICE_MS } from '../model/resync-model.ts';
import { REGENERATING_LABEL, livingCard, previewTarget, type LivingActionId, type LivingRepoView } from '../model/living-page-model.ts';
import { driftLines, landedLine, readOnlyLine, repoHeaderLine, systemBanners, type BannerActionId, type BannerSpec } from '../model/system-home-model.ts';
import { viewingBanner } from '../model/versions-model.ts';
import { exportMenuEntry, exportOffered, renamedSentence } from '../model/token-export-model.ts';
import type { WallSelection } from '../wall/wall-types.ts';
import { renderLivingCard } from './living-card.ts';
import { mountLivingPreview, type LivingPreviewHandle } from './living-preview.ts';
import { paintRepoReview } from './repo-review.ts';
import { openResyncSheet, type ResyncApplied } from './resync-sheet.ts';
import { sendSystemMessage } from './system-ask.ts';
import { openExportSheet } from './export-sheet.ts';
import { mountBoard, type BoardHandle } from './system-board.ts';
import { createIconStore } from './system-icons.ts';
import { mountSystemScreens, type ScreensHandle } from './system-screens.ts';
import { mountSystemBuild, type SystemBuildHandle } from './system-build.ts';
import { renderSection, type SectionContext } from './section-panel.ts';
import { createSystemRestore, mountSystemVersions, type SystemRestore, type SystemVersionsHandle } from './system-versions.ts';

export type SystemPageOptions = {
  id: string;
  surface: 'page' | 'panel';
  actions: ActionContext;
  onBack: () => void;
  /** Where Back goes, when it is not the systems list (a chip or a tile opened this page from the library). */
  backTo?: 'library';
};

export type SystemPageHandle = {
  el: HTMLElement;
  /** Resolves `true` when the view may go away: nothing unsaved, or the user chose Save or Discard. */
  beforeLeave: () => Promise<boolean>;
  focus: () => void;
  /**
   * An open request named more than the page: `board` brings the board forward (and closes the preview), `preview` opens
   * the living page's preview frame. Waits for the system to load; says so quietly when there is no preview to show.
   */
  showTarget: (target: 'board' | 'preview') => void;
  dispose: () => void;
};

type LoadState = 'loading' | 'ready' | 'error' | 'gone';
type Viewing = { id: string; n: number; compare: boolean };

/** As long as a design's "Export saved" notice stays up. */
const EXPORT_NOTICE_MS = 15_000;

const REVIEW_DOT: Record<string, string> = { 'not-reviewed': 'Not reviewed', 'looks-good': 'Looks good', 'needs-work': 'Needs work' };

const statusBadge = (status: 'draft' | 'ready'): HTMLElement => {
  const holder = h('span', { class: 'dc-sys-badge' });
  mountBadge(holder, status === 'ready' ? { label: 'Ready', tone: 'success' } : { label: 'Draft', tone: 'neutral' });
  return holder;
};

const describeChange = (change: PendingChange): string => {
  switch (change.kind) {
    case 'token':
      return `${change.name} (${change.mode}): ${change.value}`;
    case 'type':
      return `${change.id} ${change.field}: ${change.value}`;
    case 'note':
      return `Note on ${change.id}: ${change.value}`;
    case 'purpose':
      return `Purpose of ${change.id}: ${change.value}`;
    case 'text':
      return `${change.file}: ${change.value}`;
    case 'remove':
      return `Remove ${change.name}`;
  }
};

export const mountSystemPage = (options: SystemPageOptions): SystemPageHandle => {
  const { id, surface } = options;
  const compact = surface === 'panel';
  const scope = createScope();
  const sheetHost = options.actions.host;

  let detail: SystemDetail | null = null;
  let load: LoadState = 'loading';
  let loadFailure = '';
  let section: SystemSection = 'overview';
  let selectedEntry: string | null = null;
  const expanded = new Set<SystemArea>();
  let pending: PendingMap = new Map();
  let editBase: SystemDetail | null = null;
  let saving = false;
  let viewing: Viewing | null = null;
  let renaming = false;
  let askingNote = false;
  let reviewBusy = false;
  let phoneView: PhoneView = 'board';
  /** The stage shows the specimen board or the system's screens (T13). */
  let stageView: StageView = 'board';
  /** The last detail whose `system.json` could be read: its screens stand in while the agent's write is half done. */
  let lastReadable: SystemDetail | null = null;
  let disposed = false;
  let versionsSheet: { close: () => void } | null = null;
  let versions: SystemVersionsHandle | null = null;
  let exportSheet: { close: () => void } | null = null;
  let loadTicket = 0;
  /** A repo-backed system's living page, as the service last described it. */
  let living: LivingRepoView | null = null;
  /** The Embed fonts switch was changed and the page is being generated again. */
  let regenerating = false;
  let regenTimer: ReturnType<typeof setTimeout> | null = null;
  let moreBanners = false;
  /** What an open request asked to see beyond the page, held until the system has loaded. */
  let wanted: 'board' | 'preview' | null = null;

  // ------------------------------------------------------------ the parts
  const notices = createNotices();
  const header = h('header', { class: compact ? 'dc-rail-head dc-syspg-head' : 'dc-syspg-top' });
  const panelScroll = h('div', { class: 'dc-syspg-scroll' });
  const panelFoot = h('div', { class: 'dc-syspg-foot' });
  const stage = h('div', { class: 'dc-syspg-stage' });
  const panel = h('aside', { class: 'dc-syspg-panel' }, panelScroll, panelFoot);
  const body = h('div', { class: 'dc-syspg-body' }, stage, panel);
  const mobile = h('div', { class: 'dc-syspg-mobile oc-segmented', role: 'group', 'aria-label': 'Show' });
  const el = h('div', { class: 'dc-syspg', 'data-surface': surface, 'data-phone-view': phoneView, 'data-state': 'loading' }, header, notices.el, body, compact ? null : mobile);

  const board: BoardHandle = mountBoard({
    id,
    name: () => detail?.name ?? 'Design system',
    onEntry: (entry) => {
      if (!detail) return;
      const target = sectionOfHit(detail, entry);
      if (target === null || entry === undefined) return;
      select(target, entry);
    },
    onState: () => undefined,
  });
  const icons = createIconStore(id, () => {
    if (!disposed && section === 'assets') paintPanel();
  });
  /** The board and the loaded screens both draw the system's files: a save, an undo, a restore or an agent turn redraws both. */
  const reloadStage = (): void => {
    board.reload();
    screens.reload();
  };
  const askLink = (): { sessionId: string | null; selectedId: string | null; selectedTitle: string | null } => {
    const selected = guestHost.session.get();
    return { sessionId: detail?.sessionId ?? null, selectedId: selected?.id ?? null, selectedTitle: selected?.title ?? null };
  };

  const afterSend = async (outcome: AskOutcome): Promise<AskOutcome> => {
    void reload();
    return outcome;
  };

  const askBar: AskBarHandle = createAskBar({
    surface: compact ? 'panel' : 'page',
    onSend: async (text, selection) => afterSend(await sendSystemMessage(id, { sessionId: detail?.sessionId ?? null }, { purpose: 'ask', text, ...(selection ? { entry: selection.key } : {}) })),
    onChipRemoved: () => {
      selectedEntry = null;
      board.focusEntry(null);
      paintPanel();
    },
    onLeave: () => (board.el.querySelector<HTMLElement>('iframe') ?? board.el).focus(),
  });

  const screens: ScreensHandle = mountSystemScreens({ id, compact, onBoard: () => setStageView('board') });
  // Built once and only relabelled, so a panel repaint never takes keyboard focus off the switch.
  const viewButtons = {
    board: h('button', { type: 'button', class: 'dc-syspg-view', 'aria-pressed': 'true', onClick: () => setStageView('board') }, 'Board'),
    screens: h('button', { type: 'button', class: 'dc-syspg-view', 'aria-pressed': 'false', onClick: () => setStageView('screens') }, 'Screens'),
  };
  const views = h('div', { class: 'dc-syspg-views oc-segmented', role: 'group', 'aria-label': 'Show on the stage', hidden: true }, viewButtons.board, viewButtons.screens);
  // The build strip floats over the board; with the switch on show it shares the switch's row instead (and wraps under it when
  // the rail is too narrow for both), so it never covers the switch.
  const buildHost = h('div', { class: 'dc-syspg-build' });
  const stageHead = h('div', { class: 'dc-syspg-stagehead' }, views, buildHost);
  stage.append(stageHead, board.el, screens.el, askBar.el);
  const build: SystemBuildHandle = mountSystemBuild({
    id,
    host: buildHost,
    compact,
    sessionId: () => detail?.sessionId ?? null,
    created: () => detail?.created ?? new Date().toISOString(),
    onOpenChat: () => void openChat(),
  });

  const preview: LivingPreviewHandle = mountLivingPreview({
    id,
    systemName: () => detail?.name ?? 'Design system',
    repo: () => (detail?.home.kind === 'repo' ? detail.home.label : 'the repo'),
    onClose: () => {
      delete el.dataset.previewing;
      paintPanel();
    },
  });
  askBar.el.before(preview.el);
  const buildingEl = h('div', { class: 'dc-syspg-built', hidden: true });
  stage.prepend(buildingEl);

  // ------------------------------------------------------------ small helpers
  /** Why values can't be edited. A repo's are read only and say so once, at the top of the panel, so theirs is empty. */
  const locked = (): string | null => {
    if (viewing) return OLD_VERSION_SENTENCE;
    if (!detail) return 'Loading';
    if (!detail.editable) return detail.home.kind === 'repo' ? '' : 'This system can’t be edited here right now.';
    return null;
  };
  const repoHome = (): Extract<SystemDetail['home'], { kind: 'repo' }> | null => (detail !== null && detail.home.kind === 'repo' ? detail.home : null);
  const localeOf = (): string => host.snapshot()?.locale ?? 'en';
  const dirty = (): boolean => pending.size > 0;
  const name = (): string => detail?.name ?? 'This design system';

  const syncAsk = (): void => {
    askBar.setLink(askLink());
    askBar.setViewing(viewing !== null);
    askBar.setQuiet(dirty());
  };

  const openChat = async (): Promise<void> => {
    if (!detail?.sessionId) {
      toast('info', 'This system has no chat yet. Send a message below to start one.');
      return;
    }
    try {
      await guestHost.client.openSession(detail.sessionId);
    } catch (error) {
      toast('error', `Couldn’t open the chat. ${errorText(error)}`);
    }
  };

  const continueChat = async (): Promise<void> => {
    try {
      const outcome = await sendSystemMessage(id, { sessionId: detail?.sessionId ?? null }, { purpose: 'continue' });
      toast('success', askResultText(outcome));
      void reload();
    } catch (error) {
      toast('error', errorText(error));
    }
  };

  // ------------------------------------------------------------ loading
  /** The living page's own description; the card keeps the last one when the service can't answer. */
  const loadLiving = async (system: SystemDetail): Promise<LivingRepoView | null> => {
    if (system.home.kind !== 'repo') return null;
    try {
      const view = await client.loadLivingPage(id);
      return view.home === 'repo' ? view : null;
    } catch {
      return living;
    }
  };
  const editingNow = (): boolean => document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('dc-sp-input') && panel.contains(document.activeElement);
  const reload = async (): Promise<void> => {
    loadTicket += 1;
    const mine = loadTicket;
    try {
      const next = await client.call('GET /systems/:id', { params: { id } });
      if (disposed || mine !== loadTicket) return;
      const nextLiving = await loadLiving(next);
      if (disposed || mine !== loadTicket) return;
      detail = next;
      icons.invalidate();
      living = nextLiving;
      load = 'ready';
      if (next.unreadable === null) lastReadable = next;
      screens.setDetail(screensSource(next, lastReadable));
      if (!isCovered(next, section) && !expanded.size) section = SYSTEM_SECTIONS.find((candidate) => isCovered(next, candidate)) ?? 'overview';
      expanded.add(AREA_OF_SECTION[section]);
    } catch (error) {
      if (disposed || mine !== loadTicket) return;
      const failure = toServiceError(error);
      if (failure.code === 'not-found') load = 'gone';
      else if (detail === null) {
        load = 'error';
        loadFailure = failure.message;
      } else toast('error', `Couldn’t refresh ${name()}. ${failure.message}`);
    }
    if (editingNow()) {
      // A value is being typed: repaint once the box loses focus, so a refresh never eats the words.
      panel.addEventListener('focusout', () => setTimeout(() => !disposed && paint(), 0), { once: true });
    } else paint();
    build.relink();
    applyWanted();
  };

  function setStageView(next: StageView): void {
    if (next === stageView) return;
    stageView = next;
    paintViews();
    if (next === 'screens') screens.focus();
  }

  const showBoard = (): void => {
    preview.close();
    setStageView('board');
    phoneView = 'board';
    el.dataset.phoneView = phoneView;
    paintMobile();
  };
  const applyWanted = (): void => {
    if (wanted === null || load === 'loading') return;
    const next = wanted;
    wanted = null;
    if (load !== 'ready' || !detail) return;
    if (next === 'board') return showBoard();
    if (living === null || previewTarget(living, detail) === null) {
      toast('info', 'There is no living page preview to show yet.');
      return showBoard();
    }
    openPreview();
  };

  // ------------------------------------------------------------ selecting
  function select(next: SystemSection, entry?: string): void {
    if (!detail) return;
    section = next;
    expanded.add(AREA_OF_SECTION[next]);
    selectedEntry = entry ?? firstEntryOf(detail, next);
    board.focusEntry(selectedEntry);
    if (entry !== undefined) {
      const label = entryLabel(detail, entry);
      const selection: WallSelection = {
        key: entry,
        element: { screen: null, viewport: 'board', anchor: { selector: entrySelector(entry), text: label.text, html: '', rect: { x: 0, y: 0, w: 0, h: 0 }, point: { x: 0, y: 0 } } },
        tag: label.tag,
        where: sectionLabel(next),
      };
      askBar.setSelection(selection);
    }
    askingNote = false;
    paintPanel();
    panelScroll.querySelector<HTMLElement>('[aria-current="true"][data-entry]')?.scrollIntoView({ block: 'nearest' });
  }

  // ------------------------------------------------------------ editing
  const propose = (key: string, change: PendingChange | null): void => {
    if (!detail) return;
    const next = new Map(pending);
    if (change === null) next.delete(key);
    else {
      if (editBase === null) editBase = detail;
      next.set(key, change);
    }
    pending = next;
    if (pending.size === 0) editBase = null;
    board.setPreview(previewVars(pending));
    syncAsk();
    paint();
  };

  const showEditNotice = (title: string, body: string, buttons: BtnHandle[], ttl?: number, tone: 'success' | 'error' | 'info' = 'success'): void => {
    if (buttons.length === 0) {
      notices.setTransient('edit', banner({ tone, title, body }), ttl);
      return;
    }
    const wrap = h('div', { class: 'dc-banner dc-restore-notice', 'data-actions': 'stack' });
    wrap.append(...bannerWithActions(tone, title, body === '' ? [] : [body], buttons.map((button) => button.el)));
    notices.setTransient('edit', wrap, ttl);
  };

  const undoEdit = async (editId: string): Promise<void> => {
    try {
      await client.call('POST /systems/:id/edits/:eid/undo', { params: { id, eid: editId }, body: {} });
      showEditNotice('Undone', '', [], SHORT_NOTICE_MS);
      await reload();
      reloadStage();
    } catch (error) {
      notices.setTransient('edit', banner({ tone: 'error', title: 'Couldn’t undo that', body: errorText(error) }));
    }
  };

  // ------------------------------------------------------------ re-sync
  /** A system kept in Design Chamber needs a code source to be re-read; a repo's reads its own folder. Only on the page: the rail has no actions. */
  const canResync = (): boolean => !compact && detail !== null && (detail.home.kind === 'repo' || detail.sources.code !== null);
  const resyncEntry = (): { id: string; label: string; disabled?: boolean; reason?: string } => {
    const repo = repoHome();
    const label = repo ? `Re-sync from ${repo.label}` : 'Re-sync from code';
    const reason = viewing ? OLD_VERSION_SENTENCE : dirty() ? 'Save or discard your changes first.' : repo !== null && !repo.readable ? `${repo.label} can’t be read right now.` : null;
    return reason === null ? { id: 'resync', label } : { id: 'resync', label, disabled: true, reason };
  };

  const resyncedNotice = (result: ResyncApplied): void => {
    const { response } = result;
    const buttons: BtnHandle[] = [];
    if (response.edit.undoable) {
      const undo = btn({
        label: 'Undo',
        variant: 'outline',
        size: 'xs',
        onClick: () => {
          undo.set({ loading: true });
          void undoEdit(response.edit.id);
        },
      });
      buttons.push(undo);
    }
    const ask = btn({
      label: 'Ask the agent to update notes',
      variant: 'outline',
      size: 'xs',
      onClick: () => {
        ask.set({ loading: true });
        void (async () => {
          try {
            const before = response.version?.id;
            const outcome = await sendSystemMessage(id, { sessionId: detail?.sessionId ?? null }, { purpose: 'resync-notes', ...(before ? { before } : {}) });
            toast('success', askResultText(outcome));
            ask.set({ loading: false, disabled: true });
            void reload();
          } catch (error) {
            ask.set({ loading: false });
            toast('error', errorText(error));
          }
        })();
      },
    });
    buttons.push(ask);
    // A repo's re-sync has no Undo: its own history is the way back, and the notice doesn't pretend otherwise.
    const body = response.edit.undoable || repoHome() !== null ? '' : (response.edit.detail ?? 'Restore “Before re-sync” from Versions to undo.');
    showEditNotice(result.sentence, body, buttons, RESYNC_NOTICE_MS);
  };

  function startResync(choose: { askFolder?: boolean } = {}): void {
    if (!detail || !canResync()) return;
    const applied = (result: ResyncApplied): void => {
      resyncedNotice(result);
      void reload().then(() => reloadStage());
    };
    const repo = repoHome();
    if (repo !== null) {
      const hasSnapshot = detail.snapshot !== null;
      const systemName = detail.name;
      openResyncSheet(sheetHost, {
        id,
        systemName,
        directory: repo.directory,
        title: hasSnapshot ? `Re-sync ${systemName} from ${repo.label}` : `Read ${systemName} from ${repo.label}`,
        subtitle: null,
        stampOf: (current) => current.snapshot?.treeHash ?? 'none',
        ...(choose.askFolder ? { askFolder: true } : {}),
        repoReview: (context) => paintRepoReview(context, { id, systemName, repo: repo.label, folder: repo.folder, hasSnapshot, onApplied: applied }),
        onApplied: applied,
      });
      return;
    }
    if (detail.sources.code === null) return;
    openResyncSheet(sheetHost, { id, systemName: detail.name, directory: detail.sources.code.directory, onApplied: applied });
  }

  // ------------------------------------------------------------ token export
  const exported = ({ path, renamed }: SystemExportResponse): void => {
    toast('success', `Saved to ${path}`, path);
    if (disposed) return;
    const changed = renamedSentence(renamed);
    const show = btn({ label: 'Show in folder', variant: 'outline', size: 'xs', onClick: () => void reveal(path) });
    const wrap = h('div', { class: 'dc-banner dc-restore-notice dc-export-notice', 'data-actions': 'stack' });
    wrap.append(...bannerWithActions('success', 'Export saved', [h('span', { class: 'dc-export-path' }, path), changed === null ? null : h('span', { class: 'dc-export-renamed' }, changed)], [show.el]));
    notices.setTransient('export', wrap, EXPORT_NOTICE_MS);
  };

  const openExport = (): void => {
    if (!detail) return;
    exportSheet?.close();
    exportSheet = openExportSheet(sheetHost, { id, systemName: detail.name, empty: detail.tokens.length === 0, onExported: exported });
  };

  // ------------------------------------------------------------ the agent, the folder, the living page
  const askAgent = async (purpose: 'living-page' | 'reconcile' | 'build-continue' | 'ask', extra: { text?: string } = {}): Promise<void> => {
    try {
      const outcome = await sendSystemMessage(id, { sessionId: detail?.sessionId ?? null }, { purpose, ...extra });
      toast('success', askResultText(outcome));
      void reload();
    } catch (error) {
      toast('error', errorText(error));
    }
  };

  const revealTarget = async (target: 'repo' | 'living-page'): Promise<void> => {
    try {
      await client.call('POST /reveal', { body: { system: id, target } });
    } catch (error) {
      toast('error', `Couldn’t open the folder. ${errorText(error)}`);
    }
  };

  const openPreview = (): void => {
    if (!detail || !living) return;
    const target = previewTarget(living, detail);
    if (target === null) return;
    setStageView('board');
    phoneView = 'board';
    el.dataset.phoneView = phoneView;
    el.dataset.previewing = 'true';
    paintMobile();
    preview.open(target);
  };

  const stopRegenerating = (): void => {
    regenerating = false;
    if (regenTimer !== null) clearTimeout(regenTimer);
    regenTimer = null;
  };

  const setEmbedFonts = async (checked: boolean): Promise<void> => {
    regenerating = true;
    if (regenTimer !== null) clearTimeout(regenTimer);
    regenTimer = setTimeout(() => {
      stopRegenerating();
      paintPanel();
    }, 20_000);
    paintPanel();
    try {
      await patch({ livingPage: { embedFonts: checked } });
      await reload();
    } catch (error) {
      stopRegenerating();
      toast('error', `Couldn’t change that. ${errorText(error)}`);
      paintPanel();
    }
  };

  const livingAction = (action: LivingActionId): void => {
    if (action === 'ask' || action === 'fix') void askAgent('living-page');
    else if (action === 'preview') openPreview();
    else void revealTarget('living-page');
  };

  const bannerAction = (action: BannerActionId): void => {
    if (action === 'choose-folder') startResync({ askFolder: true });
    else if (action === 'resync') startResync();
    else if (action === 'build-continue') void askAgent('build-continue');
    else if (action === 'ask-living') void askAgent('living-page');
    else if (detail?.landed?.sentence) void askAgent('ask', { text: `About what landed: “${detail.landed.sentence}”` });
  };

  const savedNotice = (answer: SystemEditResponse, body: string): void => {
    const buttons: BtnHandle[] = [];
    if (answer.edit.undoable) {
      const undo = btn({
        label: 'Undo',
        variant: 'outline',
        size: 'xs',
        onClick: () => {
          undo.set({ loading: true });
          void undoEdit(answer.edit.id);
        },
      });
      buttons.push(undo);
    }
    showEditNotice('Saved', body === '' ? answer.edit.label : body, buttons, RESTORE_NOTICE_MS);
  };

  const failedSave = (error: unknown): void => {
    const failure = toServiceError(error);
    if (failure.code === 'stale') {
      const again = btn({
        label: STALE_ACTION,
        variant: 'outline',
        size: 'xs',
        onClick: () => {
          again.set({ loading: true });
          void reload().then(() => {
            editBase = detail;
            reloadStage();
            notices.setTransient('edit', null);
          });
        },
      });
      showEditNotice(staleSentence(name()), '', [again], undefined, 'error');
      return;
    }
    showEditNotice('Nothing was saved', failure.message, [], undefined, 'error');
  };

  const save = async (): Promise<boolean> => {
    if (!detail || saving) return false;
    const request = saveRequest(pending, editBase ?? detail);
    if (!request) return true;
    saving = true;
    paintFoot();
    try {
      const answer = await client.call('POST /systems/:id/edits', { params: { id }, body: request });
      pending = new Map();
      editBase = null;
      board.setPreview([]);
      saving = false;
      syncAsk();
      paint();
      savedNotice(answer, '');
      await reload();
      reloadStage();
      return true;
    } catch (error) {
      saving = false;
      failedSave(error);
      paintFoot();
      return false;
    }
  };

  const reset = (): void => {
    pending = new Map();
    editBase = null;
    board.setPreview([]);
    syncAsk();
    paint();
  };

  const removeToken = (token: string): void => {
    if (!detail || saving) return;
    const stamp = detail.stamps.tokens;
    saving = true;
    void client
      .call('POST /systems/:id/edits', { params: { id }, body: { op: 'save', stamps: stamp ? { tokens: stamp } : {}, tokens: [{ kind: 'remove', name: token, mode: 'both' }] } })
      .then(async (answer) => {
        const next = new Map(pending);
        for (const [key, change] of next) if ((change.kind === 'token' && change.name === token) || (change.kind === 'note' && change.path === 'tokens' && change.id === token)) next.delete(key);
        pending = next;
        saving = false;
        savedNotice(answer, `Removed ${token}. Designs that copied ${name()} keep it.`);
        await reload();
        editBase = pending.size > 0 ? detail : null;
        board.setPreview(previewVars(pending));
        reloadStage();
      })
      .catch((error: unknown) => {
        saving = false;
        failedSave(error);
        paintFoot();
      });
  };

  // ------------------------------------------------------------ review, ready, rename
  const patch = async (body: Parameters<typeof client.call<'PATCH /systems/:id'>>[1] extends infer T ? (T extends { body: infer B } ? B : never) : never) => client.call('PATCH /systems/:id', { params: { id }, body });

  const setReview = async (target: SystemSection, state: 'looks-good' | 'needs-work' | 'not-reviewed', note?: string): Promise<void> => {
    reviewBusy = true;
    paintFoot();
    try {
      await patch({ review: { section: target, state, ...(note ? { note } : {}) } });
      await reload();
    } catch (error) {
      toast('error', `Couldn’t save that. ${errorText(error)}`);
    } finally {
      reviewBusy = false;
      paintFoot();
    }
  };

  const sendNeedsWork = async (target: SystemSection, note: string): Promise<void> => {
    reviewBusy = true;
    paintFoot();
    try {
      await patch({ review: { section: target, state: 'needs-work', ...(note.trim() ? { note: note.trim() } : {}) } });
      const outcome = await sendSystemMessage(id, { sessionId: detail?.sessionId ?? null }, { purpose: 'review', section: target });
      askingNote = false;
      toast('success', askResultText(outcome));
      await reload();
    } catch (error) {
      toast('error', errorText(error));
    } finally {
      reviewBusy = false;
      paint();
    }
  };

  const toggleReady = async (): Promise<void> => {
    if (!detail) return;
    const toReady = detail.status === 'draft';
    try {
      const answer = await patch({ status: toReady ? 'ready' : 'draft' });
      await reload();
      if (!toReady) {
        showEditNotice(`${name()} is back to a draft.`, '', [], SHORT_NOTICE_MS, 'info');
        return;
      }
      const note = readyNotice(name(), answer.readyNote?.unreviewed ?? 0);
      const buttons: BtnHandle[] = [];
      if (note.action && detail) {
        const first = unreviewedSections(detail)[0];
        if (first) buttons.push(btn({ label: note.action, variant: 'outline', size: 'xs', onClick: () => select(first) }));
      }
      showEditNotice(note.title, note.body, buttons, RESTORE_NOTICE_MS);
    } catch (error) {
      toast('error', `Couldn’t change the status. ${errorText(error)}`);
    }
  };

  const startRename = (): void => {
    if (!detail || renaming || viewing) return;
    renaming = true;
    const input = h('input', { class: 'oc-sdk-input dc-syspg-rename', type: 'text', 'aria-label': 'Design system name', autocomplete: 'off', spellcheck: 'false' });
    input.value = detail.name;
    const problem = h('p', { class: 'dc-form-error', role: 'alert', hidden: true });
    let finished = false;
    const finish = async (commit: boolean): Promise<void> => {
      if (finished) return;
      if (!commit || input.value.trim() === detail?.name) {
        finished = true;
        renaming = false;
        paintHeader();
        return;
      }
      const others = (systems().get().systems ?? []).filter((entry) => entry.id !== id);
      const sentence = systemNameProblem(input.value, others);
      if (sentence) {
        problem.textContent = sentence;
        problem.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      finished = true;
      try {
        await systems().rename(id, input.value.trim());
        await reload();
      } catch (error) {
        toast('error', errorText(error));
      }
      renaming = false;
      paintHeader();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        void finish(false);
      }
    });
    input.addEventListener('blur', () => {
      if (problem.hidden) void finish(true);
    });
    header.querySelector('.dc-syspg-titlewrap')?.replaceChildren(input, problem);
    input.focus();
    input.select();
  };

  // ------------------------------------------------------------ versions
  const setViewing = (next: Viewing | null): void => {
    viewing = next;
    board.setVersion(next?.id ?? null);
    screens.setVersion(next?.id ?? null);
    syncAsk();
    paint();
  };

  const restore: SystemRestore = createSystemRestore({
    id,
    notices,
    refresh: async () => {
      await reload();
      editBase = pending.size > 0 ? detail : null;
      reloadStage();
    },
    onRestored: () => {
      viewing = null;
      board.setVersion(null);
      screens.setVersion(null);
      syncAsk();
      paint();
      versions?.load().catch(() => undefined);
    },
    onBusy: () => versions?.refresh(),
    focusBoard: () => (board.el.querySelector<HTMLElement>('iframe') ?? board.el).focus(),
    onFailed: (version: Version) => versions?.focusRestore(version.id),
  });

  const openVersions = (): void => {
    if (versionsSheet) return;
    const sheet = openSheet(sheetHost, {
      title: 'Versions',
      variant: 'side',
      onClose: () => {
        versions?.dispose();
        versions = null;
        versionsSheet = null;
      },
    });
    versionsSheet = sheet;
    versions = mountSystemVersions({
      id,
      viewing: () => (viewing ? { id: viewing.id, compare: viewing.compare } : null),
      onView: (vid, n) => {
        setViewing({ id: vid, n, compare: false });
        versions?.refresh();
      },
      onCompare: (vid, n) => {
        setViewing({ id: vid, n, compare: true });
        versions?.refresh();
      },
      onBackToCurrent: () => {
        setViewing(null);
        versions?.refresh();
      },
      restoring: () => restore.busyId(),
      onRestore: (version) => restore.restore(version),
      ...(repoHome() ? { repo: repoHome()?.label ?? '' } : {}),
    });
    sheet.body.append(versions.el);
  };

  // ------------------------------------------------------------ painting
  function paintHeader(): void {
    if (renaming) return;
    header.replaceChildren();
    const back = compact
      ? iconBtn({ icon: 'back', label: options.backTo === 'library' ? 'Back to designs' : 'Back to design systems', onClick: () => void leave() })
      : btn({ label: options.backTo === 'library' ? 'Library' : 'Design systems', variant: 'ghost', size: 'default', icon: 'back', onClick: () => void leave() }).el;
    const titleText = detail?.name ?? 'Design system';
    const title = detail
      ? h('button', { type: 'button', class: 'dc-syspg-title', title: 'Rename', 'aria-label': `${titleText}. Rename`, onClick: () => startRename() }, titleText)
      : h('h1', { class: 'dc-syspg-title' }, titleText);
    const pencil = detail && !compact ? iconBtn({ icon: 'pencil', label: `Rename ${titleText}`, onClick: () => startRename() }) : null;
    const titleWrap = h('div', { class: 'dc-syspg-titlewrap' }, h('h1', { class: 'dc-syspg-h1' }, title), pencil, detail ? statusBadge(detail.status) : null, dirty() ? h('span', { class: 'dc-syspg-unsaved' }, 'Unsaved') : null);
    const repoLine = detail && !compact ? repoHeaderLine(detail) : null;
    const home = detail
      ? repoLine !== null
        ? h('p', { class: 'dc-syspg-home dc-muted', title: repoLine.title }, repoLine.text)
        : h('p', { class: 'dc-syspg-home dc-muted', title: homeTitle(detail) }, homeLine(detail, sourceText(detail.sources, folderName, (iso) => relativeTime(iso, Date.now(), localeOf()))))
      : null;
    const living = detail ? livingPagePill(detail) : null;
    const livingEl = living ? h('span', { class: 'dc-syspg-living', title: living.title }) : null;
    if (livingEl && living) mountBadge(livingEl, { label: living.label, tone: living.tone });
    const main = h('div', { class: 'dc-syspg-main' }, titleWrap, home, livingEl);
    const tools = h('div', { class: 'dc-syspg-tools' });
    if (detail) {
      const control = readyControl(detail);
      const ready = btn({
        label: control.label,
        variant: control.emphasis === 'primary' && !dirty() ? 'default' : 'outline',
        size: compact ? 'sm' : 'default',
        ...(control.emphasis === 'primary' && !dirty() ? { emphasis: 'primary' as const } : {}),
        disabled: viewing !== null,
        title: viewing ? OLD_VERSION_SENTENCE : undefined,
        onClick: () => void toggleReady(),
      });
      if (!compact) tools.append(ready.el);
      if (!compact && repoHome() !== null) tools.append(btn({ label: 'Reveal', variant: 'outline', size: 'default', icon: 'external', title: `Reveal ${repoHome()?.label ?? 'the repo'} in your file manager`, onClick: () => void revealTarget('repo') }).el);
      if (!compact) tools.append(btn({ label: 'Versions', variant: 'outline', size: 'default', icon: 'history', onClick: () => openVersions() }).el);
      const more = iconBtn({ icon: 'more', label: 'More', onClick: () => undefined });
      attachMenu(
        more,
        () => [
          { id: 'rename', label: 'Rename' },
          { id: 'chat', label: 'Continue in chat' },
          ...(canResync() ? [resyncEntry()] : []),
          ...(exportOffered(host.snapshot()) ? [exportMenuEntry({ viewing: viewing !== null, dirty: dirty(), unreadable: detail?.unreadable != null })] : []),
          ...(compact ? [{ id: 'versions', label: 'Versions' }] : []),
        ],
        (choice) => {
          if (choice === 'rename') startRename();
          else if (choice === 'chat') void continueChat();
          else if (choice === 'resync') startResync();
          else if (choice === 'export') openExport();
          else if (choice === 'versions') openVersions();
        },
      );
      tools.append(more);
    }
    header.append(back, main, tools);
  }

  const bannerOf = (spec: BannerSpec): HTMLElement =>
    banner({ tone: spec.tone, title: spec.title, body: spec.body, ...(spec.action ? { action: { label: spec.action.label, onClick: () => bannerAction((spec.action as { id: BannerActionId }).id) } } : {}) });

  function paintStatic(): void {
    const nodes: HTMLElement[] = [];
    if (detail) {
      // The "changed since you marked it ready" line is a repo page's banner; an internal page says it on its Ready button.
      const stack = systemBanners({ ...detail, changesToReview: detail.home.kind === 'repo' && detail.changesToReview }, { now: Date.now(), locale: localeOf(), secrets: living?.staged?.secrets ?? [] });
      const shown = stack.shown;
      const more = stack.more;
      nodes.push(...shown.map(bannerOf));
      if (more.length > 0) {
        const toggle = h(
          'button',
          { type: 'button', class: 'dc-banner-more-toggle', 'aria-expanded': String(moreBanners), 'aria-controls': 'dc-banner-more-body', onClick: () => { moreBanners = !moreBanners; paintStatic(); } },
          h('span', { class: 'dc-banner-more-chev', 'aria-hidden': 'true' }),
          `+${more.length} more`,
        );
        const rest = h('div', { class: 'dc-banner-more-body', id: 'dc-banner-more-body', hidden: !moreBanners }, ...more.map(bannerOf));
        nodes.push(h('div', { class: 'dc-banner-more' }, toggle, rest));
      }
      if (!detail.unreadable && detail.problems.length > 0) nodes.push(banner({ tone: 'warning', title: `${plural(detail.problems.length, 'entry', 'entries')} couldn’t be read`, body: detail.problems.slice(0, 3).map((problem) => problem.message).join(' ') }));
    }
    if (viewing) {
      nodes.push(banner({ tone: 'info', title: viewingBanner(viewing.n, viewing.compare), body: OLD_VERSION_SENTENCE, action: { label: 'Back to current', onClick: () => setViewing(null) } }));
    }
    notices.setStatic(nodes);
  }

  /** The repo page's Overview: the living-page card, then the drift and landed lines. Nothing for a system kept in Design Chamber. */
  function repoOverview(): HTMLElement | null {
    if (!detail || repoHome() === null) return null;
    const out = h('div', { class: 'dc-syspg-repo' });
    if (living !== null) {
      const card = livingCard(living, detail, { now: Date.now(), locale: localeOf(), regenerating, locked: viewing ? OLD_VERSION_SENTENCE : dirty() ? 'Save or discard your changes first.' : null });
      out.append(renderLivingCard(card, { onAction: livingAction, onEmbedFonts: (checked) => void setEmbedFonts(checked) }));
    }
    const drift = driftLines(detail);
    if (drift.sentence !== null || drift.agent !== null) {
      out.append(
        h(
          'div',
          { class: 'dc-syspg-drift', 'data-testid': 'drift' },
          drift.sentence === null ? null : h('p', { class: 'dc-syspg-drift-line' }, drift.sentence),
          drift.unread === null ? null : h('p', { class: 'dc-syspg-drift-line dc-muted' }, drift.unread),
          drift.agent === null ? null : h('p', { class: 'dc-syspg-drift-line dc-muted' }, drift.agent),
          drift.canReconcile ? h('div', { class: 'dc-syspg-drift-actions' }, btn({ label: 'Ask the agent to reconcile', variant: 'outline', size: 'sm', icon: 'chat', disabled: viewing !== null, onClick: () => void askAgent('reconcile') }).el) : null,
        ),
      );
    }
    const landed = landedLine(detail);
    if (landed !== null) {
      out.append(
        h(
          'div',
          { class: 'dc-syspg-landed', 'data-testid': 'landed' },
          h('p', { class: 'dc-syspg-drift-line' }, landed.sentence),
          h('div', { class: 'dc-syspg-drift-actions' }, btn({ label: landed.action, variant: 'outline', size: 'sm', icon: 'chat', onClick: () => bannerAction('ask-landed') }).el),
        ),
      );
    }
    return out;
  }

  /** The rail says only the living page's state; the one thing it can do is show the preview. */
  function railLiving(): HTMLElement | null {
    if (!detail || !living || repoHome() === null) return null;
    const target = previewTarget(living, detail);
    if (target === null) return null;
    return h('div', { class: 'dc-syspg-railliving' }, btn({ label: 'Preview living page', variant: 'outline', size: 'sm', icon: 'eye', onClick: () => openPreview() }).el);
  }

  function areasView(): HTMLElement {
    const root = h('div', { class: 'dc-syspg-areas' });
    if (!detail) return root;
    for (const group of areaGroups(detail)) {
      const open = expanded.has(group.area);
      const rowsId = `dc-syspg-rows-${group.area}`;
      const head = h(
        'button',
        {
          type: 'button',
          class: 'dc-syspg-area-head',
          'aria-expanded': String(open),
          'aria-controls': rowsId,
          onClick: () => {
            if (expanded.has(group.area)) expanded.delete(group.area);
            else expanded.add(group.area);
            paintPanel();
          },
        },
        h('span', { class: 'dc-syspg-chev', 'aria-hidden': 'true' }),
        h('span', { class: 'dc-syspg-area-name' }, group.label),
        h('span', { class: 'dc-syspg-area-meta dc-muted' }, group.meta),
      );
      const rows = h('ul', { class: 'dc-syspg-rows', id: rowsId, hidden: !open });
      for (const row of group.rows) {
        const current = row.section === section;
        rows.append(
          h(
            'li',
            null,
            h(
              'button',
              { type: 'button', class: 'dc-syspg-row', 'aria-current': current ? 'true' : null, 'aria-label': row.ariaLabel, 'data-focus-key': `row:${row.section}`, onClick: () => select(row.section) },
              h('span', { class: 'dc-syspg-row-name' }, row.label),
              h('span', { class: 'dc-syspg-row-count dc-muted' }, row.count),
              row.covered ? h('span', { class: 'dc-syspg-row-state', 'data-state': row.review, title: REVIEW_DOT[row.review] }, row.review === 'not-reviewed' ? '' : REVIEW_LABEL[row.review]) : null,
            ),
          ),
        );
      }
      root.append(h('section', { class: 'dc-syspg-area', 'data-area': group.area, 'data-covered': String(group.covered) }, head, rows));
    }
    return root;
  }

  const sectionContext = (current: SystemDetail): SectionContext => ({
    detail: current,
    pending,
    locked: locked(),
    selectedEntry,
    propose,
    removeToken,
    selectEntry: (entry) => select(section, entry),
    icons: () => icons.view((current.icons ?? []).map((icon) => icon.file)),
    retryIcons: () => icons.retry(),
  });

  /** The Board and Screens switch, and which of the two is on the stage. */
  function paintViews(building = load === 'ready' && detail !== null && repoHome() !== null && detail.snapshot === null): void {
    const shown = detail === null ? null : screensSource(detail, lastReadable);
    const showTabs = !building && load === 'ready' && shown !== null && screensTabShown(shown, stageView);
    if (!showTabs && stageView === 'screens' && (building || load !== 'ready')) stageView = 'board';
    el.dataset.stageView = stageView;
    el.dataset.views = String(showTabs);
    views.hidden = !showTabs;
    viewButtons.board.setAttribute('aria-pressed', String(stageView === 'board'));
    viewButtons.screens.setAttribute('aria-pressed', String(stageView === 'screens'));
    viewButtons.screens.textContent = shown !== null && shown.screens.length > 0 ? `Screens (${shown.screens.length})` : 'Screens';
    board.el.hidden = building || stageView !== 'board';
    screens.setActive(!building && stageView === 'screens');
  }

  /** A repo-backed system the agent hasn't stamped yet has no snapshot to draw: say where it is and offer the two ways on. */
  function paintStage(): void {
    const repo = repoHome();
    const building = load === 'ready' && detail !== null && repo !== null && detail.snapshot === null;
    buildingEl.hidden = !building;
    paintViews(building);
    buildingEl.replaceChildren();
    if (!building || detail === null || repo === null) return;
    const waiting = detail.proposal !== null && detail.proposal.state === 'current';
    const target = living !== null ? previewTarget(living, detail) : null;
    buildingEl.append(
      h('h2', { class: 'dc-syspg-built-title' }, 'Being built in chat'),
      h('p', { class: 'dc-muted' }, `${detail.name} will show here once the agent has written it to ${repo.label}.`),
      ...(waiting ? [h('p', { class: 'dc-syspg-built-wait' }, 'The agent is waiting for your answer in chat.')] : []),
      h(
        'div',
        { class: 'dc-syspg-built-actions' },
        btn({ label: 'Continue in chat', variant: 'outline', icon: 'chat', onClick: () => void continueChat() }).el,
        btn({ label: 'Re-sync', variant: 'outline', disabled: !canResync() || !repo.readable, title: repo.readable ? undefined : `${repo.label} can’t be read right now.`, onClick: () => startResync() }).el,
        ...(waiting && target !== null ? [btn({ label: 'Preview living page', variant: 'outline', icon: 'eye', onClick: () => openPreview() }).el] : []),
      ),
    );
  }

  function paintPanel(): void {
    paintStage();
    const scrollTop = panelScroll.scrollTop;
    const focused = document.activeElement instanceof HTMLElement && panel.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
    panelScroll.replaceChildren();
    el.dataset.state = load;
    if (load === 'loading') {
      panelScroll.append(loadingRow('Loading the design system…'));
    } else if (load === 'error') {
      panelScroll.append(
        h('div', { class: 'dc-sys-pagemsg' }, h('p', { class: 'dc-sys-pagemsg-title' }, 'The design system didn’t load'), h('p', { class: 'dc-muted' }, loadFailure || 'The local service didn’t answer.'), btn({ label: 'Try again', variant: 'outline', onClick: () => void reload() }).el),
      );
    } else if (load === 'gone') {
      const kept = [...pending.values()];
      panelScroll.append(
        h(
          'div',
          { class: 'dc-sys-pagemsg' },
          h('p', { class: 'dc-sys-pagemsg-title' }, `${name()} is gone`),
          h('p', { class: 'dc-muted' }, 'Its folder was moved or deleted. Check the trash in the Designs folder.'),
          kept.length > 0 ? h('div', null, h('p', { class: 'dc-muted' }, 'Your unsaved values, so you can copy them:'), h('ul', { class: 'dc-syspg-kept' }, ...kept.map((change) => h('li', { class: 'dc-mono' }, describeChange(change))))) : null,
          btn({ label: 'Back to design systems', variant: 'outline', icon: 'back', onClick: () => options.onBack() }).el,
        ),
      );
    } else if (detail) {
      const progress = reviewProgress(detail);
      const bar = h('span', { class: 'dc-syspg-progress', role: 'img', 'aria-label': progress.text });
      bar.style.setProperty('--dc-progress', `${progress.percent}%`);
      const readOnly = readOnlyLine(detail);
      panelScroll.append(
        h('div', { class: 'dc-syspg-panelhead' }, h('h2', { class: 'dc-syspg-panel-title' }, 'Sections'), h('span', { class: 'dc-muted' }, progress.text), bar),
        areasView(),
      );
      const readOnlyEl = readOnly === null ? null : h('p', { class: 'dc-syspg-readonly', 'data-testid': 'read-only' }, h('strong', null, readOnly.lead), ` ${readOnly.rest}`);
      const railEl = compact ? railLiving() : null;
      const areas = panelScroll.lastElementChild;
      if (readOnlyEl !== null) areas?.before(readOnlyEl);
      if (railEl !== null) areas?.before(railEl);
      if (!compact) {
        const editable = locked() === null;
        panelScroll.append(
          h(
            'div',
            { class: 'dc-syspg-detail' },
            h('div', { class: 'dc-syspg-detail-head' }, h('h3', { class: 'dc-syspg-detail-title' }, sectionLabel(section)), editable && isCovered(detail, section) ? h('span', { class: 'dc-muted dc-syspg-hint' }, 'Click a value to edit it.') : null),
            section === 'overview' ? repoOverview() : null,
            renderSection(sectionContext(detail), section),
          ),
        );
      }
    }
    panelScroll.scrollTop = scrollTop;
    if (focused) panelScroll.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focused)}"]`)?.focus();
    paintFoot();
  }

  function paintFoot(): void {
    panelFoot.replaceChildren();
    if (load !== 'ready' || !detail) return;
    if (dirty() && !compact) {
      const saveButton = btn({ label: 'Save', variant: 'default', size: 'sm', emphasis: 'primary', loading: saving, onClick: () => void save() });
      panelFoot.append(
        h(
          'div',
          { class: 'dc-syspg-editbar' },
          h('span', { class: 'dc-syspg-editcount' }, h('span', { class: 'dc-sp-dirty-dot', 'aria-hidden': 'true' }), `${plural(pending.size, 'unsaved change')}`),
          h('span', { class: 'dc-spacer' }),
          btn({ label: 'Reset', variant: 'ghost', size: 'sm', disabled: saving, onClick: () => reset() }).el,
          saveButton.el,
        ),
      );
    }
    const foot = reviewFoot(detail, section);
    // The rail's buttons and hint stay under every section, including one the system doesn't cover.
    const railFoot = (): void => {
      if (!compact || !detail) return;
      const control = readyControl(detail);
      panelFoot.append(
        h(
          'div',
          { class: 'dc-syspg-railactions' },
          btn({ label: control.label, variant: control.emphasis === 'primary' ? 'default' : 'outline', size: 'sm', ...(control.emphasis === 'primary' ? { emphasis: 'primary' as const } : {}), disabled: viewing !== null, onClick: () => void toggleReady() }).el,
          btn({ label: 'Continue in chat', variant: 'outline', size: 'sm', icon: 'chat', onClick: () => void openChat() }).el,
        ),
        ...(detail.home.kind === 'repo' ? [] : [h('p', { class: 'dc-muted dc-syspg-railhint' }, railHint(detail))]),
      );
    };
    if (foot.kind === 'uncovered') {
      railFoot();
      return;
    }
    const disabled = reviewBusy || viewing !== null;
    if (askingNote) {
      const note = h('textarea', { class: 'oc-sdk-input dc-syspg-note', rows: 3, 'aria-label': `What needs work in ${sectionLabel(section)}?`, placeholder: 'What needs work? (optional)', maxlength: 500 });
      panelFoot.append(
        h(
          'div',
          { class: 'dc-syspg-review', 'data-state': 'work' },
          h('p', { class: 'dc-syspg-review-text' }, `Tell the agent what to fix in ${sectionLabel(section)}.`),
          note,
          h(
            'div',
            { class: 'dc-syspg-review-actions' },
            btn({ label: 'Cancel', variant: 'ghost', size: 'sm', disabled: reviewBusy, onClick: () => { askingNote = false; paintFoot(); } }).el,
            btn({ label: 'Send to the agent', variant: 'default', size: 'sm', icon: 'send', loading: reviewBusy, onClick: () => void sendNeedsWork(section, note.value) }).el,
          ),
        ),
      );
      note.focus();
      return;
    }
    const actions = foot.actions.map((action) =>
      btn({
        label: REVIEW_BUTTON[action],
        variant: 'outline',
        size: 'sm',
        disabled,
        title: viewing ? OLD_VERSION_SENTENCE : undefined,
        onClick: () => {
          if (action === 'needs-work') {
            askingNote = true;
            paintFoot();
          } else void setReview(section, 'looks-good');
        },
      }).el,
    );
    panelFoot.append(
      h(
        'div',
        { class: 'dc-syspg-review', 'data-state': foot.kind === 'state' ? (foot.state === 'looks-good' ? 'good' : 'work') : 'ask' },
        h('p', { class: 'dc-syspg-review-text', 'aria-live': 'polite' }, foot.text),
        h('div', { class: 'dc-syspg-review-actions' }, ...actions),
      ),
    );
    railFoot();
  }

  function paintMobile(): void {
    if (compact) return;
    mobile.replaceChildren();
    for (const view of ['board', 'sections'] as const) {
      mobile.append(
        h(
          'button',
          {
            type: 'button',
            class: 'dc-syspg-mobile-btn',
            'aria-pressed': String(phoneView === view),
            onClick: () => {
              phoneView = view;
              el.dataset.phoneView = view;
              paintMobile();
            },
          },
          view === 'board' ? 'Board' : 'Sections',
        ),
      );
    }
  }

  function paint(): void {
    if (disposed) return;
    paintHeader();
    paintStatic();
    paintPanel();
    paintMobile();
    syncAsk();
  }

  // ------------------------------------------------------------ leaving
  const beforeLeave = (): Promise<boolean> => {
    if (!dirty() || load !== 'ready') return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (value: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const sheet = openSheet(sheetHost, { title: `Save your changes to ${name()}?`, variant: 'dialog', onClose: () => done(false) });
      const failure = h('p', { class: 'dc-form-error', role: 'alert', hidden: true });
      sheet.body.append(h('p', null, `You have ${plural(pending.size, 'unsaved change')}. A version of ${name()} is saved first, so you can go back.`), failure);
      const keep = btn({ label: 'Keep editing', variant: 'ghost', onClick: () => sheet.close() });
      const discard = btn({
        label: 'Discard',
        variant: 'outline',
        onClick: () => {
          done(true);
          sheet.close();
        },
      });
      const saveButton = btn({
        label: 'Save',
        variant: 'default',
        emphasis: 'primary',
        onClick: () => {
          saveButton.set({ loading: true });
          void save().then((ok) => {
            if (ok) {
              done(true);
              sheet.close();
            } else {
              saveButton.set({ loading: false });
              failure.textContent = 'Couldn’t save. Nothing was changed.';
              failure.hidden = false;
            }
          });
        },
      });
      sheet.foot.append(keep.el, discard.el, saveButton.el);
      saveButton.el.focus();
    });
  };

  async function leave(): Promise<void> {
    if (await beforeLeave()) options.onBack();
  }

  // ------------------------------------------------------------ live updates
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const stopFeed = feed.subscribe((batch) => {
    const mine = batch.events.filter((event) => event.system === id);
    if (!batch.reset && mine.length === 0) return;
    if (mine.some((event) => event.systemChange === 'removed')) {
      load = 'gone';
      paint();
      return;
    }
    if (regenerating && mine.some((event) => event.systemChange === 'living-page')) stopRegenerating();
    const files = mine.some((event) => event.systemChange === 'files' && event.origin !== 'user');
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      // The board and screens draw once the system is read again, so a half-written system.json is known before they ask.
      void reload().then(() => {
        if (files && viewing === null && !disposed) reloadStage();
      });
    }, 300);
  });
  const stopSession = guestHost.session.subscribe(() => syncAsk());

  scope.add(() => {
    disposed = true;
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    if (regenTimer !== null) clearTimeout(regenTimer);
    preview.dispose();
    stopFeed();
    stopSession();
    versionsSheet?.close();
    exportSheet?.close();
    restore.dispose();
    build.dispose();
    askBar.dispose();
    board.dispose();
    icons.dispose();
    screens.dispose();
    notices.dispose();
    el.remove();
  });

  paint();
  void reload();

  return {
    el,
    beforeLeave,
    focus: () => header.querySelector<HTMLElement>('button')?.focus(),
    showTarget: (target) => {
      wanted = target;
      applyWanted();
    },
    dispose: () => scope.dispose(),
  };
};

