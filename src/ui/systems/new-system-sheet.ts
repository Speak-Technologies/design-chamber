// The New design system sheet (Phase 2.5 U1, technical design §9.3; Phase 2.6 E2, §6.6): a name, what to start
// from (project code, brand files, a description, an existing design system; any mix but code and existing exclude
// each other), and which chat the agent works in. It makes an internal design system, or registers a folder that
// already holds a complete one as a read-only repo-backed Draft; the rest of the repo-backed ones come from
// /design-system. Nothing is written until the footer button; every failure keeps what the user typed. A problem
// after the system exists (a refused file, a request that didn't reach a chat) is shown as a result with its own
// way forward, never as a lost sheet.

import { mountBadge, mountCheckbox, mountSelect, mountSpinner, mountTabs, mountTextField, type CheckboxHandle, type SelectHandle, type TextFieldHandle } from '@openchamber/sdk/ui';

import type { CreateSystemScanBody, ScanSummary, SystemCandidate } from '../../shared/api.ts';
import { sameDirectory } from '../../shared/path-compare.ts';
import type { MakeStep, MakeSystemInput, MakeSystemResult } from '../../guest/make-system.ts';
import { toast } from '../components/actions.ts';
import { createScope, errorText, h, nextId } from '../components/dom.ts';
import { icon } from '../components/icons.ts';
import { banner, bannerWithActions, btn, iconBtn, openSheet } from '../components/kit.ts';
import { systems } from '../components/systems-store.ts';
import { client, guestHost, host, makeSystem, store } from '../guest.ts';
import { fileSize, folderName, middlePath, plural } from '../model/format.ts';
import {
  AGENT_DISABLED_HINT,
  BRAND_ACCEPT,
  BRAND_TYPES_LINE,
  DESCRIPTION_MAX,
  DESCRIPTION_PLACEHOLDER,
  DISCOVERY_IDLE,
  FONT_LICENCE_NOTE,
  LOCATION_FAILED_HINT,
  LOCATION_HELPER,
  LOCATION_IDLE,
  LOOKING_LABEL,
  MAKE_CHOICE_LABEL,
  MAKE_FROM_HINT,
  MAKE_LABEL,
  NAME_SUGGESTED_HELPER,
  NO_CANDIDATES,
  NOTHING_IN_LOCATION,
  REGISTER_CHOICE_LABEL,
  REGISTER_HINT,
  REGISTER_LABEL,
  REGISTER_TOAST,
  REPO_UNTOUCHED_LINE,
  SCAN_NOTHING_FOUND,
  SCAN_PARTIAL,
  SHEET_SUBTITLE,
  SOURCES,
  candidateCountLine,
  candidateMarkLine,
  candidatesMoreLine,
  candidatesNote,
  contractProblemLine,
  draftProblems,
  filesReadLabel,
  filesReadMore,
  forAgentLine,
  leftForAgentLine,
  locationLabel,
  missedLine,
  nextSources,
  nudgeLine,
  resultHeadline,
  resultToast,
  scanFoundNothing,
  scanSummarySentence,
  skippedLine,
  takeBrandFiles,
  type DraftProblem,
  type LocationScanState,
  type PickedFile,
  type ScanState,
  type SourceId,
} from '../model/new-system-model.ts';
import { DESTINATIONS, presetOptions, type Destination } from '../model/new-model.ts';

export type NewSystemOptions = {
  /** The source the opening action ticks ("From code…", "From an existing system…"); none for the header button. */
  source?: SourceId;
  /**
   * The system whose page should open: after Make or Register, or from a candidate's Open (one already
   * registered). The list is already refreshing; the caller opens the system page (both surfaces).
   */
  onMade?: (result: { id: string; name: string }) => void;
};

const OTHER_FOLDER = '__other';
const SCAN_POLL_MS = 500;

type ProjectOption = { directory: string; name: string };

/** What the footer's primary does: make a new system, or register the folder as it is. */
type Choice = 'make' | 'register';

