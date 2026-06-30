import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Moon,
  Sun,
  Book,
  X,
  Menu,
  Home,
  List,
  Bookmark,
  BookmarkPlus,
  Type,
  Trash2,
  Copy,
} from 'lucide-react';
import { parseEpub } from './lib/epub';
import * as storage from './lib/storage';
import { saveEpubBlob, getEpubBlob, deleteEpubBlob, listEpubBlobKeys } from './lib/blobStore';

// Render text with the search term highlighted.
const HighlightedText = ({ text, searchQuery }) => {
  if (!searchQuery || !text) return <span>{text}</span>;
  const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  const parts = text.split(regex);
  return (
    <span>
      {parts.map((part, index) =>
        part.toLowerCase() === searchQuery.toLowerCase() ? (
          <mark key={index} className="inline-highlight">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </span>
  );
};

const FONT_FAMILIES = {
  serif: 'Georgia, "Times New Roman", serif',
  sans: '-apple-system, "Segoe UI", system-ui, sans-serif',
  mono: '"SF Mono", Menlo, Consolas, monospace',
};

const formatTimeLeft = (minutes) => {
  if (!isFinite(minutes) || minutes <= 0) return '0 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return m ? `${h}h ${m}m` : `${h}h`;
};

const formatRelative = (ts) => {
  if (!ts) return '';
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const EPUBReader = () => {
  // --- book state ----------------------------------------------------------
  const [epub, setEpub] = useState(null);
  const [currentChapter, setCurrentChapter] = useState(0);
  const [chapters, setChapters] = useState([]);
  const [content, setContent] = useState('');
  const [metadata, setMetadata] = useState({});

  // --- ui state ------------------------------------------------------------
  const [darkMode, setDarkMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [readingMode, setReadingMode] = useState(false);
  const [showFloatingMenu, setShowFloatingMenu] = useState(false);

  // --- new in this revision ------------------------------------------------
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('toc'); // 'toc' | 'bookmarks'
  const [showFontPanel, setShowFontPanel] = useState(false);
  const [settings, setSettings] = useState(storage.getSettings());
  const [bookmarks, setBookmarks] = useState([]);
  const [recent, setRecent] = useState(() => storage.getRecent());
  const [chapterScrollRatio, setChapterScrollRatio] = useState(0);

  const fileInputRef = useRef(null);
  const contentRef = useRef(null);
  const searchInputRef = useRef(null);
  const progressSaveTimer = useRef(null);

  const bookId = metadata?.bookId;

  // --- settings & theme bootstrap -----------------------------------------

  // Apply persisted darkMode (or follow system) on first load.
  useEffect(() => {
    if (settings.darkMode === null) {
      const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
      setDarkMode(!!prefersDark);
    } else {
      setDarkMode(!!settings.darkMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSettings = (partial) => {
    const merged = storage.saveSettings(partial);
    setSettings(merged);
  };

  const toggleTheme = () => {
    const next = !darkMode;
    setDarkMode(next);
    updateSettings({ darkMode: next });
  };

  // --- parse + load EPUB ---------------------------------------------------

  const parseEPUB = async (file) => {
    console.log(
      '[parseEPUB] ENTER',
      file?.constructor?.name,
      'size=' + (file?.size ?? '?'),
      'type=' + (file?.type ?? '?')
    );
    try {
      const { metadata: meta, chapters: loadedChapters } = await parseEpub(file);
      console.log(
        '[parseEPUB] parsed OK bookId="' + meta.bookId + '" chapters=' + loadedChapters.length
      );
      setMetadata(meta);
      setChapters(loadedChapters);
      setEpub(file);

      // Restore progress (if any) or start from chapter 0.
      const progress = storage.getProgress(meta.bookId);
      const startIndex = Math.min(
        Math.max(0, progress?.chapterIndex || 0),
        loadedChapters.length - 1
      );
      setCurrentChapter(startIndex);
      setContent(loadedChapters[startIndex].content);
      setChapterScrollRatio(progress?.scrollRatio || 0);

      // Restore bookmarks for this book.
      setBookmarks(storage.getBookmarks(meta.bookId));

      // Track in recent.
      setRecent(
        storage.addRecent({
          bookId: meta.bookId,
          title: meta.title,
          author: meta.author,
          cover: meta.cover,
        })
      );

      // Persist the file bytes so the user can reopen from the recent grid
      // without re-picking the file.
      console.log('[parseEPUB] about to save blob for bookId="' + meta.bookId + '"');
      const saved = await saveEpubBlob(meta.bookId, file);
      console.log('[parseEPUB] save result: ' + saved);
      if (!saved) {
        console.warn(
          'EPUB blob not cached (bookId=' +
            meta.bookId +
            '). Re-opening from "recent" will require re-picking the file.'
        );
      }
    } catch (error) {
      console.error('Error parsing EPUB:', error);
      alert('Error loading EPUB file: ' + error.message);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.epub')) {
      alert('Please select an .epub file. PDFs and other formats are not supported.');
      e.target.value = '';
      return;
    }
    parseEPUB(file);
  };

  // After the chapter content renders, scroll to the saved position (once).
  useEffect(() => {
    if (!contentRef.current || !content) return;
    const el = contentRef.current;
    requestAnimationFrame(() => {
      const max = el.scrollHeight - el.clientHeight;
      el.scrollTop = max > 0 ? max * chapterScrollRatio : 0;
    });
    // We intentionally only restore on chapter changes, not on every scroll-ratio update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, currentChapter]);

  // Re-process images after content renders (preserved from previous version).
  useEffect(() => {
    if (contentRef.current && content) {
      const images = contentRef.current.querySelectorAll('img[data-loaded="true"]');
      images.forEach((img) => {
        const dataSrc = img.getAttribute('data-src');
        if (dataSrc && (!img.src || img.src !== dataSrc)) {
          img.src = dataSrc;
        }
      });
    }
  }, [content, currentChapter]);

  // --- scroll tracking + progress persistence ------------------------------

  const handleContentScroll = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const ratio = max > 0 ? el.scrollTop / max : 0;
    setChapterScrollRatio(ratio);

    // Debounce-write to localStorage.
    if (!bookId) return;
    if (progressSaveTimer.current) clearTimeout(progressSaveTimer.current);
    progressSaveTimer.current = setTimeout(() => {
      storage.saveProgress(bookId, { chapterIndex: currentChapter, scrollRatio: ratio });
    }, 400);
  }, [bookId, currentChapter]);

  // Save progress immediately on chapter change.
  useEffect(() => {
    if (bookId) storage.saveProgress(bookId, { chapterIndex: currentChapter, scrollRatio: 0 });
  }, [bookId, currentChapter]);

  // --- navigation ----------------------------------------------------------

  const goToChapter = useCallback(
    (index, opts = {}) => {
      if (index < 0 || index >= chapters.length) return;
      setCurrentChapter(index);
      setContent(chapters[index].content);
      setChapterScrollRatio(opts.scrollRatio || 0);
      if (contentRef.current && !opts.scrollRatio) contentRef.current.scrollTop = 0;
      if (sidebarOpen) setSidebarOpen(false);
      if (showFontPanel) setShowFontPanel(false);
      // Only reset search UI state; do NOT call clearSearch, which would
      // overwrite the freshly-set chapter content with the (stale) previous
      // chapter via its closure-captured currentChapter.
      resetSearchState();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chapters, sidebarOpen, showFontPanel]
  );

  // --- search --------------------------------------------------------------

  const performSearch = useCallback(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2 || !chapters.length) {
      setSearchResults([]);
      return;
    }
    const results = [];
    const maxResultsPerChapter = 5;
    const maxTotalResults = 50;
    chapters.forEach((chapter, chapterIndex) => {
      if (results.length >= maxTotalResults) return;
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = chapter.content;
      const text = tempDiv.textContent || tempDiv.innerText || '';
      const regex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      let match;
      let chapterResults = 0;
      while ((match = regex.exec(text)) !== null && chapterResults < maxResultsPerChapter) {
        const start = Math.max(0, match.index - 50);
        const end = Math.min(text.length, match.index + searchQuery.length + 50);
        let context = text.substring(start, end);
        if (start > 0) context = '...' + context;
        if (end < text.length) context = context + '...';
        results.push({
          chapterIndex,
          chapterTitle: chapter.title,
          context,
          matchIndex: match.index,
          matchText: match[0],
        });
        chapterResults++;
        if (match.index === regex.lastIndex) regex.lastIndex++;
      }
    });
    setSearchResults(results);
  }, [searchQuery, chapters]);

  useEffect(() => {
    const debounceTimer = setTimeout(() => performSearch(), 500);
    return () => clearTimeout(debounceTimer);
  }, [searchQuery, performSearch]);

  const goToSearchResult = (result) => {
    setCurrentChapter(result.chapterIndex);
    setContent(chapters[result.chapterIndex].content);
    setIsSearching(false);
    if (contentRef.current) contentRef.current.scrollTop = 0;
    setTimeout(() => highlightSearchText(searchQuery, result.chapterIndex), 200);
  };

  const highlightSearchText = (text, chapterIndex = currentChapter) => {
    if (!text || !chapters[chapterIndex]) return;
    const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedText})`, 'gi');
    const highlighted = chapters[chapterIndex].content.replace(
      regex,
      '<mark class="search-highlight">$1</mark>'
    );
    setContent(highlighted);
    setTimeout(() => {
      contentRef.current?.querySelector('.search-highlight')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 100);
  };

  // Reset only the search UI state. Does NOT touch chapter content — safe to
  // call from goToChapter, where content has just been set to a new chapter.
  const resetSearchState = () => {
    setSearchQuery('');
    setSearchResults([]);
    setIsSearching(false);
    if (searchInputRef.current) searchInputRef.current.blur();
  };

  // Full clear: also drops search-result highlights from the visible chapter
  // by restoring the original chapter HTML. Used when the user dismisses the
  // search panel directly.
  const clearSearch = () => {
    resetSearchState();
    if (chapters[currentChapter]) setContent(chapters[currentChapter].content);
  };

  // --- bookmarks -----------------------------------------------------------

  const addBookmarkHere = () => {
    if (!bookId || !chapters[currentChapter]) return;
    // Snippet = first ~120 chars of currently visible text.
    let snippet = '';
    const el = contentRef.current;
    if (el) {
      const text = el.innerText || '';
      // Approximate visible offset using scrollRatio.
      const start = Math.floor(text.length * chapterScrollRatio);
      snippet = text.substring(start, start + 120).replace(/\s+/g, ' ').trim();
    }
    const updated = storage.addBookmark(bookId, {
      chapterIndex: currentChapter,
      chapterTitle: chapters[currentChapter].title,
      scrollRatio: chapterScrollRatio,
      snippet,
    });
    setBookmarks(updated);
    setSidebarTab('bookmarks');
    setSidebarOpen(true);
  };

  const goToBookmark = (bm) => {
    goToChapter(bm.chapterIndex, { scrollRatio: bm.scrollRatio });
  };

  const deleteBookmark = (e, id) => {
    e.stopPropagation();
    setBookmarks(storage.removeBookmark(bookId, id));
  };

  // --- select-all in current chapter --------------------------------------

  const selectAllChapterText = () => {
    const el = contentRef.current;
    if (!el) return;
    const selection = window.getSelection?.();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    el.focus?.();
  };

  // --- reading mode --------------------------------------------------------

  const toggleReadingMode = () => {
    setReadingMode(!readingMode);
    setShowFloatingMenu(false);
    setSidebarOpen(false);
  };

  // --- keyboard ------------------------------------------------------------

  useEffect(() => {
    const handleKeyPress = (e) => {
      // Don't hijack typing in inputs.
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;

      if (e.key === 'ArrowLeft') goToChapter(currentChapter - 1);
      if (e.key === 'ArrowRight') goToChapter(currentChapter + 1);
      if (e.key === 'Escape') {
        if (readingMode) toggleReadingMode();
        else if (sidebarOpen) setSidebarOpen(false);
        else if (showFontPanel) setShowFontPanel(false);
        else if (isSearching) clearSearch();
      }
      if (e.key === 'b' || e.key === 'B') addBookmarkHere();
      if (e.key === 't' || e.key === 'T') setSidebarOpen((v) => !v);
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChapter, readingMode, isSearching, sidebarOpen, showFontPanel, chapters, bookId, chapterScrollRatio]);

  // --- back to home --------------------------------------------------------

  const backToMenu = () => {
    if (bookId)
      storage.saveProgress(bookId, {
        chapterIndex: currentChapter,
        scrollRatio: chapterScrollRatio,
      });
    setEpub(null);
    setChapters([]);
    setContent('');
    setMetadata({});
    setCurrentChapter(0);
    setBookmarks([]);
    setSidebarOpen(false);
    setShowFontPanel(false);
    clearSearch();
    setReadingMode(false);
    setRecent(storage.getRecent());
  };

  const openRecentBook = async (book) => {
    console.log(`[openRecentBook] CLICK bookId="${book.bookId}" title="${book.title}"`);
    let blob;
    try {
      blob = await getEpubBlob(book.bookId);
      console.log(
        `[openRecentBook] getEpubBlob resolved →`,
        blob
          ? { found: true, size: blob.size, type: blob.type, constructor: blob.constructor?.name }
          : { found: false }
      );
    } catch (err) {
      console.error('[openRecentBook] getEpubBlob threw:', err);
      blob = null;
    }

    if (blob) {
      try {
        await parseEPUB(blob);
        console.log('[openRecentBook] parseEPUB completed');
      } catch (err) {
        console.error('[openRecentBook] parseEPUB threw:', err);
      }
      return;
    }

    // No blob cached — show what IS in the store so key mismatches are visible.
    const presentKeys = await listEpubBlobKeys();
    console.warn(
      `[openRecentBook] MISS for bookId="${book.bookId}". ` +
        `IDB store keys=[${presentKeys.join(', ')}]. Opening file picker.`
    );
    fileInputRef.current?.click();
  };

  const removeRecentBook = (e, id) => {
    e.stopPropagation();
    setRecent(storage.removeRecent(id));
    deleteEpubBlob(id);
  };

  // --- derived: progress + time estimate -----------------------------------

  const { bookProgress, chapterProgress, minutesLeft, totalChapters } = useMemo(() => {
    if (!chapters.length) {
      return { bookProgress: 0, chapterProgress: 0, minutesLeft: 0, totalChapters: 0 };
    }
    const totalWords = chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);
    const wordsBefore = chapters
      .slice(0, currentChapter)
      .reduce((sum, c) => sum + (c.wordCount || 0), 0);
    const currentWords = chapters[currentChapter]?.wordCount || 0;
    const wordsRead = wordsBefore + currentWords * chapterScrollRatio;
    const bp = totalWords > 0 ? wordsRead / totalWords : 0;
    const cp = chapterScrollRatio;
    const wpm = 250;
    const minLeft = (totalWords - wordsRead) / wpm;
    return {
      bookProgress: bp,
      chapterProgress: cp,
      minutesLeft: minLeft,
      totalChapters: chapters.length,
    };
  }, [chapters, currentChapter, chapterScrollRatio]);

  // --- theming / typography vars -------------------------------------------

  const themeVars = {
    '--bg-primary': darkMode ? '#0a0a0a' : '#ffffff',
    '--bg-secondary': darkMode ? '#1a1a1a' : '#f3f4f6',
    '--bg-tertiary': darkMode ? '#2a2a2a' : '#e5e7eb',
    '--text-primary': darkMode ? '#ffffff' : '#000000',
    '--text-secondary': darkMode ? '#a0a0a0' : '#6b7280',
    '--border-color': darkMode ? '#333333' : '#e5e7eb',
    '--gradient-start': darkMode ? '#1e3a8a' : '#3b82f6',
    '--gradient-end': darkMode ? '#7c3aed' : '#8b5cf6',
    '--reader-font-family': FONT_FAMILIES[settings.fontFamily] || FONT_FAMILIES.serif,
    '--reader-font-size': `${settings.fontSize}px`,
    '--reader-line-height': settings.lineHeight,
    '--reader-page-width': `${settings.pageWidth}px`,
  };

  // --- sub-renders ---------------------------------------------------------

  const renderProgressBar = () => (
    <div className="progress-bar">
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: `${Math.round(bookProgress * 100)}%` }}
        />
      </div>
      <div className="progress-meta">
        <span>
          Chapter {currentChapter + 1} of {totalChapters}
        </span>
        <span className="progress-dot">·</span>
        <span>{Math.round(bookProgress * 100)}% book</span>
        <span className="progress-dot">·</span>
        <span>{Math.round(chapterProgress * 100)}% chapter</span>
        <span className="progress-dot">·</span>
        <span>{formatTimeLeft(minutesLeft)} left</span>
      </div>
    </div>
  );

  const renderFontPanel = () => (
    <div className={`font-panel ${showFontPanel ? 'show' : ''}`} role="dialog">
      <div className="font-row">
        <label>Size</label>
        <div className="font-stepper">
          <button
            type="button"
            onClick={() => updateSettings({ fontSize: Math.max(12, settings.fontSize - 1) })}
            aria-label="Decrease font size"
          >
            −
          </button>
          <span className="font-value">{settings.fontSize}px</span>
          <button
            type="button"
            onClick={() => updateSettings({ fontSize: Math.min(32, settings.fontSize + 1) })}
            aria-label="Increase font size"
          >
            +
          </button>
        </div>
      </div>
      <div className="font-row">
        <label>Family</label>
        <div className="font-family-group" role="radiogroup">
          {['serif', 'sans', 'mono'].map((f) => (
            <button
              key={f}
              type="button"
              className={settings.fontFamily === f ? 'active' : ''}
              onClick={() => updateSettings({ fontFamily: f })}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="font-row">
        <label>Line height</label>
        <input
          type="range"
          min="1.2"
          max="2.2"
          step="0.05"
          value={settings.lineHeight}
          onChange={(e) => updateSettings({ lineHeight: parseFloat(e.target.value) })}
        />
        <span className="font-value">{settings.lineHeight.toFixed(2)}</span>
      </div>
      <div className="font-row">
        <label>Page width</label>
        <input
          type="range"
          min="480"
          max="1100"
          step="20"
          value={settings.pageWidth}
          onChange={(e) => updateSettings({ pageWidth: parseInt(e.target.value, 10) })}
        />
        <span className="font-value">{settings.pageWidth}px</span>
      </div>
    </div>
  );

  const renderSidebar = () => (
    <>
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'show' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />
      <aside className={`sidebar ${sidebarOpen ? 'show' : ''}`} aria-hidden={!sidebarOpen}>
        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab ${sidebarTab === 'toc' ? 'active' : ''}`}
            onClick={() => setSidebarTab('toc')}
          >
            <List size={16} /> Contents
          </button>
          <button
            className={`sidebar-tab ${sidebarTab === 'bookmarks' ? 'active' : ''}`}
            onClick={() => setSidebarTab('bookmarks')}
          >
            <Bookmark size={16} /> Bookmarks ({bookmarks.length})
          </button>
          <button
            className="sidebar-close icon-button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>
        <div className="sidebar-body">
          {sidebarTab === 'toc' ? (
            <ul className="toc-list">
              {chapters.map((c, i) => (
                <li
                  key={i}
                  className={`toc-item ${i === currentChapter ? 'active' : ''}`}
                  onClick={() => goToChapter(i)}
                >
                  <span className="toc-index">{i + 1}</span>
                  <span className="toc-title">{c.title}</span>
                </li>
              ))}
            </ul>
          ) : bookmarks.length === 0 ? (
            <div className="empty-state">
              <Bookmark size={32} />
              <p>No bookmarks yet.</p>
              <p className="muted">
                Press <kbd>B</kbd> or use the bookmark button while reading.
              </p>
            </div>
          ) : (
            <ul className="bookmark-list">
              {bookmarks.map((bm) => (
                <li key={bm.id} className="bookmark-item" onClick={() => goToBookmark(bm)}>
                  <div className="bookmark-head">
                    <span className="bookmark-chapter">{bm.chapterTitle}</span>
                    <button
                      className="icon-button bookmark-delete"
                      onClick={(e) => deleteBookmark(e, bm.id)}
                      aria-label="Delete bookmark"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {bm.snippet && <div className="bookmark-snippet">{bm.snippet}</div>}
                  <div className="bookmark-meta muted">{formatRelative(bm.createdAt)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );

  const renderHomeScreen = () => (
    <div className="home-screen">
      <div className="home-inner">
        {recent.length > 0 && (
          <section className="recent-section">
            <h2 className="recent-title">Recent</h2>
            <div className="recent-grid">
              {recent.map((b) => (
                <div key={b.bookId} className="recent-card" onClick={() => openRecentBook(b)}>
                  <div className="recent-cover">
                    {b.cover ? (
                      <img src={b.cover} alt={b.title} />
                    ) : (
                      <div className="recent-cover-fallback">
                        <Book size={32} />
                      </div>
                    )}
                  </div>
                  <div className="recent-card-title" title={b.title}>
                    {b.title}
                  </div>
                  <div className="recent-card-author">{b.author}</div>
                  <div className="recent-card-meta">{formatRelative(b.lastOpenedAt)}</div>
                  <button
                    className="recent-card-remove"
                    onClick={(e) => removeRecentBook(e, b.bookId)}
                    aria-label="Remove from recent"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <p className="muted recent-hint">
              Click a recent book to re-select the EPUB file. Files are not stored — only metadata.
            </p>
          </section>
        )}

        <div className="upload-card">
          <Book className="upload-icon" />
          <h1 className="upload-title">EPUB Reader</h1>
          <p style={{ marginBottom: '30px', color: 'var(--text-secondary)' }}>
            Select an EPUB file to start reading
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".epub"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <button className="upload-button" onClick={() => fileInputRef.current?.click()}>
            Choose EPUB File
          </button>
        </div>
      </div>
    </div>
  );

  // --- main render ---------------------------------------------------------

  return (
    <div
      className="epub-reader"
      style={themeVars}
      data-theme={darkMode ? 'dark' : 'light'}
    >
      {!epub ? (
        renderHomeScreen()
      ) : readingMode ? (
        <div className="reading-mode">
          <button
            className="reading-nav-area prev"
            onClick={() => goToChapter(currentChapter - 1)}
            disabled={currentChapter === 0}
          >
            <ChevronLeft size={40} style={{ marginLeft: '20px' }} />
          </button>

          <div
            ref={contentRef}
            className="reading-mode-content"
            onScroll={handleContentScroll}
            dangerouslySetInnerHTML={{ __html: content }}
          />

          <button
            className="reading-nav-area next"
            onClick={() => goToChapter(currentChapter + 1)}
            disabled={currentChapter === chapters.length - 1}
          >
            <ChevronRight size={40} style={{ marginRight: '20px' }} />
          </button>

          <button className="menu-trigger" onClick={() => setShowFloatingMenu(!showFloatingMenu)}>
            <Menu size={24} />
          </button>

          <div className={`floating-menu ${showFloatingMenu ? 'show' : ''}`}>
            <button className="icon-button" onClick={toggleReadingMode} aria-label="Exit reading mode">
              <X size={20} />
            </button>
            <button className="icon-button" onClick={() => setSidebarOpen(true)} aria-label="Contents">
              <List size={20} />
            </button>
            <button className="icon-button" onClick={addBookmarkHere} aria-label="Bookmark">
              <BookmarkPlus size={20} />
            </button>
            <button
              className="icon-button"
              onClick={selectAllChapterText}
              aria-label="Select all chapter text"
            >
              <Copy size={20} />
            </button>
            <button className="icon-button" onClick={toggleTheme}>
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>

          {renderSidebar()}
          {renderProgressBar()}
        </div>
      ) : (
        <div className="reader-container">
          <header className="header">
            <div className="header-left">
              <button className="back-button" onClick={backToMenu} aria-label="Home">
                <Home size={20} />
              </button>
              <button
                className="icon-button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Contents and bookmarks"
              >
                <List size={20} />
              </button>
              <div className="book-info">
                <div className="book-title">{metadata.title}</div>
                <div className="book-author">{metadata.author}</div>
              </div>
            </div>

            <div className="header-controls">
              <div className="search-container">
                <input
                  ref={searchInputRef}
                  type="text"
                  className="search-input"
                  placeholder="Search in book... (min 2 chars)"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (e.target.value.trim().length >= 2) setIsSearching(true);
                    else {
                      setIsSearching(false);
                      setSearchResults([]);
                    }
                  }}
                  onFocus={() => searchQuery.trim().length >= 2 && setIsSearching(true)}
                />
                <Search className="search-icon" size={18} />
              </div>

              <button className="icon-button" onClick={addBookmarkHere} aria-label="Bookmark this spot">
                <BookmarkPlus size={20} />
              </button>

              <button
                className="icon-button"
                onClick={selectAllChapterText}
                aria-label="Select all chapter text"
                title="Select all text in this chapter"
              >
                <Copy size={20} />
              </button>

              <div className="font-button-wrap">
                <button
                  className="icon-button"
                  onClick={() => setShowFontPanel((v) => !v)}
                  aria-label="Typography"
                  aria-expanded={showFontPanel}
                >
                  <Type size={20} />
                </button>
                {renderFontPanel()}
              </div>

              <button className="icon-button" onClick={toggleTheme} aria-label="Toggle theme">
                {darkMode ? <Sun size={20} /> : <Moon size={20} />}
              </button>

              <button className="icon-button" onClick={toggleReadingMode} aria-label="Reading mode">
                <Book size={20} />
              </button>
            </div>
          </header>

          <div className="content-area">
            <div
              ref={contentRef}
              className="chapter-content"
              onScroll={handleContentScroll}
              dangerouslySetInnerHTML={{ __html: content }}
            />

            {isSearching && (
              <div className={`search-results ${searchResults.length > 0 ? 'active' : ''}`}>
                <div className="search-results-header">
                  <h3 className="search-results-title">{searchResults.length} Results</h3>
                  <button className="icon-button" onClick={clearSearch}>
                    <X size={20} />
                  </button>
                </div>
                {searchResults.map((result, index) => (
                  <div
                    key={index}
                    className="search-result-item"
                    onClick={() => goToSearchResult(result)}
                  >
                    <div className="search-result-chapter">{result.chapterTitle}</div>
                    <div className="search-result-context">
                      <HighlightedText text={result.context} searchQuery={searchQuery} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <nav className="navigation-bar">
            <button
              className="nav-button"
              onClick={() => goToChapter(currentChapter - 1)}
              disabled={currentChapter === 0}
            >
              <ChevronLeft size={18} />
              Previous
            </button>

            <button className="nav-button toc-button" onClick={() => setSidebarOpen(true)}>
              <List size={18} />
              Contents
            </button>

            <button
              className="nav-button"
              onClick={() => goToChapter(currentChapter + 1)}
              disabled={currentChapter === chapters.length - 1}
            >
              Next
              <ChevronRight size={18} />
            </button>
          </nav>

          {renderProgressBar()}
          {renderSidebar()}
        </div>
      )}
    </div>
  );
};

export default EPUBReader;
