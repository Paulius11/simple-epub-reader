import JSZip from 'jszip';

// OPF/NCX hrefs are URIs (e.g. "CR%21foo.html") but JSZip indexes by the raw
// filename ("CR!foo.html"). Try the literal path first, then the URL-decoded form.
const getZipFile = (zip, p) => {
  if (!p) return null;
  let f = zip.file(p);
  if (f) return f;
  try {
    const decoded = decodeURIComponent(p);
    if (decoded !== p) f = zip.file(decoded);
  } catch (_) { /* malformed URI: ignore */ }
  return f || null;
};

const IMAGE_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

const getImageMimeType = (imagePath) => {
  const ext = imagePath.split('.').pop().toLowerCase();
  return IMAGE_MIME[ext] || 'image/jpeg';
};

const HTML_TYPES = new Set([
  'application/xhtml+xml',
  'application/html+xml',
  'application/xml',
  'text/html',
  'text/xml',
]);

const IMAGE_NOT_FOUND_PLACEHOLDER =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2YwZjBmMCIgc3Ryb2tlPSIjY2NjIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1kYXNoYXJyYXk9IjUsMTAiLz48dGV4dCB4PSIxMDAiIHk9IjU1IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IiM2NjYiPkltYWdlIE5vdCBGb3VuZDwvdGV4dD48L3N2Zz4=';

const resolveImagePath = (src, chapterPath, opfDir) => {
  if (src.startsWith('../')) {
    const chapterDir = chapterPath.substring(0, chapterPath.lastIndexOf('/'));
    const parentDir = chapterDir.substring(0, chapterDir.lastIndexOf('/'));
    return `${parentDir}/${src.substring(3)}`;
  }
  if (src.startsWith('./')) {
    const chapterDir = chapterPath.substring(0, chapterPath.lastIndexOf('/'));
    return `${chapterDir}/${src.substring(2)}`;
  }
  if (src.startsWith('/')) {
    return opfDir ? `${opfDir}${src}` : src.substring(1);
  }
  const chapterDir = chapterPath.substring(0, chapterPath.lastIndexOf('/'));
  return chapterDir ? `${chapterDir}/${src}` : src;
};

const findImageInZip = (zip, src, chapterPath, opfDir) => {
  const filename = src.split('/').pop();
  const resolvedPath = resolveImagePath(src, chapterPath, opfDir);

  const variations = [
    resolvedPath,
    `Images/${filename}`,
    `images/${filename}`,
    `OEBPS/Images/${filename}`,
    `OEBPS/images/${filename}`,
    `${opfDir}/Images/${filename}`,
    `${opfDir}/images/${filename}`,
    filename,
    src,
  ];
  const unique = [...new Set(variations.filter((p) => p && p !== 'undefined' && p !== 'null'))];

  for (const p of unique) {
    const f = getZipFile(zip, p);
    if (f) return { file: f, path: p };
    const lower = p.toLowerCase();
    const lf = getZipFile(zip, lower);
    if (lf) return { file: lf, path: lower };
  }

  // Last resort: scan all image files in the zip for a basename match
  const allFiles = Object.keys(zip.files);
  const imageFiles = allFiles.filter((f) => /\.(jpe?g|png|gif|svg|webp|bmp)$/i.test(f));
  const srcBasename = filename.toLowerCase();
  const matching = imageFiles.find((f) => {
    const base = f.split('/').pop().toLowerCase();
    return base === srcBasename || base.startsWith(srcBasename.split('.')[0]);
  });
  return matching ? { file: zip.file(matching), path: matching } : null;
};

