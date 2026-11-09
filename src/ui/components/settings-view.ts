// Settings (rail R3 and page P5): the designs folder, folders you used before, how agents find
// your designs (guide, skill, AGENTS.md snippet), the browser that makes thumbnails, and the
// opencode.json tip. Same content in the rail sheet and the page sheet.

import { mountBadge, mountTextField } from '@openchamber/sdk/ui';

import { buildAgentsSnippet } from '../../shared/agent/guide.ts';
import type { SettingsResponse } from '../../shared/api.ts';
import { client, host, store } from '../guest.ts';
import { middlePath } from '../model/format.ts';
import {
  browserStatus,
  designCountLabel,
  duplicateSentences,
  guideSentence,
  isSameRootInput,
  permissionSnippet,
  skillRow,
  validateRootInput,
  type PathSentence,
} from '../model/settings-model.ts';
import { toast } from './actions.ts';
import { append, createScope, errorText, h } from './dom.ts';
import { banner, btn, loadingRow } from './kit.ts';

export type SettingsHandle = { dispose: () => void };

/** How long "Saved" and "Copied" stay on their buttons. */
const ACK_MS = 2000;

/** A sentence with its path in code type, shortened in the middle; the full path is the tooltip. `inline` sits beside a badge. */
const sentence = (parts: PathSentence, inline = false): HTMLElement => {
  const path = parts.path === null ? null : h('code', { class: 'dc-path', title: parts.path }, middlePath(parts.path));
  return inline ? h('span', { class: 'dc-muted dc-status-detail' }, parts.before, path, parts.after) : h('p', { class: 'dc-settings-p' }, parts.before, path, parts.after);
};

/** The AGENTS.md lines for this root, or null when the root can't be put in one (the service refuses such roots). */
const agentsSnippetFor = (root: string): string | null => {
  try {
    return buildAgentsSnippet(root);
  } catch {
    return null;
  }
};

const section = (title: string, description: string, ...children: Array<Node | null>): HTMLElement =>
  h('section', { class: 'dc-settings-section' }, h('h3', { class: 'dc-settings-h' }, title), h('p', { class: 'dc-settings-p' }, description), ...children);