export const openNewSystemSheet = (hostEl: HTMLElement, options: NewSystemOptions = {}): void => {
  const scope = createScope();
  let closed = false;
  const sheet = openSheet(hostEl, {
    title: 'New design system',
    variant: 'dialog',
    subtitle: SHEET_SUBTITLE,
    onClose: () => {
      closed = true;
      cancelSlot(projectSlot);
      cancelSlot(locationSlot);
      scope.dispose();
    },
  });
  sheet.el.classList.add('dc-newsys');

  // ------------------------------------------------------------ state
  const sources: Record<SourceId, boolean> = { code: options.source === 'code', brand: options.source === 'brand', description: options.source === 'description' || options.source === undefined, existing: options.source === 'existing' };
  let name = '';
  let nameTouched = false;
  let destination: Destination = 'new-chat';
  let description = '';
  let preset = '';
  let scan: ScanState = { state: 'idle' };
  let location: LocationScanState = { state: 'idle' };
  /** The location field's text; kept across scans and failures. */
  let locationPath = '';
  let choice: Choice = 'make';
  /** The nudge is offered once per sheet session; Dismiss puts it away for good. */
  let nudgeDismissed = false;
  /** Project files ticked to copy in; every font and logo the scan found, ticked until the user says otherwise. */
  const ticked = new Set<string>();
  /** The location scan's own assets, ticked the same way. */
  const locationTicked = new Set<string>();
  let projects: ProjectOption[] = [];
  let projectChoice = '';
  let otherFolder = '';
  let files: PickedFile[] = [];
  const picked = new Map<string, File>();
  let refused: Array<{ name: string; reason: string }> = [];
  let brandFolder = '';
  let folderOpen = false;
  let making = false;
  let attempted = false;
  let problems: DraftProblem[] = [];

  /** The project the sheet reads: the chosen one, or the folder typed under Other folder… */
  const projectDirectory = (): string => (projectChoice === OTHER_FOLDER ? otherFolder.trim() : projectChoice);
  const projectLabel = (): string => {
    const directory = projectDirectory();
    return projects.find((project) => sameDirectory(project.directory, directory))?.name ?? folderName(directory);
  };
  /** Registering: the existing start, a done location scan with a complete contract, and the register choice. */
  const registering = (): boolean =>
    sources.existing && location.state === 'done' && location.summary.location?.contract?.complete === true && choice === 'register';

  // ------------------------------------------------------------ name
  const nameHost = h('div', { class: 'dc-newsys-g-name' });
  const nameField: TextFieldHandle = mountTextField(nameHost, {
    label: 'Name',
    value: name,
    placeholder: 'e.g. Acme',
    onChange: (next) => {
      name = next;
      nameTouched = true;
      // The kit re-renders from its own props on every update (the error line), so the value has to live there too.
      nameField.update({ value: next, helper: '' });
      if (attempted) paintProblems();
    },
  });
  scope.add(() => nameField.dispose());

  // ------------------------------------------------------------ the four sources
  const checks = new Map<SourceId, CheckboxHandle>();
  const panels = new Map<SourceId, HTMLElement>();
  const problemLines = new Map<SourceId | 'name', HTMLElement>();
  /** The Existing design system's body: the sheet's second column at laptop width, below the options at 320 px. */
  const whereHost = h('div', { class: 'dc-newsys-g-where dc-newsys-stack', hidden: true });

  /** A source tick: the exclusion rules live in the model; the scans follow what is ticked. */
  const tickSource = (id: SourceId, checked: boolean): void => {
    Object.assign(sources, nextSources(sources, id, checked, { description, preset }));
    // The project scan serves Project code and Existing design system alike; without either it stops.
    if (!sources.code && !sources.existing) {
      cancelSlot(projectSlot);
      scan = { state: 'idle' };
    }
    if (!sources.existing) {
      cancelSlot(locationSlot);
      location = { state: 'idle' };
    }
    paintSources();
    if ((sources.code || sources.existing) && scan.state === 'idle') void startDefaultScan();
  };

  const sourceBlock = (id: SourceId, body: HTMLElement, inline = true): HTMLElement => {
    const entry = SOURCES.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`Design Chamber: unknown source ${id}`);
    const head = h('div', { class: 'dc-newsys-head' });
    const check = mountCheckbox(head, {
      label: entry.label,
      description: entry.hint,
      checked: sources[id],
      onChange: (checked) => tickSource(id, checked),
    });
    checks.set(id, check);
    scope.add(() => check.dispose());
    const problem = h('p', { class: 'dc-form-error', role: 'alert', hidden: true });
    problemLines.set(id, problem);
    if (!inline) {
      // Existing design system: the checkbox stays under Start from; its body is the second column.
      panels.set(id, whereHost);
      whereHost.append(body, problem);
      return h('section', { class: 'dc-newsys-source', 'data-source': id }, head);
    }
    const panel = h('div', { class: 'dc-newsys-body' }, body, problem);
    panels.set(id, panel);
    return h('section', { class: 'dc-newsys-source', 'data-source': id }, head, panel);
  };

  const paintSources = (): void => {
    for (const [id, panel] of panels) {
      panel.hidden = !sources[id];
      checks.get(id)?.update({ checked: sources[id] });
    }
    sheet.el.dataset.existing = sources.existing ? 'true' : 'false';
    paintScan();
    paintExisting();
    paintFooter();
    paintDest();
    if (attempted) paintProblems();
  };

  // ---- project code
  const projectHost = h('div', { class: 'dc-field' });
  let projectSelect: SelectHandle | null = null;
  const otherHost = h('div', { class: 'dc-newsys-other', hidden: true });
  const otherId = nextId('dc-newsys-folder');
  const otherInput = h('input', { type: 'text', id: otherId, class: 'oc-sdk-input', placeholder: 'C:\\Projects\\shop or /Users/you/shop', spellcheck: 'false', autocomplete: 'off' });
  const otherScan = btn({ label: 'Read this folder', variant: 'outline', size: 'sm', onClick: () => void scanFolder(otherFolder) });
  otherHost.append(h('div', { class: 'dc-field' }, h('label', { class: 'oc-sdk-field-label', for: otherId }, 'Project folder'), h('div', { class: 'dc-newsys-row' }, otherInput, otherScan.el)));
  otherInput.addEventListener('input', () => {
    otherFolder = otherInput.value;
    existingOtherInput.value = otherFolder;
  });
  otherInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void scanFolder(otherFolder);
    }
  });
  const scanHost = h('div', { class: 'dc-newsys-scan', 'aria-live': 'polite' });
  const codeBody = h('div', { class: 'dc-newsys-stack' }, projectHost, otherHost, scanHost);

  const projectOptions = (): Array<{ id: string; label: string; hint?: string }> => [
    ...projects.map((project) => ({ id: project.directory, label: project.name, hint: middlePath(project.directory, 28) })),
    { id: OTHER_FOLDER, label: 'Other folder…' },
  ];
  const paintProject = (): void => {
    const value = projectChoice === '' ? null : projectChoice;
    projectSelect?.update({ options: projectOptions(), value });
    existingProjectSelect?.update({ options: projectOptions(), value });
    otherHost.hidden = projectChoice !== OTHER_FOLDER;
    existingOtherHost.hidden = projectChoice !== OTHER_FOLDER;
    otherInput.value = otherFolder;
    existingOtherInput.value = otherFolder;
    const directory = projectDirectory();
    existingProjectNote.hidden = directory === '';
    existingProjectNote.textContent = directory === '' ? '' : `${middlePath(directory, 48)} · other folders are under “Other folder…”`;
    existingProjectNote.title = directory;
  };
  /** Both Project selects (code and existing) drive the same choice and the same project scan. */
  const chooseProject = (id: string): void => {
    projectChoice = id;
    // Another project invalidates the location read under the old one; what was typed stays.
    cancelSlot(locationSlot);
    location = { state: 'idle' };
    choice = 'make';
    paintProject();
    paintExisting();
    if (id === OTHER_FOLDER) {
      // The typed folder is read on Enter or Read this folder; the old project's scan must not linger.
      cancelSlot(projectSlot);
      scan = { state: 'idle' };
      paintScan();
      paintDiscovery();
      (sources.existing ? existingOtherInput : otherInput).focus();
      return;
    }
    void scanFolder(id);
  };
  projectSelect = mountSelect(projectHost, {
    label: 'Project',
    value: null,
    options: projectOptions(),
    placeholder: 'Choose a project',
    onChange: chooseProject,
  });
  scope.add(() => projectSelect?.dispose());

  /** One scan job: started on the service, polled until it settles. A newer scan or a closed sheet ends the old one. */
  type ScanSlot = { ticket: number; job: string | null; timer: ReturnType<typeof setTimeout> | null };
  const newSlot = (): ScanSlot => ({ ticket: 0, job: null, timer: null });
  const projectSlot = newSlot();
  const locationSlot = newSlot();
  const cancelSlot = (slot: ScanSlot): void => {
    slot.ticket += 1;
    if (slot.timer !== null) clearTimeout(slot.timer);
    slot.timer = null;
    const job = slot.job;
    slot.job = null;
    if (job !== null) {
      client.call('DELETE /system-scans/:scanId', { params: { scanId: job } }).catch((error: unknown) => {
        console.warn('Design Chamber: the scan could not be cancelled; the service ends it on its own', error);
      });
    }
  };

  const runScan = async (
    slot: ScanSlot,
    body: CreateSystemScanBody,
    settle: { running: (seen: number) => void; done: (scanId: string, summary: ScanSummary) => void; failed: (message: string) => void },
  ): Promise<void> => {
    cancelSlot(slot);
    const mine = slot.ticket;
    settle.running(0);
    try {
      const { scanId } = await client.call('POST /system-scans', { body });
      if (mine !== slot.ticket) {
        client.call('DELETE /system-scans/:scanId', { params: { scanId } }).catch(() => undefined);
        return;
      }
      slot.job = scanId;
      const poll = async (): Promise<void> => {
        try {
          const answer = await client.call('GET /system-scans/:scanId', { params: { scanId } });
          if (mine !== slot.ticket) return;
          if (answer.state === 'running') {
            settle.running(answer.seen);
            slot.timer = setTimeout(() => void poll(), SCAN_POLL_MS);
            return;
          }
          slot.job = null;
          if (answer.state === 'done') settle.done(scanId, answer.summary);
          else settle.failed(answer.message);
        } catch (error) {
          if (mine !== slot.ticket) return;
          slot.job = null;
          settle.failed(errorText(error));
        }
      };
      await poll();
    } catch (error) {
      if (mine !== slot.ticket) return;
      settle.failed(errorText(error));
    }
  };

  const scanFolder = async (directory: string): Promise<void> => {
    const folder = directory.trim();
    if (folder === '') {
      scan = { state: 'failed', directory: '', message: 'Type the full path of the folder to read.' };
      paintScan();
      paintDiscovery();
      return;
    }
    ticked.clear();
    await runScan(projectSlot, { directory: folder }, {
      running: (seen) => {
        scan = { state: 'running', directory: folder, seen };
        paintScan();
        paintDiscovery();
      },
      done: (scanId, summary) => {
        scan = { state: 'done', directory: folder, scanId, summary };
        for (const asset of summary.assets) ticked.add(asset.path);
        if (!nameTouched && name.trim() === '') suggestName(folder);
        paintScan();
        paintDiscovery();
      },
      failed: (message) => {
        scan = { state: 'failed', directory: folder, message };
        paintScan();
        paintDiscovery();
      },
    });
  };

  /** The location scan (Phase 2.6 §6.6): a second job rooted at the folder, inside the chosen project. */
  const scanLocation = async (raw: string): Promise<void> => {
    const path = raw.trim();
    const project = projectDirectory();
    if (project === '') {
      locationField.update({ error: 'Pick the project to read first.' });
      return;
    }
    if (path === '') {
      locationField.update({ error: 'Pick where the system lives, or type its folder.' });
      return;
    }
    locationPath = path;
    locationField.update({ value: path, error: undefined });
    locationTicked.clear();
    await runScan(locationSlot, { directory: project, location: path }, {
      running: () => {
        location = { state: 'running', path };
        paintExisting();
      },
      done: (scanId, summary) => {
        location = { state: 'done', path, scanId, summary };
        for (const asset of summary.assets) locationTicked.add(asset.path);
        // A complete contract preselects Register it as it is (owner sign-off, §20); anything else can only be made.
        choice = summary.location?.contract?.complete === true ? 'register' : 'make';
        paintExisting();
      },
      failed: (message) => {
        location = { state: 'failed', path, message };
        paintExisting();
      },
    });
  };

  /** A project's own name is a fair first guess for the system's name; the user's typing always wins. */
  const suggestName = (directory: string): void => {
    const match = projects.find((project) => sameDirectory(project.directory, directory));
    name = match?.name ?? folderName(directory);
    nameField.update({ value: name, helper: NAME_SUGGESTED_HELPER });
  };

  const startDefaultScan = async (): Promise<void> => {
    if (scan.state !== 'idle' || projectChoice === '' || projectChoice === OTHER_FOLDER) return;
    await scanFolder(projectChoice);
  };

  // ---- existing design system: the second column (project, discovery, location)
  const existingProjectHost = h('div', { class: 'dc-field' });
  let existingProjectSelect: SelectHandle | null = null;
  const existingProjectNote = h('p', { class: 'dc-muted dc-newsys-project-note', hidden: true });
  existingProjectSelect = mountSelect(existingProjectHost, {
    label: 'Project',
    value: null,
    options: projectOptions(),
    placeholder: 'Choose a project',
    onChange: chooseProject,
  });
  scope.add(() => existingProjectSelect?.dispose());
  existingProjectHost.append(existingProjectNote);
  const existingOtherHost = h('div', { class: 'dc-newsys-other', hidden: true });
  const existingOtherId = nextId('dc-newsys-existing-folder');
  const existingOtherInput = h('input', { type: 'text', id: existingOtherId, class: 'oc-sdk-input', placeholder: 'C:\\Projects\\shop or /Users/you/shop', spellcheck: 'false', autocomplete: 'off' });
  const existingOtherScan = btn({ label: 'Read this folder', variant: 'outline', size: 'sm', onClick: () => void scanFolder(otherFolder) });
  existingOtherHost.append(h('div', { class: 'dc-field' }, h('label', { class: 'oc-sdk-field-label', for: existingOtherId }, 'Project folder'), h('div', { class: 'dc-newsys-row' }, existingOtherInput, existingOtherScan.el)));
  existingOtherInput.addEventListener('input', () => {
    otherFolder = existingOtherInput.value;
    otherInput.value = otherFolder;
  });
  existingOtherInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void scanFolder(otherFolder);
    }
  });
  const discoveryHost = h('div', { class: 'dc-newsys-discovery', 'aria-live': 'polite' });
  const locationFieldHost = h('div');
  const locationField: TextFieldHandle = mountTextField(locationFieldHost, {
    label: 'Where does it live?',
    value: locationPath,
    mono: true,
    placeholder: 'design-system',
    helper: LOCATION_HELPER(projectLabel()),
    onChange: (next) => {
      locationPath = next;
      locationField.update({ value: next });
      syncCandidateChecks();
      if (attempted) paintProblems();
    },
  });
  scope.add(() => locationField.dispose());
  const locationRead = btn({ label: 'Read this folder', variant: 'outline', size: 'sm', onClick: () => void scanLocation(locationPath) });
  locationFieldHost.append(locationRead.el);
  locationFieldHost.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      void scanLocation(locationPath);
    }
  });
  const existingBody = h(
    'div',
    { class: 'dc-newsys-stack' },
    h('div', { class: 'dc-newsys-col-head' }, h('h3', { class: 'dc-newsys-h3' }, 'Existing design system'), h('p', { class: 'dc-muted' }, 'Pick where it lives. Design Chamber only reads the folder.')),
    existingProjectHost,
    existingOtherHost,
    discoveryHost,
    locationFieldHost,
  );

  /** The fonts and logos a scan found, ticked to copy in, with the licence note when a font is among them. */
  const assetGroup = (summary: ScanSummary, ticks: Set<string>): HTMLElement | null => {
    if (summary.assets.length === 0) return null;
    const group = h('div', { class: 'dc-newsys-assets' }, h('span', { class: 'oc-sdk-field-label' }, 'Copy into the system'));
    for (const asset of summary.assets) {
      const holder = h('div');
      const label = asset.family ? `${asset.family}${asset.weight ? ` ${asset.weight}` : ''}` : folderName(asset.path);
      const handle = mountCheckbox(holder, {
        label: `${asset.kind === 'font' ? 'Font' : 'Logo'}: ${label}`,
        description: `${asset.path} · ${fileSize(asset.bytes, host.snapshot()?.locale ?? 'en')}`,
        checked: ticks.has(asset.path),
        onChange: (checked) => void (checked ? ticks.add(asset.path) : ticks.delete(asset.path)),
      });
      scope.add(() => handle.dispose());
      group.append(holder);
    }
    if (summary.assets.some((asset) => asset.kind === 'font')) group.append(h('p', { class: 'dc-muted' }, FONT_LICENCE_NOTE));
    return group;
  };

  const summaryDetails = (summary: ScanSummary): HTMLElement => {
    const list = h('ul', { class: 'dc-newsys-files' }, ...summary.files.slice(0, 40).map((file) => h('li', null, h('span', { class: 'dc-path' }, file.path), h('span', { class: 'dc-muted' }, plural(file.found, 'value')))));
    const more = summary.files.length > 40 ? h('p', { class: 'dc-muted' }, `and ${summary.files.length - 40} more.`) : null;
    const noValues = filesReadMore(summary);
    return h('details', { class: 'dc-newsys-details' }, h('summary', null, filesReadLabel(summary)), list, more, noValues === null ? null : h('p', { class: 'dc-muted' }, noValues));
  };

  /** The nudge (Phase 2.6 §6.6): Project code is ticked and the project already holds a strong candidate. */
  const nudgeBanner = (): HTMLElement | null => {
    if (!sources.code || nudgeDismissed || scan.state !== 'done') return null;
    const first = scan.summary.candidates?.[0];
    if (!first || !first.strong) return null;
    const start = btn({ label: 'Start from it', variant: 'outline', size: 'xs', onClick: () => {
      Object.assign(sources, nextSources(sources, 'existing', true, { description, preset }));
      locationPath = first.path;
      paintSources();
      void scanLocation(first.path);
    } });
    const dismiss = btn({ label: 'Dismiss', variant: 'ghost', size: 'xs', onClick: () => {
      nudgeDismissed = true;
      paintScan();
    } });
    const wrap = h('div', { class: 'dc-newsys-nudge' });
    wrap.append(...bannerWithActions('info', nudgeLine(first), [], [start.el, dismiss.el]));
    return wrap;
  };

  const paintScan = (): void => {
    scanHost.replaceChildren();
    // The "pick the project" line goes away as soon as a scan has settled (and comes back if it fails).
    if (attempted) paintProblems();
    if (scan.state === 'idle') {
      const chosen = projectChoice === '' || projectChoice === OTHER_FOLDER ? null : projectChoice;
      if (chosen === null && projectChoice === '' && projects.length > 0) scanHost.append(h('p', { class: 'dc-muted' }, 'Choose a project and Design Chamber reads its colours, type and spacing. Nothing in it is changed.'));
      // Cancelled, or not read yet: the project that is already chosen can't be picked again, so it gets its own button.
      if (chosen !== null) scanHost.append(btn({ label: `Read ${projects.find((project) => sameDirectory(project.directory, chosen))?.name ?? folderName(chosen)}`, variant: 'outline', size: 'sm', onClick: () => void scanFolder(chosen) }).el);
      return;
    }
    if (scan.state === 'running') {
      const spinnerHost = h('div', { class: 'dc-newsys-running' });
      mountSpinner(spinnerHost, { label: scan.seen > 0 ? `Reading ${folderName(scan.directory)}… ${plural(scan.seen, 'file')} looked at` : `Reading ${folderName(scan.directory)}…` });
      scanHost.append(spinnerHost, btn({ label: 'Cancel scan', variant: 'ghost', size: 'xs', onClick: () => {
        cancelSlot(projectSlot);
        scan = { state: 'idle' };
        paintScan();
        paintDiscovery();
      } }).el);
      return;
    }
    if (scan.state === 'failed') {
      scanHost.append(h('p', { class: 'dc-form-error', role: 'alert' }, scan.message), h('p', { class: 'dc-muted' }, 'What you typed is kept. Pick another folder, or untick Project code.'));
      return;
    }
    const nudge = nudgeBanner();
    if (nudge !== null) scanHost.append(nudge);
    const { summary } = scan;
    const sentence = scanSummarySentence(summary);
    const lines: HTMLElement[] = [sentence === null ? h('p', { class: 'dc-muted' }, SCAN_NOTHING_FOUND) : h('p', { class: 'dc-newsys-found' }, icon('check', 14), sentence)];
    if (summary.partial) lines.push(h('p', { class: 'dc-muted' }, SCAN_PARTIAL));
    lines.push(h('p', { class: 'dc-muted dc-newsys-note' }, missedLine(summary)));
    const agentLine = forAgentLine(summary);
    if (agentLine) lines.push(h('p', { class: 'dc-muted' }, agentLine));
    const skipped = skippedLine(summary);
    if (skipped) lines.push(h('p', { class: 'dc-muted' }, skipped));
    if (summary.read > 0) lines.push(summaryDetails(summary));
    const assets = assetGroup(summary, ticked);
    if (assets !== null) lines.push(assets);
    scanHost.append(...lines);
  };

  // ---- existing design system: discovery, the location's read, and the choice
  /** The candidate rows are rebuilt when the discovery state changes; a location change only moves the tick. */
  let discoveryKey = '';
  const candidateInputs = new Map<string, HTMLInputElement>();

  const syncCandidateChecks = (): void => {
    const selected = location.state === 'done' || location.state === 'running' ? location.path : locationPath.trim();
    for (const [path, input] of candidateInputs) {
      const on = path === selected;
      input.checked = on;
      input.closest('.dc-newsys-cand')?.setAttribute('data-on', on ? 'true' : 'false');
    }
  };

  /** Open a system the candidate is already registered as: the caller opens its page (both surfaces). */
  const openRegistered = (registered: { id: string; name: string }): void => {
    if (options.onMade) {
      options.onMade(registered);
      sheet.close();
      return;
    }
    // Without the callback (a caller that only wants the sheet): leave an open request the rail takes.
    client.call('POST /open-request', { body: { system: registered.id, target: 'page' } }).then(
      () => sheet.close(),
      (error: unknown) => toast('error', `Couldn’t open ${registered.name}. ${errorText(error)}`),
    );
  };

  const candidateRow = (candidate: SystemCandidate, groupName: string): HTMLElement => {
    const id = nextId('dc-newsys-cand');
    const input = h('input', { type: 'radio', class: 'dc-newsys-radio', name: groupName, id });
    input.addEventListener('change', () => {
      if (!input.checked) return;
      locationPath = candidate.path;
      locationField.update({ value: candidate.path, error: undefined });
      void scanLocation(candidate.path);
    });
    candidateInputs.set(candidate.path, input);
    const pathLabel = h('label', { for: id, class: 'dc-newsys-cand-path-label', title: candidate.path === '' ? projectLabel() : candidate.path }, locationLabel(candidate.path));
    const pathLine = h('div', { class: 'dc-newsys-cand-path' }, pathLabel);
    if (candidate.marks.includes('contract')) {
      const badge = h('span', { class: 'dc-newsys-cand-badge' });
      mountBadge(badge, { label: 'Complete', tone: 'success' });
      pathLine.append(badge);
    }
    if (candidate.registered !== null) {
      const registered = candidate.registered;
      const open = btn({ label: 'Open', variant: 'ghost', size: 'xs', title: `Open ${registered.name}`, onClick: (event) => {
        event.stopPropagation();
        openRegistered(registered);
      } });
      open.el.setAttribute('aria-label', `Open ${registered.name} in Design Chamber`);
      pathLine.append(open.el);
    }
    return h(
      'div',
      { class: 'dc-newsys-cand', 'data-on': 'false' },
      input,
      pathLine,
      h('p', { class: 'dc-newsys-cand-mark' }, candidateMarkLine(candidate)),
      h('p', { class: 'dc-newsys-cand-count' }, candidateCountLine(candidate)),
    );
  };

  const paintDiscovery = (): void => {
    if (attempted) paintProblems();
    const key = scan.state === 'done' ? `done:${scan.scanId}` : scan.state === 'running' ? `running:${scan.directory}` : scan.state === 'failed' ? `failed:${scan.directory}:${scan.message}` : `idle:${projectDirectory()}`;
    if (key === discoveryKey && discoveryHost.childElementCount > 0) {
      syncCandidateChecks();
      return;
    }
    discoveryKey = key;
    candidateInputs.clear();
    discoveryHost.replaceChildren();
    if (scan.state === 'idle') {
      const directory = projectDirectory();
      if (directory === '') discoveryHost.append(h('p', { class: 'dc-muted' }, DISCOVERY_IDLE));
      else discoveryHost.append(btn({ label: 'Look for a design system', variant: 'outline', size: 'sm', onClick: () => void scanFolder(directory) }).el);
      return;
    }
    if (scan.state === 'running') {
      const spinnerHost = h('div', { class: 'dc-newsys-running' });
      mountSpinner(spinnerHost, { label: LOOKING_LABEL(projectLabel()) });
      discoveryHost.append(spinnerHost, btn({ label: 'Cancel scan', variant: 'ghost', size: 'xs', onClick: () => {
        cancelSlot(projectSlot);
        scan = { state: 'idle' };
        paintScan();
        paintDiscovery();
      } }).el);
      return;
    }
    if (scan.state === 'failed') {
      const failedDirectory = scan.directory;
      discoveryHost.append(
        h('p', { class: 'dc-form-error', role: 'alert' }, scan.message),
        btn({ label: 'Try again', variant: 'outline', size: 'sm', onClick: () => void scanFolder(failedDirectory) }).el,
      );
      return;
    }
    const candidates = scan.summary.candidates ?? [];
    if (candidates.length === 0) {
      discoveryHost.append(h('p', { class: 'dc-muted' }, NO_CANDIDATES));
      return;
    }
    const more = scan.summary.candidatesMore ?? 0;
    const groupName = nextId('dc-newsys-loc');
    const list = h('div', { class: 'dc-newsys-cands', role: 'radiogroup', 'aria-label': 'Looks like a design system' }, ...candidates.map((candidate) => candidateRow(candidate, groupName)));
    if (more > 0) list.append(h('p', { class: 'dc-newsys-cand-more' }, candidatesMoreLine(more)));
    discoveryHost.append(
      h('div', { class: 'dc-newsys-pick-head' }, h('h3', { class: 'dc-newsys-h3' }, 'Looks like a design system'), h('span', { class: 'dc-muted dc-newsys-pick-note' }, candidatesNote(candidates.length + more))),
      list,
    );
    syncCandidateChecks();
  };

  /** The found-vs-missed block of a done location scan, scoped to the folder (Phase 2.6 §6.6). */
  const locationSummaryBlock = (summary: ScanSummary): HTMLElement[] => {
    const sentence = scanSummarySentence(summary);
    const lines: HTMLElement[] = [
      sentence === null
        ? h('p', { class: 'dc-muted' }, NOTHING_IN_LOCATION(locationLabel(location.state === 'done' ? location.path : '')))
        : h('p', { class: 'dc-newsys-found-line' }, h('strong', null, 'Found'), sentence.replace(/^Found/, '')),
    ];
    if (summary.partial) lines.push(h('p', { class: 'dc-muted' }, SCAN_PARTIAL));
    lines.push(h('p', { class: 'dc-muted dc-newsys-note' }, missedLine(summary)));
    const view = summary.location;
    if (view) {
      const left = leftForAgentLine(view);
      if (left !== null) lines.push(h('p', { class: 'dc-muted dc-newsys-note' }, icon('page', 14), h('span', null, left)));
    }
    const agentLine = forAgentLine(summary);
    if (agentLine) lines.push(h('p', { class: 'dc-muted dc-newsys-note' }, agentLine));
    const skipped = skippedLine(summary);
    if (skipped) lines.push(h('p', { class: 'dc-muted dc-newsys-note' }, icon('alert', 14), h('span', null, skipped)));
    if (summary.read > 0) lines.push(summaryDetails(summary));
    const assets = assetGroup(summary, locationTicked);
    if (assets !== null) lines.push(assets);
    return lines;
  };

  const choiceBlock = (summary: ScanSummary): HTMLElement | null => {
    const contract = summary.location?.contract;
    if (contract == null) return null;
    if (!contract.complete) return h('p', { class: 'dc-muted dc-newsys-contract-problem' }, contractProblemLine(contract.missing));
    const groupName = nextId('dc-newsys-how');
    const option = (value: Choice, label: string, hint: string, recommended: boolean): HTMLElement => {
      const id = nextId('dc-newsys-choice');
      const input = h('input', { type: 'radio', class: 'dc-newsys-radio', name: groupName, id, checked: choice === value });
      input.addEventListener('change', () => {
        if (!input.checked) return;
        choice = value;
        paintFooter();
        paintDest();
        syncChoiceChecks();
      });
      const labelEl = h('label', { for: id }, label);
      if (recommended) {
        const badge = h('span', { class: 'dc-newsys-cand-badge' });
        mountBadge(badge, { label: 'Recommended', tone: 'success' });
        labelEl.append(' ', badge);
      }
      return h('div', { class: 'dc-newsys-choice', 'data-on': choice === value ? 'true' : 'false', 'data-choice': value }, input, labelEl, h('p', { class: 'dc-newsys-choice-hint' }, hint));
    };
    const group = h(
      'div',
      { class: 'dc-newsys-choices', role: 'radiogroup', 'aria-label': 'What should happen with it?' },
      h('span', { class: 'oc-sdk-field-label' }, 'What should happen with it?'),
      option('register', REGISTER_CHOICE_LABEL, REGISTER_HINT(projectLabel()), true),
      option('make', MAKE_CHOICE_LABEL, MAKE_FROM_HINT, false),
    );
    return group;
  };

  const syncChoiceChecks = (): void => {
    for (const row of resultHost.querySelectorAll<HTMLElement>('.dc-newsys-choice')) {
      const on = row.dataset.choice === choice;
      row.setAttribute('data-on', on ? 'true' : 'false');
      const input = row.querySelector<HTMLInputElement>('input');
      if (input) input.checked = on;
    }
  };

  const resultHost = h('div', { class: 'dc-newsys-g-result dc-newsys-stack', hidden: true, 'aria-live': 'polite' });

  const paintResult = (): void => {
    resultHost.replaceChildren();
    if (location.state === 'done') {
      const { summary } = location;
      resultHost.append(
        h('div', { class: 'dc-newsys-col-head' }, h('h3', { class: 'dc-newsys-h3' }, 'What Design Chamber read'), h('p', { class: 'dc-muted' }, `In ${locationLabel(location.path)}`)),
        h('div', { class: 'dc-newsys-read-lines' }, ...locationSummaryBlock(summary)),
      );
      const choiceEl = choiceBlock(summary);
      if (choiceEl !== null) resultHost.append(choiceEl);
      return;
    }
    resultHost.append(h('div', { class: 'dc-newsys-col-head' }, h('h3', { class: 'dc-newsys-h3' }, 'What Design Chamber read')));
    if (location.state === 'running') {
      const spinnerHost = h('div', { class: 'dc-newsys-running' });
      mountSpinner(spinnerHost, { label: `Reading ${folderName(location.path)}…` });
      resultHost.append(spinnerHost, btn({ label: 'Cancel scan', variant: 'ghost', size: 'xs', onClick: () => {
        cancelSlot(locationSlot);
        location = { state: 'idle' };
        paintExisting();
      } }).el);
      return;
    }
    resultHost.append(h('p', { class: 'dc-muted' }, location.state === 'failed' ? LOCATION_FAILED_HINT : LOCATION_IDLE));
  };

  const paintExisting = (): void => {
    resultHost.hidden = !sources.existing;
    paintDiscovery();
    paintResult();
    locationRead.set({ loading: location.state === 'running' });
    locationField.update({
      value: locationPath,
      error: location.state === 'failed' ? location.message : undefined,
      helper: LOCATION_HELPER(projectLabel()),
    });
    paintFooter();
    paintDest();
    if (attempted) paintProblems();
  };

  // ---- brand files
  const fileInput = h('input', { type: 'file', multiple: true, accept: BRAND_ACCEPT, hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
  const dropZone = h('div', { class: 'dc-newsys-drop', 'data-drop': 'idle' });
  const chooseFiles = btn({ label: 'Choose files…', variant: 'outline', size: 'sm', icon: 'plus', onClick: () => fileInput.click() });
  dropZone.append(h('span', { class: 'dc-newsys-drop-text' }, 'Drop files here, or'), chooseFiles.el, h('span', { class: 'dc-muted dc-newsys-drop-types' }, BRAND_TYPES_LINE));
  const fileList = h('ul', { class: 'dc-newsys-picked', 'aria-label': 'Brand files to add' });
  const refusedList = h('ul', { class: 'dc-newsys-refused', 'aria-label': 'Files that can’t be added', role: 'status' });
  const folderHost = h('div', { class: 'dc-newsys-other', hidden: true });
  const folderId = nextId('dc-newsys-brand-folder');
  const folderInput = h('input', { type: 'text', id: folderId, class: 'oc-sdk-input', placeholder: 'C:\\Brand or /Users/you/Brand', spellcheck: 'false', autocomplete: 'off' });
  folderHost.append(h('div', { class: 'dc-field' }, h('label', { class: 'oc-sdk-field-label', for: folderId }, 'Brand folder'), folderInput), h('p', { class: 'dc-muted' }, 'Design Chamber reads the files directly in it, not in folders inside it. The folder isn’t changed.'));
  folderInput.addEventListener('input', () => {
    brandFolder = folderInput.value;
  });
  const folderToggle = btn({ label: 'Add from a folder…', variant: 'ghost', size: 'sm', icon: 'folder', onClick: () => {
    folderOpen = !folderOpen;
    folderHost.hidden = !folderOpen;
    if (folderOpen) folderInput.focus();
    else {
      brandFolder = '';
      folderInput.value = '';
    }
  } });
  const brandBody = h('div', { class: 'dc-newsys-stack' }, dropZone, fileInput, fileList, refusedList, folderToggle.el, folderHost);

  const paintFiles = (): void => {
    const locale = host.snapshot()?.locale ?? 'en';
    fileList.replaceChildren(
      ...files.map((file) => {
        const remove = iconBtn({ icon: 'close', label: `Remove ${file.name}`, size: 'sm', onClick: () => {
          picked.delete(file.key);
          files = files.filter((entry) => entry.key !== file.key);
          paintFiles();
        } });
        return h('li', { class: 'dc-newsys-file' }, h('span', { class: 'dc-newsys-file-name', title: file.name }, file.name), h('span', { class: 'dc-muted dc-newsys-file-meta' }, `${KIND_LABEL[file.kind]} · ${fileSize(file.bytes, locale)}`), remove);
      }),
    );
    fileList.hidden = files.length === 0;
    refusedList.replaceChildren(...refused.map((entry) => h('li', null, icon('alert', 14), h('span', null, entry.reason))));
    refusedList.hidden = refused.length === 0;
  };
  const KIND_LABEL: Record<PickedFile['kind'], string> = { font: 'Font', logo: 'Logo', source: 'Document' };

  const take = (list: FileList | null): void => {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list).map((file) => ({ key: `${file.name}\u0000${file.size}\u0000${file.lastModified}`, name: file.name, bytes: file.size, file }));
    const result = takeBrandFiles(incoming, files);
    for (const entry of result.added) {
      const source = incoming.find((candidate) => candidate.key === entry.key);
      if (source) picked.set(entry.key, source.file);
    }
    files = [...files, ...result.added];
    refused = result.refused;
    paintFiles();
    if (attempted) paintProblems();
  };
  fileInput.addEventListener('change', () => {
    take(fileInput.files);
    fileInput.value = '';
  });
  for (const type of ['dragenter', 'dragover'] as const) {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      dropZone.dataset.drop = 'over';
    });
  }
  dropZone.addEventListener('dragleave', () => void (dropZone.dataset.drop = 'idle'));
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.dataset.drop = 'idle';
    take(event.dataTransfer?.files ?? null);
  });

  // ---- description
  const descHost = h('div');
  const descField: TextFieldHandle = mountTextField(descHost, {
    label: 'What should it look like?',
    value: description,
    multiline: true,
    rows: 4,
    placeholder: DESCRIPTION_PLACEHOLDER,
    helper: `Up to ${DESCRIPTION_MAX.toLocaleString('en-US')} characters.`,
    onChange: (next) => {
      description = next;
      descField.update({ value: next });
      if (attempted) paintProblems();
    },
  });
  scope.add(() => descField.dispose());
  const presetHost = h('div', { class: 'dc-field' });
  const presetSelect: SelectHandle = mountSelect(presetHost, { label: 'Start from a style preset', value: '', options: presetOptions([]), disabled: true, onChange: (id) => void (preset = id) });
  scope.add(() => presetSelect.dispose());
  const presetNote = h('p', { class: 'oc-sdk-field-note', hidden: true });
  presetHost.append(presetNote);
  const paintPresets = (): void => {
    const state = store.getState().presets;
    if (state.status === 'ready' && state.data) presetSelect.update({ options: presetOptions(state.data.presets), disabled: false, value: preset });
    if (state.status === 'error') {
      presetNote.textContent = 'Style presets didn’t load. You can still describe the look yourself.';
      presetNote.hidden = false;
    }
  };
  scope.add(store.subscribe(paintPresets));
  void store.loadPresets();
  paintPresets();
  const descriptionBody = h('div', { class: 'dc-newsys-stack' }, descHost, presetHost);

  // ------------------------------------------------------------ where the agent works
  const destHost = h('div', { class: 'dc-field dc-newsys-g-agent dc-newsys-agent' }, h('span', { class: 'oc-sdk-field-label' }, 'Agent works in'));
  const destTabs = mountTabs(destHost, {
    items: DESTINATIONS.map(({ id, label }) => ({ id, label })),
    activeId: destination,
    trackBackground: true,
    onChange: (id) => {
      // Registering sends no request, so the choice is off and says why (the tabs stay reachable, aria-disabled).
      if (registering()) {
        destTabs.update({ activeId: destination });
        return;
      }
      destination = id === 'current-chat' ? 'current-chat' : 'new-chat';
      destTabs.update({ activeId: destination });
      paintDest();
    },
  });
  scope.add(() => destTabs.dispose());
  const destHint = h('p', { class: 'oc-sdk-field-note' });
  destHost.append(destHint);
  const paintDest = (): void => {
    const off = registering();
    destHost.dataset.disabled = off ? 'true' : 'false';
    for (const tab of destHost.querySelectorAll<HTMLElement>('[role="tab"]')) tab.setAttribute('aria-disabled', off ? 'true' : 'false');
    const noSession = destination === 'current-chat' && host.session() === null;
    destHint.textContent = off ? AGENT_DISABLED_HINT : noSession ? 'No chat is open right now. Choose New chat, or open one first.' : destination === 'new-chat' ? 'Starts a chat in the project you read, or in this one.' : 'Attaches the design system to the chat you have open.';
  };
  paintDest();

  // ------------------------------------------------------------ the form, problems, buttons
  const nameProblem = h('p', { class: 'dc-form-error', role: 'alert', hidden: true });
  problemLines.set('name', nameProblem);
  nameHost.append(nameProblem);
  const failure = h('div', { class: 'dc-newsys-failure', role: 'alert', hidden: true });
  // Three columns at laptop width (start / location / what was read), one column at the rail's width (§20).
  const grid = h(
    'div',
    { class: 'dc-newsys-grid' },
    nameHost,
    h(
      'div',
      { class: 'dc-newsys-sources dc-newsys-g-opts', role: 'group', 'aria-label': 'Start from' },
      h('span', { class: 'oc-sdk-field-label' }, 'Start from'),
      sourceBlock('code', codeBody),
      sourceBlock('brand', brandBody),
      sourceBlock('description', descriptionBody),
      sourceBlock('existing', existingBody, false),
    ),
    whereHost,
    resultHost,
    destHost,
  );
  const form = h('div', { class: 'dc-newsys-form' }, grid, failure);
  const progress = h('div', { class: 'dc-newsys-progress', hidden: true, 'aria-live': 'polite' });
  const cancel = btn({ label: 'Cancel', variant: 'ghost', onClick: () => sheet.close() });
  const make = btn({ label: MAKE_LABEL, variant: 'default', emphasis: 'primary', onClick: () => void submit() });
  const repoNote = h('p', { class: 'dc-newsys-repo-note', hidden: true }, REPO_UNTOUCHED_LINE);
  sheet.body.append(form, progress);
  sheet.foot.append(repoNote, cancel.el, make.el);

  const paintFooter = (): void => {
    make.set({ label: registering() ? REGISTER_LABEL : MAKE_LABEL });
    repoNote.hidden = !sources.existing;
  };

  const existing = (): Array<{ name: string }> => systems().get().systems ?? [];

  const currentDraft = (): Parameters<typeof draftProblems>[0] => ({ name, sources, scan: { project: scan, location }, brand: { files, folder: brandFolder }, description, preset });

  /** Shows what stops Make next to the thing that needs it; clears the lines that no longer apply. */
  const paintProblems = (): void => {
    problems = draftProblems(currentDraft(), existing());
    for (const [field, line] of problemLines) {
      const problem = problems.find((entry) => entry.field === field);
      line.textContent = problem?.message ?? '';
      line.hidden = problem === undefined;
    }
    nameField.update({ error: problems.find((entry) => entry.field === 'name')?.message });
    // The name line duplicates the field's own error text; keep the field's.
    nameProblem.hidden = true;
  };

  const focusFirst = (): void => {
    const first = problems[0];
    if (!first) return;
    const existingTarget = projectDirectory() === ''
      ? (projectChoice === OTHER_FOLDER ? existingOtherInput : existingProjectHost.querySelector<HTMLElement>('button'))
      : locationFieldHost.querySelector<HTMLElement>('input');
    const target = first.field === 'name' ? nameHost.querySelector<HTMLElement>('input') : first.field === 'code' ? (otherHost.hidden ? projectHost.querySelector<HTMLElement>('button') : otherInput) : first.field === 'existing' ? existingTarget : first.field === 'brand' ? chooseFiles.el : descHost.querySelector<HTMLElement>('textarea');
    target?.focus();
  };

  const stepText = (step: MakeStep): string => {
    if (step.phase === 'creating') return 'Making the design system…';
    if (step.phase === 'files') return `Adding brand files: ${step.done + 1} of ${step.total}, ${step.name}`;
    if (step.phase === 'folder') return 'Adding brand files from the folder…';
    return 'Asking the agent to write it…';
  };

  const setMaking = (on: boolean): void => {
    making = on;
    make.set({ loading: on });
    cancel.set({ disabled: on });
    form.inert = on;
    progress.hidden = !on;
  };

  const submit = async (): Promise<void> => {
    if (making) return;
    attempted = true;
    paintProblems();
    if (problems.length > 0) {
      focusFirst();
      return;
    }
    failure.hidden = true;
    const trimmedName = name.normalize('NFKC').trim();
    // Register it as it is (Phase 2.6 AD-10): one call, no brand files, no agent request. A refusal keeps everything.
    if (registering() && location.state === 'done') {
      setMaking(true);
      progress.replaceChildren();
      const spinnerHost = h('div');
      mountSpinner(spinnerHost, { label: 'Registering the design system…' });
      progress.append(spinnerHost);
      try {
        const registered = await makeSystem.register({ scanId: location.scanId, name: trimmedName });
        void systems().load();
        options.onMade?.(registered);
        toast('success', REGISTER_TOAST(registered.name, projectLabel()));
        if (!closed) sheet.close();
      } catch (error) {
        setMaking(false);
        failure.replaceChildren(h('p', { class: 'dc-form-error' }, `Couldn’t register the design system. ${errorText(error)}`));
        failure.hidden = false;
      }
      return;
    }
    const input: MakeSystemInput = {
      name: trimmedName,
      // From a location: the scan is the location job, but the chat's project is the project it sits in (§5.8).
      code: sources.existing && location.state === 'done'
        ? { scanId: location.scanId, assets: [...locationTicked], directory: projectDirectory() }
        : sources.code && scan.state === 'done'
          ? { scanId: scan.scanId, assets: [...ticked], directory: scan.directory }
          : null,
      description: sources.description ? { text: description.trim(), preset: preset === '' ? null : preset } : null,
      brand: sources.brand
        ? {
            files: files.flatMap((file) => {
              const blob = picked.get(file.key);
              return blob ? [{ file: blob, name: file.name, kind: file.kind }] : [];
            }),
            folder: brandFolder.trim() === '' ? null : brandFolder.trim(),
          }
        : null,
      destination,
    };
    setMaking(true);
    progress.replaceChildren();
    const spinnerHost = h('div');
    const spinner = mountSpinner(spinnerHost, { label: stepText({ phase: 'creating' }) });
    progress.append(spinnerHost);
    const setStep = (step: MakeStep): void => spinner.update({ label: stepText(step) });
    try {
      const result = await makeSystem.make(input, setStep);
      void systems().load();
      options.onMade?.(result);
      finish(result);
    } catch (error) {
      // Nothing was made: the sheet keeps everything, and the sentence says what to change.
      setMaking(false);
      failure.replaceChildren(h('p', { class: 'dc-form-error' }, `Couldn’t make the design system. ${errorText(error)}`));
      failure.hidden = false;
    }
  };

  /** Everything went through: a toast and done. Anything that needs attention: a result the user reads and acts on. */
  const finish = (result: MakeSystemResult): void => {
    const refusedCount = result.files.refused.length;
    const sent = result.agent.outcome !== 'not-sent';
    if (refusedCount === 0 && sent) {
      toast('success', result.agent.outcome === 'composed' ? `Made ${result.name}. The request is waiting in the chat composer.` : `Made ${result.name}. It’s a draft; the agent is writing it now.`);
      if (!closed) sheet.close();
      return;
    }
    if (closed) {
      toast('error', `${resultToast(result.name, refusedCount, sent)} Check the design system’s files in the list.`);
      return;
    }
    showResult(result);
  };

  const showResult = (result: MakeSystemResult): void => {
    setMaking(false);
    sheet.setTitle(`${result.name} is made`);
    // The subtitle belonged to the form.
    sheet.el.querySelector('.dc-sheet-sub')?.remove();
    const body = h('div', { class: 'dc-newsys-result' });
    let agent = result.agent;
    const render = (): void => {
      body.replaceChildren(h('p', null, resultHeadline(result.files.refused.length, agent.outcome !== 'not-sent')));
      if (result.files.added.length > 0) body.append(h('p', { class: 'dc-muted' }, `Added ${plural(result.files.added.length, 'file')}: ${result.files.added.join(', ')}.`));
      if (result.files.refused.length > 0) {
        body.append(h('div', { class: 'dc-newsys-block' }, h('span', { class: 'oc-sdk-field-label' }, 'Files not added'), h('ul', { class: 'dc-newsys-refused' }, ...result.files.refused.map((entry) => h('li', null, icon('alert', 14), h('span', null, entry.reason)))), h('p', { class: 'dc-muted' }, 'You can add them again from the system’s page. The rest are in.')));
      }
      if (agent.outcome === 'not-sent') {
        const again = btn({ label: 'Try again', variant: 'outline', size: 'sm', onClick: () => {
          again.set({ loading: true });
          void makeSystem.askToMake({ id: result.id, destination, directory: scan.state === 'done' ? scan.directory : null }).then((next) => {
            agent = next;
            if (next.outcome !== 'not-sent' && result.files.refused.length === 0) {
              toast('success', `Asked the agent to write ${result.name}.`);
              sheet.close();
              return;
            }
            render();
          });
        } });
        const actions = [again.el];
        if (agent.text !== null) {
          const text = agent.text;
          actions.push(btn({ label: 'Copy request', variant: 'ghost', size: 'sm', icon: 'copy', onClick: () => void host.writeClipboard(text).then((ok) => toast(ok ? 'success' : 'error', ok ? 'Copied the request. Paste it into a chat.' : 'Couldn’t copy. Select the text and copy it yourself.')) }).el);
        }
        body.append(h('div', { class: 'dc-newsys-block' }, banner({ tone: 'warning', title: 'Couldn’t ask the agent', body: agent.reason ?? 'The request didn’t reach a chat.' }), h('div', { class: 'dc-row-actions' }, ...actions)), h('p', { class: 'dc-muted' }, `${result.name} is saved as a draft with what was gathered. You can ask the agent later.`));
      }
    };
    render();
    sheet.body.replaceChildren(body);
    sheet.foot.replaceChildren(btn({ label: 'Done', variant: 'default', emphasis: 'primary', onClick: () => sheet.close() }).el);
  };

  // ------------------------------------------------------------ first paint, then the host's project names
  paintProject();
  paintSources();
  paintFiles();
  void guestHost.client.listProjects().then(
    (answer) => {
      if (closed) return;
      projects = answer.projects.map((project) => ({ directory: project.directory, name: project.name }));
      const current = host.snapshot()?.directory ?? null;
      const match = current === null ? undefined : projects.find((project) => sameDirectory(project.directory, current));
      if (match && projectChoice === '') projectChoice = match.directory;
      else if (projects.length === 0 && projectChoice === '') projectChoice = OTHER_FOLDER;
      paintProject();
      paintSources();
      if ((sources.code || sources.existing) && scan.state === 'idle') void startDefaultScan();
    },
    (error: unknown) => {
      console.warn('Design Chamber: the project list could not be read; the folder path still works', error);
      if (closed) return;
      projectChoice = OTHER_FOLDER;
      paintProject();
      paintExisting();
    },
  );
  void systems().load();
};
