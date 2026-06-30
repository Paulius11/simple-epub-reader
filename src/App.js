import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Search, Moon, Sun, Book, X, Menu, Home } from 'lucide-react';
import { parseEpub } from './lib/epub';

// Component to render highlighted search results
const HighlightedText = ({ text, searchQuery }) => {
  if (!searchQuery || !text) return <span>{text}</span>;
  
  const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  const parts = text.split(regex);
  
  return (
    <span>
      {parts.map((part, index) => {
        // Check if this part matches the search query (case insensitive)
        const isMatch = part.toLowerCase() === searchQuery.toLowerCase();
        return isMatch ? (
          <mark 
            key={index} 
            style={{ 
              background: '#ffd700', 
              color: '#000', 
              padding: '1px 3px', 
              borderRadius: '3px',
              fontWeight: '500'
            }}
          >
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        );
      })}
    </span>
  );
};

const EPUBReader = () => {
  const [epub, setEpub] = useState(null);
  const [currentChapter, setCurrentChapter] = useState(0);
  const [chapters, setChapters] = useState([]);
  const [content, setContent] = useState('');
  const [metadata, setMetadata] = useState({});
  const [darkMode, setDarkMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [readingMode, setReadingMode] = useState(false);
  const [showFloatingMenu, setShowFloatingMenu] = useState(false);
  const fileInputRef = useRef(null);
  const contentRef = useRef(null);
  const searchInputRef = useRef(null);

  // Parse EPUB file and load it into state
  const parseEPUB = async (file) => {
    try {
      const { metadata: meta, chapters: loadedChapters } = await parseEpub(file);
      setMetadata(meta);
      setChapters(loadedChapters);
      setContent(loadedChapters[0].content);
      setCurrentChapter(0);
      setEpub(file);
    } catch (error) {
      console.error('Error parsing EPUB:', error);
      alert('Error loading EPUB file: ' + error.message);
    }
  };

  // Handle file selection
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

  // Navigate chapters
  const goToChapter = (index) => {
    if (index >= 0 && index < chapters.length) {
      setCurrentChapter(index);
      setContent(chapters[index].content);
      if (contentRef.current) {
        contentRef.current.scrollTop = 0;
      }
      clearSearch();
    }
  };

  // Search functionality
  const performSearch = useCallback(() => {
    // Require minimum 2 characters to prevent crashes with single letters
    if (!searchQuery.trim() || searchQuery.trim().length < 2 || !chapters.length) {
      setSearchResults([]);
      return;
    }

    const results = [];
    const maxResultsPerChapter = 5; // Limit results per chapter to prevent crashes
    const maxTotalResults = 50; // Overall limit
    
    chapters.forEach((chapter, chapterIndex) => {
      if (results.length >= maxTotalResults) return;
      
      // Create a temporary div to extract text content properly
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
        
        // Add ellipsis if context is trimmed
        if (start > 0) context = '...' + context;
        if (end < text.length) context = context + '...';
        
        results.push({
          chapterIndex,
          chapterTitle: chapter.title,
          context: context,
          matchIndex: match.index,
          matchText: match[0]
        });
        
        chapterResults++;
        
        // Prevent infinite loops
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }
    });

    setSearchResults(results);
  }, [searchQuery, chapters]);

  useEffect(() => {
    // Increase debounce time and add minimum character requirement
    const debounceTimer = setTimeout(() => {
      performSearch();
    }, 500); // Increased from 300ms to 500ms

    return () => clearTimeout(debounceTimer);
  }, [searchQuery, performSearch]);

  // Navigate to search result
  const goToSearchResult = (result) => {
    setCurrentChapter(result.chapterIndex);
    setContent(chapters[result.chapterIndex].content);
    setIsSearching(false);
    
    // Scroll to top first
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
    
    // Highlight the text after a short delay to ensure content is rendered
    setTimeout(() => {
      highlightSearchText(searchQuery, result.chapterIndex);
    }, 200);
  };

  // Highlight search text
  const highlightSearchText = (text, chapterIndex = currentChapter) => {
    if (!text || !chapters[chapterIndex]) return;
    
    const originalContent = chapters[chapterIndex].content;
    const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedText})`, 'gi');
    
    const highlighted = originalContent.replace(regex, '<mark class="search-highlight">$1</mark>');
    setContent(highlighted);
    
    // Scroll to the first highlight
    setTimeout(() => {
      const firstHighlight = contentRef.current?.querySelector('.search-highlight');
      if (firstHighlight) {
        firstHighlight.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      }
    }, 100);
  };

  // Clear search
  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setIsSearching(false);
    // Restore original content without highlights
    if (chapters[currentChapter]) {
      setContent(chapters[currentChapter].content);
    }
    // Clear the search input
    if (searchInputRef.current) {
      searchInputRef.current.blur();
    }
  };

  // Toggle theme
  const toggleTheme = () => {
    setDarkMode(!darkMode);
  };

  // Toggle reading mode
  const toggleReadingMode = () => {
    setReadingMode(!readingMode);
    setShowFloatingMenu(false);
  };

  // Re-process images after content is rendered (React safety)
  useEffect(() => {
    if (contentRef.current && content) {
      const images = contentRef.current.querySelectorAll('img[data-loaded="true"]');
      images.forEach(img => {
        const dataSrc = img.getAttribute('data-src');
        if (dataSrc && (!img.src || img.src !== dataSrc)) {
          img.src = dataSrc;
          img.style.maxWidth = '100%';
          img.style.height = 'auto';
          img.style.display = 'block';
          img.style.margin = '10px auto';
        }
      });
    }
  }, [content, currentChapter]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === 'ArrowLeft') goToChapter(currentChapter - 1);
      if (e.key === 'ArrowRight') goToChapter(currentChapter + 1);
      if (e.key === 'Escape') {
        if (readingMode) toggleReadingMode();
        if (isSearching) clearSearch();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [currentChapter, readingMode, isSearching]);

  // Reset to file selection
  const backToMenu = () => {
    setEpub(null);
    setChapters([]);
    setContent('');
    setCurrentChapter(0);
    clearSearch();
    setReadingMode(false);
  };

  // CSS variables for theming
  const themeVars = {
    '--bg-primary': darkMode ? '#0a0a0a' : '#ffffff',
    '--bg-secondary': darkMode ? '#1a1a1a' : '#f3f4f6',
    '--bg-tertiary': darkMode ? '#2a2a2a' : '#e5e7eb',
    '--text-primary': darkMode ? '#ffffff' : '#000000',
    '--text-secondary': darkMode ? '#a0a0a0' : '#6b7280',
    '--border-color': darkMode ? '#333333' : '#e5e7eb',
    '--gradient-start': darkMode ? '#1e3a8a' : '#3b82f6',
    '--gradient-end': darkMode ? '#7c3aed' : '#8b5cf6',
  };

  return (
    <div 
      className="epub-reader" 
      style={themeVars}
      data-theme={darkMode ? 'dark' : 'light'}
    >

      {!epub ? (
        <div className="home-screen">
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
            <button 
              className="upload-button"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose EPUB File
            </button>
          </div>
        </div>
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
            dangerouslySetInnerHTML={{ __html: content }}
          />
          
          <button 
            className="reading-nav-area next"
            onClick={() => goToChapter(currentChapter + 1)}
            disabled={currentChapter === chapters.length - 1}
          >
            <ChevronRight size={40} style={{ marginRight: '20px' }} />
          </button>

          <button 
            className="menu-trigger"
            onClick={() => setShowFloatingMenu(!showFloatingMenu)}
          >
            <Menu size={24} />
          </button>

          <div className={`floating-menu ${showFloatingMenu ? 'show' : ''}`}>
            <button className="icon-button" onClick={toggleReadingMode}>
              <X size={20} />
            </button>
            <select 
              className="chapter-select"
              value={currentChapter}
              onChange={(e) => goToChapter(parseInt(e.target.value))}
              style={{ minWidth: '200px' }}
            >
              {chapters.map((chapter, index) => (
                <option key={index} value={index}>
                  {chapter.title}
                </option>
              ))}
            </select>
            <button className="icon-button" onClick={toggleTheme}>
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </div>
      ) : (
        <div className="reader-container">
          <header className="header">
            <div className="header-left">
              <button className="back-button" onClick={backToMenu}>
                <Home size={20} />
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
                    if (e.target.value.trim().length >= 2) {
                      setIsSearching(true);
                    } else {
                      setIsSearching(false);
                      setSearchResults([]);
                    }
                  }}
                  onFocus={() => searchQuery.trim().length >= 2 && setIsSearching(true)}
                />
                <Search className="search-icon" size={18} />
              </div>
              
              <button className="icon-button" onClick={toggleTheme}>
                {darkMode ? <Sun size={20} /> : <Moon size={20} />}
              </button>
              
              <button className="icon-button" onClick={toggleReadingMode}>
                <Book size={20} />
              </button>
            </div>
          </header>

          <div className="content-area">
            <div 
              ref={contentRef}
              className="chapter-content"
              dangerouslySetInnerHTML={{ __html: content }}
            />
            
            {isSearching && (
              <div className={`search-results ${searchResults.length > 0 ? 'active' : ''}`}>
                <div className="search-results-header">
                  <h3 className="search-results-title">
                    {searchResults.length} Results
                  </h3>
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
                    <div className="search-result-chapter">
                      {result.chapterTitle}
                    </div>
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
            
            <div className="chapter-selector">
              <select 
                className="chapter-select"
                value={currentChapter}
                onChange={(e) => goToChapter(parseInt(e.target.value))}
              >
                {chapters.map((chapter, index) => (
                  <option key={index} value={index}>
                    {chapter.title}
                  </option>
                ))}
              </select>
            </div>
            
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
      )}
    </div>
  );
};

export default EPUBReader;