const inlineImages = async (root, chapterPath, zip, opfDir) => {
  const htmlImages = root.querySelectorAll('img');
  const svgImages = root.querySelectorAll('image');
  const allImages = [...htmlImages, ...svgImages];

  for (const img of allImages) {
    const src =
      img.getAttribute('src') ||
      img.getAttribute('xlink:href') ||
      img.getAttribute('href') ||
      img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');

    if (!src || src.startsWith('http') || src.startsWith('data:')) continue;

    try {
      const found = findImageInZip(zip, src, chapterPath, opfDir);
      if (!found) {
        const placeholder = document.createElement('img');
        placeholder.src = IMAGE_NOT_FOUND_PLACEHOLDER;
        placeholder.style.maxWidth = '200px';
        placeholder.style.margin = '10px auto';
        placeholder.style.display = 'block';
        img.parentNode.replaceChild(placeholder, img);
        continue;
      }

      const base64 = await found.file.async('base64');
      const dataUrl = `data:${getImageMimeType(found.path)};base64,${base64}`;

      if (img.tagName.toLowerCase() === 'image') {
        const newImg = document.createElement('img');
        newImg.src = dataUrl;
        newImg.setAttribute('data-src', dataUrl);
        newImg.setAttribute('data-loaded', 'true');
        const width = img.getAttribute('width');
        const height = img.getAttribute('height');
        if (width) newImg.style.width = width.includes('px') ? width : `${width}px`;
        if (height) newImg.style.height = height.includes('px') ? height : `${height}px`;
        newImg.style.maxWidth = '100%';
        newImg.style.height = 'auto';
        newImg.style.display = 'block';
        newImg.style.margin = '10px auto';
        img.parentNode.replaceChild(newImg, img);
      } else {
        img.setAttribute('src', dataUrl);
        img.setAttribute('data-src', dataUrl);
        img.setAttribute('data-loaded', 'true');
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.display = 'block';
        img.style.margin = '10px auto';
      }
    } catch (err) {
      // If image processing fails, hide the broken element rather than crash.
      img.style.display = 'none';
    }
  }
};

const processChapterContent = async (content, chapterPath, zip, opfDir) => {
  const div = document.createElement('div');
  div.innerHTML = content;
  await inlineImages(div, chapterPath, zip, opfDir);
  div.querySelectorAll('script').forEach((s) => s.remove());
  return div.innerHTML;
};

const parseTocFromNcx = async (ncxFile, parser) => {
  const tocTitles = {};
  const ncxContent = await ncxFile.async('string');
  const ncxDoc = parser.parseFromString(ncxContent, 'text/xml');
  ncxDoc.querySelectorAll('navPoint').forEach((navPoint) => {
    const label = navPoint.querySelector('navLabel text')?.textContent;
    const src = navPoint.querySelector('content')?.getAttribute('src');
    if (label && src) {
      tocTitles[src.split('#')[0]] = label.trim();
    }
  });
  return tocTitles;
};

const parseTocFromNav = async (navFile, parser) => {
  const tocTitles = {};
  const navContent = await navFile.async('string');
  const navDoc = parser.parseFromString(navContent, 'text/html');
  navDoc.querySelectorAll('nav[epub\\:type="toc"] a, nav a').forEach((link) => {
    const href = link.getAttribute('href');
    const title = link.textContent;
    if (href && title) {
      tocTitles[href.split('#')[0]] = title.trim();
    }
  });
  return tocTitles;
};

/**
 * Parse an EPUB file (Blob, File, ArrayBuffer, or Uint8Array/Buffer) into a
 * structured object: { metadata, chapters }.
 *
 * Throws Error with a human-readable message on any failure. Caller is
 * responsible for surfacing the error in the UI.
 */
