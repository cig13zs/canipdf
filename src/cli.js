#!/usr/bin/env node
/**
 * canipdf — conformance tests for JavaScript PDF libraries.
 *
 * Runs the same fixtures through every registered library, reads the output back
 * with an independent extractor, and reports what actually survived. The result
 * is a matrix, not an opinion.
 *
 *   node src/cli.js                      human summary + markdown tables
 *   node src/cli.js --md                 markdown only (for CI and the README)
 *   node src/cli.js --json               machine-readable results
 *   node src/cli.js --font ./font.ttf    also run with a real Unicode font
 */

import { writeFileSync } from 'node:fs';
import { TEXT_CASES, STRUCTURE_MARKERS, STRUCTURE_LABELS } from './cases/index.js';
import { extractAll, adjudicate, glyphPlacement, hasRtl, REFEREES } from './extract.js';
import { ADAPTERS } from './adapters/index.js';

const args = process.argv.slice(2);
const mdOnly = args.includes('--md');
const jsonOnly = args.includes('--json');
const fontIdx = args.indexOf('--font');
const fontPath = fontIdx >= 0 ? args[fontIdx + 1] : null;
const failIdx = args.indexOf('--fail-on');
const failOn = failIdx >= 0 ? (args[failIdx + 1] ?? '').split(',').filter(Boolean) : [];

if (args.includes('--help') || args.includes('-h')) {
  console.log(`canipdf — conformance tests for JavaScript PDF libraries

Usage
  canipdf                        human summary + markdown matrix
  canipdf --md                   markdown only
  canipdf --json                 machine-readable results
  canipdf --font ./font.ttf      also run a pass with a real Unicode font
  canipdf --fail-on ERR,LOSSY    exit 1 if any case has one of these statuses

Statuses
  pass      every codepoint survived, in order
  order     all codepoints survived, reordered (RTL/bidi)
  partial   >=50% survived
  lossy     <50% survived
  FAIL      nothing recognisable came back
  error     the library threw
  disputed  the two referees disagreed
  n/a       not applicable

Exit codes
  0  no --fail-on match
  1  --fail-on matched
  2  no referee available (results would be meaningless)`);
  process.exit(0);
}

const SYMBOL = {
  PASS: 'pass',
  ORDER: 'order',
  PARTIAL: 'partial',
  LOSSY: 'lossy',
  FAIL: 'FAIL',
  ERR: '**error**',
  SKIP: 'n/a',
  DISPUTED: '**disputed**',
};

function structureOf(bytes) {
  const raw = Buffer.from(bytes).toString('latin1');
  const out = {};
  for (const [key, re] of Object.entries(STRUCTURE_MARKERS)) out[key] = re.test(raw);
  return out;
}

async function runAdapter(adapter, ctx) {
  const result = {
    id: adapter.id,
    name: adapter.name,
    version: adapter.version,
    installed: true,
    cases: {},
    structure: null,
    capabilities: null,
  };

  try {
    const out = await adapter.generate('probe', ctx);
    const bytes = out?.bytes ?? out;
    result.structure = structureOf(bytes);
    result.bytes = bytes.length;
    if (out?.notes?.length) result.notes = out.notes;
    if (out?.subsetting) result.subsetting = out.subsetting;
    if (out?.fontkit) result.fontkit = out.fontkit;
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (/Cannot find (module|package)/i.test(msg)) {
      result.installed = false;
      result.reason = msg.slice(0, 100);
      return result;
    }
    result.structure = { error: msg.slice(0, 120) };
  }

  try {
    result.capabilities = await adapter.capabilities();
  } catch (e) {
    result.capabilities = { error: String(e?.message ?? e).slice(0, 120) };
  }

  for (const c of TEXT_CASES) {
    try {
      const out = await adapter.generate(c.text, ctx);
      const bytes = out?.bytes ?? out;
      const verdict = adjudicate(c.text, await extractAll(bytes));
      // Placement is a separate axis from extraction: a document can look right
      // and still read back in the wrong order (or vice versa).
      if (hasRtl(c.text)) {
        const g = await glyphPlacement(bytes);
        verdict.placement = g.direction;
      }
      result.cases[c.id] = verdict;
    } catch (e) {
      result.cases[c.id] = { status: 'ERR', detail: String(e?.message ?? e).slice(0, 110) };
    }
  }
  return result;
}

const yesNo = (v) => (v === true ? 'yes' : v === false ? 'no' : 'n/a');

