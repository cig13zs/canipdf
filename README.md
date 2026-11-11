# canipdf

**Conformance tests for JavaScript PDF libraries.** Does the library actually work, or does it just have a good README?

Every library claims to support Unicode, forms and accessibility. Almost none are tested against each other. `canipdf` renders the same fixtures through each library, reads the output back with **two independent extractors**, and reports two separate axes: whether the text survives a round trip, and where the glyphs were physically placed. Pixels are not evidence. Codepoints and coordinates are.

```
npx canipdf                                  # human summary + matrix
npx canipdf --font ./NotoSans.ttf            # second pass with a real Unicode font
npx canipdf --fail-on LOSSY,ERR              # exit 1 if anything regresses
```

Latest results are committed: [`docs/results-2026-11-11.md`](docs/results-2026-11-11.md) · [`.json`](docs/results-2026-11-11.json)

---

## What this measures — and what it does not

Read this before citing anything below.

**It measures** two things about the bytes a library wrote: whether the text
survives a round trip through independent extractors (what copy-paste, search and
text ingestion will see), and where the glyphs were physically placed (what the
page looks like).

**It does not measure** correct bidi *layout* of mixed-direction runs, line
breaking, or visual fidelity in general. A `pass` means the content stream and
glyph origins are right — not that the document is beautiful.

---

## The findings

Full detail, including one retraction, in [FINDINGS.md](FINDINGS.md).

### Solid: two libraries corrupt non-Latin text *silently*

Default font, asked for Arabic, Hebrew, Devanagari, Thai, CJK, Greek or Cyrillic:

| library | behaviour |
|---|---|
| `pdf-lib` | **throws** — `WinAnsi cannot encode "م" (0x0645)` |
| `@cantoo/pdf-lib` | **does not throw.** Writes a PDF whose text is destroyed on read-back |
| `pdfkit` | **does not throw.** Same silent loss |

Both referees independently agree the output is lossy. The safety inversion is the
finding: the library everyone forked *away* from is the only one that fails loudly.
A thrown error is a bug you find in five minutes; a PDF that prints as empty boxes
on an invoice is a bug you find from a customer.

### Only one of four can emit a tagged document — and not the one you'd guess

