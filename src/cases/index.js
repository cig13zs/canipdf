/**
 * Case definitions for canipdf.
 *
 * A case is a claim a library's README makes, reduced to something checkable.
 * Every text case is a round-trip: render the string into a PDF, extract it
 * back out with an independent reader, compare codepoints. Pixels are not
 * evidence; codepoints are.
 */

/**
 * Non-Latin text cases. Chosen because they are the failure class that actually
 * bites users in production invoicing, receipts and reporting — and because the
 * most-reacted open bug in the most-installed JS PDF library is exactly this
 * (pdf-lib#1152, "WinAnsi cannot encode ... non-latin text").
 */
export const TEXT_CASES = [
  { id: 'ar-basic', script: 'Arabic', class: 'non-latin', text: 'مرحبا بالعالم' },
  { id: 'ar-invoice', script: 'Arabic (mixed)', class: 'non-latin', text: 'الفاتورة رقم 42 لسنة 2026' },
  // Mixed-direction runs are the harder case: a correct writer keeps logical
  // order in the content stream even though the glyphs are placed right-to-left.
  { id: 'bidi-ar-latin', script: 'Bidi: Arabic + Latin', class: 'bidi', text: 'Invoice 42: مرحبا بك (03/2026)' },
  { id: 'bidi-he-latin', script: 'Bidi: Hebrew + Latin', class: 'bidi', text: 'שלום World 123' },
  { id: 'he', script: 'Hebrew', class: 'non-latin', text: 'שלום עולם' },
  { id: 'hi-deva', script: 'Devanagari', class: 'non-latin', text: 'नमस्ते दुनिया' },
  { id: 'th', script: 'Thai', class: 'non-latin', text: 'สวัสดีชาวโลก' },
  { id: 'zh-hans', script: 'Han (Simplified)', class: 'non-latin', text: '你好世界' },
  { id: 'ja', script: 'Japanese', class: 'non-latin', text: 'こんにちは世界' },
  { id: 'ko', script: 'Korean', class: 'non-latin', text: '안녕하세요 세계' },
  { id: 'el', script: 'Greek', class: 'non-latin', text: 'Γειά σου Κόσμε' },
  { id: 'ru-cyr', script: 'Cyrillic', class: 'non-latin', text: 'Привет, мир' },
  { id: 'vi', script: 'Vietnamese', class: 'diacritics', text: 'Tiếng Việt có dấu' },
  { id: 'ascii-control', script: 'Latin (control)', class: 'control', text: 'Invoice 42 - paid' },
];

/**
 * Structural properties read straight from the PDF bytes, no library needed.
 *
 * These are the machine-checkable prerequisites of an accessible document. They
 * are not a conformance verdict — a document can carry every one of these and
 * still fail PDF/UA, because reading order and correct alt text require a human.
 * They are the cheap triage gate: if these are missing, nothing downstream can
 * pass.
 */
export const STRUCTURE_MARKERS = {
  tagged: /\/StructTreeRoot/,
  marked: /\/MarkInfo/,
  lang: /\/Lang\s*[\/\(]/,
  title: /\/Title\s*[\(<]/,
  altText: /\/Alt\b/,
  embeddedFont: /\/FontFile[23]?/,
  encrypted: /\/Encrypt/,
};

export const STRUCTURE_LABELS = [
  ['tagged', 'structure tree (/StructTreeRoot)'],
  ['marked', 'marked content (/MarkInfo)'],
  ['lang', 'document language (/Lang)'],
  ['title', 'document title (/Title)'],
  ['altText', 'alt text (/Alt)'],
  ['embeddedFont', 'embedded font (/FontFile)'],
  ['encrypted', 'encryption (/Encrypt)'],
];

/**
 * Capability probes: things a library either has an API for or does not.
 * These return 'yes' | 'no' | 'no API'. No shims, no workarounds — the question
 * is whether the API exists at all.
 */
export const CAPABILITIES = [
  { id: 'forms', label: 'AcroForm fields' },
  { id: 'encrypt', label: 'Encryption' },
  { id: 'tagged', label: 'Tagged output (PDF/UA prerequisite)' },
];
