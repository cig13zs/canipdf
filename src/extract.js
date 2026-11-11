/**
 * The referee: an independent text extractor.
 *
 * We never ask a library whether it encoded correctly. We render with that
 * library, then read the bytes back with pdfjs-dist (a different project) and
 * compare codepoints. If the referee is missing, the run fails loudly rather
 * than quietly passing.
 */

let cached = null;

async function loadPdfjs() {
  if (cached !== null) return cached;
  const candidates = [
    'pdfjs-dist/legacy/build/pdf.mjs',
    'pdfjs-dist/build/pdf.mjs',
  ];
  for (const spec of candidates) {
    try {
      cached = await import(spec);
      return cached;
    } catch {
      /* try next */
    }
  }
  cached = false;
  return cached;
}

export async function extractText(bytes) {
  const pdfjs = await loadPdfjs();
  if (!pdfjs) return { ok: false, reason: 'pdfjs-dist is not installed — cannot referee' };

  const data = new Uint8Array(bytes);
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data,
      useSystemFonts: false,
      disableFontFace: true,
      isEvalSupported: false,
      verbosity: 0,
    }).promise;

    let out = '';
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      out += content.items.map((i) => i.str ?? '').join('');
    }
    return { ok: true, text: out };
  } catch (e) {
    return { ok: false, reason: e?.message ?? String(e) };
  } finally {
    try {
      await doc?.destroy();
    } catch {
      /* ignore */
    }
  }
}

const norm = (s) => (s ?? '').normalize('NFC').replace(/\s+/gu, '');

/**
 * Compare what went in with what came out.
 *
 * PASS       every codepoint present, in order
 * ORDER      same codepoints, different order (usually RTL/bidi handling)
 * PARTIAL    roughly half or more survived
 * LOSSY      most codepoints destroyed but something came back
 * FAIL       extraction produced nothing recognisable
 */
export function compare(expected, actual) {
  const a = norm(expected);
  const b = norm(actual);
  if (a === b) return { status: 'PASS', kept: 1 };

  const sortedMatch = [...a].sort().join('') === [...b].sort().join('');
  if (sortedMatch && b.length > 0) return { status: 'ORDER', kept: 1 };

  const want = new Map();
  for (const ch of a) want.set(ch, (want.get(ch) ?? 0) + 1);
  let kept = 0;
  for (const ch of b) {
    const n = want.get(ch);
    if (n) {
      kept += 1;
      want.set(ch, n - 1);
    }
  }
  const ratio = a.length ? kept / a.length : 0;
  if (ratio >= 0.5) return { status: 'PARTIAL', kept: ratio };
  if (b.length > 0) return { status: 'LOSSY', kept: ratio };
  return { status: 'FAIL', kept: ratio };
}
