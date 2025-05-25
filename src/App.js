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
    
    // Process both HTML img tags and SVG image tags
    const htmlImages = div.querySelectorAll('img');
    const svgImages = div.querySelectorAll('image'); // SVG image elements
    const allImages = [...htmlImages, ...svgImages];
    
    console.log(`Processing ${allImages.length} images in chapter: ${chapterPath} (${htmlImages.length} HTML img, ${svgImages.length} SVG image)`);
    
    for (const img of allImages) {
      // Get the image source - could be src, xlink:href, or href
      const src = img.getAttribute('src') || 
                  img.getAttribute('xlink:href') || 
                  img.getAttribute('href') ||
                  img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      
      console.log('Processing image:', src, 'Element type:', img.tagName);
      
      if (src && !src.startsWith('http') && !src.startsWith('data:')) {
        try {
          // Extract just the filename from the src
          const filename = src.split('/').pop();
          
          // Calculate the proper path based on the chapter's location
          let resolvedPath = '';
          if (src.startsWith('../')) {
            // Go up one directory from chapter directory
            const chapterDir = chapterPath.substring(0, chapterPath.lastIndexOf('/'));
            const parentDir = chapterDir.substring(0, chapterDir.lastIndexOf('/'));
            resolvedPath = `${parentDir}/${src.substring(3)}`;
          } else if (src.startsWith('./')) {
            const chapterDir = chapterPath.substring(0, chapterPath.lastIndexOf('/'));
            resolvedPath = `${chapterDir}/${src.substring(2)}`;
          } else if (src.startsWith('/')) {
            resolvedPath = opfDir ? `${opfDir}${src}` : src.substring(1);
          } else {
            const chapterDir = chapterPath.substring(0, chapterPath.lastIndexOf('/'));
            resolvedPath = chapterDir ? `${chapterDir}/${src}` : src;
          }
          
          console.log('Resolved image path:', resolvedPath);
          
          // Try different possible image paths
          const pathVariations = [
            resolvedPath,
            `Images/${filename}`,
            `images/${filename}`,
            `OEBPS/Images/${filename}`,
            `OEBPS/images/${filename}`,
            `${opfDir}/Images/${filename}`,
            `${opfDir}/images/${filename}`,
            filename,
            src
          ];
          
          // Remove duplicates and invalid paths
          const uniquePaths = [...new Set(pathVariations.filter(path => path && path !== 'undefined' && path !== 'null'))];
          
          let imageFile = null;
          let successfulPath = '';
          
          // Try each path variation
          for (const path of uniquePaths) {
            try {
              const testFile = zip.file(path);
              if (testFile) {
                imageFile = testFile;
                successfulPath = path;
                break;
              }
              
              // Also try case-insensitive versions
              const lowerPath = path.toLowerCase();
              const lowerFile = zip.file(lowerPath);
              if (lowerFile) {
                imageFile = lowerFile;
                successfulPath = lowerPath;
                break;
              }
            } catch (e) {
              continue;
            }
          }
          
          // If still not found, search through all files in the zip
          if (!imageFile) {
            const allFiles = Object.keys(zip.files);
            const imageFiles = allFiles.filter(file => 
              file.toLowerCase().endsWith('.jpg') || 
              file.toLowerCase().endsWith('.jpeg') || 
              file.toLowerCase().endsWith('.png') || 
              file.toLowerCase().endsWith('.gif') || 
              file.toLowerCase().endsWith('.svg') || 
              file.toLowerCase().endsWith('.webp')
            );
            
            // Look for a file with matching name
            const matchingFile = imageFiles.find(file => {
              const fileBasename = file.split('/').pop().toLowerCase();
              const srcBasename = filename.toLowerCase();
              return fileBasename === srcBasename || fileBasename.startsWith(srcBasename.split('.')[0]);
            });
            
            if (matchingFile) {
              imageFile = zip.file(matchingFile);
              successfulPath = matchingFile;
            }
          }
          
          if (imageFile) {
            try {
              // Load the image from the zip
              const imageData = await imageFile.async('base64');
              const imageType = getImageMimeType(successfulPath);
              const dataUrl = `data:${imageType};base64,${imageData}`;
              
              if (img.tagName.toLowerCase() === 'image') {
                // Handle SVG image elements - convert to HTML img
                const newImg = document.createElement('img');
                newImg.src = dataUrl;
                newImg.setAttribute('data-src', dataUrl);
                newImg.setAttribute('data-loaded', 'true');
                
                // Copy dimensions if they exist
                const width = img.getAttribute('width');
                const height = img.getAttribute('height');
                if (width) newImg.style.width = width.includes('px') ? width : width + 'px';
                if (height) newImg.style.height = height.includes('px') ? height : height + 'px';
                
                // Add styling
                newImg.style.maxWidth = '100%';
                newImg.style.height = 'auto';
                newImg.style.display = 'block';
                newImg.style.margin = '10px auto';
                
                // Replace the SVG image with HTML img
                img.parentNode.replaceChild(newImg, img);
                
                console.log('Successfully converted SVG image to HTML img:', src, 'from path:', successfulPath);
              } else {
                // Handle regular HTML img elements
                img.setAttribute('src', dataUrl);
                img.setAttribute('data-src', dataUrl);
                img.setAttribute('data-loaded', 'true');
                
                // Add styling
                img.style.maxWidth = '100%';
                img.style.height = 'auto';
                img.style.display = 'block';
                img.style.margin = '10px auto';
                
                console.log('Successfully loaded HTML image:', src, 'from path:', successfulPath);
              }
            } catch (loadError) {
              console.warn('Error loading image data for:', src, loadError);
              img.style.display = 'none';
            }
          } else {
            console.warn('Could not find image:', src, 'tried paths:', uniquePaths);
            // Create a visible placeholder
            const placeholder = document.createElement('img');
            placeholder.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2YwZjBmMCIgc3Ryb2tlPSIjY2NjIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1kYXNoYXJyYXk9IjUsMTAiLz48dGV4dCB4PSIxMDAiIHk9IjU1IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IiM2NjYiPkltYWdlIE5vdCBGb3VuZDwvdGV4dD48L3N2Zz4=';
            placeholder.style.maxWidth = '200px';
            placeholder.style.margin = '10px auto';
            placeholder.style.display = 'block';
            img.parentNode.replaceChild(placeholder, img);
          }
        } catch (error) {
          console.warn('Error processing image:', src, error);
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
      <style>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        .epub-reader {
          min-height: 100vh;
          background: var(--bg-primary);
          color: var(--text-primary);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          transition: all 0.3s ease;
        }

        .gradient-bg {
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          color: white;
        }

        .home-screen {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          background: linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-secondary) 100%);
        }

        .upload-card {
          background: var(--bg-secondary);
          border-radius: 20px;
          padding: 60px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
          text-align: center;
          max-width: 500px;
          width: 90%;
        }

        .upload-icon {
          width: 80px;
          height: 80px;
          margin: 0 auto 30px;
          opacity: 0.8;
        }

        .upload-title {
          font-size: 32px;
          font-weight: 700;
          margin-bottom: 15px;
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .upload-button {
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          color: white;
          border: none;
          border-radius: 12px;
          padding: 15px 40px;
          font-size: 18px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          margin-top: 20px;
        }

        .upload-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(59, 130, 246, 0.3);
        }

        .reader-container {
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
        }

        .header {
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border-color);
          padding: 15px 20px;
          display: flex;
          align-items: center;
          gap: 20px;
          flex-wrap: wrap;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 15px;
          flex: 1;
        }

        .back-button {
          background: transparent;
          border: none;
          color: var(--text-primary);
          cursor: pointer;
          padding: 8px;
          border-radius: 8px;
          transition: all 0.2s;
        }

        .back-button:hover {
          background: var(--bg-tertiary);
        }

        .book-info {
          flex: 1;
        }

        .book-title {
          font-size: 20px;
          font-weight: 700;
          margin-bottom: 4px;
        }

        .book-author {
          font-size: 14px;
          color: var(--text-secondary);
        }

        .header-controls {
          display: flex;
          align-items: center;
          gap: 15px;
        }

        .search-container {
          position: relative;
          width: 300px;
        }

        .search-input {
          width: 100%;
          padding: 10px 40px 10px 15px;
          border: 1px solid var(--border-color);
          border-radius: 10px;
          background: var(--bg-primary);
          color: var(--text-primary);
          font-size: 14px;
          transition: all 0.2s;
        }

        .search-input:focus {
          outline: none;
          border-color: var(--gradient-start);
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        .search-icon {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-secondary);
          pointer-events: none;
        }

        .icon-button {
          background: transparent;
          border: none;
          color: var(--text-primary);
          cursor: pointer;
          padding: 10px;
          border-radius: 10px;
          transition: all 0.2s;
        }

        .icon-button:hover {
          background: var(--bg-tertiary);
        }

        .content-area {
          flex: 1;
          display: flex;
          overflow: hidden;
          position: relative;
        }

        .chapter-content {
          flex: 1;
          padding: 40px;
          overflow-y: auto;
          line-height: 1.8;
          font-size: 18px;
          max-width: 800px;
          margin: 0 auto;
          width: 100%;
        }

        .chapter-content h1 {
          font-size: 32px;
          margin-bottom: 30px;
          color: var(--gradient-start);
        }

        .chapter-content p {
          margin-bottom: 20px;
          text-align: justify;
        }

        .search-highlight {
          background: #ffd700;
          color: #000;
          padding: 2px 4px;
          border-radius: 3px;
          animation: highlight-pulse 0.5s ease;
        }

        @keyframes highlight-pulse {
          0% { background: #fff59d; }
          50% { background: #ffd700; }
          100% { background: #ffd700; }
        }

        .search-results {
          position: absolute;
          top: 0;
          right: 0;
          width: 350px;
          height: 100%;
          background: var(--bg-secondary);
          border-left: 1px solid var(--border-color);
          overflow-y: auto;
          padding: 20px;
          z-index: 10;
          transform: translateX(100%);
          transition: transform 0.3s ease;
        }

        .search-results.active {
          transform: translateX(0);
        }

        .search-results-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .search-results-title {
          font-size: 18px;
          font-weight: 600;
        }

        .search-result-item {
          background: var(--bg-primary);
          border-radius: 10px;
          padding: 15px;
          margin-bottom: 10px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .search-result-item:hover {
          transform: translateX(-5px);
          box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
        }

        .search-result-chapter {
          font-size: 12px;
          color: var(--text-secondary);
          margin-bottom: 5px;
        }

        .search-result-context {
          font-size: 14px;
          line-height: 1.5;
        }

        .navigation-bar {
          background: var(--bg-secondary);
          border-top: 1px solid var(--border-color);
          padding: 15px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
        }

        .nav-button {
          background: var(--bg-tertiary);
          border: none;
          color: var(--text-primary);
          padding: 10px 20px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .nav-button:hover:not(:disabled) {
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          color: white;
        }

        .nav-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .chapter-selector {
          flex: 1;
          max-width: 400px;
        }

        .chapter-select {
          width: 100%;
          padding: 10px 15px;
          border: 1px solid var(--border-color);
          border-radius: 10px;
          background: var(--bg-primary);
          color: var(--text-primary);
          font-size: 14px;
          cursor: pointer;
        }

        .reading-mode {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: var(--bg-primary);
          z-index: 100;
          display: flex;
        }

        .reading-mode-content {
          flex: 1;
          padding: 60px 40px;
          overflow-y: auto;
          max-width: 900px;
          margin: 0 auto;
          font-size: 20px;
          line-height: 1.8;
        }

        .reading-nav-area {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 100px;
          cursor: pointer;
          background: transparent;
          border: none;
          opacity: 0;
          transition: opacity 0.2s;
        }

        .reading-nav-area:hover {
          opacity: 1;
        }

        .reading-nav-area.prev {
          left: 0;
          background: linear-gradient(to right, rgba(0,0,0,0.1), transparent);
        }

        .reading-nav-area.next {
          right: 0;
          background: linear-gradient(to left, rgba(0,0,0,0.1), transparent);
        }

        .floating-menu {
          position: fixed;
          bottom: 30px;
          left: 50%;
          transform: translateX(-50%);
          background: var(--bg-secondary);
          border-radius: 20px;
          padding: 15px 20px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
          display: flex;
          align-items: center;
          gap: 15px;
          z-index: 101;
          opacity: 0;
          pointer-events: none;
          transition: all 0.3s ease;
        }

        .floating-menu.show {
          opacity: 1;
          pointer-events: auto;
        }

        .menu-trigger {
          position: fixed;
          bottom: 30px;
          right: 30px;
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          color: white;
          border: none;
          width: 60px;
          height: 60px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 5px 20px rgba(0, 0, 0, 0.2);
          transition: all 0.3s ease;
          z-index: 101;
        }

        .menu-trigger:hover {
          transform: scale(1.1);
        }

        @media (max-width: 768px) {
          .header {
            padding: 10px 15px;
          }

          .search-container {
            width: 100%;
            order: 3;
          }

          .chapter-content {
            padding: 20px;
            font-size: 16px;
          }

          .search-results {
            width: 100%;
          }

          .upload-card {
            padding: 40px 30px;
          }
        }
      `}</style>

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