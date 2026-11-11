/**
 * Self-tests for the classification logic.
 *
 * The whole tool is only as trustworthy as the thing that decides whether a
 * cell says "pass" or "lossy". If that classifier is wrong, the matrix is
 * confidently wrong, which is worse than having no matrix.
 *
 *   node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, adjudicate } from '../src/extract.js';

test('identical text passes', () => {
  assert.equal(compare('Invoice 42', 'Invoice 42').status, 'PASS');
});

test('whitespace differences are not failures', () => {
  assert.equal(compare('Invoice 42', 'Invoice42').status, 'PASS');
  assert.equal(compare('أ ب ج', 'أبج').status, 'PASS');
});

test('reordered text is ORDER, not PASS and not FAIL', () => {
  // Same characters, different order: the RTL/bidi signature.
  assert.equal(compare('مرحبا', 'ابحرم').status, 'ORDER');
});

test('partial survival is LOSSY below the threshold', () => {
  // 2 of 5 characters survive.
  assert.equal(compare('مرحبا', 'مر').status, 'LOSSY');
});

test('most characters surviving is PARTIAL', () => {
  // 3 of 5 survive.
  assert.equal(compare('مرحبا', 'مرح').status, 'PARTIAL');
});

test('empty extraction is FAIL', () => {
  assert.equal(compare('مرحبا', '').status, 'FAIL');
});

test('whitespace-only extraction is FAIL, not PASS', () => {
  assert.equal(compare('مرحبا', '   ').status, 'FAIL');
});

test('NFC and NFD forms of the same string agree', () => {
  const nfc = 'Tiếng Việt'.normalize('NFC');
  const nfd = 'Tiếng Việt'.normalize('NFD');
  assert.equal(compare(nfc, nfd).status, 'PASS');
});

test('two referees agreeing keeps the verdict', () => {
  const v = adjudicate('Invoice 42', [
    { referee: 'pdfjs', ok: true, text: 'Invoice 42' },
    { referee: 'mupdf', ok: true, text: 'Invoice 42' },
  ]);
  assert.equal(v.status, 'PASS');
  assert.equal(v.agreed, true);
});

test('two referees disagreeing is DISPUTED, not an average', () => {
  const v = adjudicate('مرحبا', [
    { referee: 'pdfjs', ok: true, text: 'مرحبا' },
    { referee: 'mupdf', ok: true, text: 'ابحرم' },
  ]);
  assert.equal(v.status, 'DISPUTED');
  assert.equal(v.agreed, false);
});

test('one referee unavailable falls back to the other', () => {
  const v = adjudicate('Invoice 42', [
    { referee: 'pdfjs', ok: true, text: 'Invoice 42' },
    { referee: 'mupdf', ok: false, reason: 'not installed' },
  ]);
  assert.equal(v.status, 'PASS');
  assert.equal(v.perReferee.length, 2);
});

test('no referees available is SKIP with a reason, never a silent pass', () => {
  const v = adjudicate('Invoice 42', [{ referee: 'pdfjs', ok: false, reason: 'boom' }]);
  assert.equal(v.status, 'SKIP');
  assert.match(v.detail, /boom/);
});
