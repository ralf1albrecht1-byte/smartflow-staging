/**
 * Phase 2a tests for `lib/duplicate-scoring.ts`
 *
 * Run with:
 *   yarn tsx --test tests/lib/duplicate-scoring.test.ts
 *
 * Covers the strict E.164 phone-match policy and the removal of the legacy
 * 4-/8-digit suffix match.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMatch, normalizeForMatch } from '../../lib/duplicate-scoring';

describe('duplicate-scoring: normalizeForMatch', () => {
  it('trims and lowercases', () => {
    assert.equal(normalizeForMatch('  Hans Meier  '), 'hans meier');
  });
  it('collapses whitespace', () => {
    assert.equal(normalizeForMatch('Hans   Meier'), 'hans meier');
  });
  it('returns empty for nullish', () => {
    assert.equal(normalizeForMatch(null), '');
    assert.equal(normalizeForMatch(undefined), '');
    assert.equal(normalizeForMatch(''), '');
  });
});

describe('duplicate-scoring: classifyMatch name gate', () => {
  it('returns UNSICHER when names do not match', () => {
    const res = classifyMatch(
      { name: 'Hans Meier', phone: '+41791234567' },
      { name: 'Peter Meier', phone: '+41791234567' },
    );
    assert.equal(res.classification, 'UNSICHER');
    assert.equal(res.score, 10);
  });
  it('returns UNSICHER when only name matches (no other signal)', () => {
    const res = classifyMatch(
      { name: 'Hans Meier' },
      { name: 'Hans Meier' },
    );
    assert.equal(res.classification, 'UNSICHER');
    assert.ok(res.score >= 40);
  });
});

describe('duplicate-scoring: classifyMatch strict phone match', () => {
  it('PHASE 2a POSITIVE: same E.164 with different formatting -> WAHRSCHEINLICH', () => {
    const res = classifyMatch(
      { name: 'Hans Meier', phone: '+41 79 123 45 67' },
      { name: 'Hans Meier', phone: '0041791234567' },
    );
    assert.equal(res.classification, 'WAHRSCHEINLICH');
    assert.equal(res.score, 45); // 40 name + 5 phone
  });

  it('PHASE 2a POSITIVE: whatsapp: prefix is stripped before comparison', () => {
    const res = classifyMatch(
      { name: 'Hans Meier', phone: 'whatsapp:+41791234567' },
      { name: 'Hans Meier', phone: '+41791234567' },
    );
    assert.equal(res.classification, 'WAHRSCHEINLICH');
    assert.equal(res.score, 45);
  });

  it('PHASE 2a NEGATIVE: junk vs parseable -> only name score (UNSICHER)', () => {
    const res = classifyMatch(
      { name: 'Hans Meier', phone: 'hacken' },
      { name: 'Hans Meier', phone: '+41791234567' },
    );
    assert.equal(res.classification, 'UNSICHER');
    assert.equal(res.score, 40);
  });

  it('PHASE 2a NEGATIVE: both junk -> only name score (UNSICHER)', () => {
    const res = classifyMatch(
      { name: 'Hans Meier', phone: 'hacken' },
      { name: 'Hans Meier', phone: 'schacken' },
    );
    assert.equal(res.classification, 'UNSICHER');
    assert.equal(res.score, 40);
  });

  it('PHASE 2a NEGATIVE: legacy 4-/8-digit suffix match no longer triggers', () => {
    // Old logic would have matched these (last 8 digits = "91234567" on both)
    // because it stripped non-digits and compared the tail.
    // New logic: both strings fail toE164Strict (no international prefix), so no phone match.
    const res = classifyMatch(
      { name: 'Hans Meier', phone: '076 91234567' },
      { name: 'Hans Meier', phone: '079 91234567' },
    );
    assert.equal(res.classification, 'UNSICHER');
    assert.equal(res.score, 40);
  });

  it('PHASE 2a NEGATIVE: local CH format without + -> no strong signal', () => {
    // Old logic forced leading 0 -> +41. New strict logic rejects both sides.
    const res = classifyMatch(
      { name: 'Hans Meier', phone: '0791234567' },
      { name: 'Hans Meier', phone: '0791234567' },
    );
    assert.equal(res.classification, 'UNSICHER');
    assert.equal(res.score, 40);
  });

  it('PHASE 2a NEGATIVE: only one side null/empty -> no phone match', () => {
    const resNullSource = classifyMatch(
      { name: 'Hans Meier', phone: null },
      { name: 'Hans Meier', phone: '+41791234567' },
    );
    assert.equal(resNullSource.classification, 'UNSICHER');
    assert.equal(resNullSource.score, 40);

    const resEmptyCandidate = classifyMatch(
      { name: 'Hans Meier', phone: '+41791234567' },
      { name: 'Hans Meier', phone: '' },
    );
    assert.equal(resEmptyCandidate.classification, 'UNSICHER');
    assert.equal(resEmptyCandidate.score, 40);
  });

  it('PHASE 2a EXTENSION: extension on one side still matches main number', () => {
    // toE164Strict separates extensions from the main number, so +41 44 123 45 67 ext. 42
    // compares equal to +41 44 123 45 67.
    const res = classifyMatch(
      { name: 'Hans Meier', phone: '+41 44 123 45 67 ext. 42' },
      { name: 'Hans Meier', phone: '+41441234567' },
    );
    assert.equal(res.classification, 'WAHRSCHEINLICH');
    assert.equal(res.score, 45);
  });

  it('PHASE 2a: different parseable numbers (same country) -> no phone match', () => {
    const res = classifyMatch(
      { name: 'Hans Meier', phone: '+41791234567' },
      { name: 'Hans Meier', phone: '+41791234568' },
    );
    assert.equal(res.classification, 'UNSICHER');
    assert.equal(res.score, 40);
  });

  it('PHASE 2a: DE vs CH E.164 -> no phone match', () => {
    const res = classifyMatch(
      { name: 'Hans Meier', phone: '+491701234567' },
      { name: 'Hans Meier', phone: '+41791234567' },
    );
    assert.equal(res.classification, 'UNSICHER');
    assert.equal(res.score, 40);
  });
});

describe('duplicate-scoring: classifyMatch composite EXAKT classification', () => {
  it('full match with same E.164 phone yields EXAKT', () => {
    const res = classifyMatch(
      { name: 'Hans Meier', address: 'Bahnhofstr. 15', plz: '8001', city: 'Zürich', phone: '+41 79 123 45 67' },
      { name: 'Hans Meier', address: 'Bahnhofstr. 15', plz: '8001', city: 'Zürich', phone: '+41791234567' },
    );
    assert.equal(res.classification, 'EXAKT');
    // 40 name + 25 addr + 15 plz + 10 city + 5 phone = 95
    assert.equal(res.score, 95);
  });

  it('EXAKT: name + address + plz without phone still works (phone null)', () => {
    const res = classifyMatch(
      { name: 'Hans Meier', address: 'Bahnhofstr. 15', plz: '8001', city: 'Zürich' },
      { name: 'Hans Meier', address: 'Bahnhofstr. 15', plz: '8001', city: 'Zürich' },
    );
    assert.equal(res.classification, 'EXAKT');
    assert.equal(res.score, 90); // 40 + 25 + 15 + 10
  });

  it('EXAKT with junk phones on both sides: phone does not contribute but other signals carry', () => {
    const res = classifyMatch(
      { name: 'Hans Meier', address: 'Bahnhofstr. 15', plz: '8001', city: 'Zürich', phone: 'hacken' },
      { name: 'Hans Meier', address: 'Bahnhofstr. 15', plz: '8001', city: 'Zürich', phone: '1234' },
    );
    assert.equal(res.classification, 'EXAKT');
    assert.equal(res.score, 90); // phone contributes 0
  });
});

describe('duplicate-scoring: classifyMatch email signal', () => {
  it('name + email -> WAHRSCHEINLICH', () => {
    const res = classifyMatch(
      { name: 'Hans Meier', email: 'Hans@Example.com' },
      { name: 'Hans Meier', email: 'hans@example.com' },
    );
    assert.equal(res.classification, 'WAHRSCHEINLICH');
    assert.equal(res.score, 45);
  });
});
