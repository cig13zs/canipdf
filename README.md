# canipdf

**Conformance tests for JavaScript PDF libraries.** Does the library actually work, or does it just have a good README?

Every library claims to support Unicode, forms, encryption and accessibility. Almost none of them are tested against each other. `canipdf` renders the same fixtures through each library, reads the output back with an *independent* extractor (`pdfjs-dist`), and compares codepoints. Pixels are not evidence. Codepoints are.

```
npm install canipdf          # or: npx canipdf
npx canipdf --font ./NotoSans.ttf
```

---

## What it found on the first run

Measured 2026-11-11, Node v24.21.0, `pdf-lib` 1.17.1, `@cantoo/pdf-lib` 2.11.1,
`pdfkit` 0.15.2, refereed by `pdfjs-dist` 4.10.38.

### 1. Two of the three libraries corrupt non-Latin text *silently*

With the default font, asked to write Arabic, Hebrew, Devanagari, Thai, CJK, Greek or Cyrillic:

| library | behaviour |
|---|---|
| `pdf-lib` | **throws** — `WinAnsi cannot encode "م" (0x0645)` |
| `@cantoo/pdf-lib` | **does not throw.** Writes a PDF whose text is destroyed on read-back |
| `pdfkit` | **does not throw.** Same silent loss |

A thrown error is a bug you find in five minutes. A PDF that renders as empty boxes in production, on an invoice, is a bug you find from a customer. Only one of these three fails loudly.

### 2. The maintained fork breaks font subsetting — 65x larger files

The reason people move to `@cantoo/pdf-lib` is that it fixed the encoding crash. It did. But embedding a Unicode font with the fontkit the ecosystem installs by default (`@pdf-lib/fontkit` 1.1.1):

| library | subsetting | file size, one page |
|---|---|---|
| `pdf-lib` | ok | **9.4 KB** |
| `@cantoo/pdf-lib` | **fails** — `Cannot read properties of undefined (reading 'pos')`, falls back to full embed | **614.9 KB** |
| `pdfkit` | ok | 9.6 KB |

The fork carries no fontkit of its own, so it inherits whatever the caller has. If the caller has the standard one, subsetting crashes and every generated file carries an entire font.

### 3. `pdfkit` reorders right-to-left text

With a Unicode font, `pdfkit` writes Arabic and Hebrew, and the characters all survive — **in the wrong order**. `pdf-lib` and the fork get basic RTL right; `pdfkit` does not shape or reorder. This is invisible if you only check that text is present.

### 4. None of them can produce an accessible document

Every library was asked for the machine-checkable prerequisites of an accessible PDF. All three, without exception:

| property | pdf-lib | @cantoo/pdf-lib | pdfkit |
|---|---|---|---|
| structure tree (`/StructTreeRoot`) | no | no | no |
| marked content (`/MarkInfo`) | no | no | no |
| document language (`/Lang`) | no | no | no |
| document title (`/Title`) | no | no | no |
| alt text (`/Alt`) | no | no | no |
| tagging API | no API | no API | no API |
| encryption API | no API | no API | no API |
| AcroForm API | yes | yes | no API |

These are not a PDF/UA verdict — a document can carry all of them and still fail, because reading order and correct alt text need a human. They are the cheap triage gate, and **all three libraries fail it at the first hurdle**. Generate a PDF with any of them today and it cannot conform, by construction.

---

## The matrices

Reproduce with `node src/cli.js --font ./your-font.ttf`. Symbols: `pass` exact round-trip · `order` all characters survive but reordered (RTL/bidi) · `partial` ≥50% survive · `lossy` <50% survive · `error` threw.

### Default font

| script | pdf-lib | @cantoo/pdf-lib | pdfkit |
|---|---|---|---|
| Arabic | **error** | lossy | lossy |
| Arabic (mixed) | **error** | lossy | lossy |
| Hebrew | **error** | lossy | lossy |
| Devanagari | **error** | lossy | lossy |
| Thai | **error** | lossy | lossy |
| Han (Simplified) | **error** | lossy | lossy |
| Japanese | **error** | lossy | lossy |
| Korean | **error** | lossy | lossy |
| Greek | **error** | lossy | lossy |
| Cyrillic | **error** | lossy | lossy |
| Vietnamese | **error** | partial | partial |
| Latin (control) | pass | pass | pass |

### Embedded Unicode font (Arial)

| script | pdf-lib | @cantoo/pdf-lib | pdfkit |
|---|---|---|---|
| Arabic | pass | pass | **order** |
| Arabic (mixed) | order | order | order |
| Hebrew | pass | pass | **order** |
| Devanagari | lossy | lossy | lossy |
| Thai | lossy | lossy | lossy |
| Han (Simplified) | lossy | lossy | lossy |
| Japanese | lossy | lossy | lossy |
| Korean | lossy | lossy | lossy |
| Greek | pass | pass | pass |
| Cyrillic | pass | pass | pass |
| Vietnamese | pass | pass | pass |
| Latin (control) | pass | pass | pass |

**Read the CJK and Devanagari rows honestly:** those fall back to `lossy` because Arial has no coverage for them, not because the library refuses. The point of those rows is that the failure is silent and font-dependent — run `--font` with a Noto font covering the script and the answer changes. That distinction is exactly what this tool exists to make visible.

---

## Use it in CI

```bash
npx canipdf --json > canipdf.json
```

Exits after writing `results.json`. Fail your build when a script regresses:

```yaml
- run: npx canipdf --font ./test/fonts/NotoSans-Regular.ttf --json
- run: |
    node -e "const r=require('./results.json');const bad=r.passes.flatMap(p=>p.results.flatMap(x=>Object.entries(x.cases))).filter(([,v])=>v.status==='ERR'||v.status==='LOSSY');if(bad.length){console.error(bad);process.exit(1)}"
```

## Add a library

One adapter, about 30 lines. It may only use the library's public API — no post-processing the bytes, no shimming, no font substitution. If the library cannot do it, that is the finding.

```js
{
  id: 'my-lib',
  name: 'my-lib',
  pkg: 'my-lib',
  version: pkgVersion('my-lib'),
  async generate(text, ctx) {
    // return { bytes: Uint8Array, notes?: string[] }
  },
  async capabilities() {
    return { forms: 'yes' | 'no' | 'no API', encrypt: ..., tagged: ... };
  },
}
```

## Scope and limitations

- **Text round-trip only, so far.** Real rendering has more failure modes than codepoints: shaping, kerning, bidi runs, line breaking. This measures the part that is objective.
- **The referee is `pdfjs-dist`.** A bug in the referee would show up as a library failure. Cross-checking with a second extractor is the obvious next step.
- **One page, one line, default size.** Layout-sensitive behaviour is out of scope for v0.
- **Font coverage and library capability are different things.** Always run both passes before drawing a conclusion.
- **Not a conformance certifier.** This is a triage gate, not a PDF/UA verdict.

## Why this exists

`pdf-lib` is installed **31 million times a week** and its most-reacted open issue (`#1152`, 22 reactions, open since 2022-01-25) is a text-encoding failure. `pdfjs-dist` is installed **55 million times a week**. Together, more than 100 million weekly installs sit on libraries that have never been compared against each other on correctness, while the only real document-conformance validator in existence is a Java binary with no importable API.

That silence is the product. Every case here is a claim someone made in a README, reduced to something an extractor can check.

## Licence

MIT.
