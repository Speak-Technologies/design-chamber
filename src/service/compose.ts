// The composed service (docs/SPEC.md §9.7): every lane's real module wired into one
// ServiceContext and every lane's routes registered on one router. `main.ts` serves it as the
// host's service process; integration tests compose it in-process the same way.

import { randomUUID } from 'node:crypto';

import { createActivityTracker } from './activity.ts';
import { createAgentSetup } from './agent-setup.ts';
import { createChangeHub } from './changes.ts';
import { unavailable, type Logger, type ServiceContext } from './context.ts';
import { createDesignIndex } from './design-index.ts';
import { createHostCalls } from './host-calls.ts';
import { createRouter, registerHealthRoute, type Router } from './http.ts';
import { startInstructions } from './instructions.ts';
import { createOutboxStore } from './outbox.ts';
import { ensureRenderService } from './render-cache.ts';
import { ensureLauncherService } from './check/launcher.ts';
import { registerChangesRoutes } from './routes/changes.ts';
import { registerChecksRoutes } from './routes/checks.ts';
import { registerChatRoutes } from './routes/chat.ts';
import { registerCommentsRoutes } from './routes/comments.ts';
import { registerDesignsRoutes } from './routes/designs.ts';
import { registerEditRoutes } from './routes/edits.ts';
import { registerExportRoutes } from './routes/export.ts';
import { registerMentionsRoutes } from './routes/mentions.ts';
import { registerOutboxRoutes } from './routes/outbox.ts';
import { registerPageStateRoutes } from './routes/page-state.ts';
import { registerPresetsRoutes } from './routes/presets.ts';
import { registerRenderRoutes } from './routes/render.ts';
import { registerSessionEventsRoutes } from './routes/session-events.ts';
import { registerSettingsRoutes } from './routes/settings.ts';
import { registerStatusRoutes } from './routes/status.ts';
import { registerThumbnailsRoutes } from './routes/thumbnails.ts';
import { registerUploadsRoutes } from './routes/uploads.ts';
import { registerVersionsRoutes } from './routes/versions.ts';
import { writeRuntimeRecord } from './runtime-record.ts';
import { createSelfWrites } from './self-writes.ts';
import { createSettingsStore, type SettingsEnv } from './settings.ts';
import { createDesignStore } from './store.ts';
import { ensureThumbnailService } from './thumbnails.ts';
import { createTurnEvents } from './turn-events.ts';
import { createUploadStore } from './uploads.ts';
import { ensureVersionsService } from './versions.ts';
import { startWatcher, type WatcherOptions } from './watch.ts';

export type ComposeOptions = {
  token: string;
  log: Logger;
  packageRoot: string;
  version: string;
  /**
   * Environment seam (`DC_SETTINGS_PATH`, `XDG_CONFIG_HOME`, the host callback); defaults to
   * `process.env`. A test that passes one gets no host callback, so host calls answer `unavailable`.
   */
  env?: SettingsEnv;
  homeDir?: string;
  /** Watcher timing seams for tests. */
  watch?: Pick<WatcherOptions, 'pollMs' | 'debounceMs'>;
};

export type ComposedService = {
  ctx: ServiceContext;
  router: Router;
  /** Run every `onDispose` callback (reverse order); failures are logged, never thrown. */
  dispose(): Promise<void>;
};

