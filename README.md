# canipdf

**Conformance tests for JavaScript PDF libraries.** Does the library actually work, or does it just have a good README?

Every library claims to support Unicode, forms and accessibility. Almost none are tested against each other. `canipdf` renders the same fixtures through each library, reads the output back with **two independent extractors**, and compares codepoints. Pixels are not evidence. Codepoints are.

```
npx canipdf                                  # human summary + matrix
npx canipdf --font ./NotoSans.ttf            # second pass with a real Unicode font
npx canipdf --fail-on LOSSY,ERR              # exit 1 if anything regresses
```

Latest results are committed: [`docs/results-2026-11-11.md`](docs/results-2026-11-11.md) · [`.json`](docs/results-2026-11-11.json)

---

## What this measures — and what it does not

Read this before citing anything below.

**It measures** whether the bytes a library wrote survive a round trip: render a
string, read it back with engines from a different codebase, compare codepoints.

**It does not measure whether the document looks right.** A library can write
logical order into the content stream and still place every glyph left-to-right,
producing a visually broken document that this tool scores as `pass`. Settling
that needs position-aware comparison, which does not exist here yet. Every
right-to-left claim below is marked accordingly.

---

## The findings

Two are solid enough to file upstream. Two are held back, and the difference is
deliberate — see [FINDINGS.md](FINDINGS.md).

### Solid: the maintained fork breaks font subsetting — 65x larger files

`@cantoo/pdf-lib` exists because `pdf-lib` crashes on non-Latin text. It fixed the
crash. But embedding a Unicode font with the fontkit the ecosystem installs by
default (`@pdf-lib/fontkit` 1.1.1):

| library | `subset: true` | file size, one page |
|---|---|---|
| `pdf-lib` | ok | **9.4 KB** |
| `@cantoo/pdf-lib` | **throws** `Cannot read properties of undefined (reading 'pos')`, falls back to full embed | **614.9 KB** |
| `pdfkit` | ok | 9.6 KB |

The fork declares no fontkit of its own, so it inherits the caller's. If the
caller has the standard one, subsetting dies and every document carries an entire
font. This needs no referee: it throws before a PDF exists, and the rest is a byte
count.

### Solid: two libraries corrupt non-Latin text *silently*

Default font, asked for Arabic, Hebrew, Devanagari, Thai, CJK, Greek or Cyrillic:

| library | behaviour |
|---|---|
| `pdf-lib` | **throws** — `WinAnsi cannot encode "م" (0x0645)` |
| `@cantoo/pdf-lib` | **does not throw.** Writes a PDF whose text is destroyed on read-back |
| `pdfkit` | **does not throw.** Same silent loss |

A thrown error is a bug you find in five minutes. A PDF that prints as empty boxes
on an invoice is a bug you find from a customer. Only one of these three fails
loudly, and it is the one everyone forked away from.

### Solid: none of them can produce an accessible document

Zero of three emit a structure tree, marked content, document language, title or
alt text, and none exposes a tagging API. Read from raw bytes, no referee involved.

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

Not a PDF/UA verdict — a document can carry all of these and still fail. These are
the triage gate, and generate a PDF with any of these three today and it cannot
conform, by construction.

### Held: mixed-direction text is reordered, by all three

With an embedded font, mixed Arabic/Latin and Hebrew/Latin content comes back in a
different order from the input — `Invoice 42: 03/2026( كب ابحرم)` for
`Invoice 42: مرحبا بك (03/2026)`.

**Why it is not filed:** the referees disagree. On `pdfkit` + Hebrew/Latin,
`pdfjs-dist` says reordered and MuPDF says clean pass — the cell below is reported
as `disputed`. When two readers disagree about what the document says, the ordering
claim is not established, and it stays out of the issue tracker.

---

## The matrices

Reproduce with `node src/cli.js --font ./your-font.ttf`. `pass` exact · `order` all
characters survived but reordered · `partial` ≥50% survived · `lossy` <50% ·
`error` threw · `disputed` the two referees disagreed.

### Default font

| script | pdf-lib | @cantoo/pdf-lib | pdfkit |
|---|---|---|---|
| Arabic | **error** | lossy | lossy |
| Arabic (mixed) | **error** | lossy | lossy |
| Bidi: Arabic + Latin | **error** | partial | partial |
| Bidi: Hebrew + Latin | **error** | partial | partial |
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
| Bidi: Arabic + Latin | order | order | order |
| Bidi: Hebrew + Latin | order | order | **disputed** |
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

**The CJK, Devanagari and Thai rows are about the font, not the library.** Arial
has no coverage for those scripts, so everything is `lossy`. Run `--font` with a
font that covers the script and the answer changes. That distinction is exactly
what this tool exists to make visible — and conflating the two is the most common
way PDF capability claims go wrong.

---

## Gate your CI

```yaml
- run: npx canipdf --font ./test/fonts/NotoSans-Regular.ttf --fail-on LOSSY,ERR
```

Exit codes: `0` clean · `1` a `--fail-on` status was matched · `2` nothing was
measurable, which fails loudly rather than painting a green bar over an empty
matrix.

---

## Add a library

One adapter, about 30 lines. It may only use the library's public API — no
post-processing bytes, no font substitution tricks. If the library cannot do it,
that is the finding.

```js
{
  id: 'my-lib',
  name: 'my-lib',
  pkg: 'my-lib',
  version: pkgVersion('my-lib'),
  async generate(text, ctx) {
    // ctx.fontPath is null for the default pass.
    // return { bytes: Uint8Array, notes?: string[] }
  },
  async capabilities() {
    // 'yes' | 'no' | 'no API' — direct API only; plugins do not count.
    return { forms: 'no API', encrypt: 'no API', tagged: 'no API' };
  },
}
```

---

## Limits

- **Content-stream order only.** Visual correctness is untested (see the top of this file).
- **Two referees are not a proof.** They share similar design assumptions; agreement raises confidence rather than establishing fact. Disagreements are surfaced as `disputed`, never averaged.
- **Yes/no capabilities are not propagation.** A library that needs a plugin to tag output is scored `no API` — read that as "not out of the box".
- **One page, one line, default size.** Layout-sensitive behaviour is out of scope.
- **Not a conformance certifier.** A triage gate, not a PDF/UA verdict.
- **Three libraries so far.** `pdfmake`, `@pdfme/generator` and `@react-pdf/renderer` are the obvious next adapters.

## Why this exists

`pdf-lib` is installed **31 million times a week** and its most-reacted open issue
(`#1152`, 22 reactions, open since 2022-01-25) is a text-encoding failure.
`pdfjs-dist` is installed **55 million times a week**. Over 100 million weekly
installs sit on libraries that have never been compared against each other on
correctness, while the only real document-conformance validator in existence is a
Java binary with no importable API.

That silence is the product. Every case here is a claim someone made in a README,
reduced to something two extractors can check.

## Licence

MIT.