Capabilities below are **measured by attempting the documented call and looking for
the marker in the produced bytes**, not by reading API names. That distinction has
already changed the answer twice: `pdf-lib` exports `EncryptedPDFError` and
`isEncrypted` (a *reader's* helpers) which a name scan reports as encryption
support, and `pdfkit` genuinely can tag — which an earlier version of this README
denied outright.

| property | pdf-lib | @cantoo/pdf-lib | pdfkit | jspdf |
|---|---|---|---|---|
| structure tree (`/StructTreeRoot`) | no | no | no | no |
| marked content (`/MarkInfo`) | no | no | no | no |
| document language (`/Lang`) | no | no | no | no |
| document title (`/Title`) | no | no | no | no |
| alt text (`/Alt`) | no | no | no | no |
| **tagging API** | no API | no API | **yes** | no API |
| **encryption API** | no API | no API | **yes** | **yes** |
| AcroForm API | yes | yes | yes | inconclusive |
| embedded font | yes | yes | yes | yes |
| fontkit used | `@pdf-lib/fontkit@1.1.1` | `@cantoo/fontkit@2.0.12` | n/a | n/a |
| file size (1 page) | 9.4 KB | 9.4 KB | 9.6 KB | — |

The structure columns read `no` because they describe a *default* one-page document
with one line of text. `pdfkit` can turn tagging on: `new PDFDocument({ tagged: true })`
produces `/StructTreeRoot` and `/MarkInfo`, and adding `lang` produces `/Lang`.
None of that is on by default, none of it is reachable through `pdf-lib` or `jsPDF`
in this test, and no library sets a title or alt text without being given the content.

So the honest claim is narrower and more useful than "they can't": **one of the four
has the machinery and ships it off.** The other three would need features they do
not have.

Not a PDF/UA verdict — a document can carry all of these and still fail, because
reading order and correct alt text need a human. This is the triage gate.
`inconclusive` means the API exists but the attempt produced no marker, which is a
limit of this harness, not a verdict on the library.

### Retracted: "the fork breaks font subsetting"

An earlier run of this harness reported that `@cantoo/pdf-lib` throws on
`subset: true` and produces 614.9 KB against `pdf-lib`'s 9.4 KB — a 65x regression.

**That was my bug, not theirs.** The fork expects fontkit **2.x**; `pdf-lib`
projects carry `@pdf-lib/fontkit` **1.1.1**, which is what my adapter handed it.
Paired correctly, the fork subsets fine at 9.4 KB. It was caught by a duplicate
check before filing: `cantoo-scribe/pdf-lib#144` and `#151` already document both
the fontkit version requirement and the 2.x default-export change.

The harness now asks each library for the fontkit **its own README documents**
(`pdf-lib` → `@pdf-lib/fontkit`, `@cantoo/pdf-lib` → `@cantoo/fontkit`, a fontkit
2.x fork), falls back through the others, and **records which one each library
actually needed** in the `fontkit used` row — so a dependency mismatch can no
longer be misreported as a library defect. Paired correctly, both produce 9.4 KB.

What survives is a modest migration note, not a bug: the fork's README documents
`@cantoo/fontkit` and keeps upstream packages "for compatibility", so carrying a
`@pdf-lib/fontkit` import across works — until a path that needs newer fontkit
behaviour is hit, where it fails without a useful diagnostic.

### Measured, not assumed: RTL looks right, but `pdfkit` documents *extract* wrong

This harness reports two independent axes, because they fail differently:

- **extraction order** — the round trip above. This is what copy-paste, search,
  text indexing and LLM ingestion actually see.
- **glyph placement** — read from MuPDF's per-character origins. This is whether
  the document *looks* right.

With an embedded font the results separate cleanly:

| right-to-left script | pdf-lib | @cantoo/pdf-lib | pdfkit |
|---|---|---|---|
| Arabic | rtl | rtl | rtl |
| Bidi: Arabic + Latin | rtl | rtl | rtl |
| Hebrew | rtl | rtl | rtl |

**All three place RTL glyphs correctly.** The visual rendering is not the problem,
and an earlier draft of this README that implied otherwise was wrong. The problem
is the other axis: `pdfkit` writes Arabic and Hebrew such that extraction returns
the characters reordered, while `pdf-lib` and the fork return them exact. So text
copied out of a `pdfkit` document — or indexed by a search engine, or fed to a
model — comes back scrambled, while the printed page looks perfect.

Mixed-direction content (Arabic or Hebrew embedded in Latin) extracts reordered in
all three, and one cell is reported as `disputed` because the two referees disagree.
That is held, not filed.

Corroboration that the placement axis works: in the **default-font** pass,
`@cantoo/pdf-lib` and `pdfkit` score `none` for placement — the RTL glyphs are not
in the output at all. Silent loss, measured from the other direction.

---

### Prior art — these are known issues, measured rather than discovered

A duplicate check against the trackers matters more than a findings list:

- `pdfkit` silent Unicode loss is [foliojs/pdfkit#1251](https://github.com/foliojs/pdfkit/issues/1251), open since 2021.
- `pdfkit` RTL is [foliojs/pdfkit#219](https://github.com/foliojs/pdfkit/issues/219), open, and shaping is [#951](https://github.com/foliojs/pdfkit/issues/951).
- The fontkit pairing trap is [cantoo-scribe/pdf-lib#144](https://github.com/cantoo-scribe/pdf-lib/issues/144) and [#151](https://github.com/cantoo-scribe/pdf-lib/issues/151), closed.

Nothing here was filed upstream, because filing duplicates is noise. **What no one
publishes is the matrix**: the same fixtures, the same fonts, three libraries, two
independent extractors. That is the contribution, and it is a table.

## The matrices

Reproduce with `node src/cli.js --font ./your-font.ttf`. `pass` exact · `order` all
characters survived but reordered · `partial` ≥50% survived · `lossy` <50% ·
`error` threw · `disputed` the two referees disagreed.

### Default font

| script | pdf-lib | @cantoo/pdf-lib | pdfkit | jspdf |
|---|---|---|---|---|
| Arabic | **error** | lossy | lossy | lossy |
| Arabic (mixed) | **error** | lossy | lossy | lossy |
| Bidi: Arabic + Latin | **error** | partial | partial | partial |
| Bidi: Hebrew + Latin | **error** | partial | partial | partial |
| Hebrew | **error** | lossy | lossy | lossy |
| Devanagari | **error** | lossy | lossy | lossy |
| Thai | **error** | lossy | lossy | lossy |
| Han (Simplified) | **error** | lossy | lossy | lossy |
| Japanese | **error** | lossy | lossy | lossy |
| Korean | **error** | lossy | lossy | lossy |
| Greek | **error** | lossy | lossy | lossy |
| Cyrillic | **error** | lossy | lossy | lossy |
| Vietnamese | **error** | partial | partial | partial |
| Latin (control) | pass | pass | pass | pass |

### Embedded Unicode font (Arial)

| script | pdf-lib | @cantoo/pdf-lib | pdfkit | jspdf |
|---|---|---|---|---|
| Arabic | pass | pass | order | **disputed** |
| Arabic (mixed) | order | order | order | **disputed** |
| Bidi: Arabic + Latin | order | order | order | **disputed** |
| Bidi: Hebrew + Latin | order | order | **disputed** | order |
| Hebrew | pass | pass | order | order |
| Devanagari | lossy | lossy | lossy | FAIL |
| Thai | lossy | lossy | lossy | FAIL |
| Han (Simplified) | lossy | lossy | lossy | FAIL |
| Japanese | lossy | lossy | lossy | FAIL |
| Korean | lossy | lossy | lossy | FAIL |
| Greek | pass | pass | pass | pass |
| Cyrillic | pass | pass | pass | pass |
| Vietnamese | pass | pass | pass | pass |
| Latin (control) | pass | pass | pass | pass |

### Glyph placement (a separate axis)

| right-to-left script | pdf-lib | @cantoo/pdf-lib | pdfkit | jspdf |
|---|---|---|---|---|
| Arabic | rtl | rtl | rtl | rtl |
| Bidi: Arabic + Latin | rtl | rtl | rtl | rtl |
| Hebrew | rtl | rtl | rtl | rtl |

`jsPDF` is the outlier worth noting: with a custom TTF it produces output the two
referees disagree about for RTL, and for CJK/Devanagari/Thai nothing extractable
comes back at all (`FAIL`, not `lossy`). It is the newest adapter and the least
verified of the four.

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

- **Two axes, not one.** Extraction order (what copy-paste and search see) is
  measured by round trip; glyph placement (what the page looks like) by MuPDF
  character origins. Placement is checked for single-script runs only — correct
  bidi *layout* of mixed runs remains unmeasured.
- **Two referees are not a proof.** They share similar design assumptions; agreement raises confidence rather than establishing fact. Disagreements are surfaced as `disputed`, never averaged.
- **Yes/no capabilities are not propagation.** A library that needs a plugin to tag output is scored `no API` — read that as "not out of the box".
- **One page, one line, default size.** Layout-sensitive behaviour is out of scope.
- **Not a conformance certifier.** A triage gate, not a PDF/UA verdict.
- **Four libraries so far:** `pdf-lib`, `@cantoo/pdf-lib`, `pdfkit`, `jspdf`. Others worth adding: `pdfmake`, `@pdfme/generator`, `@react-pdf/renderer`.
- **Capabilities are attempts, not guarantees.** A `yes` means the documented call produced the marker; a `no API` means the option was accepted and ignored, or the call threw. `inconclusive` means the API exists but this harness could not make it work — a limit of the harness, not the library.

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