export const composeService = async (options: ComposeOptions): Promise<ComposedService> => {
  const { log, packageRoot } = options;
  const disposers: (() => void | Promise<void>)[] = [];

  const settings = await createSettingsStore({
    log,
    packageRoot,
    ...(options.env ? { env: options.env } : {}),
    ...(options.homeDir ? { homeDir: options.homeDir } : {}),
  });
  const epoch = randomUUID();
  const hub = createChangeHub(epoch);
  // One registry shared by the watcher's echo filter and the edit service (Phase 2 §2.6).
  const selfWrites = createSelfWrites();
  settings.onRootChange(() => selfWrites.clear());
  hub.subscribe((event) => {
    if (event.kind === 'removed' && event.slug !== null) selfWrites.forgetDesign(event.slug);
  });
  // The store reads list thumb states from the thumbnail service, which itself needs the store:
  // the store asks through the context, which holds the real service before any request runs.
  const store = createDesignStore({ settings, log, hub, thumbnails: { peek: (slug) => ctx.thumbnails.peek(slug) } });
  // In-memory summaries for the routes the host calls on its own clock (mentions, session events, Work Status).
  const designIndex = createDesignIndex({ store, hub, log });

  const ctx: ServiceContext = {
    packageRoot,
    version: options.version,
    epoch,
    log,
    settings,
    store,
    hub,
    uploads: createUploadStore(),
    outbox: createOutboxStore(),
    renders: unavailable('rendering'),
    thumbnails: unavailable('thumbnails'),
    designIndex,
    hostCalls: createHostCalls({ env: options.env ?? process.env, log }),
    activity: createActivityTracker(),
    selfWrites,
    onDispose: (fn) => {
      disposers.push(fn);
    },
  };
  ctx.onDispose(() => designIndex.dispose());
  // Eager, so the versions service (created with the render service) takes quiet-period
  // snapshots from the first content event on, and the routes share these same instances.
  ctx.renders = ensureRenderService(ctx);
  ctx.thumbnails = ensureThumbnailService(ctx);

  const watcher = startWatcher({ settings, hub, log, selfWrites, ...options.watch });
  ctx.onDispose(() => watcher.stop());

  // The guide at <root>/AGENTS.md: synced after the watcher's baseline, on root changes and on
  // new designs. The skill ships inside the extension; an older installed copy is only read here.
  // The check launcher is written first: the guide quotes its command.
  const launcher = ensureLauncherService(ctx);
  const agent = createAgentSetup({
    log,
    settings,
    checkCommand: (root) => launcher.commandFor(root, '<slug>'),
    ...(options.env ? { env: options.env } : {}),
    ...(options.homeDir ? { homeDir: options.homeDir } : {}),
  });
  const stopAgent = agent.start({ hub, ready: watcher.ready });
  ctx.onDispose(async () => {
    stopAgent();
    await agent.idle();
  });

  // The Design Chamber note in every agent's instructions: after the baseline and on root changes.
  ctx.onDispose(startInstructions(ctx, { commandFor: (root) => launcher.commandFor(root, '<slug>'), ready: watcher.ready }));

  // Session events: the route answers at once; this queue snapshots linked designs after each turn.
  const turnEvents = createTurnEvents({
    index: designIndex,
    versions: { turn: (sessionId) => ensureVersionsService(ctx).turn(sessionId) },
    activity: ctx.activity,
    hub,
    log,
  });
  ctx.onDispose(() => turnEvents.dispose());

  // runtime.json for the OpenCode design_check tool; it never rejects, and shutdown waits for it.
  const runtimeRecord = writeRuntimeRecord({
    log,
    version: options.version,
    ...(options.env ? { env: options.env } : {}),
    ...(options.homeDir ? { homeDir: options.homeDir } : {}),
  }).catch((error: unknown) => log.warn('runtime-record.write-failed', { error: error instanceof Error ? error.message : String(error) }));
  ctx.onDispose(() => runtimeRecord);

  const router = createRouter({ token: options.token, log });
  registerHealthRoute(router, { version: ctx.version, epoch: ctx.epoch });
  // WP1
  registerSettingsRoutes(router, ctx, agent);
  registerChangesRoutes(router, ctx);
  registerDesignsRoutes(router, ctx);
  registerCommentsRoutes(router, ctx);
  registerUploadsRoutes(router, ctx);
  registerOutboxRoutes(router, ctx);
  // WP2
  registerRenderRoutes(router, ctx);
  registerVersionsRoutes(router, ctx);
  registerExportRoutes(router, ctx);
  registerThumbnailsRoutes(router, ctx);
  registerChecksRoutes(router, ctx);
  // WP3 (registers the RULES.md `onCreate` hook on the real store)
  registerPresetsRoutes(router, ctx);
  registerChatRoutes(router, ctx);
  // Phase 1.5: host-called routes and Work Status (documentation/specs/phase-1-5-sdk-2-7.md §3.5)
  registerSessionEventsRoutes(router, ctx, turnEvents);
  registerMentionsRoutes(router, ctx);
  registerStatusRoutes(router, ctx);
  // Phase 2: hand edits (the edit pipeline) and saved page data (per-design page state).
  registerEditRoutes(router, ctx);
  registerPageStateRoutes(router, ctx);

  let disposed = false;
  return {
    ctx,
    router,
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const dispose of disposers.reverse()) {
        try {
          await dispose();
        } catch (error) {
          log.warn('service.dispose-failed', { error: error instanceof Error ? error.message : String(error) });
        }
      }
    },
  };
};
