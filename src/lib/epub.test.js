/* eslint-env jest */
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { parseEpub, __internals } from './epub';

const FIXTURES = path.resolve(__dirname, '../../test/fixtures');

// Silence noisy console.warn from the parser during tests; restore after.
let warnSpy;
beforeEach(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Helpers for building synthetic EPUB fixtures in-memory.
// Keeps the test file self-contained and lets us assert against EPUB2 + EPUB3
// without shipping binary blobs for every variant.
// ---------------------------------------------------------------------------

const MIMETYPE = 'application/epub+zip';

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const chapterHtml = (title, body) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${title}</title></head>
<body><h1>${title}</h1>${body}</body>
</html>`;

const buildEpub2 = async ({ title = 'Test Book', author = 'Test Author', chapterHrefs = [] } = {}) => {
  const zip = new JSZip();
  zip.file('mimetype', MIMETYPE);
  zip.file('META-INF/container.xml', CONTAINER_XML);

  const manifestItems = chapterHrefs
    .map(
      (href, i) =>
        `<item id="ch${i}" href="${href}" media-type="application/xhtml+xml"/>`
    )
    .join('\n    ');
  const spineItems = chapterHrefs.map((_, i) => `<itemref idref="ch${i}"/>`).join('\n    ');

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:test</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    ${spineItems}
  </spine>
</package>`;
  zip.file('OEBPS/content.opf', opf);

  const navPoints = chapterHrefs
    .map(
      (href, i) => `<navPoint id="np${i}" playOrder="${i + 1}">
      <navLabel><text>TOC Title ${i + 1}</text></navLabel>
      <content src="${href}"/>
    </navPoint>`
    )
    .join('\n    ');
  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:test"/></head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
    ${navPoints}
  </navMap>
</ncx>`
  );

  // Resolve href -> actual file path (decoded). Tests can pass percent-encoded
  // hrefs in chapterHrefs and we'll store the file under its decoded name.
  for (let i = 0; i < chapterHrefs.length; i++) {
    const decoded = decodeURIComponent(chapterHrefs[i]);
    zip.file(`OEBPS/${decoded}`, chapterHtml(`Body Title ${i + 1}`, `<p>Chapter ${i + 1} body.</p>`));
  }

  return zip.generateAsync({ type: 'nodebuffer' });
};

const buildEpub3 = async ({ title = 'Test Book 3', chapterHrefs = [] } = {}) => {
  const zip = new JSZip();
  zip.file('mimetype', MIMETYPE);
  zip.file('META-INF/container.xml', CONTAINER_XML);

  const manifestItems = chapterHrefs
    .map(
      (href, i) =>
        `<item id="ch${i}" href="${href}" media-type="application/xhtml+xml"/>`
    )
    .join('\n    ');
  const spineItems = chapterHrefs.map((_, i) => `<itemref idref="ch${i}"/>`).join('\n    ');

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:test3</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>EPUB3 Author</dc:creator>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`;
  zip.file('OEBPS/content.opf', opf);

  const navLinks = chapterHrefs
    .map((href, i) => `<li><a href="${href}">Nav Title ${i + 1}</a></li>`)
    .join('\n      ');
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Nav</title></head>
<body>
  <nav epub:type="toc"><ol>
      ${navLinks}
  </ol></nav>
</body>
</html>`
  );

  for (let i = 0; i < chapterHrefs.length; i++) {
    const decoded = decodeURIComponent(chapterHrefs[i]);
    zip.file(`OEBPS/${decoded}`, chapterHtml(`Body Title ${i + 1}`, `<p>EPUB3 chapter ${i + 1}.</p>`));
  }

  return zip.generateAsync({ type: 'nodebuffer' });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseEpub - real-world fixture (Kobold, percent-encoded hrefs)', () => {
  const fixturePath = path.join(FIXTURES, 'kobold-percent-encoded.epub');
  const fixtureExists = fs.existsSync(fixturePath);
  const maybeIt = fixtureExists ? it : it.skip;

  maybeIt('parses all 28 chapters when OPF hrefs are URL-encoded', async () => {
    const buf = fs.readFileSync(fixturePath);
    const { metadata, chapters } = await parseEpub(buf);

    expect(metadata.title).toMatch(/Kobold Guide to Board Game Design/);
    expect(metadata.author).toMatch(/Garfield/);
    // Regression: prior to decodeURIComponent fallback, only 1/28 resolved.
    expect(chapters.length).toBe(28);
    chapters.forEach((c) => {
      expect(typeof c.title).toBe('string');
      expect(typeof c.content).toBe('string');
    });
  });
});

describe('parseEpub - EPUB2 synthetic', () => {
  it('parses metadata and chapters from a minimal EPUB2', async () => {
    const buf = await buildEpub2({
      title: 'My Book',
      author: 'Jane Doe',
      chapterHrefs: ['ch1.xhtml', 'ch2.xhtml'],
    });
    const { metadata, chapters } = await parseEpub(buf);
    expect(metadata.title).toBe('My Book');
    expect(metadata.author).toBe('Jane Doe');
    expect(chapters).toHaveLength(2);
    // NCX titles take precedence over <title>/<h1> in the chapter HTML
    expect(chapters[0].title).toBe('TOC Title 1');
    expect(chapters[1].title).toBe('TOC Title 2');
    expect(chapters[0].content).toContain('Chapter 1 body.');
  });

  it('handles percent-encoded hrefs in the manifest (the Kobold bug)', async () => {
    // Encoded "CR!split_001.html" -> "CR%21split_001.html"
    const buf = await buildEpub2({
      chapterHrefs: ['CR%21split_001.html', 'CR%21split_002.html'],
    });
    const { chapters } = await parseEpub(buf);
    expect(chapters).toHaveLength(2);
  });
});

describe('parseEpub - EPUB3 synthetic', () => {
  it('parses metadata, nav-doc TOC, and chapters', async () => {
    const buf = await buildEpub3({
      title: 'Three Book',
      chapterHrefs: ['c1.xhtml', 'c2.xhtml', 'c3.xhtml'],
    });
    const { metadata, chapters } = await parseEpub(buf);
    expect(metadata.title).toBe('Three Book');
    expect(chapters).toHaveLength(3);
    expect(chapters[0].title).toBe('Nav Title 1');
    expect(chapters[2].title).toBe('Nav Title 3');
  });
});

describe('parseEpub - error handling', () => {
  it('throws a helpful error on a non-zip (e.g. PDF)', async () => {
    const fakePdf = Buffer.from('%PDF-1.4\nnot a zip\n%%EOF');
    await expect(parseEpub(fakePdf)).rejects.toThrow(/zip/i);
  });

  it('throws when zip is missing META-INF/container.xml', async () => {
    const zip = new JSZip();
    zip.file('random.txt', 'hello');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(parseEpub(buf)).rejects.toThrow(/container\.xml/);
  });

  it('throws when OPF declared in container.xml is missing from the zip', async () => {
    const zip = new JSZip();
    zip.file('META-INF/container.xml', CONTAINER_XML);
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(parseEpub(buf)).rejects.toThrow(/OPF/);
  });

  it('throws when no chapters end up loadable', async () => {
    const buf = await buildEpub2({ chapterHrefs: [] });
    await expect(parseEpub(buf)).rejects.toThrow(/No chapters/);
  });
});

describe('parseEpub - chapter title fallbacks', () => {
  it('falls back to chapter HTML <title> when TOC entry is missing for that href', async () => {
    // Build an EPUB where NCX only covers ch1; ch2 must get its title from body.
    const zip = new JSZip();
    zip.file('mimetype', MIMETYPE);
    zip.file('META-INF/container.xml', CONTAINER_XML);
    zip.file(
      'OEBPS/content.opf',
      `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">uid</dc:identifier><dc:title>x</dc:title>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`
    );
    zip.file(
      'OEBPS/toc.ncx',
      `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="uid"/></head>
  <docTitle><text>x</text></docTitle>
  <navMap>
    <navPoint id="n1" playOrder="1">
      <navLabel><text>From NCX</text></navLabel>
      <content src="ch1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`
    );
    zip.file('OEBPS/ch1.xhtml', chapterHtml('Body One', '<p>1</p>'));
    zip.file('OEBPS/ch2.xhtml', chapterHtml('Body Two', '<p>2</p>'));
    const buf = await zip.generateAsync({ type: 'nodebuffer' });

    const { chapters } = await parseEpub(buf);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toBe('From NCX');
    expect(chapters[1].title).toBe('Body Two'); // <title> tag fallback
  });
});

