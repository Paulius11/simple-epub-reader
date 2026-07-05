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

// Parse the NCX (EPUB2) TOC into an *ordered* list of entries, preserving the
// `#fragment` of each `content src`. Many EPUBs pack multiple logical chapters
// (e.g. cantos) into one spine file, distinguishing them only by fragment; we
// need every entry, not one-per-file, so downstream splitting can work.
// querySelectorAll returns navPoints in document (reading) order.
const parseTocFromNcx = async (ncxFile, parser) => {
  const entries = [];
  const ncxContent = await ncxFile.async('string');
  const ncxDoc = parser.parseFromString(ncxContent, 'text/xml');
  ncxDoc.querySelectorAll('navPoint').forEach((navPoint) => {
    const label = navPoint.querySelector('navLabel text')?.textContent;
    const src = navPoint.querySelector('content')?.getAttribute('src');
    if (label && src) {
      const [href, fragment] = src.split('#');
      entries.push({ href, fragment: fragment || null, title: label.trim() });
    }
  });
  return entries;
};

// Fast non-crypto hash for fallback bookId. Good enough to disambiguate files;
// not for security. Returns base-36 string.
const simpleHash = (str) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(36);
};

const countWords = (html) => {
  if (!html) return 0;
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ');
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
};

// Look up the cover image href (if any) declared via the EPUB2 convention:
//   <meta name="cover" content="<manifest-id>"/>
// or the EPUB3 convention: <item properties="cover-image"/> in the manifest.
const findCoverHref = (metadataEl, manifestItems) => {
  // EPUB3
  for (const item of manifestItems) {
    const props = item.getAttribute('properties') || '';
    if (props.split(/\s+/).includes('cover-image')) {
      return { href: item.getAttribute('href'), type: item.getAttribute('media-type') };
    }
  }
  // EPUB2
  const metaTags = metadataEl.getElementsByTagNameNS('*', 'meta');
  for (const m of metaTags) {
    if ((m.getAttribute('name') || '').toLowerCase() === 'cover') {
      const id = m.getAttribute('content');
      const item = Array.from(manifestItems).find((i) => i.getAttribute('id') === id);
      if (item) return { href: item.getAttribute('href'), type: item.getAttribute('media-type') };
    }
  }
  return null;
};

// EPUB3 nav-doc equivalent of parseTocFromNcx: ordered entries, fragments kept.
const parseTocFromNav = async (navFile, parser) => {
  const entries = [];
  const seen = new Set();
  const navContent = await navFile.async('string');
  const navDoc = parser.parseFromString(navContent, 'text/html');
  navDoc.querySelectorAll('nav[epub\\:type="toc"] a, nav a').forEach((link) => {
    const rawHref = link.getAttribute('href');
    const title = link.textContent;
    if (!rawHref || !title) return;
    // The "nav a" fallback selector can match the same link twice when the nav
    // has an epub:type="toc"; dedupe on href.
    if (seen.has(rawHref)) return;
    seen.add(rawHref);
    const [href, fragment] = rawHref.split('#');
    entries.push({ href, fragment: fragment || null, title: title.trim() });
  });
  return entries;
};

