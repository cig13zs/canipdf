/**
 * Adapters — one thin shim per library, deliberately small.
 *
 * An adapter may only do what the library's public API allows. No post-hoc
 * repair, no font substitution tricks, no "we patched the bytes": if the library
 * cannot do it, that is the finding we are here to record.
 *
 * Every adapter receives a context: { fontPath }. With no fontPath it uses the
 * library's default font — which is what most users get. With a fontPath it uses
 * a real Unicode font, which is the documented workaround. Both columns matter:
 * the first shows what happens by accident, the second shows what the library can
 * actually do when asked properly.
 */

import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

function pkgVersion(pkg) {
  try {
    const path = require.resolve(`${pkg}/package.json`);
    return JSON.parse(require('node:fs').readFileSync(path, 'utf8')).version;
  } catch {
    try {
      const base = require('node:path').join(process.cwd(), 'node_modules', pkg, 'package.json');
      return JSON.parse(require('node:fs').readFileSync(base, 'utf8')).version;
    } catch {
      return 'unknown';
    }
  }
}

/**
 * Fontkit candidates.
 *
 * There are three live fontkit packages and each library documents a different
 * preferred one: `pdf-lib` documents `@pdf-lib/fontkit` (1.x), while
 * `@cantoo/pdf-lib`'s README documents its own `@cantoo/fontkit` (a fontkit 2.x
 * fork with a default export) and keeps upstream `fontkit` working. Pairing the
 * wrong one is a documented trap, so the harness asks each library for its own
 * preference order and records which package it actually needed — otherwise a
 * dependency mismatch gets reported as a library defect.
 */
const FONTKITS = {
  'fontkit': async () => { const m = await import('fontkit'); return m.default ?? m; },
  '@cantoo/fontkit': async () => { const m = await import('@cantoo/fontkit'); return m.default ?? m; },
  '@pdf-lib/fontkit': async () => (await import('@pdf-lib/fontkit')).default,
};

/** Each library's documented preference, then the others as fallbacks. */
const FONTKIT_ORDER = {
  'pdf-lib': ['@pdf-lib/fontkit', 'fontkit', '@cantoo/fontkit'],
  '@cantoo/pdf-lib': ['@cantoo/fontkit', 'fontkit', '@pdf-lib/fontkit'],
};

function fontkitVersion(id) {
  try {
    const p = require('node:path').join(process.cwd(), 'node_modules', id, 'package.json');
    return JSON.parse(require('node:fs').readFileSync(p, 'utf8')).version;
  } catch {
    return '?';
  }
}

const pdfLibFamily = (pkg) => ({
  async generate(text, ctx = {}) {
    const { PDFDocument, StandardFonts } = await import(pkg);
    const notes = [];

    // useObjectStreams:false keeps the structure readable for the byte scanner
    // instead of hidden inside a compressed object stream.
    const build = async (embed) => {
      const doc = await PDFDocument.create();
      const font = await embed(doc);
      const page = doc.addPage([320, 120]);
      page.drawText(text, { x: 20, y: 60, size: 18, font });
      return await doc.save({ useObjectStreams: false });
    };

    if (!ctx.fontPath) {
      const bytes = await build((doc) => doc.embedFont(StandardFonts.Helvetica));
      return { bytes, notes };
    }

    const fontBytes = await readFile(ctx.fontPath);
    const order = FONTKIT_ORDER[pkg] ?? Object.keys(FONTKITS);

    // Try each fontkit with subsetting; first one that works wins.
    for (const id of order) {
      try {
        const kit = await FONTKITS[id]();
        const bytes = await build(async (doc) => {
          doc.registerFontkit(kit);
          return doc.embedFont(fontBytes, { subset: true });
        });
        return { bytes, notes, fontkit: `${id}@${fontkitVersion(id)}`, subsetting: 'ok' };
      } catch (e) {
        notes.push(`${id}: ${String(e?.message ?? e).slice(0, 70)}`);
      }
    }

    // Nothing could subset. Fall back to a full embed so the text column is
    // still measurable, and say so loudly — the file size will show it.
    const fallbackId = order[0];
    const kit = await FONTKITS[fallbackId]();
    const bytes = await build(async (doc) => {
      doc.registerFontkit(kit);
      return doc.embedFont(fontBytes, { subset: false });
    });
    return {
      bytes,
      notes,
      fontkit: `${fallbackId}@${fontkitVersion(fallbackId)}`,
      subsetting: 'failed — fell back to full embed',
    };
  },

  async capabilities() {
    const { PDFDocument } = await import(pkg);
    const out = { forms: 'no API', encrypt: 'no API', tagged: 'no API' };
    try {
      const doc = await PDFDocument.create();
      doc.addPage();
      const form = doc.getForm();
      form.createTextField('probe').setText('x');
      out.forms = 'yes';
    } catch (e) {
      out.forms = `no: ${String(e?.message ?? e).slice(0, 50)}`;
    }
    return out;
  },
});

export const ADAPTERS = [
  { id: 'pdf-lib', name: 'pdf-lib', pkg: 'pdf-lib', ...pdfLibFamily('pdf-lib') },
  {
    id: 'cantoo',
    name: '@cantoo/pdf-lib',
    pkg: '@cantoo/pdf-lib',
    ...pdfLibFamily('@cantoo/pdf-lib'),
  },
  {
    id: 'pdfkit',
    name: 'pdfkit',
    pkg: 'pdfkit',
    async generate(text, ctx = {}) {
      const { default: PDFDocument } = await import('pdfkit');
      const bytes = await new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: [320, 120], margin: 20 });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        try {
          doc.font(ctx.fontPath ?? 'Helvetica').fontSize(18).text(text, 20, 50);
          doc.end();
        } catch (e) {
          reject(e);
        }
      });
      return { bytes, notes: [] };
    },
    async capabilities() {
      return { forms: 'no API', encrypt: 'no API', tagged: 'no API' };
    },
  },
].map((a) => ({ ...a, version: pkgVersion(a.pkg) }));