function mdFiles(results, heading) {
  const live = results.filter((r) => r.installed);
  const lines = [];
  lines.push(`#### ${heading}`);
  lines.push('');
  lines.push(`| script | ${live.map((r) => r.name).join(' | ')} |`);
  lines.push(`|---|${live.map(() => '---').join('|')}|`);
  for (const c of TEXT_CASES) {
    const cells = live.map((r) => {
      const v = r.cases[c.id];
      return v ? (SYMBOL[v.status] ?? v.status) : '—';
    });
    lines.push(`| ${c.script} | ${cells.join(' | ')} |`);
  }
  const rtlCases = TEXT_CASES.filter((c) => hasRtl(c.text));
  if (rtlCases.length) {
    lines.push('');
    lines.push('**Glyph placement** (MuPDF per-character origins): `rtl` glyphs move');
    lines.push('right-to-left, i.e. visually correct. This is a different axis from the');
    lines.push('table above: a document can be drawn correctly and still extract in the');
    lines.push('wrong order, which is what copy-paste, search and text ingestion see.');
    lines.push('');
    lines.push(`| right-to-left script | ${live.map((r) => r.name).join(' | ')} |`);
    lines.push(`|---|${live.map(() => '---').join('|')}|`);
    for (const c of rtlCases) {
      const cells = live.map((r) => {
        const v = r.cases[c.id];
        if (!v?.placement) return v?.status === 'ERR' ? '—' : 'n/a';
        return v.placement === 'ltr' ? '**ltr**' : v.placement;
      });
      lines.push(`| ${c.script} | ${cells.join(' | ')} |`);
    }
  }

  lines.push('');
  lines.push(`#### ${heading} — structure and API`);
  lines.push(`| property | ${live.map((r) => r.name).join(' | ')} |`);
  lines.push(`|---|${live.map(() => '---').join('|')}|`);
  for (const [key, label] of STRUCTURE_LABELS) {
    lines.push(`| ${label} | ${live.map((r) => yesNo(r.structure?.[key])).join(' | ')} |`);
  }
  lines.push(
    `| AcroForm API | ${live.map((r) => r.capabilities?.forms ?? '—').join(' | ')} |`,
  );
  lines.push(
    `| font subsetting | ${live.map((r) => r.subsetting ?? (r.structure ? 'n/a (default font)' : '—')).join(' | ')} |`,
  );
  lines.push(
    `| fontkit used | ${live.map((r) => r.fontkit ?? '—').join(' | ')} |`,
  );
  lines.push(
    `| file size (1 page) | ${live.map((r) => (r.bytes ? `${(r.bytes / 1024).toFixed(1)} KB` : '—')).join(' | ')} |`,
  );
  return lines.join('\n');
}

const passes = [{ label: 'Default font', ctx: {} }];
if (fontPath) passes.push({ label: `Embedded font (${fontPath.split(/[\\/]/).pop()})`, ctx: { fontPath } });

const payload = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  referees: REFEREES.map((r) => r.id),
  passes: [],
};

for (const pass of passes) {
  const results = [];
  for (const a of ADAPTERS) results.push(await runAdapter(a, pass.ctx));
  payload.passes.push({ label: pass.label, results });
}

writeFileSync('results.json', JSON.stringify(payload, null, 2));

if (jsonOnly) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

if (!mdOnly) {
  console.log('canipdf — conformance matrix');
  console.log(`${TEXT_CASES.length} text cases x ${ADAPTERS.length} libraries`);
  console.log('');
  for (const p of payload.passes) {
    console.log(`  ${p.label}`);
    for (const r of p.results) {
      if (!r.installed) {
        console.log(`    ${r.name.padEnd(18)} not installed`);
        continue;
      }
      const vals = Object.values(r.cases);
      const pass = vals.filter((v) => v.status === 'PASS').length;
      const err = vals.filter((v) => v.status === 'ERR').length;
      console.log(
        `    ${r.name.padEnd(18)} v${String(r.version).padEnd(9)} ${pass}/${vals.length} exact${err ? `, ${err} threw` : ''}`,
      );
    }
  }
  console.log('');
}

for (const p of payload.passes) console.log(mdFiles(p.results, p.label) + '\n');

if (!mdOnly) {
  const errs = payload.passes
    .flatMap((p) => p.results.map((r) => ({ pass: p.label, lib: r.name, cases: r.cases })))
    .flatMap((r) => Object.entries(r.cases).filter(([, v]) => v.status === 'ERR').map(([k, v]) => ({ ...r, k, v })));
  if (errs.length) {
    const e = errs[0];
    console.log(`first throw (${e.pass} / ${e.lib} / ${e.k}):`);
    console.log(`  ${e.v.detail}`);
  }
  console.log('\nresults written to results.json');
}

// ---- exit status -------------------------------------------------------
// 0 clean · 1 --fail-on matched · 2 nothing was measurable (fail loudly
// rather than reporting a green bar over an empty matrix).
let exitCode = 0;

const allCases = payload.passes.flatMap((p) =>
  p.results.flatMap((r) => Object.values(r.cases ?? {})),
);
if (allCases.length && allCases.every((c) => c.status === 'SKIP' || c.status === 'ERR')) {
  if (!mdOnly) console.error('\nno referee produced a readable result — refusing to report success');
  exitCode = 2;
}

if (failOn.length) {
  const hits = [];
  for (const p of payload.passes) {
    for (const r of p.results) {
      for (const [k, v] of Object.entries(r.cases ?? {})) {
        if (failOn.includes(v.status)) hits.push({ pass: p.label, lib: r.name, case: k, status: v.status });
      }
    }
  }
  if (hits.length) {
    exitCode = 1;
    if (!mdOnly) {
      console.error(`\n--fail-on ${failOn.join(',')}: ${hits.length} case(s) matched`);
      for (const h of hits.slice(0, 15)) {
        console.error(`  ${h.status.padEnd(9)} ${h.lib.padEnd(18)} ${h.case}  [${h.pass}]`);
      }
      if (hits.length > 15) console.error(`  ... and ${hits.length - 15} more`);
    }
  } else if (!mdOnly) {
    console.log(`\n--fail-on ${failOn.join(',')}: clean`);
  }
}

process.exit(exitCode);
