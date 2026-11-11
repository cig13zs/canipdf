/**
 * Tests for the capability observer.
 *
 * The observer is the part of this tool that used to lie: it returned a
 * hardcoded 'no API' for tagging and encryption without looking at anything.
 * These tests pin the behaviour that replaced it, including the distinction
 * between "the library cannot" and "my attempt was wrong".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observeCapabilities, CAPABILITY_MARKERS } from '../src/adapters/index.js';

const bytes = (s) => new TextEncoder().encode(s);

test('a marker in the output means yes', () => {
  const r = observeCapabilities({ forms: { bytes: bytes('... /AcroForm ...') } });
  assert.equal(r.forms.api, 'yes');
  assert.match(r.forms.evidence, /present in output/);
});

test('a missing marker after a documented option means no API', () => {
  const r = observeCapabilities({ tagged: { bytes: bytes('no structure tree here') } });
  assert.equal(r.tagged.api, 'no API');
  assert.match(r.tagged.evidence, /absent/);
});

test('a thrown attempt is no API, and keeps the library error as evidence', () => {
  const r = observeCapabilities({ encrypt: { error: 'not supported' } });
  assert.equal(r.encrypt.api, 'no API');
  assert.equal(r.encrypt.evidence, 'not supported');
});

test('an API that exists but produced no marker is inconclusive, not no', () => {
  const r = observeCapabilities({
    forms: { bytes: bytes('nothing'), apiHint: 'AcroFormTextField exists' },
  });
  assert.equal(r.forms.api, 'inconclusive');
  assert.match(r.forms.evidence, /AcroFormTextField exists/);
});

test('an untouched capability is reported as not attempted, never as a verdict', () => {
  const r = observeCapabilities({});
  for (const key of Object.keys(CAPABILITY_MARKERS)) {
    assert.equal(r[key].api, 'not attempted');
  }
});

test('encryption marker does not match the reader-only helper names', () => {
  // The old symbol scan reported pdf-lib as capable because it exports
  // EncryptedPDFError and isEncrypted, which are about reading, not writing.
  const r = observeCapabilities({ encrypt: { bytes: bytes('EncryptedPDFError isEncrypted') } });
  assert.equal(r.encrypt.api, 'no API');
});
