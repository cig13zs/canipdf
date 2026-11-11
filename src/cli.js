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
import { extractText, compare } from './extract.js';
import { ADAPTERS } from './adapters/index.js';

const args = process.argv.slice(2);
const mdOnly = args.includes('--md');
const jsonOnly = args.includes('--json');
const fontIdx = args.indexOf('--font');
const fontPath = fontIdx >= 0 ? args[fontIdx + 1] : null;

const SYMBOL = {
  PASS: 'pass',
  ORDER: 'order',
  PARTIAL: 'partial',
  LOSSY: 'lossy',
  FAIL: 'FAIL',
  ERR: '**error**',
  SKIP: 'n/a',
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
      const read = await extractText(bytes);
      if (!read.ok) {
        result.cases[c.id] = { status: 'SKIP', detail: read.reason };
        continue;
      }
      const cmp = compare(c.text, read.text);
      result.cases[c.id] = {
        status: cmp.status,
        kept: Number(cmp.kept.toFixed(2)),
        readBack: read.text.slice(0, 40),
      };
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
  lines.push('');
  lines.push('| structure / API | ' + live.map((r) => r.name).join(' | ') + ' |');
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
    `| file size (1 page) | ${live.map((r) => (r.bytes ? `${(r.bytes / 1024).toFixed(1)} KB` : '—')).join(' | ')} |`,
  );
  return lines.join('\n');
}

const passes = [{ label: 'Default font', ctx: {} }];
if (fontPath) passes.push({ label: `Embedded font (${fontPath.split(/[\\/]/).pop()})`, ctx: { fontPath } });

const payload = { generatedAt: new Date().toISOString(), node: process.version, passes: [] };

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
