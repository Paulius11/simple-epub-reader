// Thin wrapper over localStorage. Survives gracefully when storage is
// unavailable (private mode, quota exceeded) by returning defaults / no-oping.

const KEY_SETTINGS = 'epub-reader:settings';
const KEY_RECENT = 'epub-reader:recent';
const KEY_BOOKMARKS = (bookId) => `epub-reader:bookmarks:${bookId}`;
const KEY_PROGRESS = (bookId) => `epub-reader:progress:${bookId}`;

const MAX_RECENT = 8;
const MAX_BOOKMARKS_PER_BOOK = 100;

const DEFAULT_SETTINGS = {
  darkMode: null, // null = follow system; true/false = user override
  fontSize: 18, // px
  fontFamily: 'serif', // 'serif' | 'sans' | 'mono'
  lineHeight: 1.7,
  pageWidth: 720, // px max-width
};

const safeGet = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
};

const safeSet = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

const safeRemove = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
};

// --- Settings ---------------------------------------------------------------

export const getSettings = () => ({ ...DEFAULT_SETTINGS, ...(safeGet(KEY_SETTINGS) || {}) });

export const saveSettings = (partial) => {
  const merged = { ...getSettings(), ...partial };
  safeSet(KEY_SETTINGS, merged);
  return merged;
};

// --- Recent books -----------------------------------------------------------

export const getRecent = () => safeGet(KEY_RECENT) || [];

export const addRecent = ({ bookId, title, author, cover }) => {
  if (!bookId) return getRecent();
  const list = getRecent().filter((b) => b.bookId !== bookId);
  list.unshift({
    bookId,
    title: title || 'Unknown Title',
    author: author || 'Unknown Author',
    cover: cover || null,
    lastOpenedAt: Date.now(),
  });
  const trimmed = list.slice(0, MAX_RECENT);
  safeSet(KEY_RECENT, trimmed);
  return trimmed;
};

export const removeRecent = (bookId) => {
  const trimmed = getRecent().filter((b) => b.bookId !== bookId);
  safeSet(KEY_RECENT, trimmed);
  return trimmed;
};

// --- Per-book progress ------------------------------------------------------

export const getProgress = (bookId) =>
  bookId ? safeGet(KEY_PROGRESS(bookId)) || { chapterIndex: 0, scrollRatio: 0 } : null;

export const saveProgress = (bookId, { chapterIndex, scrollRatio }) => {
  if (!bookId) return;
  safeSet(KEY_PROGRESS(bookId), {
    chapterIndex,
    scrollRatio: Math.max(0, Math.min(1, scrollRatio || 0)),
    updatedAt: Date.now(),
  });
};

// --- Per-book bookmarks -----------------------------------------------------

export const getBookmarks = (bookId) => (bookId ? safeGet(KEY_BOOKMARKS(bookId)) || [] : []);

export const addBookmark = (bookId, { chapterIndex, chapterTitle, scrollRatio, snippet }) => {
  if (!bookId) return [];
  const list = getBookmarks(bookId);
  list.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    chapterIndex,
    chapterTitle: chapterTitle || `Chapter ${chapterIndex + 1}`,
    scrollRatio: Math.max(0, Math.min(1, scrollRatio || 0)),
    snippet: (snippet || '').slice(0, 200),
    createdAt: Date.now(),
  });
  const trimmed = list.slice(0, MAX_BOOKMARKS_PER_BOOK);
  safeSet(KEY_BOOKMARKS(bookId), trimmed);
  return trimmed;
};

export const removeBookmark = (bookId, id) => {
  if (!bookId) return [];
  const trimmed = getBookmarks(bookId).filter((b) => b.id !== id);
  safeSet(KEY_BOOKMARKS(bookId), trimmed);
  return trimmed;
};

// Exposed for tests/debugging.
export const __internals = {
  KEY_SETTINGS,
  KEY_RECENT,
  KEY_BOOKMARKS,
  KEY_PROGRESS,
  DEFAULT_SETTINGS,
  MAX_RECENT,
  safeGet,
  safeSet,
  safeRemove,
};
