// The New design system sheet (Phase 2.5 U1, technical design §9.3): a name, what to start from (project code,
// brand files, a description; any mix), and which chat the agent works in. It makes an internal design system:
// repo-backed ones come from /design-system. Nothing is written until Make design system; every failure keeps what
// the user typed. A problem after the system exists (a refused file, a request that didn't reach a chat) is shown
// as a result with its own way forward, never as a lost sheet.

import { mountCheckbox, mountSelect, mountSpinner, mountTabs, mountTextField, type CheckboxHandle, type SelectHandle, type TextFieldHandle } from '@openchamber/sdk/ui';

import type { ScanSummary } from '../../shared/api.ts';
import { sameDirectory } from '../../shared/path-compare.ts';
import type { MakeStep, MakeSystemInput, MakeSystemResult } from '../../guest/make-system.ts';
import { toast } from '../components/actions.ts';
import { createScope, errorText, h, nextId } from '../components/dom.ts';
import { icon } from '../components/icons.ts';
import { banner, btn, iconBtn, openSheet } from '../components/kit.ts';
import { systems } from '../components/systems-store.ts';
import { client, guestHost, host, makeSystem, store } from '../guest.ts';
import { fileSize, folderName, middlePath, plural } from '../model/format.ts';
import {
  BRAND_ACCEPT,
  BRAND_TYPES_LINE,
  DESCRIPTION_MAX,
  DESCRIPTION_PLACEHOLDER,
  FONT_LICENCE_NOTE,
  MAKE_LABEL,
  SCAN_NOTHING_FOUND,
  SCAN_PARTIAL,
  SHEET_SUBTITLE,
  SOURCES,
  draftProblems,
  forAgentLine,
  resultHeadline,
  resultToast,
  scanSummarySentence,
  skippedLine,
  takeBrandFiles,
  type DraftProblem,
  type PickedFile,
  type ScanState,
  type SourceId,
} from '../model/new-system-model.ts';
import { DESTINATIONS, presetOptions, type Destination } from '../model/new-model.ts';

export type NewSystemOptions = {
  /** The source the opening action ticks ("From code…", "From brand files…", "Describe…"); none for the header button. */
  source?: SourceId;
  /** Called once the system exists, with its id: the list is already refreshing; U2 opens the system page here. */
  onMade?: (result: MakeSystemResult) => void;
};

const OTHER_FOLDER = '__other';
const SCAN_POLL_MS = 500;

type ProjectOption = { directory: string; name: string };

