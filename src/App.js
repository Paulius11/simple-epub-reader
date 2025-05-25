import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Search, Moon, Sun, Book, X, Menu, Home } from 'lucide-react';
import JSZip from 'jszip';

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

  // Helper function to get proper MIME type for images
  const getImageMimeType = (imagePath) => {
    const extension = imagePath.split('.').pop().toLowerCase();
    const mimeTypes = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'webp': 'image/webp',
      'bmp': 'image/bmp'
    };
    return mimeTypes[extension] || 'image/jpeg';
  };

  // Helper function to process chapter content (handle images, relative paths, etc.)
  const processChapterContent = async (content, chapterPath, zip, opfDir) => {
    // Create a temporary div to manipulate the HTML
    const div = document.createElement('div');
    div.innerHTML = content;
    
    // Process images
    const images = div.querySelectorAll('img');
    for (const img of images) {
      const src = img.getAttribute('src');
      if (src && !src.startsWith('http')) {
        try {
          // Calculate the correct path for the image - handle different path scenarios
          let imagePath;
          
          if (src.startsWith('../')) {
            // Handle relative paths that go up directories
            const chapterDir = chapterPath.substring(0, chapterPath.lastIndexOf('/'));
            const parentDir = chapterDir.substring(0, chapterDir.lastIndexOf('/'));
            imagePath = `${parentDir}/${src.substring(3)}`;
          } else if (src.startsWith('./')) {
            // Handle current directory relative paths
            const chapterDir = chapterPath.substring(0, chapterPath.lastIndexOf('/'));
            imagePath = `${chapterDir}/${src.substring(2)}`;
          } else if (src.startsWith('/')) {
            // Handle absolute paths from root
            imagePath = opfDir ? `${opfDir}${src}` : src.substring(1);
          } else {
            // Handle relative paths without prefix
            const chapterDir = chapterPath.substring(0, chapterPath.lastIndexOf('/'));
            imagePath = chapterDir ? `${chapterDir}/${src}` : src;
          }
          
          // Try to find the image file (case-insensitive search)
          let imageFile = zip.file(imagePath);
          if (!imageFile) {
            // Try different variations if the exact path doesn't work
            const pathVariations = [
              imagePath,
              imagePath.toLowerCase(),
              imagePath.replace(/\\/g, '/'),
              `images/${src}`,
              `Images/${src}`,
              `OEBPS/images/${src}`,
              `OEBPS/Images/${src}`
            ];
            
            for (const variation of pathVariations) {
              imageFile = zip.file(variation);
              if (imageFile) break;
            }
          }
          
          if (imageFile) {
            // Load the image from the zip
            const imageData = await imageFile.async('base64');
            const imageType = getImageMimeType(imagePath);
            img.src = `data:${imageType};base64,${imageData}`;
          } else {
            console.warn('Could not find image:', src, 'tried path:', imagePath);
            // Set a placeholder or hide the image
            img.style.display = 'none';
          }
        } catch (error) {
          console.warn('Error loading image:', src, error);
          img.style.display = 'none';
        }
      }
    }
    
    // Remove any script tags for security
    const scripts = div.querySelectorAll('script');
    scripts.forEach(script => script.remove());
    
    return div.innerHTML;
  };

  // Parse EPUB file
  const parseEPUB = async (file) => {
    try {
      // Load the EPUB file as a zip
      const zip = await JSZip.loadAsync(file);
      
      // Read container.xml to find the OPF file
      const containerXml = await zip.file('META-INF/container.xml').async('string');
      const parser = new DOMParser();
      const containerDoc = parser.parseFromString(containerXml, 'text/xml');
      
      // Get the OPF file path
      const opfPath = containerDoc.querySelector('rootfile').getAttribute('full-path');
      const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/'));
      
      // Read and parse the OPF file
      const opfXml = await zip.file(opfPath).async('string');
      const opfDoc = parser.parseFromString(opfXml, 'text/xml');
      
      // Extract metadata
      const title = opfDoc.querySelector('metadata title')?.textContent || 'Unknown Title';
      const author = opfDoc.querySelector('metadata creator')?.textContent || 'Unknown Author';
      const description = opfDoc.querySelector('metadata description')?.textContent || '';
      
      setMetadata({ title, author, description });
      
      // Get the spine (reading order)
      const spine = opfDoc.querySelectorAll('spine itemref');
      const manifest = opfDoc.querySelectorAll('manifest item');
      
      // Create a map of manifest items
      const manifestMap = {};
      manifest.forEach(item => {
        manifestMap[item.getAttribute('id')] = {
          href: item.getAttribute('href'),
          type: item.getAttribute('media-type')
        };
      });
      
      // Load chapters based on spine order
      const loadedChapters = [];
      
      for (const itemRef of spine) {
        const idref = itemRef.getAttribute('idref');
        const manifestItem = manifestMap[idref];
        
        if (manifestItem && manifestItem.type === 'application/xhtml+xml') {
          const chapterPath = opfDir ? `${opfDir}/${manifestItem.href}` : manifestItem.href;
          const chapterContent = await zip.file(chapterPath).async('string');
          
          // Parse the chapter HTML to extract title
          const chapterDoc = parser.parseFromString(chapterContent, 'text/html');
          const chapterTitle = chapterDoc.querySelector('title')?.textContent || 
                             chapterDoc.querySelector('h1')?.textContent || 
                             `Chapter ${loadedChapters.length + 1}`;
          
          // Extract body content
          const bodyContent = chapterDoc.querySelector('body')?.innerHTML || chapterContent;
          
          // Process images and styles if needed
          const processedContent = await processChapterContent(bodyContent, chapterPath, zip, opfDir);
          
          loadedChapters.push({
            title: chapterTitle.trim(),
            content: processedContent
          });
        }
      }
      
      if (loadedChapters.length === 0) {
        throw new Error('No chapters found in EPUB');
      }
      
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
    if (file) {
      parseEPUB(file);
    }
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
    if (!searchQuery.trim() || !chapters.length) {
      setSearchResults([]);
      return;
    }

    const results = [];
    chapters.forEach((chapter, chapterIndex) => {
      // Create a temporary div to extract text content properly
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = chapter.content;
      const text = tempDiv.textContent || tempDiv.innerText || '';
      
      const regex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      let match;
      
      while ((match = regex.exec(text)) !== null) {
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
        
        // Prevent infinite loops
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }
    });

    setSearchResults(results);
  }, [searchQuery, chapters]);

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      performSearch();
    }, 300);

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
                  placeholder="Search in book..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (e.target.value.trim()) {
                      setIsSearching(true);
                    } else {
                      setIsSearching(false);
                      setSearchResults([]);
                    }
                  }}
                  onFocus={() => searchQuery.trim() && setIsSearching(true)}
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
                      {result.context}
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