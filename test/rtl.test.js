import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRtlChar, hasRtl } from '../src/extract.js';

test('detects RTL scripts', () => {
  for (const ch of ['م', 'ש', 'ܐ', 'ހ']) assert.equal(isRtlChar(ch), true, ch);
});

test('does not flag LTR scripts as RTL', () => {
  for (const ch of ['a', 'Z', 'न', 'あ', '中', 'Ω', 'д']) assert.equal(isRtlChar(ch), false, ch);
});

test('digit and punctuation are not RTL', () => {
  for (const ch of ['4', '2', '/', '(', ' ']) assert.equal(isRtlChar(ch), false, ch);
});

test('hasRtl finds RTL inside a mixed string', () => {
  assert.equal(hasRtl('Invoice 42: مرحبا'), true);
  assert.equal(hasRtl('Invoice 42 only'), false);
});