// Split a chapter's <body> element into segments at the given TOC anchor
// entries, so that one spine file containing several logical chapters (e.g.
// "I GIESMĖ", "II GIESMĖ" marked by `<h4 id="toc_N">`) becomes multiple
// chapters. Each entry begins a new segment at the top-level body child that
// contains its anchor; an entry with no fragment begins at the file start.
//
// Returns [{ title, html }] in document order, or null when there is nothing
// useful to split on (caller then keeps the file as a single chapter).
const splitBodyByAnchors = (bodyEl, entries) => {
  const children = Array.from(bodyEl.childNodes);

  // Resolve each entry to the index of the top-level body child where it begins.
  const points = [];
  for (const entry of entries) {
    let childIndex = 0;
    if (entry.fragment) {
      const anchor =
        bodyEl.querySelector(`[id="${entry.fragment}"]`) ||
        bodyEl.querySelector(`[name="${entry.fragment}"]`);
      if (!anchor) continue; // fragment not in this file — skip
      let node = anchor;
      while (node.parentNode && node.parentNode !== bodyEl) node = node.parentNode;
      childIndex = children.indexOf(node);
      if (childIndex < 0) continue;
    }
    points.push({ title: entry.title, fragment: entry.fragment, childIndex });
  }

  if (points.length < 2) return null; // nothing gained by splitting

  points.sort((a, b) => a.childIndex - b.childIndex);
  // Attach any leading content (before the first anchor) to the first segment.
  points[0].childIndex = 0;

  const segments = [];
  for (let i = 0; i < points.length; i++) {
    const start = points[i].childIndex;
    const end = i + 1 < points.length ? points[i + 1].childIndex : children.length;
    // Consecutive entries sharing a top-level child would make an empty slice;
    // fold their titles together rather than emit a contentless chapter.
    if (end <= start) {
      if (segments.length) segments[segments.length - 1].extraTitles.push(points[i].title);
      continue;
    }
    const container = bodyEl.ownerDocument.createElement('div');
    for (let j = start; j < end; j++) container.appendChild(children[j].cloneNode(true));
    segments.push({
      title: points[i].title,
      fragment: points[i].fragment,
      html: container.innerHTML,
      extraTitles: [],
    });
  }
  return segments.length >= 2 ? segments : null;
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
  // dc:identifier is required by the EPUB spec and is the most stable per-book
  // key we can get. Falls back to a hash of the OPF bytes if missing/malformed.
  const dcIdentifier = readMeta('identifier');
  const bookId = dcIdentifier || `epub:hash:${simpleHash(opfXml)}`;

  const metadata = {
    title: readMeta('title') || 'Unknown Title',
    author: readMeta('creator') || 'Unknown Author',
    description: readMeta('description'),
    bookId,
    cover: null, // filled in below if present
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

  // Cover image (EPUB2 <meta name="cover"> or EPUB3 properties="cover-image").
  const coverInfo = findCoverHref(metadataEl, manifest);
  if (coverInfo?.href) {
    try {
      const coverPath = opfDir ? `${opfDir}/${coverInfo.href}` : coverInfo.href;
      const coverFile = getZipFile(zip, coverPath);
      if (coverFile) {
        const base64 = await coverFile.async('base64');
        const mime = coverInfo.type || getImageMimeType(coverPath);
        metadata.cover = `data:${mime};base64,${base64}`;
      }
    } catch (err) {
      console.warn('Could not load cover image:', err);
    }
  }

  // TOC: prefer NCX (EPUB2), fall back to nav doc (EPUB3). Both return an
  // ordered list of { href, fragment, title } entries.
  let tocEntries = [];
  const ncxItem = Array.from(manifest).find(
    (item) => item.getAttribute('media-type') === 'application/x-dtbncx+xml'
  );
  if (ncxItem) {
    try {
      const ncxPath = opfDir ? `${opfDir}/${ncxItem.getAttribute('href')}` : ncxItem.getAttribute('href');
      const ncxFile = getZipFile(zip, ncxPath);
      if (ncxFile) tocEntries = await parseTocFromNcx(ncxFile, parser);
    } catch (err) {
      console.warn('Could not parse NCX file:', err);
    }
  }
  if (tocEntries.length === 0) {
    const navItem = Array.from(manifest).find(
      (item) =>
        item.getAttribute('properties')?.includes('nav') ||
        item.getAttribute('href')?.includes('nav')
    );
    if (navItem) {
      try {
        const navPath = opfDir ? `${opfDir}/${navItem.getAttribute('href')}` : navItem.getAttribute('href');
        const navFile = getZipFile(zip, navPath);
        if (navFile) tocEntries = await parseTocFromNav(navFile, parser);
      } catch (err) {
        console.warn('Could not parse navigation file:', err);
      }
    }
  }

  // Group TOC entries by the spine file they point into, preserving order.
  const tocByHref = new Map();
  for (const entry of tocEntries) {
    if (!tocByHref.has(entry.href)) tocByHref.set(entry.href, []);
    tocByHref.get(entry.href).push(entry);
  }
  // NCX srcs and manifest hrefs may differ only by URL-encoding; try both forms.
  const getTocEntriesFor = (href) => {
    if (tocByHref.has(href)) return tocByHref.get(href);
    try {
      const decoded = decodeURIComponent(href);
      if (tocByHref.has(decoded)) return tocByHref.get(decoded);
    } catch (_) { /* malformed URI: ignore */ }
    return [];
  };

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
    const doc = parser.parseFromString(chapterContent, 'text/html');
    const bodyEl = doc.querySelector('body');
    const entries = getTocEntriesFor(manifestItem.href);

    // If this file holds several TOC entries (with fragments), split it into
    // one chapter per entry. Otherwise keep it as a single chapter.
    const segments = bodyEl ? splitBodyByAnchors(bodyEl, entries) : null;

    if (segments) {
      for (const segment of segments) {
        const processedContent = await processChapterContent(
          segment.html,
          chapterPath,
          zip,
          opfDir
        );
        const title = [segment.title, ...segment.extraTitles].filter(Boolean).join(' · ');
        chapters.push({
          title: title || `Chapter ${chapters.length + 1}`,
          content: processedContent,
          wordCount: countWords(processedContent),
          href: manifestItem.href,
          fragment: segment.fragment || null,
        });
      }
      continue;
    }

    let chapterTitle = entries[0]?.title;
    if (!chapterTitle) {
      chapterTitle =
        doc.querySelector('title')?.textContent ||
        doc.querySelector('h1')?.textContent ||
        doc.querySelector('h2')?.textContent ||
        doc.querySelector('h3')?.textContent;
    }
    if (!chapterTitle || chapterTitle.trim() === '') {
      chapterTitle = `Chapter ${chapters.length + 1}`;
    }

    const bodyContent = bodyEl?.innerHTML || chapterContent;
    const processedContent = await processChapterContent(bodyContent, chapterPath, zip, opfDir);

    chapters.push({
      title: chapterTitle.trim(),
      content: processedContent,
      wordCount: countWords(processedContent),
      href: manifestItem.href,
    });
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