export const openNewSystemSheet = (hostEl: HTMLElement, options: NewSystemOptions = {}): void => {
  const scope = createScope();
  let closed = false;
  const sheet = openSheet(hostEl, {
    title: 'New design system',
    variant: 'dialog',
    subtitle: SHEET_SUBTITLE,
    onClose: () => {
      closed = true;
      cancelScan();
      scope.dispose();
    },
  });
  sheet.el.classList.add('dc-newsys');

  // ------------------------------------------------------------ state
  const sources: Record<SourceId, boolean> = { code: options.source === 'code', brand: options.source === 'brand', description: options.source === 'description' || options.source === undefined };
  let name = '';
  let nameTouched = false;
  let destination: Destination = 'new-chat';
  let description = '';
  let preset = '';
  let scan: ScanState = { state: 'idle' };
  /** Project files ticked to copy in; every font and logo the scan found, ticked until the user says otherwise. */
  const ticked = new Set<string>();
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

  // ------------------------------------------------------------ name
  const nameHost = h('div');
  const nameField: TextFieldHandle = mountTextField(nameHost, {
    label: 'Name',
    value: name,
    placeholder: 'e.g. Acme',
    onChange: (next) => {
      name = next;
      nameTouched = true;
      // The kit re-renders from its own props on every update (the error line), so the value has to live there too.
      nameField.update({ value: next });
      if (attempted) paintProblems();
    },
  });
  scope.add(() => nameField.dispose());

  // ------------------------------------------------------------ the three sources
  const checks = new Map<SourceId, CheckboxHandle>();
  const panels = new Map<SourceId, HTMLElement>();
  const problemLines = new Map<SourceId | 'name', HTMLElement>();

  const sourceBlock = (id: SourceId, body: HTMLElement): HTMLElement => {
    const entry = SOURCES.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`Design Chamber: unknown source ${id}`);
    const head = h('div', { class: 'dc-newsys-head' });
    const check = mountCheckbox(head, {
      label: entry.label,
      description: entry.hint,
      checked: sources[id],
      onChange: (checked) => {
        sources[id] = checked;
        paintSources();
        if (id === 'code' && checked) void startDefaultScan();
        if (id === 'code' && !checked) cancelScan();
      },
    });
    checks.set(id, check);
    scope.add(() => check.dispose());
    const problem = h('p', { class: 'dc-form-error', role: 'alert', hidden: true });
    problemLines.set(id, problem);
    const panel = h('div', { class: 'dc-newsys-body' }, body, problem);
    panels.set(id, panel);
    return h('section', { class: 'dc-newsys-source', 'data-source': id }, head, panel);
  };

  const paintSources = (): void => {
    for (const [id, panel] of panels) {
      panel.hidden = !sources[id];
      checks.get(id)?.update({ checked: sources[id] });
    }
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
    projectSelect?.update({ options: projectOptions(), value: projectChoice === '' ? null : projectChoice });
    otherHost.hidden = projectChoice !== OTHER_FOLDER;
  };
  projectSelect = mountSelect(projectHost, {
    label: 'Project',
    value: null,
    options: projectOptions(),
    placeholder: 'Choose a project',
    onChange: (id) => {
      projectChoice = id;
      paintProject();
      if (id === OTHER_FOLDER) {
        otherInput.focus();
        return;
      }
      void scanFolder(id);
    },
  });
  scope.add(() => projectSelect?.dispose());

  /** The scan job (§7.1): started on the service, polled until it settles. A newer scan or a closed sheet ends the old one. */
  let scanTicket = 0;
  let scanJob: string | null = null;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  function cancelScan(): void {
    scanTicket += 1;
    if (scanTimer !== null) clearTimeout(scanTimer);
    scanTimer = null;
    const job = scanJob;
    scanJob = null;
    if (job !== null) {
      client.call('DELETE /system-scans/:scanId', { params: { scanId: job } }).catch((error: unknown) => {
        console.warn('Design Chamber: the scan could not be cancelled; the service ends it on its own', error);
      });
    }
  }

  const scanFolder = async (directory: string): Promise<void> => {
    const folder = directory.trim();
    if (folder === '') {
      scan = { state: 'failed', directory: '', message: 'Type the full path of the folder to read.' };
      paintScan();
      return;
    }
    cancelScan();
    const mine = scanTicket;
    scan = { state: 'running', directory: folder, seen: 0 };
    ticked.clear();
    paintScan();
    try {
      const { scanId } = await client.call('POST /system-scans', { body: { directory: folder } });
      if (mine !== scanTicket) {
        client.call('DELETE /system-scans/:scanId', { params: { scanId } }).catch(() => undefined);
        return;
      }
      scanJob = scanId;
      const poll = async (): Promise<void> => {
        try {
          const answer = await client.call('GET /system-scans/:scanId', { params: { scanId } });
          if (mine !== scanTicket) return;
          if (answer.state === 'running') {
            scan = { state: 'running', directory: folder, seen: answer.seen };
            paintScan();
            scanTimer = setTimeout(() => void poll(), SCAN_POLL_MS);
            return;
          }
          scanJob = null;
          if (answer.state === 'done') {
            scan = { state: 'done', directory: folder, scanId, summary: answer.summary };
            for (const asset of answer.summary.assets) ticked.add(asset.path);
            if (!nameTouched && name.trim() === '') suggestName(folder);
          } else scan = { state: 'failed', directory: folder, message: answer.message };
          paintScan();
        } catch (error) {
          if (mine !== scanTicket) return;
          scanJob = null;
          scan = { state: 'failed', directory: folder, message: errorText(error) };
          paintScan();
        }
      };
      await poll();
    } catch (error) {
      if (mine !== scanTicket) return;
      scan = { state: 'failed', directory: folder, message: errorText(error) };
      paintScan();
    }
  };

  /** A project's own name is a fair first guess for the system's name; the user's typing always wins. */
  const suggestName = (directory: string): void => {
    const match = projects.find((project) => sameDirectory(project.directory, directory));
    name = match?.name ?? folderName(directory);
    nameField.update({ value: name });
  };

  const startDefaultScan = async (): Promise<void> => {
    if (scan.state !== 'idle' || projectChoice === '' || projectChoice === OTHER_FOLDER) return;
    await scanFolder(projectChoice);
  };

  const summaryDetails = (summary: ScanSummary): HTMLElement => {
    const list = h('ul', { class: 'dc-newsys-files' }, ...summary.files.slice(0, 40).map((file) => h('li', null, h('span', { class: 'dc-path' }, file.path), h('span', { class: 'dc-muted' }, plural(file.found, 'value')))));
    const more = summary.files.length > 40 ? h('p', { class: 'dc-muted' }, `and ${summary.files.length - 40} more.`) : null;
    return h('details', { class: 'dc-newsys-details' }, h('summary', null, `Files read (${summary.files.length})`), list, more);
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
        cancelScan();
        scan = { state: 'idle' };
        paintScan();
      } }).el);
      return;
    }
    if (scan.state === 'failed') {
      scanHost.append(h('p', { class: 'dc-form-error', role: 'alert' }, scan.message), h('p', { class: 'dc-muted' }, 'What you typed is kept. Pick another folder, or untick Project code.'));
      return;
    }
    const { summary } = scan;
    const sentence = scanSummarySentence(summary);
    const lines: HTMLElement[] = [sentence === null ? h('p', { class: 'dc-muted' }, SCAN_NOTHING_FOUND) : h('p', { class: 'dc-newsys-found' }, icon('check', 14), sentence)];
    if (summary.partial) lines.push(h('p', { class: 'dc-muted' }, SCAN_PARTIAL));
    const agentLine = forAgentLine(summary);
    if (agentLine) lines.push(h('p', { class: 'dc-muted' }, agentLine));
    const skipped = skippedLine(summary);
    if (skipped) lines.push(h('p', { class: 'dc-muted' }, skipped));
    if (summary.files.length > 0) lines.push(summaryDetails(summary));
    if (summary.assets.length > 0) {
      const group = h('div', { class: 'dc-newsys-assets' }, h('span', { class: 'oc-sdk-field-label' }, 'Copy into the system'));
      for (const asset of summary.assets) {
        const holder = h('div');
        const label = asset.family ? `${asset.family}${asset.weight ? ` ${asset.weight}` : ''}` : folderName(asset.path);
        const handle = mountCheckbox(holder, {
          label: `${asset.kind === 'font' ? 'Font' : 'Logo'}: ${label}`,
          description: `${asset.path} · ${fileSize(asset.bytes, host.snapshot()?.locale ?? 'en')}`,
          checked: ticked.has(asset.path),
          onChange: (checked) => void (checked ? ticked.add(asset.path) : ticked.delete(asset.path)),
        });
        scope.add(() => handle.dispose());
        group.append(holder);
      }
      if (summary.assets.some((asset) => asset.kind === 'font')) group.append(h('p', { class: 'dc-muted' }, FONT_LICENCE_NOTE));
      lines.push(group);
    }
    scanHost.append(...lines);
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
  const destHost = h('div', { class: 'dc-field' }, h('span', { class: 'oc-sdk-field-label' }, 'Agent works in'));
  const destTabs = mountTabs(destHost, {
    items: DESTINATIONS.map(({ id, label }) => ({ id, label })),
    activeId: destination,
    trackBackground: true,
    onChange: (id) => {
      destination = id === 'current-chat' ? 'current-chat' : 'new-chat';
      destTabs.update({ activeId: destination });
      paintDest();
    },
  });
  scope.add(() => destTabs.dispose());
  const destHint = h('p', { class: 'oc-sdk-field-note' });
  destHost.append(destHint);
  const paintDest = (): void => {
    const noSession = destination === 'current-chat' && host.session() === null;
    destHint.textContent = noSession ? 'No chat is open right now. Choose New chat, or open one first.' : destination === 'new-chat' ? 'Starts a chat in the project you read, or in this one.' : 'Attaches the design system to the chat you have open.';
  };
  paintDest();

  // ------------------------------------------------------------ the form, problems, buttons
  const nameProblem = h('p', { class: 'dc-form-error', role: 'alert', hidden: true });
  problemLines.set('name', nameProblem);
  nameHost.append(nameProblem);
  const failure = h('div', { class: 'dc-newsys-failure', role: 'alert', hidden: true });
  const form = h(
    'div',
    { class: 'dc-newsys-form' },
    nameHost,
    h('div', { class: 'dc-newsys-sources', role: 'group', 'aria-label': 'Start from' }, h('span', { class: 'oc-sdk-field-label' }, 'Start from'), sourceBlock('code', codeBody), sourceBlock('brand', brandBody), sourceBlock('description', descriptionBody)),
    destHost,
    failure,
  );
  const progress = h('div', { class: 'dc-newsys-progress', hidden: true, 'aria-live': 'polite' });
  const cancel = btn({ label: 'Cancel', variant: 'ghost', onClick: () => sheet.close() });
  const make = btn({ label: MAKE_LABEL, variant: 'default', emphasis: 'primary', onClick: () => void submit() });
  sheet.body.append(form, progress);
  sheet.foot.append(cancel.el, make.el);

  const existing = (): Array<{ name: string }> => systems().get().systems ?? [];

  const currentDraft = (): Parameters<typeof draftProblems>[0] => ({ name, sources, scan, brand: { files, folder: brandFolder }, description, preset });

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
    const target = first.field === 'name' ? nameHost.querySelector<HTMLElement>('input') : first.field === 'code' ? (otherHost.hidden ? projectHost.querySelector<HTMLElement>('button') : otherInput) : first.field === 'brand' ? chooseFiles.el : descHost.querySelector<HTMLElement>('textarea');
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
    const input: MakeSystemInput = {
      name: name.normalize('NFKC').trim(),
      code: sources.code && scan.state === 'done' ? { scanId: scan.scanId, assets: [...ticked], directory: scan.directory } : null,
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
  paintSources();
  paintFiles();
  paintScan();
  paintProject();
  void guestHost.client.listProjects().then(
    (answer) => {
      if (closed) return;
      projects = answer.projects.map((project) => ({ directory: project.directory, name: project.name }));
      const current = host.snapshot()?.directory ?? null;
      const match = current === null ? undefined : projects.find((project) => sameDirectory(project.directory, current));
      if (match && projectChoice === '') projectChoice = match.directory;
      else if (projects.length === 0 && projectChoice === '') projectChoice = OTHER_FOLDER;
      paintProject();
      paintScan();
      if (sources.code && scan.state === 'idle') void startDefaultScan();
    },
    (error: unknown) => {
      console.warn('Design Chamber: the project list could not be read; the folder path still works', error);
      if (closed) return;
      projectChoice = OTHER_FOLDER;
      paintProject();
    },
  );
  void systems().load();
};