export async function parseEpub(file) {
  const zip = await JSZip.loadAsync(file);

  const containerFile = getZipFile(zip, 'META-INF/container.xml');
  if (!containerFile) {
    throw new Error(
      'Not a valid EPUB file (missing META-INF/container.xml). Only .epub files are supported.'
    );
  }
  const containerXml = await containerFile.async('string');
  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml, 'text/xml');

  const rootfile = containerDoc.querySelector('rootfile');
  if (!rootfile) throw new Error('EPUB is malformed: container.xml has no <rootfile>.');
  const opfPath = rootfile.getAttribute('full-path');
  const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/'));

  const opfFile = getZipFile(zip, opfPath);
  if (!opfFile) throw new Error(`EPUB is malformed: OPF file not found at "${opfPath}".`);
  const opfXml = await opfFile.async('string');
  const opfDoc = parser.parseFromString(opfXml, 'text/xml');

  // Metadata lives in <dc:title>/<dc:creator>/<dc:description>. Browsers are
  // lenient with namespaced selectors but jsdom is strict — use the namespace
  // wildcard lookup so it works in both.
  const metadataEl = opfDoc.getElementsByTagNameNS('*', 'metadata')[0] || opfDoc.documentElement;
  const readMeta = (localName) =>
    metadataEl.getElementsByTagNameNS('*', localName)[0]?.textContent?.trim() || '';
  const metadata = {
    title: readMeta('title') || 'Unknown Title',
    author: readMeta('creator') || 'Unknown Author',
    description: readMeta('description'),
  };

  const spine = opfDoc.querySelectorAll('spine itemref');
  const manifest = opfDoc.querySelectorAll('manifest item');

  const manifestMap = {};
  manifest.forEach((item) => {
    manifestMap[item.getAttribute('id')] = {
      href: item.getAttribute('href'),
      type: item.getAttribute('media-type'),
    };
  });

  // TOC: prefer NCX (EPUB2), fall back to nav doc (EPUB3).
  let tocTitles = {};
  const ncxItem = Array.from(manifest).find(
    (item) => item.getAttribute('media-type') === 'application/x-dtbncx+xml'
  );
  if (ncxItem) {
    try {
      const ncxPath = opfDir ? `${opfDir}/${ncxItem.getAttribute('href')}` : ncxItem.getAttribute('href');
      const ncxFile = getZipFile(zip, ncxPath);
      if (ncxFile) tocTitles = await parseTocFromNcx(ncxFile, parser);
    } catch (err) {
      console.warn('Could not parse NCX file:', err);
    }
  }
  if (Object.keys(tocTitles).length === 0) {
    const navItem = Array.from(manifest).find(
      (item) =>
        item.getAttribute('properties')?.includes('nav') ||
        item.getAttribute('href')?.includes('nav')
    );
    if (navItem) {
      try {
        const navPath = opfDir ? `${opfDir}/${navItem.getAttribute('href')}` : navItem.getAttribute('href');
        const navFile = getZipFile(zip, navPath);
        if (navFile) tocTitles = await parseTocFromNav(navFile, parser);
      } catch (err) {
        console.warn('Could not parse navigation file:', err);
      }
    }
  }

  const chapters = [];
  for (const itemRef of spine) {
    const idref = itemRef.getAttribute('idref');
    const manifestItem = manifestMap[idref];
    if (!manifestItem) {
      console.warn(`Skipping spine itemref with no manifest match: idref="${idref}"`);
      continue;
    }

    const mediaType = (manifestItem.type || '').trim().toLowerCase();
    const looksLikeHtml =
      HTML_TYPES.has(mediaType) || /\.x?html?$/i.test(manifestItem.href || '');
    if (!looksLikeHtml) {
      console.warn(`Skipping non-HTML spine item: ${manifestItem.href} (type="${manifestItem.type}")`);
      continue;
    }

    const chapterPath = opfDir ? `${opfDir}/${manifestItem.href}` : manifestItem.href;
    const chapterFile = getZipFile(zip, chapterPath);
    if (!chapterFile) {
      console.warn(`Skipping missing chapter: ${chapterPath}`);
      continue;
    }
    const chapterContent = await chapterFile.async('string');

    let chapterTitle = tocTitles[manifestItem.href];
    if (!chapterTitle) {
      const doc = parser.parseFromString(chapterContent, 'text/html');
      chapterTitle =
        doc.querySelector('title')?.textContent ||
        doc.querySelector('h1')?.textContent ||
        doc.querySelector('h2')?.textContent ||
        doc.querySelector('h3')?.textContent;
    }
    if (!chapterTitle || chapterTitle.trim() === '') {
      chapterTitle = `Chapter ${chapters.length + 1}`;
    }

    const doc = parser.parseFromString(chapterContent, 'text/html');
    const bodyContent = doc.querySelector('body')?.innerHTML || chapterContent;
    const processedContent = await processChapterContent(bodyContent, chapterPath, zip, opfDir);

    chapters.push({ title: chapterTitle.trim(), content: processedContent });
  }

  if (chapters.length === 0) throw new Error('No chapters found in EPUB');

  return { metadata, chapters };
}

// Exported for tests; not part of the public API.
export const __internals = {
  getZipFile,
  resolveImagePath,
  HTML_TYPES,
};
