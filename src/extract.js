/**
 * The referees: two independent text extractors.
 *
 * We never ask a library whether it encoded correctly. We render with that
 * library, then read the bytes back with engines that live in a different
 * codebase entirely, and compare codepoints.
 *
 * Two referees matter because a single referee's bug would read as a subject
 * library's failure. When they disagree, the cell is reported as DISPUTED rather
 * than being quietly averaged into a verdict.
 */

let pdfjsModule = null;

async function loadPdfjs() {
  if (pdfjsModule !== null) return pdfjsModule;
  for (const spec of ['pdfjs-dist/legacy/build/pdf.mjs', 'pdfjs-dist/build/pdf.mjs']) {
    try {
      pdfjsModule = await import(spec);
      return pdfjsModule;
    } catch {
      /* next */
    }
  }
  pdfjsModule = false;
  return pdfjsModule;
}

async function viaPdfjs(bytes) {
  const pdfjs = await loadPdfjs();
  if (!pdfjs) throw new Error('pdfjs-dist not installed');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  try {
    let out = '';
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      out += content.items.map((i) => i.str ?? '').join('');
    }
    return out;
  } finally {
    try {
      await doc.destroy();
    } catch {
      /* ignore */
    }
  }
}

async function viaMupdf(bytes) {
  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
  try {
    let out = '';
    for (let p = 0; p < doc.countPages(); p++) {
      const page = doc.loadPage(p);
      out += page.toStructuredText('preserve-whitespace').asText();
    }
    return out;
  } finally {
    try {
      doc.destroy();
    } catch {
      /* ignore */
    }
  }
}

export const REFEREES = [
  { id: 'pdfjs', label: 'pdfjs-dist', run: viaPdfjs },
  { id: 'mupdf', label: 'MuPDF', run: viaMupdf },
];

/** Read the same bytes with every available referee. */
export async function extractAll(bytes) {
  const out = [];
  for (const r of REFEREES) {
    try {
      out.push({ referee: r.id, ok: true, text: await r.run(bytes) });
    } catch (e) {
      out.push({ referee: r.id, ok: false, reason: String(e?.message ?? e).slice(0, 90) });
    }
  }
  return out;
}

const norm = (s) => (s ?? '').normalize('NFC').replace(/\s+/gu, '');

/** Hebrew, Arabic, Syriac, Thaana, NKo and the presentation-form blocks. */
export function isRtlChar(ch) {
  const cp = ch.codePointAt(0) ?? 0;
  return (
    (cp >= 0x0590 && cp <= 0x08ff) ||
    (cp >= 0xfb1d && cp <= 0xfdff) ||
    (cp >= 0xfe70 && cp <= 0xfeff)
  );
}

export const hasRtl = (s) => [...(s ?? '')].some(isRtlChar);

/**
 * Where did the glyphs physically go?
 *
 * Round-trip comparison proves the content stream kept logical order. It says
 * nothing about placement: a writer can emit the correct codepoints in the
 * correct order and still lay them out left-to-right, producing a document that
 * reads backwards. MuPDF's structured-text walker reports a per-character origin
 * and bidi level, so this is measurable without a reference render.
 *
 * direction:
 *   'rtl'   successive RTL glyphs move right-to-left — placed correctly
 *   'ltr'   successive RTL glyphs move left-to-right — visually reversed
 *   'none'  no RTL characters in the document
 *   'unknown' nothing measurable
 */
export async function glyphPlacement(bytes) {
  let mupdf;
  try {
    mupdf = await import('mupdf');
  } catch {
    return { direction: 'unknown', reason: 'mupdf not installed' };
  }

  let doc;
  try {
    doc = mupdf.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
    const page = doc.loadPage(0);
    const st = page.toStructuredText('preserve-whitespace');
    const chars = [];
    st.walk({
      onChar(c, origin) {
        chars.push({ c, x: origin[0] });
      },
    });

    const rtl = chars.filter((ch) => isRtlChar(ch.c));
    if (rtl.length < 2) return { direction: 'none', glyphs: chars.length };

    let decreasing = 0;
    let increasing = 0;
    for (let i = 1; i < rtl.length; i++) {
      const dx = rtl[i].x - rtl[i - 1].x;
      if (dx < 0) decreasing++;
      else if (dx > 0) increasing++;
    }
    return {
      direction: decreasing >= increasing ? 'rtl' : 'ltr',
      glyphs: chars.length,
      decreasing,
      increasing,
    };
  } catch (e) {
    return { direction: 'unknown', reason: String(e?.message ?? e).slice(0, 80) };
  } finally {
    try {
      doc?.destroy();
    } catch {
      /* ignore */
    }
  }
}

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

/**
 * Combine referee verdicts. All referees agreeing is a finding; referees
 * disagreeing is a finding about the *measurement*, and it is reported as such.
 */
export function adjudicate(expected, extractions) {
  const perReferee = extractions.map((e) =>
    e.ok
      ? { referee: e.referee, ...compare(expected, e.text), readBack: e.text.slice(0, 40) }
      : { referee: e.referee, status: 'SKIP', reason: e.reason },
  );

  const decided = perReferee.filter((r) => r.status !== 'SKIP');
  if (!decided.length) {
    return { status: 'SKIP', perReferee, detail: perReferee.find((r) => r.reason)?.reason };
  }

  const distinct = [...new Set(decided.map((r) => r.status))];
  if (distinct.length === 1) {
    const kept = Math.min(...decided.map((r) => r.kept ?? 0));
    return { status: distinct[0], kept: Number(kept.toFixed(2)), perReferee, agreed: true };
  }
  return { status: 'DISPUTED', perReferee, agreed: false, detail: distinct.join(' vs ') };
}
