import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { PAGE_STATE_CAP_SENTENCE, PAGE_STATE_CLEARED_ELSEWHERE_SENTENCE, PAGE_STATE_UNSAVED_SENTENCE } from '../../src/guest/page-state.ts';
import {
  CLEARED_SENTENCE,
  CLEAR_DIALOG_BODY,
  clearDialogTitle,
  clearFailureText,
  pageDataEntry,
  pageDataNotice,
  PAGE_DATA_CLEAR_LABEL,
  type PageDataNoticeKind,
} from '../../src/ui/model/page-state-model.ts';
import { onReadyMessages, setSlotStorage, setSlotTokens, slotStorage, slotTokens } from '../../src/ui/model/slot-seed.ts';

describe('the Clear saved page data menu entry', () => {
  test('is hidden when nothing is saved, and when this view could not read the saved data', () => {
    assert.equal(pageDataEntry({ chars: 0, persisting: true, viewing: false }), 'hidden');
    assert.equal(pageDataEntry({ chars: 120, persisting: false, viewing: false }), 'hidden');
  });

  test('is enabled once the design has saved data', () => {
    assert.equal(pageDataEntry({ chars: 1, persisting: true, viewing: false }), 'enabled');
  });

  test('is off, not hidden, while an old version is on show', () => {
    assert.equal(pageDataEntry({ chars: 1, persisting: true, viewing: true }), 'disabled');
    // Nothing saved: still nothing to show, a version or not.
    assert.equal(pageDataEntry({ chars: 0, persisting: true, viewing: true }), 'hidden');
  });

  test('says what it does', () => {
    assert.equal(PAGE_DATA_CLEAR_LABEL, 'Clear saved page data');
  });
});

describe('the confirm dialog words', () => {
  test('the title names the design, the body says what resets and that it cannot be undone', () => {
    assert.equal(clearDialogTitle('Tidepool site'), 'Clear saved page data for Tidepool site?');
    assert.equal(CLEAR_DIALOG_BODY, "Ticks, toggles and filters this design saved will be reset. This can't be undone.");
  });

  test('a failure keeps the service’s own words after ours', () => {
    assert.equal(clearFailureText('The local service didn’t answer.'), 'Couldn’t clear the saved page data. The local service didn’t answer.');
  });
});

describe('the notices', () => {
  test('each shows the exact sentence, warning for the ones about data not saved', () => {
    assert.deepEqual(pageDataNotice('cap'), { tone: 'warning', title: "This design tried to save more than 1 MB of page data. The extra wasn't saved.", ttlMs: 10_000 });
    assert.deepEqual(pageDataNotice('cleared'), { tone: 'success', title: 'Saved page data cleared.', ttlMs: 5_000 });
    assert.equal(pageDataNotice('cleared-elsewhere').title, 'Saved page data was cleared.');
    assert.equal(pageDataNotice('cleared-elsewhere').tone, 'info');
  });

  test('"can’t be saved" is a title and a body that read as the controller’s one sentence', () => {
    const notice = pageDataNotice('unsaved');
    assert.equal(notice.tone, 'warning');
    assert.equal(`${notice.title} ${notice.body}`, PAGE_STATE_UNSAVED_SENTENCE);
  });

  test('the sentences the controller owns come through unchanged', () => {
    assert.equal(pageDataNotice('cap').title, PAGE_STATE_CAP_SENTENCE);
    assert.equal(pageDataNotice('cleared-elsewhere').title, PAGE_STATE_CLEARED_ELSEWHERE_SENTENCE);
    assert.equal(CLEARED_SENTENCE, 'Saved page data cleared.');
  });

  test('every kind the controller can raise has a notice (a new kind fails the typecheck here)', () => {
    const kinds: Record<PageDataNoticeKind, true> = { unsaved: true, cap: true, 'cleared-elsewhere': true, cleared: true };
    for (const kind of Object.keys(kinds) as PageDataNoticeKind[]) assert.ok(pageDataNotice(kind).title.length > 0);
  });
});

describe('what a frame is seeded with (slot-seed)', () => {
  afterEach(() => {
    setSlotTokens('d', []);
  });

  test('a frame that turns ready is told the preview, also when it is empty (KI-20)', () => {
    setSlotTokens('d', [{ name: '--accent-h', value: '200' }]);
    assert.deepEqual(onReadyMessages('d'), [{ type: 'set-tokens', vars: [{ name: '--accent-h', value: '200' }] }]);
    // A Reset or Discard while the frame was loading: the frame still gets the (now empty) preview, which clears what it wore.
    setSlotTokens('d', []);
    assert.deepEqual(onReadyMessages('d'), [{ type: 'set-tokens', vars: [] }]);
    assert.deepEqual(onReadyMessages('never-previewed'), [{ type: 'set-tokens', vars: [] }]);
  });

  test('the preview is kept by design slug', () => {
    setSlotTokens('d', [{ name: '--gap', value: '8px' }]);
    assert.deepEqual(slotTokens('other'), []);
    assert.equal(slotTokens('d').length, 1);
  });

  test('the saved data is registered per design and forgotten by the registration that made it', () => {
    const first = { ready: Promise.resolve(), init: () => ({ persist: true, items: [['k', 'v']] as [string, string][] }) };
    const second = { ready: Promise.resolve(), init: () => ({ persist: true, items: [] as [string, string][] }) };
    const forgetFirst = setSlotStorage('d', first);
    assert.equal(slotStorage('d'), first);
    assert.equal(slotStorage('other'), undefined);
    // The design was closed and reopened: the old view's late cleanup must not remove the new registration.
    const forgetSecond = setSlotStorage('d', second);
    forgetFirst();
    assert.equal(slotStorage('d'), second);
    forgetSecond();
    assert.equal(slotStorage('d'), undefined);
  });
});