describe('__internals.getZipFile', () => {
  it('returns the literal match when present', async () => {
    const zip = new JSZip();
    zip.file('foo/bar.html', '<p/>');
    const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(__internals.getZipFile(loaded, 'foo/bar.html')).not.toBeNull();
  });

  it('falls back to the URL-decoded form', async () => {
    const zip = new JSZip();
    zip.file('foo/CR!split.html', '<p/>'); // raw filename
    const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
    // Look up the encoded form
    expect(__internals.getZipFile(loaded, 'foo/CR%21split.html')).not.toBeNull();
  });

  it('returns null for missing paths', async () => {
    const zip = new JSZip();
    zip.file('foo/bar.html', '<p/>');
    const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(__internals.getZipFile(loaded, 'nope.html')).toBeNull();
  });

  it('returns null on malformed URI without throwing', async () => {
    const zip = new JSZip();
    const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(__internals.getZipFile(loaded, 'bad%E0%A4%A')).toBeNull();
  });
});

describe('__internals.resolveImagePath', () => {
  const { resolveImagePath } = __internals;

  it('resolves ../ relative to the chapter directory', () => {
    expect(resolveImagePath('../Images/cover.jpg', 'OEBPS/Text/ch1.html', 'OEBPS')).toBe(
      'OEBPS/Images/cover.jpg'
    );
  });

  it('resolves ./ relative to the chapter directory', () => {
    expect(resolveImagePath('./fig1.png', 'OEBPS/Text/ch1.html', 'OEBPS')).toBe(
      'OEBPS/Text/fig1.png'
    );
  });

  it('resolves bare filenames relative to the chapter directory', () => {
    expect(resolveImagePath('fig.png', 'OEBPS/Text/ch1.html', 'OEBPS')).toBe(
      'OEBPS/Text/fig.png'
    );
  });

  it('resolves absolute paths against the OPF root', () => {
    expect(resolveImagePath('/Images/cover.jpg', 'OEBPS/Text/ch1.html', 'OEBPS')).toBe(
      'OEBPS/Images/cover.jpg'
    );
  });
});
