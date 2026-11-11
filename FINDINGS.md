# Findings — run of 2026-11-11

Three observations survived scrutiny. One did not, and the retraction is the most
useful part of this file.

Environment: Node v24.21.0 · `pdf-lib` 1.17.1 · `@cantoo/pdf-lib` 2.11.1 ·
`pdfkit` 0.15.2 · referees `pdfjs-dist` 4.10.38 **and** MuPDF 1.28.6 ·
font Arial (covers Latin, Greek, Cyrillic, Arabic, Hebrew, Vietnamese;
**not** CJK, Devanagari or Thai).

---

## RETRACTED — "the maintained fork breaks font subsetting, 65x larger files"

**What was claimed.** `@cantoo/pdf-lib` 2.11.1 throws
`Cannot read properties of undefined (reading 'pos')` on
`embedFont(bytes, { subset: true })` and falls back to a 614.9 KB file against
`pdf-lib`'s 9.4 KB — a 65x regression.

**What is actually true.** That was **my harness's bug**. The fork expects
fontkit **2.x**; `pdf-lib` projects have `@pdf-lib/fontkit` **1.1.1**, which is
what my adapter passed it. With the correct pairing:

| library + fontkit | subsetting | file size |
|---|---|---|
| `@cantoo/pdf-lib` + `fontkit@2.0.4` | ok | **9.4 KB** |
| `@cantoo/pdf-lib` + `@pdf-lib/fontkit@1.1.1` | throws | — |
| `pdf-lib` + `@pdf-lib/fontkit@1.1.1` | ok | 9.4 KB |

There is no regression. The fork is fine.

**How close this came to being filed.** I had the issue text written. What stopped
it was a duplicate check before posting: `cantoo-scribe/pdf-lib#144` (closed)
already states that the CJK subsetting bugs are *fixed in fontkit 1.8/1.9*, and
`#151` documents the fontkit 2 ESM/default-export change. The maintainers had
answered this months ago. Filing it would have been a false accusation against a
maintained project, in public, under someone else's name.

**What changed in the harness.** It now tries every installed fontkit per library,
uses the first that works, and **records which one each library needed** in the
matrix (`fontkit used` row). A dependency mismatch can no longer masquerade as a
library defect. The declared fontkit version is part of the result, not an
assumption.

**What survives as a real, modest finding.** Migrating `pdf-lib` → `@cantoo/pdf-lib`
and carrying over the `@pdf-lib/fontkit` import produces a crash with no
diagnostic. That is a *documentation gap* worth a docs PR, not a bug report.

---

## SOLID — safe to file

### S1 — Two libraries corrupt non-Latin text silently

Default font, asked for Arabic, Hebrew, Devanagari, Thai, CJK, Greek or Cyrillic:

| library | behaviour |
|---|---|
| `pdf-lib` | **throws** `WinAnsi cannot encode "م" (0x0645)` |
| `@cantoo/pdf-lib` | **does not throw** — writes a PDF whose text is destroyed on read-back |
| `pdfkit` | **does not throw** — same silent loss |

Both referees independently agree the result is lossy. The safety inversion is the
finding: the library everyone forked *away* from is the only one that fails loudly.

**Ask:** warn or throw when a glyph is not representable in the selected font.

### S2 — No tested library can emit an accessible document

None emits `/StructTreeRoot`, `/MarkInfo`, `/Lang`, `/Title` or `/Alt`, and none
exposes a tagging API. `pdfkit` also has no AcroForm API.

Read from raw bytes with a regex — no referee involved, so no interpretation. These
are the machine-checkable prerequisites, not a PDF/UA verdict: without them
conformance is impossible by construction.

**Caveat that must travel with this claim:** these are *direct API* probes. A
library that needs a plugin to tag output is scored `no API`, which means "not out
of the box", never "impossible". Check for an extension package before filing.

---

## HOLD — do not file

### H1 — Mixed-direction text comes back reordered

With an embedded font, mixed Arabic/Latin and Hebrew/Latin content returns in a
different order than it went in, across all three libraries.

**Why it is held:** the referees disagree. For `pdfkit` + Hebrew/Latin,
`pdfjs-dist` reports reordered and MuPDF reports a clean pass — that cell is
reported as `disputed` rather than averaged. When two readers disagree about what
a document says, an ordering claim is not established.

### H2 — Visual RTL correctness is untested, by design

A `pass` on right-to-left text proves the *content stream* kept logical order. It
does not prove the glyphs were placed right-to-left. A library can score `pass`
here and still render a reversed document. Any RTL claim beyond "the bytes contain
the right codepoints in the right sequence" needs position-aware extraction.

---

## The test that would settle H1 and H2

`pdfjs.getTextContent()` items carry a transform; MuPDF structured text carries
bounding boxes. Assert that inside an RTL run, increasing logical index yields
decreasing x. That converts "the order looks wrong" into "the glyphs are at the
wrong coordinates" — a claim that can be filed. Until then, both stay here.
