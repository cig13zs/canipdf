# Findings — run of 2026-11-11

Four observations. Two are rock solid and safe to file upstream; two are
measurement-dependent and need a stronger test before anyone writes them as a bug
report. The distinction is the point of this file — a findings list that treats
all four as equally true would be misleading.

Environment: Node v24.21.0 · `pdf-lib` 1.17.1 · `@cantoo/pdf-lib` 2.11.1 ·
`pdfkit` 0.15.2 · referees `pdfjs-dist` 4.10.38 **and** MuPDF 1.28.6 ·
font Arial (Unicode coverage: Latin, Greek, Cyrillic, Arabic, Hebrew, Vietnamese;
**no** CJK, Devanagari or Thai coverage).

---

## SOLID — file these

### S1 — `@cantoo/pdf-lib`: font subsetting crashes with the standard fontkit

**Severity:** high. Hard crash or a 65x file-size regression, depending on the flag.
**Where:** `@cantoo/pdf-lib` 2.11.1 + `@pdf-lib/fontkit` 1.1.1,
`doc.embedFont(bytes, { subset: true })`.

```
TypeError: Cannot read properties of undefined (reading 'pos')
```

With `subset: false` it succeeds and writes **614.9 KB** for a one-page document,
against **9.4 KB** from `pdf-lib` 1.17.1 for the same content. The fork declares no
fontkit dependency of its own, so this pairing is what every migrating user gets.

**Why this one needs no referee:** the exception is thrown before any PDF exists,
and the 65x ratio is a byte count. There is no interpretation involved.

**Question for the maintainer:** is a specific fontkit version required, and should
it be declared as a dependency or a peer?

### S2 — Silent text corruption with the default font

`pdf-lib` throws `WinAnsi cannot encode "م" (0x0645)` — loud, and therefore safe.
`@cantoo/pdf-lib` and `pdfkit` accept the same input and emit a PDF whose text is
destroyed on read-back. Both referees agree the result is lossy.

**Ask:** warn (or throw) when a glyph is not representable in the selected font.
Silent loss should not be the default for text input, and this is the mechanism
behind the whole class of failures below.

### S3 — No tested library can emit an accessible document

None of the three emits `/StructTreeRoot`, `/MarkInfo`, `/Lang`, `/Title` or
`/Alt`, and none exposes a tagging API. `pdfkit` additionally has no AcroForm API.

Read from raw bytes with a regex, so no referee is involved. These are the
machine-checkable prerequisites, not a PDF/UA verdict — but without them
conformance is impossible by construction.

---

## HOLD — do not file these yet

### H1 — Mixed-direction text is reordered by all three libraries

With an embedded font, every library returns mixed Arabic/Latin and Hebrew/Latin
content in a different order from the input. Read-backs look like
`Invoice 42: 03/2026( كب ابحرم)` for input `Invoice 42: مرحبا بك (03/2026)`.

**Why it is held:** the referees themselves disagree. For `pdfkit` +
Hebrew/Latin, `pdfjs-dist` reports reordered and MuPDF reports a clean pass. When
the two readers do not agree on what the document says, the document's ordering
claim is not established.

### H2 — `pdfkit` reorders single-script RTL

`pdfkit` returns Arabic and Hebrew single-script runs reordered while `pdf-lib`
and the fork return them exact. This was the original F1 and it is **weaker than
first written**: see the method limits below.

---

## Method limits — read before citing anything here

**1. A `pass` on right-to-left text does not mean the document looks right.**
Comparing extracted codepoints tests the *content stream*: did the writer keep
logical order in the bytes. It does not test glyph *placement*. A library can
write logical order and place every glyph left-to-right, producing a visually
wrong document that this tool scores as `pass`. Settling visual correctness needs
position-aware comparison (are successive RTL characters decreasing in x?) or a
reference render — neither of which exists here yet. **H2 depends on this gap.**

**2. Yes/no capabilities are not propagation.** Adapters can only use a library's
direct API. A library that requires a plugin or an extension package to tag output
will be scored `no API` even though it can do the job. Treat those cells as "not
out of the box", never as "impossible".

**3. CJK, Devanagari and Thai rows are font-bound, not library-bound.** Arial has
no coverage for those scripts, so every library returns `lossy`. That row measures
the font. Run `--font` with a font that covers the script before drawing any
conclusion about the library.

**4. One page, one line, default size.** Layout-sensitive behaviour — line
breaking, justification, bidi across lines — is outside this harness entirely.

**5. Two referees is not a proof.** They share the same job and similar design
assumptions. Agreement raises confidence; it does not make a verdict absolute.

---

## Next test that would settle H1 and H2

Extract with positions (`pdfjs` `getTextContent()` items carry a transform;
MuPDF structured text carries bounding boxes) and assert that within an RTL run,
increasing logical index yields decreasing x. That turns "the order looks wrong"
into "the glyphs are at the wrong coordinates", which is a claim that can be
filed. Until then, both stay in this file.
