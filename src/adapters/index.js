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

    const fontkit = (await import('@pdf-lib/fontkit')).default;
    const fontBytes = await readFile(ctx.fontPath);
    const register = (doc) => doc.registerFontkit(fontkit);

    try {
      const bytes = await build(async (doc) => {
        register(doc);
        return doc.embedFont(fontBytes, { subset: true });
      });
      return { bytes, notes, subsetting: 'ok' };
    } catch (e) {
      // A real finding, not a harness failure: record it, then retry without
      // subsetting so the text column can still be measured.
      notes.push(`font subsetting failed: ${String(e?.message ?? e).slice(0, 80)}`);
      const bytes = await build(async (doc) => {
        register(doc);
        return doc.embedFont(fontBytes, { subset: false });
      });
      return { bytes, notes, subsetting: 'failed — fell back to full embed' };
    }
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
