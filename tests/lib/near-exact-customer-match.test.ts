/**
 * Phase 2d — Near-exact deterministic customer reuse contract tests.
 *
 * Rules (see lib/exact-customer-match.ts block comment):
 *   - triggers only when EXACTLY one of {plz, city} is missing on incoming
 *   - candidate must have the missing field filled
 *   - strict normalization on the three present fields (name, street, and
 *     the present one of plz/city)
 *   - exactly 1 active candidate required
 *   - phone/email conflict blocks reuse
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyNearExactMatch,
  type CandidateCustomer,
} from '@/lib/exact-customer-match';

const baseCandidate: CandidateCustomer = {
  id: 'c1',
  customerNumber: 'K-001',
  name: 'Albrecht',
  address: 'Kirchweg 1',
  plz: '79761',
  city: 'Waldshut',
  phone: null,
  email: null,
  deletedAt: null,
};

describe('near-exact-customer-match: plz missing on incoming', () => {
  it('returns single candidate & completes plz when name+street+city match uniquely', () => {
    const r = classifyNearExactMatch(
      { name: 'albrecht', street: 'kirchweg 1', plz: null, city: 'waldshut' },
      [baseCandidate],
    );
    assert.equal(r.reason, 'ok');
    assert.equal(r.match?.id, 'c1');
    assert.equal(r.completedField, 'plz');
    assert.equal(r.completedValue, '79761');
  });

  it('tolerates case and umlaut folding on the present fields', () => {
    const r = classifyNearExactMatch(
      { name: 'ALBRECHT', street: 'Kirchweg 1', plz: '', city: 'WALDSHUT' },
      [baseCandidate],
    );
    assert.equal(r.reason, 'ok');
    assert.equal(r.completedField, 'plz');
  });

  it('refuses when two candidates match the three present fields (ambiguous)', () => {
    const c2: CandidateCustomer = { ...baseCandidate, id: 'c2', customerNumber: 'K-002', plz: '79762' };
    const r = classifyNearExactMatch(
      { name: 'albrecht', street: 'kirchweg 1', plz: null, city: 'waldshut' },
      [baseCandidate, c2],
    );
    assert.equal(r.reason, 'multiple_candidates');
    assert.equal(r.match, null);
    assert.equal(r.candidateCount, 2);
  });

  it('refuses when candidate has empty plz (nothing to complete)', () => {
    const c: CandidateCustomer = { ...baseCandidate, plz: null };
    const r = classifyNearExactMatch(
      { name: 'albrecht', street: 'kirchweg 1', plz: null, city: 'waldshut' },
      [c],
    );
    assert.equal(r.reason, 'no_candidate');
  });

  it('refuses when candidate has invalid short plz (less than 4 digits)', () => {
    const c: CandidateCustomer = { ...baseCandidate, plz: '79' };
    const r = classifyNearExactMatch(
      { name: 'albrecht', street: 'kirchweg 1', plz: null, city: 'waldshut' },
      [c],
    );
    assert.equal(r.reason, 'no_candidate');
  });
});

describe('near-exact-customer-match: city missing on incoming', () => {
  it('completes city when name+street+plz match uniquely', () => {
    const r = classifyNearExactMatch(
      { name: 'albrecht', street: 'kirchweg 1', plz: '79761', city: null },
      [baseCandidate],
    );
    assert.equal(r.reason, 'ok');
    assert.equal(r.completedField, 'city');
    assert.equal(r.completedValue, 'Waldshut');
  });

  it('refuses when candidate has empty city', () => {
    const c: CandidateCustomer = { ...baseCandidate, city: null };
    const r = classifyNearExactMatch(
      { name: 'albrecht', street: 'kirchweg 1', plz: '79761', city: null },
      [c],
    );
    assert.equal(r.reason, 'no_candidate');
  });
});

describe('near-exact-customer-match: applicability guards', () => {
  it('returns not_applicable when both plz and city are present (exact path should handle)', () => {
    const r = classifyNearExactMatch(
      { name: 'albrecht', street: 'kirchweg 1', plz: '79761', city: 'Waldshut' },
      [baseCandidate],
    );
    assert.equal(r.reason, 'not_applicable');
  });

  it('returns not_applicable when both plz and city are missing', () => {
    const r = classifyNearExactMatch(
      { name: 'albrecht', street: 'kirchweg 1', plz: null, city: null },
      [baseCandidate],
    );
    assert.equal(r.reason, 'not_applicable');
  });

  it('returns incomplete_incoming when name is missing', () => {
    const r = classifyNearExactMatch(
      { name: null, street: 'kirchweg 1', plz: '79761', city: null },
      [baseCandidate],
    );
    assert.equal(r.reason, 'incomplete_incoming');
  });

  it('returns incomplete_incoming when street is missing', () => {
    const r = classifyNearExactMatch(
      { name: 'albrecht', street: null, plz: '79761', city: null },
      [baseCandidate],
    );
    assert.equal(r.reason, 'incomplete_incoming');
  });
});

describe('near-exact-customer-match: strict on the present fields', () => {
  it('refuses when name only partially matches', () => {
    const r = classifyNearExactMatch(
      { name: 'albrecht gmbh', street: 'kirchweg 1', plz: '79761', city: null },
      [baseCandidate],
    );
    assert.equal(r.reason, 'no_candidate');
  });

  it('refuses when street house number differs', () => {
    const r = classifyNearExactMatch(
      { name: 'albrecht', street: 'kirchweg 2', plz: '79761', city: null },
      [baseCandidate],
    );
    assert.equal(r.reason, 'no_candidate');
  });

  it('refuses when plz differs (city missing case)', () => {
    const r = classifyNearExactMatch(
      { name: 'albrecht', street: 'kirchweg 1', plz: '79999', city: null },
      [baseCandidate],
    );
    assert.equal(r.reason, 'no_candidate');
  });

  it('refuses when city differs (plz missing case)', () => {
    const r = classifyNearExactMatch(
      { name: 'albrecht', street: 'kirchweg 1', plz: null, city: 'Konstanz' },
      [baseCandidate],
    );
    assert.equal(r.reason, 'no_candidate');
  });
});

describe('near-exact-customer-match: conflict guards', () => {
  it('blocks reuse on phone conflict (both E.164 parseable and differ)', () => {
    const c: CandidateCustomer = { ...baseCandidate, phone: '+41791111111' };
    const r = classifyNearExactMatch(
      { name: 'albrecht', street: 'kirchweg 1', plz: null, city: 'waldshut', phone: '+41792222222' },
      [c],
    );
    assert.equal(r.reason, 'phone_conflict');
  });

  it('allows reuse when only incoming phone is set (candidate phone empty)', () => {
    const r = classifyNearExactMatch(
      { name: 'albrecht', street: 'kirchweg 1', plz: null, city: 'waldshut', phone: '+41792222222' },
      [baseCandidate], // candidate.phone === null
    );
    assert.equal(r.reason, 'ok');
  });

  it('allows reuse when only candidate phone is set (incoming phone empty)', () => {
    const c: CandidateCustomer = { ...baseCandidate, phone: '+41791111111' };
    const r = classifyNearExactMatch(
      { name: 'albrecht', street: 'kirchweg 1', plz: null, city: 'waldshut' },
      [c],
    );
    assert.equal(r.reason, 'ok');
  });

  it('blocks reuse on email conflict (case-insensitive)', () => {
    const c: CandidateCustomer = { ...baseCandidate, email: 'OLD@domain.ch' };
    const r = classifyNearExactMatch(
      { name: 'albrecht', street: 'kirchweg 1', plz: null, city: 'waldshut', email: 'new@domain.ch' },
      [c],
    );
    assert.equal(r.reason, 'email_conflict');
  });

  it('allows same email with different case', () => {
    const c: CandidateCustomer = { ...baseCandidate, email: 'A@DOMAIN.CH' };
    const r = classifyNearExactMatch(
      { name: 'albrecht', street: 'kirchweg 1', plz: null, city: 'waldshut', email: 'a@domain.ch' },
      [c],
    );
    assert.equal(r.reason, 'ok');
  });
});

describe('near-exact-customer-match: archived candidate', () => {
  it('ignores archived candidates (deletedAt !== null) when finding matches', () => {
    const c: CandidateCustomer = { ...baseCandidate, deletedAt: new Date() };
    const r = classifyNearExactMatch(
      { name: 'albrecht', street: 'kirchweg 1', plz: null, city: 'waldshut' },
      [c],
    );
    assert.equal(r.reason, 'no_candidate');
  });
});
