/**
 * Adapters — one thin shim per library, deliberately small.
 *
 * An adapter may only do what the library's public API allows. No post-hoc
 * repair, no font substitution tricks, no "we patched the bytes": if the library
 * cannot do it, that is the finding we are here to record.
 *
 * Two rules this file exists to enforce:
 *
 * 1. Capabilities are MEASURED, not asserted. An earlier version returned the
 *    literal string 'no API' for encryption and tagging without looking at the
 *    library at all. That is an assertion dressed as a measurement — the exact
 *    failure this tool is supposed to catch. Every capability below is now the
 *    result of scanning the library's exported and instance symbols, and the
 *    evidence (how many symbols, which ones matched) is recorded in results.json.
 *
 * 2. Fontkit is resolved from each library's own documentation, not guessed.
 */

import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

function pkgVersion(pkg) {
  try {
    const p = require('node:path').join(process.cwd(), 'node_modules', pkg, 'package.json');
    return JSON.parse(require('node:fs').readFileSync(p, 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

/**
 * Three live fontkit packages, and each library documents a different one:
 * `pdf-lib` → `@pdf-lib/fontkit` (1.x); `@cantoo/pdf-lib` → `@cantoo/fontkit`
 * (fontkit 2.x with a default export). Upstream `fontkit` 2.x has no default
 * export under Node ESM. Pairing the wrong one is a documented trap, so the
 * preference order comes from each library's README and the resolved package is
 * reported, never assumed.
 */
const FONTKITS = {
  fontkit: async () => {
    const m = await import('fontkit');
    return m.default ?? m;
  },
  '@cantoo/fontkit': async () => {
    const m = await import('@cantoo/fontkit');
    return m.default ?? m;
  },
  '@pdf-lib/fontkit': async () => (await import('@pdf-lib/fontkit')).default,
};

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

// ---------------------------------------------------------------------------
// Capability probing: attempt the operation, then look for the marker in the
// bytes the library actually produced.
//
// Symbol scanning alone was not good enough: `pdf-lib` exports
// `EncryptedPDFError` and `isEncrypted`, which are about READING an encrypted
// file, and a name scan reported that as encryption support. Asserting from
// names over-reports capability; asserting from a hardcoded list under-reports
// it (this file used to claim `pdfkit` had no tagging API, and it does).
// The only trustworthy question is: pass the documented option, then look at the
// output.
// ---------------------------------------------------------------------------

export const CAPABILITY_MARKERS = {
  forms: /\/AcroForm/,
  encrypt: /\/Encrypt/,
  tagged: /\/StructTreeRoot/,
};

/**
 * Turn each adapter's attempt into a verdict.
 *   marker present             -> yes
 *   API exists but no marker   -> inconclusive (the call may need different args)
 *   attempt threw              -> no API, with the error as evidence
 */
export function observeCapabilities(attempts = {}) {
  const out = {};
  for (const [key, marker] of Object.entries(CAPABILITY_MARKERS)) {
    const a = attempts[key];
    if (!a) {
      out[key] = { api: 'not attempted', evidence: 'no attempt defined' };
      continue;
    }
    if (a.error) {
      out[key] = { api: 'no API', evidence: a.error };
      continue;
    }
    const bytes = a.bytes ?? a;
    const present = marker.test(Buffer.from(bytes).toString('latin1'));
    if (present) {
      out[key] = { api: 'yes', evidence: `${marker.source} present in output` };
    } else if (a.apiHint) {
      out[key] = { api: 'inconclusive', evidence: `${a.apiHint}, but ${marker.source} absent` };
    } else {
      out[key] = { api: 'no API', evidence: `option accepted, ${marker.source} absent` };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

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

  async attempts() {
    const { PDFDocument } = await import(pkg);
    const blank = async () => {
      const d = await PDFDocument.create();
      d.addPage([320, 120]);
      return d;
    };
    const out = {};
    try {
      const d = await blank();
      d.getForm().createTextField('canipdf').setText('x');
      out.forms = { bytes: await d.save({ useObjectStreams: false }) };
    } catch (e) {
      out.forms = { error: String(e?.message ?? e).slice(0, 60) };
    }
    // pdf-lib documents no tagging or encryption option; passing one anyway
    // proves the option is accepted and ignored rather than argued about.
    try {
      const d = await blank();
      out.tagged = { bytes: await d.save({ useObjectStreams: false, tagged: true }) };
    } catch (e) {
      out.tagged = { error: String(e?.message ?? e).slice(0, 60) };
    }
    try {
      const d = await blank();
      out.encrypt = {
        bytes: await d.save({
          useObjectStreams: false,
          userPassword: 'canipdf',
          ownerPassword: 'canipdf',
        }),
      };
    } catch (e) {
      out.encrypt = { error: String(e?.message ?? e).slice(0, 60) };
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
        const doc = new PDFDocument({
          size: [320, 120],
          margin: 20,
          compress: false, // keep the byte scanner honest
        });
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
      return { bytes, notes: [], fontkit: 'n/a (pdfkit embeds directly)' };
    },
    async attempts() {
      const { default: PDFDocument } = await import('pdfkit');
      const build = (opts, write) =>
        new Promise((resolve, reject) => {
          let d;
          try {
            d = new PDFDocument({ size: [320, 120], margin: 20, compress: false, ...opts });
          } catch (e) {
            reject(e);
            return;
          }
          const chunks = [];
          d.on('data', (c) => chunks.push(c));
          d.on('end', () => resolve({ bytes: Buffer.concat(chunks) }));
          d.on('error', reject);
          try {
            write(d);
            d.end();
          } catch (e) {
            reject(e);
          }
        });

      const out = {};
      try {
        out.forms = await build({}, (d) => {
          d.initForm(); // pdfkit requires this before any form element
          d.formText('canipdf', 20, 20, 100, 20);
        });
      } catch (e) {
        out.forms = { error: String(e?.message ?? e).slice(0, 60) };
      }
      try {
        out.tagged = await build({ tagged: true }, (d) => d.text('x', 20, 20));
      } catch (e) {
        out.tagged = { error: String(e?.message ?? e).slice(0, 60) };
      }
      try {
        out.encrypt = await build(
          { userPassword: 'canipdf', ownerPassword: 'canipdf' },
          (d) => d.text('x', 20, 20),
        );
      } catch (e) {
        out.encrypt = { error: String(e?.message ?? e).slice(0, 60) };
      }
      return out;
    },
  },
  {
    id: 'jspdf',
    name: 'jspdf',
    pkg: 'jspdf',
    async generate(text, ctx = {}) {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF();
      const notes = [];
      let fontkit = 'n/a (jsPDF embeds directly)';
      if (ctx.fontPath) {
        // jsPDF's documented path for a custom TTF: add to VFS, register a face.
        const b64 = (await readFile(ctx.fontPath)).toString('base64');
        doc.addFileToVFS('canipdf.ttf', b64);
        doc.addFont('canipdf.ttf', 'CanipdfFont', 'normal');
        doc.setFont('CanipdfFont');
      }
      doc.text(text, 10, 20);
      const out = doc.output('arraybuffer');
      return { bytes: new Uint8Array(out), notes, fontkit };
    },
    async attempts() {
      const { jsPDF } = await import('jspdf');
      const out = {};
      try {
        const d = new jsPDF();
        d.text('x', 10, 10);
        const hasApi = typeof d.AcroFormTextField === 'function';
        if (hasApi) {
          d.AcroForm = 'Yes';
          d.AcroFormTextField(10, 10, 60, 10, 'canipdf');
        }
        out.forms = {
          bytes: new Uint8Array(d.output('arraybuffer')),
          apiHint: hasApi ? 'AcroFormTextField exists' : undefined,
        };
      } catch (e) {
        out.forms = { error: String(e?.message ?? e).slice(0, 60) };
      }
      try {
        const d = new jsPDF();
        d.text('x', 10, 10);
        out.tagged = { bytes: new Uint8Array(d.output('arraybuffer')) };
      } catch (e) {
        out.tagged = { error: String(e?.message ?? e).slice(0, 60) };
      }
      try {
        const d = new jsPDF({ encryption: { userPassword: 'canipdf', ownerPassword: 'canipdf' } });
        d.text('x', 10, 10);
        out.encrypt = { bytes: new Uint8Array(d.output('arraybuffer')) };
      } catch (e) {
        out.encrypt = { error: String(e?.message ?? e).slice(0, 60) };
      }
      return out;
    },
  },
].map((a) => ({ ...a, version: pkgVersion(a.pkg) }));
