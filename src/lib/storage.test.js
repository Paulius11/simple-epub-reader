/* eslint-env jest */
import * as storage from './storage';

beforeEach(() => {
  localStorage.clear();
});

describe('settings', () => {
  it('returns defaults when nothing is stored', () => {
    const s = storage.getSettings();
    expect(s.fontSize).toBe(18);
    expect(s.fontFamily).toBe('serif');
    expect(s.lineHeight).toBe(1.7);
    expect(s.pageWidth).toBe(720);
    expect(s.darkMode).toBeNull();
  });

  it('merges partial overrides with defaults', () => {
    storage.saveSettings({ fontSize: 24 });
    const s = storage.getSettings();
    expect(s.fontSize).toBe(24);
    expect(s.fontFamily).toBe('serif'); // untouched
  });

  it('persists across calls', () => {
    storage.saveSettings({ darkMode: true, fontFamily: 'sans' });
    const s = storage.getSettings();
    expect(s.darkMode).toBe(true);
    expect(s.fontFamily).toBe('sans');
  });
});

describe('recent books', () => {
  it('returns empty list when nothing stored', () => {
    expect(storage.getRecent()).toEqual([]);
  });

  it('adds a book to the front of the list', () => {
    storage.addRecent({ bookId: 'a', title: 'A', author: 'X' });
    storage.addRecent({ bookId: 'b', title: 'B', author: 'Y' });
    const list = storage.getRecent();
    expect(list.map((b) => b.bookId)).toEqual(['b', 'a']);
  });

  it('deduplicates by bookId — re-adding moves to front', () => {
    storage.addRecent({ bookId: 'a', title: 'A' });
    storage.addRecent({ bookId: 'b', title: 'B' });
    storage.addRecent({ bookId: 'a', title: 'A v2' });
    const list = storage.getRecent();
    expect(list).toHaveLength(2);
    expect(list[0].bookId).toBe('a');
    expect(list[0].title).toBe('A v2');
  });

  it('caps the list at MAX_RECENT', () => {
    for (let i = 0; i < storage.__internals.MAX_RECENT + 5; i++) {
      storage.addRecent({ bookId: `b${i}`, title: `T${i}` });
    }
    expect(storage.getRecent()).toHaveLength(storage.__internals.MAX_RECENT);
  });

  it('ignores adds with missing bookId', () => {
    storage.addRecent({ bookId: '', title: 'no id' });
    expect(storage.getRecent()).toEqual([]);
  });

  it('removes a specific book', () => {
    storage.addRecent({ bookId: 'a', title: 'A' });
    storage.addRecent({ bookId: 'b', title: 'B' });
    storage.removeRecent('a');
    const list = storage.getRecent();
    expect(list).toHaveLength(1);
    expect(list[0].bookId).toBe('b');
  });
});

describe('progress', () => {
  it('returns default progress when nothing saved', () => {
    expect(storage.getProgress('x')).toEqual({ chapterIndex: 0, scrollRatio: 0 });
  });

  it('saves and reads progress', () => {
    storage.saveProgress('x', { chapterIndex: 5, scrollRatio: 0.42 });
    const p = storage.getProgress('x');
    expect(p.chapterIndex).toBe(5);
    expect(p.scrollRatio).toBeCloseTo(0.42);
  });

  it('clamps scrollRatio to [0, 1]', () => {
    storage.saveProgress('x', { chapterIndex: 1, scrollRatio: 5 });
    expect(storage.getProgress('x').scrollRatio).toBe(1);
    storage.saveProgress('x', { chapterIndex: 1, scrollRatio: -2 });
    expect(storage.getProgress('x').scrollRatio).toBe(0);
  });

  it('keeps progress separate per book', () => {
    storage.saveProgress('a', { chapterIndex: 1, scrollRatio: 0 });
    storage.saveProgress('b', { chapterIndex: 9, scrollRatio: 0.5 });
    expect(storage.getProgress('a').chapterIndex).toBe(1);
    expect(storage.getProgress('b').chapterIndex).toBe(9);
  });
});

describe('bookmarks', () => {
  it('returns empty list when no bookmarks', () => {
    expect(storage.getBookmarks('x')).toEqual([]);
  });

  it('adds bookmarks and returns them in newest-first order', () => {
    storage.addBookmark('x', { chapterIndex: 0, chapterTitle: 'A', scrollRatio: 0, snippet: 'one' });
    storage.addBookmark('x', { chapterIndex: 1, chapterTitle: 'B', scrollRatio: 0, snippet: 'two' });
    const list = storage.getBookmarks('x');
    expect(list).toHaveLength(2);
    expect(list[0].snippet).toBe('two');
    expect(list[1].snippet).toBe('one');
  });

  it('assigns a unique id to each bookmark', () => {
    storage.addBookmark('x', { chapterIndex: 0, chapterTitle: 'A', scrollRatio: 0 });
    storage.addBookmark('x', { chapterIndex: 0, chapterTitle: 'A', scrollRatio: 0 });
    const list = storage.getBookmarks('x');
    expect(list[0].id).not.toBe(list[1].id);
  });

  it('removes a bookmark by id', () => {
    storage.addBookmark('x', { chapterIndex: 0, chapterTitle: 'A', scrollRatio: 0 });
    storage.addBookmark('x', { chapterIndex: 1, chapterTitle: 'B', scrollRatio: 0 });
    const list = storage.getBookmarks('x');
    storage.removeBookmark('x', list[0].id);
    const after = storage.getBookmarks('x');
    expect(after).toHaveLength(1);
    expect(after[0].chapterTitle).toBe('A');
  });

  it('truncates snippets to 200 chars', () => {
    const huge = 'a'.repeat(500);
    storage.addBookmark('x', { chapterIndex: 0, scrollRatio: 0, snippet: huge });
    expect(storage.getBookmarks('x')[0].snippet).toHaveLength(200);
  });

  it('keeps bookmarks separate per book', () => {
    storage.addBookmark('a', { chapterIndex: 0, scrollRatio: 0 });
    storage.addBookmark('b', { chapterIndex: 0, scrollRatio: 0 });
    expect(storage.getBookmarks('a')).toHaveLength(1);
    expect(storage.getBookmarks('b')).toHaveLength(1);
  });
});

describe('resilience', () => {
  it('does not throw if localStorage.getItem throws', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => storage.getSettings()).not.toThrow();
    expect(() => storage.getRecent()).not.toThrow();
    expect(() => storage.getBookmarks('x')).not.toThrow();
    spy.mockRestore();
  });

  it('does not throw if localStorage.setItem throws (quota)', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    expect(() => storage.saveSettings({ fontSize: 22 })).not.toThrow();
    expect(() => storage.addRecent({ bookId: 'a', title: 'A' })).not.toThrow();
    expect(() => storage.saveProgress('a', { chapterIndex: 0, scrollRatio: 0 })).not.toThrow();
    spy.mockRestore();
  });
});
