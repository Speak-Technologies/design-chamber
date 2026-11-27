// The icon pictures of one system, for the section panel (system-builder-depth T10c). They come out of the
// specimen board (`iconPictures`): loaded when the Assets section is first opened, again after the files change.

import { client, host } from '../guest.ts';
import { iconPictures, type IconPicture } from '../model/system-assets-model.ts';
import { boardScheme } from '../model/system-page-model.ts';

export type IconView = {
  state: 'loading' | 'ready' | 'error';
  /** By icon file. */
  pictures: ReadonlyMap<string, IconPicture>;
};

export type IconStore = {
  /** The current answer; starts a load when there is none or the files changed. */
  view: (files: readonly string[]) => IconView;
  /** The system's files changed: the next `view` loads again, showing the old pictures meanwhile. */
  invalidate: () => void;
  retry: () => void;
  dispose: () => void;
};

export const createIconStore = (id: string, onChange: () => void): IconStore => {
  let state: IconView['state'] = 'loading';
  let pictures: ReadonlyMap<string, IconPicture> = new Map();
  let stale = true;
  let running = false;
  let disposed = false;

  const load = (files: readonly string[]): void => {
    stale = false;
    running = true;
    client.loadBoard(id, null, boardScheme(host.snapshot()?.theme.mode)).then(
      (doc) => {
        const found = iconPictures(doc.html);
        pictures = new Map(files.flatMap((file, index) => {
          const picture = found.get(index);
          return picture === undefined ? [] : [[file, picture] as const];
        }));
        state = 'ready';
        running = false;
        if (!disposed) onChange();
      },
      (error: unknown) => {
        console.warn('Design Chamber: icon pictures failed', error);
        state = 'error';
        running = false;
        if (!disposed) onChange();
      },
    );
  };

  return {
    view: (files) => {
      if (stale && !running) {
        if (state === 'error') state = 'loading';
        load(files);
      }
      return { state, pictures };
    },
    invalidate: () => {
      stale = true;
    },
    retry: () => {
      stale = true;
      state = 'loading';
      onChange();
    },
    dispose: () => {
      disposed = true;
    },
  };
};