export const mountSettings = (container: HTMLElement): SettingsHandle => {
  const scope = createScope();
  const body = h('div', { class: 'dc-settings' });
  container.append(body);
  let version = '';
  void client.call('GET /health').then(
    (health) => {
      version = health.version;
      paint();
    },
    () => undefined,
  );

  // Field state survives repaints (a settings refresh must not wipe what is being typed).
  let rootDraft: string | null = null;
  let rootError: string | null = null;
  let chromeDraft: string | null = null;
  let chromeError: string | null = null;
  let rootBusy = false;
  let rootSaved = false;
  let chromeBusy = false;
  let skillBusy = false;
  let skillError: string | null = null;
  let skillConfirming = false;
  const copied = { permissions: false, agents: false };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  };

  const applyRoot = async (value: string | null, current: SettingsResponse): Promise<void> => {
    if (value !== null) {
      if (isSameRootInput(value, current.root)) return;
      rootError = validateRootInput(value);
      if (rootError !== null) return paint();
    } else if (current.root === current.defaultRoot) return;
    rootBusy = true;
    rootError = null;
    paint();
    try {
      await store.updateSettings({ root: value === null ? null : value.trim() });
      rootDraft = null;
      rootSaved = true;
      later(() => {
        rootSaved = false;
        paint();
      }, ACK_MS);
      await store.refreshDesigns();
      toast('success', 'Designs folder changed. Designs in the earlier folder stay where they were.');
    } catch (error) {
      rootError = errorText(error);
    } finally {
      rootBusy = false;
      paint();
    }
  };

  const switchBack = async (path: string): Promise<void> => {
    try {
      await store.updateSettings({ root: path });
      await store.refreshDesigns();
      toast('success', 'Switched back to that folder.');
    } catch (error) {
      toast('error', `Couldn’t switch back. ${errorText(error)}`);
    }
  };

  const applyChrome = async (value: string | null): Promise<void> => {
    chromeBusy = true;
    chromeError = null;
    paint();
    try {
      const next = await store.updateSettings({ chromePath: value === null ? null : value.trim() });
      if (value !== null && next.chrome.source !== 'setting') chromeError = 'That file isn’t a browser Design Chamber can use. Check the path and try again.';
      else {
        chromeDraft = null;
        toast('success', value === null ? 'Using the detected browser.' : 'That browser works. Thumbnails will use it.');
      }
    } catch (error) {
      chromeError = errorText(error);
    } finally {
      chromeBusy = false;
      paint();
    }
  };

  const copySnippet = async (snippet: string, which: keyof typeof copied): Promise<void> => {
    if (await host.writeClipboard(snippet)) {
      copied[which] = true;
      paint();
      later(() => {
        copied[which] = false;
        paint();
      }, ACK_MS);
    } else toast('error', 'Couldn’t reach the clipboard. Select the text and copy it by hand.');
  };

  /** Only ever from a click: the one write outside the designs folder. */
  const installSkill = async (replaceEdited: boolean, updating: boolean): Promise<void> => {
    skillBusy = true;
    skillError = null;
    skillConfirming = false;
    paint();
    try {
      await client.call('POST /agent/skill', { body: replaceEdited ? { replaceEdited: true } : {} });
      toast('success', updating ? 'Skill updated. New chats use the new folder.' : 'Skill installed. New chats in OpenCode can find your designs.');
    } catch (error) {
      skillError = errorText(error);
    } finally {
      skillBusy = false;
      // The answer or the failure may mean the file changed under us (edited, someone else's): show what is there now.
      await store.loadSettings();
      paint();
    }
  };

  const paint = (): void => {
    const state = store.getState().settings;
    body.replaceChildren();
    if (state.status === 'idle' || (state.status === 'loading' && !state.data)) {
      body.append(loadingRow('Loading settings…'));
      return;
    }
    if (!state.data) {
      body.append(banner({ tone: 'error', title: 'Settings didn’t load', body: state.error?.message ?? 'The local service didn’t answer.', action: { label: 'Try again', onClick: () => void store.loadSettings() } }));
      return;
    }
    const settings = state.data;

    // Designs folder
    const folderHost = h('div');
    const draft = rootDraft ?? settings.root;
    const unchanged = (value: string): boolean => isSameRootInput(value, settings.root);
    const folderField = mountTextField(folderHost, {
      label: 'Designs folder',
      value: draft,
      mono: true,
      disabled: rootBusy,
      error: rootError ?? undefined,
      helper: settings.rootExists ? 'Existing designs aren’t moved when you change this.' : 'This folder doesn’t exist yet. It is created when you apply.',
      onChange: (next) => {
        rootDraft = next;
        if (rootError !== null) {
          rootError = null;
          folderField.update({ error: undefined });
        }
        rootSaved = false;
        apply.set(applyState(next));
      },
    });
    // Disabled while the field names the current folder: there is nothing to apply, and the title says so.
    const applyState = (value: string): { label: string; icon: 'check' | undefined; disabled: boolean; title: string | undefined } => ({
      label: rootSaved ? 'Saved' : 'Apply folder',
      icon: rootSaved ? 'check' : undefined,
      disabled: rootBusy || unchanged(value),
      title: !rootSaved && unchanged(value) ? 'Change the path above to apply it.' : undefined,
    });
    const apply = btn({ variant: 'default', emphasis: 'primary', loading: rootBusy, ...applyState(draft), onClick: () => void applyRoot(rootDraft ?? settings.root, settings) });
    const reset = btn({ label: 'Use default', variant: 'ghost', disabled: rootBusy || settings.root === settings.defaultRoot, title: settings.defaultRoot, onClick: () => void applyRoot(null, settings) });
    folderHost.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
        event.preventDefault();
        void applyRoot(rootDraft ?? settings.root, settings);
      }
    });
    const folder = section('Where designs live', 'Your chat agent writes each design as its own folder here.', folderHost, h('div', { class: 'dc-row-actions' }, apply.el, reset.el));

    // Previous folders
    let previous: HTMLElement | null = null;
    if (settings.previousRoots.length > 0) {
      const rows = settings.previousRoots.map((root) => {
        const switchButton = btn({ label: 'Switch back', variant: 'outline', size: 'xs', disabled: !root.exists, title: root.exists ? undefined : 'This folder no longer exists.', onClick: () => void switchBack(root.path) });
        return h(
          'li',
          { class: 'dc-prev' },
          h('div', { class: 'dc-prev-text' }, h('code', { class: 'dc-path', title: root.path }, middlePath(root.path)), h('span', { class: 'dc-muted' }, root.exists ? `${designCountLabel(root.designCount)} remain here` : 'Folder not found')),
          switchButton.el,
        );
      });
      previous = section('Earlier folders', 'Designs in these folders were left in place. Switch back to see them again.', h('ul', { class: 'dc-prev-list' }, ...rows));
    }

    // Agent discovery: the guide the service keeps, the skill a click installs, the snippet to paste.
    const guide = h('div', { class: 'dc-field' }, h('span', { class: 'oc-sdk-field-label' }, 'Guide in your designs folder'), sentence(guideSentence(settings.agent.guide)));

    const row = skillRow(settings.agent.skill);
    const skill = h('div', { class: 'dc-field' }, h('span', { class: 'oc-sdk-field-label' }, 'OpenCode skill'));
    if (row.installed) {
      const installed = h('span');
      mountBadge(installed, { label: 'Installed', tone: 'success' });
      append(skill, h('div', { class: 'dc-status-line' }, installed, sentence(row.sentence, true)));
    } else skill.append(sentence(row.sentence));
    const action = row.action;
    if (action && skillConfirming && row.confirm !== null) {
      const replace = btn({ label: 'Replace skill', variant: 'destructive', size: 'xs', loading: skillBusy, onClick: () => void installSkill(true, false) });
      const keep = btn({ label: 'Keep mine', variant: 'ghost', size: 'xs', disabled: skillBusy, onClick: () => {
        skillConfirming = false;
        paint();
      } });
      append(skill, h('p', { class: 'dc-settings-p', role: 'alert' }, row.confirm), h('div', { class: 'dc-row-actions' }, replace.el, keep.el));
      queueMicrotask(() => keep.el.focus());
    } else if (action) {
      const press = btn({ label: action.label, variant: 'outline', size: 'sm', loading: skillBusy, onClick: () => {
        if (action.kind === 'replace') {
          skillConfirming = true;
          skillError = null;
          paint();
        } else void installSkill(false, action.kind === 'update');
      } });
      append(skill, h('div', { class: 'dc-row-actions' }, press.el));
    }
    if (skillError !== null) skill.append(h('p', { class: 'dc-form-error', role: 'alert' }, skillError));
    for (const duplicate of duplicateSentences(settings.agent.skill)) {
      const badge = h('span');
      mountBadge(badge, { label: 'Duplicate', tone: 'warning' });
      skill.append(h('div', { class: 'dc-status-line' }, badge, sentence(duplicate, true)));
    }

    const agentsSnippet = agentsSnippetFor(settings.root);
    let snippetBlock: HTMLElement | null = null;
    if (agentsSnippet !== null) {
      const copyAgents = btn({ label: copied.agents ? 'Copied' : 'Copy', variant: 'outline', size: 'sm', icon: copied.agents ? 'check' : 'copy', onClick: () => void copySnippet(agentsSnippet, 'agents') });
      copyAgents.el.setAttribute('aria-label', copied.agents ? 'Copied the AGENTS.md lines' : 'Copy the AGENTS.md lines');
      snippetBlock = h(
        'div',
        { class: 'dc-field' },
        h('span', { class: 'oc-sdk-field-label' }, 'Lines for AGENTS.md'),
        h('p', { class: 'dc-settings-p' }, 'Paste this into a project’s AGENTS.md or your global ~/.config/opencode/AGENTS.md.'),
        h('pre', { class: 'dc-code', 'data-wrap': 'true', tabindex: '0', 'aria-label': 'AGENTS.md lines' }, agentsSnippet),
        h('div', { class: 'dc-row-actions' }, copyAgents.el),
      );
    }
    const agents = section('Help your agent find your designs', 'Chats that don’t start with /design or /page can still find your designs folder through these.', guide, skill, snippetBlock);

    // Browser
    const status = browserStatus(settings.chrome.path, settings.chrome.source);
    const statusBadge = h('span');
    mountBadge(statusBadge, { label: status.title, tone: status.tone });
    const chromeHost = h('div');
    const chromeField = mountTextField(chromeHost, {
      label: 'Use a different browser',
      value: chromeDraft ?? '',
      mono: true,
      placeholder: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      disabled: chromeBusy,
      error: chromeError ?? undefined,
      helper: 'Optional. Chrome, Edge or Chromium; used only to take thumbnails.',
      onChange: (next) => {
        chromeDraft = next;
        if (chromeError !== null) {
          chromeError = null;
          chromeField.update({ error: undefined });
        }
      },
    });
    const test = btn({ label: 'Test and save', variant: 'outline', loading: chromeBusy, onClick: () => {
      if ((chromeDraft ?? '').trim() === '') {
        chromeError = 'Enter the path of a browser to test.';
        return paint();
      }
      void applyChrome(chromeDraft);
    } });
    const detected = btn({ label: 'Use detected', variant: 'ghost', disabled: chromeBusy || settings.chrome.source !== 'setting', onClick: () => void applyChrome(null) });
    const browser = section(
      'Browser for thumbnails',
      'A headless browser takes the previews. Without one, thumbnails fall back to live previews.',
      h('div', { class: 'dc-status-line' }, statusBadge, h('span', { class: 'dc-muted dc-status-detail' }, status.detail)),
      chromeHost,
      h('div', { class: 'dc-row-actions' }, test.el, detected.el),
    );

    // Permissions
    const snippet = permissionSnippet(settings.root);
    const copy = btn({ label: copied.permissions ? 'Copied' : 'Copy', variant: 'outline', size: 'sm', icon: copied.permissions ? 'check' : 'copy', onClick: () => void copySnippet(snippet, 'permissions') });
    copy.el.setAttribute('aria-label', copied.permissions ? 'Copied the opencode.json snippet' : 'Copy the opencode.json snippet');
    const permissions = section(
      'Let your agent write here',
      'OpenCode asks before your agent writes outside the project. To allow your Designs folder once, add this to opencode.json. Design Chamber never edits that file.',
      h('pre', { class: 'dc-code', tabindex: '0', 'aria-label': 'opencode.json snippet' }, snippet),
      h('div', { class: 'dc-row-actions' }, copy.el),
    );

    append(body, folder, previous, agents, browser, permissions, h('p', { class: 'dc-settings-foot' }, version ? `Design Chamber ${version.startsWith('v') ? version : `v${version}`}` : 'Design Chamber'));
  };

  // Repaint only when settings changed: other store traffic (the designs list) must not steal focus from a field being typed in.
  let seen = '';
  scope.add(
    store.subscribe(() => {
      const state = store.getState().settings;
      const signature = `${state.status}:${state.data ? JSON.stringify(state.data) : ''}:${state.error?.message ?? ''}`;
      if (signature === seen) return;
      seen = signature;
      paint();
    }),
  );
  void store.loadSettings();
  paint();
  return {
    dispose: () => {
      scope.dispose();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      body.remove();
    },
  };
};
