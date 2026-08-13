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
  Zap,
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { parseEpub } from './lib/epub';
import * as storage from './lib/storage';
import { saveEpubBlob, getEpubBlob, deleteEpubBlob } from './lib/blobStore';

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

// The chapter HTML is injected via dangerouslySetInnerHTML. Memoize it so that
// unrelated re-renders (revealing the auto-hidden bars, page-counter updates,
// scroll-ratio changes, etc.) don't cause React to re-apply innerHTML — which
// would recreate every child node and wipe the user's text selection.
const ChapterHtml = React.memo(function ChapterHtml({ html, className, innerRef, onScroll }) {
  return (
    <div
      ref={innerRef}
      className={className}
      onScroll={onScroll}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

// Optimal Recognition Point: which letter to center/highlight (Spritz-style).
const pivotIndex = (word) => {
  const n = word.length;
  if (n <= 1) return 0;
  if (n <= 5) return 1;
  if (n <= 9) return 2;
  if (n <= 13) return 3;
  return 4;
};

// RSVP speed reader: flashes one word at a time at a fixed WPM, with the pivot
// letter aligned to the centre line for minimal eye movement.
const SpeedReader = ({ words, wpm, onWpm, onClose }) => {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const timer = useRef(null);

  const total = words.length;
  const done = index >= total;
  const word = done ? '' : words[index];

  // Advance while playing; pause longer on long words and sentence punctuation.
  useEffect(() => {
    if (!playing || done) return;
    const base = 60000 / wpm;
    let delay = base;
    if (/[.,!?;:—–]$/.test(word)) delay += base * 0.9;
    if (word.length > 8) delay += base * 0.3;
    timer.current = setTimeout(() => setIndex((i) => i + 1), delay);
    return () => clearTimeout(timer.current);
  }, [playing, index, wpm, word, done]);

  useEffect(() => {
    if (done) setPlaying(false);
  }, [done]);

  const restart = () => {
    setIndex(0);
    setPlaying(true);
  };
  const step = (d) => {
    setPlaying(false);
    setIndex((i) => Math.max(0, Math.min(total - 1, i + d)));
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  const p = pivotIndex(word);
  const pct = total ? Math.round((Math.min(index, total) / total) * 100) : 0;

  return (
    <div className="rsvp-overlay" role="dialog" aria-label="Speed reader">
      <button className="rsvp-close icon-button" onClick={onClose} aria-label="Close speed reader">
        <X size={22} />
      </button>

      <div className="rsvp-stage">
        <div className="rsvp-guide" />
        {done ? (
          <div className="rsvp-word rsvp-end">Done</div>
        ) : (
          <div className="rsvp-word">
            <span className="rsvp-before">{word.slice(0, p)}</span>
            <span className="rsvp-pivot">{word.slice(p, p + 1)}</span>
            <span className="rsvp-after">{word.slice(p + 1)}</span>
          </div>
        )}
        <div className="rsvp-guide" />
      </div>

      <div className="rsvp-progress">
        <div className="rsvp-progress-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="rsvp-controls">
        <button className="icon-button" onClick={() => step(-1)} aria-label="Previous word">
          <SkipBack size={20} />
        </button>
        <button className="rsvp-play" onClick={() => (done ? restart() : setPlaying((v) => !v))}>
          {done ? <RotateCcw size={22} /> : playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button className="icon-button" onClick={() => step(1)} aria-label="Next word">
          <SkipForward size={20} />
        </button>
        <button className="icon-button" onClick={restart} aria-label="Restart">
          <RotateCcw size={18} />
        </button>
      </div>

      <div className="rsvp-wpm">
        <button className="icon-button" onClick={() => onWpm(Math.max(100, wpm - 25))} aria-label="Slower">
          −
        </button>
        <input
          type="range"
          min="100"
          max="900"
          step="25"
          value={wpm}
          onChange={(e) => onWpm(parseInt(e.target.value, 10))}
        />
        <button className="icon-button" onClick={() => onWpm(Math.min(900, wpm + 25))} aria-label="Faster">
          +
        </button>
        <span className="rsvp-wpm-value">{wpm} wpm</span>
        <span className="rsvp-count">
          {Math.min(index + 1, total)} / {total}
        </span>
      </div>
    </div>
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

  // --- paged (multi-column) reading --------------------------------------
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [chromeHidden, setChromeHidden] = useState(false); // auto-hide header/footer
  const [speedWords, setSpeedWords] = useState(null); // RSVP words, or null when closed

  const fileInputRef = useRef(null);
  const chromeTimer = useRef(null); // inactivity timer for auto-hide
  const contentRef = useRef(null); // the multi-column content element
  const viewportRef = useRef(null); // its overflow-clipped scroll container
  const searchInputRef = useRef(null);
  const progressSaveTimer = useRef(null);
  const spacerRef = useRef(null); // pads scroll width to a whole number of pages
  const strideRef = useRef(0); // px to advance per page (clientWidth + column-gap)
  // When set, the next pagination measure restores to this 0..1 position instead
  // of page 0 (used on chapter change / resize / returning to a book).
  const pendingRatioRef = useRef(0);

  const bookId = metadata?.bookId;

  // --- settings & theme bootstrap -----------------------------------------

  // Reflect the open book in the browser tab title; restore the default on the
  // home screen and when the reader unmounts.
  useEffect(() => {
    const DEFAULT_TITLE = 'Simple EPUB Reader';
    document.title = epub && metadata?.title ? metadata.title : DEFAULT_TITLE;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [epub, metadata?.title]);

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
    try {
      const { metadata: meta, chapters: loadedChapters } = await parseEpub(file);
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
      pendingRatioRef.current = progress?.scrollRatio || 0;
      setPage(0);

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
      // without re-picking the file. Fire-and-forget; failure is non-fatal.
      saveEpubBlob(meta.bookId, file);
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

  // --- pagination (multi-column paged reader) ------------------------------

  // Measure how many pages the current chapter occupies at the current size and
  // cache the per-page scroll stride (viewport width + column gap).
  const measurePages = useCallback(() => {
    const vp = viewportRef.current;
    const el = contentRef.current;
    const spacer = spacerRef.current;
    if (!vp || !el) return 1;
    const style = getComputedStyle(el);
    const gap = parseFloat(style.columnGap) || 0;
    const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    // A page advances by one content-box width plus the inter-column gap; the
    // element's horizontal padding is NOT part of the repeating stride.
    const stride = el.clientWidth - padX + gap;
    strideRef.current = stride;
    if (stride <= 0) {
      setPageCount(1);
      return 1;
    }
    // Measure the natural scroll extent with no spacer, then round the page
    // count UP so the final partial column is always reachable.
    if (spacer) spacer.style.width = '0px';
    const naturalMax = Math.max(0, vp.scrollWidth - vp.clientWidth);
    const total = naturalMax <= 2 ? 1 : Math.ceil((naturalMax - 2) / stride) + 1;
    // Pad the scrollable width to exactly (total-1) strides so every page,
    // including the last, snaps to whole columns (no clipped/skipped lines).
    if (spacer) {
      const desiredMax = (total - 1) * stride;
      spacer.style.width = '1px';
      spacer.style.left = `${desiredMax + vp.clientWidth - 1}px`;
    }
    setPageCount(total);
    return total;
  }, []);

  // Scroll the viewport to a given page. onViewportScroll keeps state in sync.
  const goToPage = useCallback((p, { smooth = false } = {}) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const stride = strideRef.current || vp.clientWidth || 1;
    const maxScroll = vp.scrollWidth - vp.clientWidth;
    const left = Math.max(0, Math.min(p * stride, maxScroll));
    vp.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // After content/size changes, remeasure and restore the pending position.
  useEffect(() => {
    if (readingMode) return; // reading mode keeps vertical scrolling
    if (!viewportRef.current || !content) return;
    const id = requestAnimationFrame(() => {
      const total = measurePages();
      const target = Math.round((pendingRatioRef.current || 0) * (total - 1));
      pendingRatioRef.current = 0;
      goToPage(target);
    });
    return () => cancelAnimationFrame(id);
  }, [
    content,
    currentChapter,
    readingMode,
    settings.fontSize,
    settings.fontFamily,
    settings.lineHeight,
    settings.pageWidth,
    settings.paragraphSpacing,
    settings.justify,
    measurePages,
    goToPage,
  ]);

  // Keep pagination correct across window/viewport resizes (preserve position).
  useEffect(() => {
    const onResize = () => {
      if (readingMode || !viewportRef.current) return;
      const prevMax = pageCount - 1;
      const ratio = prevMax > 0 ? page / prevMax : 0;
      const total = measurePages();
      goToPage(Math.round(ratio * (total - 1)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [readingMode, page, pageCount, measurePages, goToPage]);

  // Re-process images after content renders (preserved from previous version).
  useEffect(() => {
    if (contentRef.current && content) {
      const images = contentRef.current.querySelectorAll('img[data-loaded="true"]');
      images.forEach((img) => {
        const dataSrc = img.getAttribute('data-src');
        if (dataSrc && (!img.src || img.src !== dataSrc)) {
          img.src = dataSrc;
        }
        // Images decode asynchronously and change column layout — remeasure the
        // page count once each finishes (paged reader only).
        if (!readingMode && !img.complete) {
          img.addEventListener(
            'load',
            () => {
              const ratio = pageCount - 1 > 0 ? page / (pageCount - 1) : 0;
              const total = measurePages();
              goToPage(Math.round(ratio * (total - 1)));
            },
            { once: true }
          );
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, currentChapter, readingMode]);

  // --- scroll tracking + progress persistence ------------------------------

  // Reading mode: vertical scroll ratio. Persisted as scrollRatio.
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

  // Paged reader: derive the current page + position ratio from horizontal
  // scroll (covers button paging, keyboard, trackpad, and scrollIntoView).
  const handleViewportScroll = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const stride = strideRef.current || vp.clientWidth || 1;
    const maxScroll = vp.scrollWidth - vp.clientWidth;
    const maxPage = stride > 0 ? Math.max(0, Math.round(maxScroll / stride)) : 0;
    const p = Math.min(maxPage, Math.round(vp.scrollLeft / stride));
    const ratio = maxPage > 0 ? p / maxPage : 0;
    setPage(p);
    setChapterScrollRatio(ratio);

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
      // Where to land once the new chapter is measured: an explicit ratio, the
      // end (when paging backwards into the previous chapter), or the start.
      const ratio = opts.scrollRatio != null ? opts.scrollRatio : opts.toEnd ? 1 : 0;
      pendingRatioRef.current = ratio;
      setCurrentChapter(index);
      setContent(chapters[index].content);
      setChapterScrollRatio(ratio);
      setPage(0);
      if (contentRef.current && readingMode && !opts.scrollRatio) {
        contentRef.current.scrollTop = 0;
      }
      if (sidebarOpen) setSidebarOpen(false);
      if (showFontPanel) setShowFontPanel(false);
      // Only reset search UI state; do NOT call clearSearch, which would
      // overwrite the freshly-set chapter content with the (stale) previous
      // chapter via its closure-captured currentChapter.
      resetSearchState();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chapters, sidebarOpen, showFontPanel, readingMode]
  );

  // Flip one page; step into the adjacent chapter at its boundaries.
  const nextPage = useCallback(() => {
    if (page < pageCount - 1) goToPage(page + 1, { smooth: true });
    else goToChapter(currentChapter + 1);
  }, [page, pageCount, goToPage, goToChapter, currentChapter]);

  const prevPage = useCallback(() => {
    if (page > 0) goToPage(page - 1, { smooth: true });
    else goToChapter(currentChapter - 1, { toEnd: true });
  }, [page, goToPage, goToChapter, currentChapter]);

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
    pendingRatioRef.current = 0;
    setCurrentChapter(result.chapterIndex);
    setContent(chapters[result.chapterIndex].content);
    setPage(0);
    setIsSearching(false);
    if (contentRef.current && readingMode) contentRef.current.scrollTop = 0;
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
    // scrollIntoView reveals the match on whichever axis the reader scrolls:
    // horizontally (inline) in paged mode, vertically (block) in reading mode.
    setTimeout(() => {
      contentRef.current?.querySelector('.search-highlight')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center',
      });
    }, 150);
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

  // --- speed reading (RSVP) ------------------------------------------------

  // Words shown on the currently visible page (paged view), in reading order.
  const collectPageWords = () => {
    const vp = viewportRef.current;
    const el = contentRef.current;
    if (!vp || !el) return [];
    const vr = vp.getBoundingClientRect();
    const words = [];
    el.querySelectorAll('p, h1, h2, h3, h4, li, blockquote').forEach((b) => {
      const r = b.getBoundingClientRect();
      const left = r.left - vr.left;
      const right = r.right - vr.left;
      if (right > 2 && left < vr.width - 2) {
        const t = (b.textContent || '').trim();
        if (t) words.push(...t.split(/\s+/));
      }
    });
    return words;
  };

  const openSpeedRead = () => {
    const words = readingMode
      ? ((contentRef.current?.innerText || '').trim().split(/\s+/).filter(Boolean))
      : collectPageWords();
    if (!words.length) return;
    setShowFloatingMenu(false);
    setShowFontPanel(false);
    setSpeedWords(words);
  };

  // --- reading mode --------------------------------------------------------

  const toggleReadingMode = () => {
    // Carry the current position across the layout switch (approximate: vertical
    // scroll ratio <-> page ratio).
    pendingRatioRef.current = chapterScrollRatio;
    setReadingMode(!readingMode);
    setShowFloatingMenu(false);
    setSidebarOpen(false);
  };

  // --- auto-hide header/footer ---------------------------------------------

  // When enabled, the header and bottom bar slide away to maximise reading
  // space. To avoid flicker while reading, they only reappear when the pointer
  // is deliberately moved to the top or bottom edge of the window (not on any
  // movement). Open panels (sidebar/search/typography) keep them visible.
  useEffect(() => {
    if (!epub || readingMode || !settings.autoHideChrome) {
      setChromeHidden(false);
      if (chromeTimer.current) clearTimeout(chromeTimer.current);
      return;
    }
    // Thin strip at the very edge, so the first/last text line (which sits a
    // little inside the padding) stays selectable without popping the bars.
    const EDGE = 10;
    const blocked = () => sidebarOpen || showFontPanel || isSearching;
    const scheduleHide = (delay) => {
      if (chromeTimer.current) clearTimeout(chromeTimer.current);
      chromeTimer.current = setTimeout(() => {
        if (!blocked()) setChromeHidden(true);
      }, delay);
    };
    const onMove = (e) => {
      // While a button is held the user is selecting/dragging — never change the
      // bars, otherwise dragging a selection up to the first line pops the header
      // over the text.
      if (e.buttons) return;
      const nearEdge = e.clientY <= EDGE || e.clientY >= window.innerHeight - EDGE;
      if (nearEdge) {
        setChromeHidden(false);
        if (chromeTimer.current) clearTimeout(chromeTimer.current);
      } else {
        // Moving within the reading area never reveals the bars; if they're
        // showing (e.g. just left the edge), hide again shortly.
        scheduleHide(600);
      }
    };
    // Show briefly on entering, then hide so the reader knows they're there.
    setChromeHidden(false);
    scheduleHide(2500);
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (chromeTimer.current) clearTimeout(chromeTimer.current);
    };
  }, [epub, readingMode, settings.autoHideChrome, sidebarOpen, showFontPanel, isSearching]);

  // --- keyboard ------------------------------------------------------------

  useEffect(() => {
    const handleKeyPress = (e) => {
      // Don't hijack typing in inputs.
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      // Speed reader has its own key handling; don't also flip pages.
      if (speedWords) return;

      // In the paged reader, arrows flip pages (and cross chapter boundaries);
      // in reading mode they still jump whole chapters.
      if (e.key === 'ArrowLeft') readingMode ? goToChapter(currentChapter - 1) : prevPage();
      if (e.key === 'ArrowRight') readingMode ? goToChapter(currentChapter + 1) : nextPage();
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
  }, [currentChapter, readingMode, isSearching, sidebarOpen, showFontPanel, chapters, bookId, chapterScrollRatio, nextPage, prevPage, speedWords]);

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
    const blob = await getEpubBlob(book.bookId).catch(() => null);
    if (blob) {
      parseEPUB(blob);
      return;
    }
    // No blob cached for this book — likely added to "recent" before blob
    // storage existed, or evicted. Open the picker so the user can re-select.
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
    '--reader-para-spacing': `${settings.paragraphSpacing}em`,
    '--reader-text-align': settings.justify ? 'justify' : 'left',
    '--reader-hyphens': settings.justify ? 'auto' : 'manual',
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
        <span>
          {readingMode
            ? `${Math.round(chapterProgress * 100)}% chapter`
            : `Page ${page + 1} of ${pageCount}`}
        </span>
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
        <label>Paragraph gap</label>
        <input
          type="range"
          min="0"
          max="1.6"
          step="0.1"
          value={settings.paragraphSpacing}
          onChange={(e) => updateSettings({ paragraphSpacing: parseFloat(e.target.value) })}
        />
        <span className="font-value">{settings.paragraphSpacing.toFixed(1)}em</span>
      </div>
      <div className="font-row">
        <label>Justify text</label>
        <button
          type="button"
          className={`font-toggle ${settings.justify ? 'active' : ''}`}
          role="switch"
          aria-checked={settings.justify}
          onClick={() => updateSettings({ justify: !settings.justify })}
        >
          {settings.justify ? 'On' : 'Off'}
        </button>
      </div>
      <div className="font-row">
        <label>Column width</label>
        <input
          type="range"
          min="260"
          max="720"
          step="20"
          value={settings.pageWidth}
          onChange={(e) => updateSettings({ pageWidth: parseInt(e.target.value, 10) })}
        />
        <span className="font-value">{settings.pageWidth}px</span>
      </div>
      <div className="font-row">
        <label>Auto-hide bars</label>
        <button
          type="button"
          className={`font-toggle ${settings.autoHideChrome ? 'active' : ''}`}
          role="switch"
          aria-checked={settings.autoHideChrome}
          onClick={() => updateSettings({ autoHideChrome: !settings.autoHideChrome })}
        >
          {settings.autoHideChrome ? 'On' : 'Off'}
        </button>
      </div>
      <div className="font-row">
        <label>Progress bar</label>
        <button
          type="button"
          className={`font-toggle ${settings.showProgress ? 'active' : ''}`}
          role="switch"
          aria-checked={settings.showProgress}
          onClick={() => updateSettings({ showProgress: !settings.showProgress })}
        >
          {settings.showProgress ? 'On' : 'Off'}
        </button>
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

          <ChapterHtml
            innerRef={contentRef}
            className="reading-mode-content"
            onScroll={handleContentScroll}
            html={content}
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
            <button className="icon-button" onClick={openSpeedRead} aria-label="Speed read">
              <Zap size={20} />
            </button>
            <button className="icon-button" onClick={toggleTheme}>
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>

          {renderSidebar()}
          {settings.showProgress && renderProgressBar()}
          {speedWords && (
            <SpeedReader
              words={speedWords}
              wpm={settings.speedReadWpm}
              onWpm={(w) => updateSettings({ speedReadWpm: w })}
              onClose={() => setSpeedWords(null)}
            />
          )}
        </div>
      ) : (
        <div
          className={`reader-container ${settings.showProgress ? 'has-progress' : ''} ${
            settings.autoHideChrome ? 'chrome-autohide' : ''
          } ${chromeHidden ? 'chrome-hidden' : ''}`}
        >
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

              <button
                className="icon-button"
                onClick={openSpeedRead}
                aria-label="Speed read this page"
                title="Speed read (RSVP)"
              >
                <Zap size={20} />
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
            <button
              className="page-nav-area prev"
              onClick={prevPage}
              disabled={currentChapter === 0 && page === 0}
              aria-label="Previous page"
            >
              <ChevronLeft size={28} />
            </button>

            <div ref={viewportRef} className="paged-viewport" onScroll={handleViewportScroll}>
              <ChapterHtml
                innerRef={contentRef}
                className="chapter-content paged-content"
                html={content}
              />
              <div ref={spacerRef} className="paged-spacer" aria-hidden="true" />
            </div>

            <button
              className="page-nav-area next"
              onClick={nextPage}
              disabled={currentChapter === chapters.length - 1 && page >= pageCount - 1}
              aria-label="Next page"
            >
              <ChevronRight size={28} />
            </button>

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

          <div className="reader-bottom">
            {settings.showProgress && renderProgressBar()}
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
          </div>

          {renderSidebar()}
          {speedWords && (
            <SpeedReader
              words={speedWords}
              wpm={settings.speedReadWpm}
              onWpm={(w) => updateSettings({ speedReadWpm: w })}
              onClose={() => setSpeedWords(null)}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default EPUBReader;
