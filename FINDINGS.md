# Findings — run of 2026-11-11

Three observations survived scrutiny. One did not, and the retraction is the most
useful part of this file.

**Read this first:** a duplicate check afterwards showed that most of what looked
like discoveries are already-known, open issues (see *Prior art* at the bottom).
That does not make them false — the harness independently reproduces them — but it
does mean **this repository's value is the matrix and the harness, not the bug
reports.** Nothing here was filed upstream, because filing duplicates is noise.

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

**What survives as a real, modest finding.** Not a bug and not a docs gap I can
fix: the fork's README *already* documents `@cantoo/fontkit` (a fontkit 2.x fork
with a default export) and states that upstream packages remain supported "for
compatibility". So the trap is a two-hours-later surprise, not missing
documentation — and a docs PR would have been redundant, and less precise than what
is already there. A second near-miss avoided by reading the target first.

**What changed in the harness.** It now asks each library for the fontkit its own
README documents, falls back through the others, and records the resolved package
in the `fontkit used` row:

| library | documented fontkit | resolved | result |
|---|---|---|---|
| `pdf-lib` | `@pdf-lib/fontkit` | `@pdf-lib/fontkit@1.1.1` | subsets, 9.4 KB |
| `@cantoo/pdf-lib` | `@cantoo/fontkit` | `@cantoo/fontkit@2.0.12` | subsets, 9.4 KB |

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

### S2 — One of four can tag; three cannot (corrected)

**Superseded claim:** "No tested library can emit an accessible document." That was
produced by a capability probe that asserted `'no API'` from a hardcoded list
instead of attempting anything. It was wrong.

Measured by attempting the documented call and scanning the produced bytes:

| | pdf-lib | @cantoo/pdf-lib | pdfkit | jspdf |
|---|---|---|---|---|
| tagging | no API | no API | **yes** (`{ tagged: true }` → `/StructTreeRoot`, `/MarkInfo`, `/Lang`) | no API |
| encryption | no API | no API | **yes** → `/Encrypt` | **yes** → `/Encrypt` |
| AcroForm | yes | yes | yes (needs `initForm()` first) | inconclusive |

The corrected claim is narrower and more interesting: **the only library of the four
with tagging machinery ships it off by default**, and the two `pdf-lib` variants
have no path to it at all.

Two false results were produced on the way to this table, both by the harness rather
than the libraries: `pdf-lib` was briefly scored as encryption-capable because it
exports `EncryptedPDFError` and `isEncrypted` (reader-side helpers), and `pdfkit` was
briefly scored as form-less because the attempt omitted the required `initForm()`
call. Both are now pinned by tests in `test/capabilities.test.js`.

What remains solid: no library sets a document title or alt text without being given
the content, and none of these checks substitutes for a PDF/UA verdict.

---

## HOLD — do not file

### Resolved by measurement — glyph placement

An earlier version of this file said visual RTL correctness was untestable here.
It now is: MuPDF's structured-text walker reports a per-character origin, so
`glyphPlacement()` checks whether successive RTL glyphs move right-to-left.

Result with an embedded font: **all four libraries place RTL glyphs correctly**
(`rtl` on every RTL row, decreasing x for every consecutive pair). The visual
rendering was never the problem — an earlier claim that implied otherwise is
withdrawn.

What the two axes show together:

| axis | pdf-lib | @cantoo/pdf-lib | pdfkit |
|---|---|---|---|
| glyph placement (looks right) | rtl | rtl | rtl |
| extraction order (copy-paste, search, ingest) | pass | pass | **order** |

So `pdfkit` produces a document that *looks* correct and *reads back* scrambled.
That is worse than either failure alone, because the preview is fine.

Still not measured: correct bidi **layout** of mixed-direction runs. Placement is
verified for single-script runs only.

### H1 — Mixed-direction text returns reordered, in every library tested

**Why it is held:** the referees disagree. For `pdfkit` + Hebrew/Latin,
`pdfjs-dist` reports reordered and MuPDF reports a clean pass — reported as
`disputed` rather than averaged. Ordering of mixed runs is genuinely contested
even between extractors, so it is not a claim worth filing.

---

## The test that would settle H1 and H2

`pdfjs.getTextContent()` items carry a transform; MuPDF structured text carries
bounding boxes. Assert that inside an RTL run, increasing logical index yields
decreasing x. That converts "the order looks wrong" into "the glyphs are at the
wrong coordinates" — a claim that can be filed. Until then, both stay here.

---

## Prior art — why none of this was filed

Checked against the trackers on 2026-11-11:

| my label | existing issue | state | relation |
|---|---|---|---|
| S1 (pdfkit silent loss) | [foliojs/pdfkit#1251](https://github.com/foliojs/pdfkit/issues/1251) — "non-Latin characters, non-BMP characters, symbols missing" | open since 2021-07-18 | **duplicate** |
| H2 (pdfkit RTL) | [foliojs/pdfkit#219](https://github.com/foliojs/pdfkit/issues/219) — "Right-to-Left (RTL) support for Hebrew and Arabic" | open | **duplicate** |
| H2 (pdfkit shaping) | [foliojs/pdfkit#951](https://github.com/foliojs/pdfkit/issues/951) — ZWJ for cursive scripts | open since 2019 | **duplicate** |
| retraction (fontkit pairing) | [cantoo-scribe/pdf-lib#144](https://github.com/cantoo-scribe/pdf-lib/issues/144), [#151](https://github.com/cantoo-scribe/pdf-lib/issues/151) | closed | **already answered** |
| S2 (no tagging API) | no equivalent found | — | the only one without prior art, and the least actionable: "support PDF/UA" is a roadmap request, not a bug report |

**The lesson, which cost me a near-miss false accusation:** search the target
tracker *before* writing the report, not after. The fork's subsetting "bug" had
been answered in a closed issue five weeks earlier, and pdfkit's Unicode gap has
been open for five years — both would have been noise at best and embarrassing at
worst.

What is genuinely not covered by prior art is the **cross-library matrix** itself:
no one publishes "here is what each of these three actually does, on the same
fixtures, with the same fonts, verified by two independent extractors." That is
the contribution, and it is a table, not a bug.

