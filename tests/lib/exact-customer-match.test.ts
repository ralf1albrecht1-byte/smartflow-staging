/**
 * Phase 2c — Exact deterministic customer reuse contract tests.
 *
 * Tests the pure classifier (classifyExactMatch) so we can reason about the
 * rules without a DB. The DB wrapper findExactDeterministicMatch is a thin
 * prisma.findMany + same classifier, covered indirectly by typing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyExactMatch,
  type CandidateCustomer,
} from '@/lib/exact-customer-match';

const baseCandidate: CandidateCustomer = {
  id: 'c1',
  customerNumber: 'K-001',
  name: 'Albrecht Stowitsch',
  address: 'Schartenstrasse 27',
  plz: '5430',
  city: 'Wettingen',
  phone: '+41791234567',
  email: 'a@b.ch',
  deletedAt: null,
};

const baseIncoming = {
  name: 'Albrecht Stowitsch',
  street: 'Schartenstrasse 27',
  plz: '5430',
  city: 'Wettingen',
};

describe('exact-customer-match: happy path', () => {
  it('returns the single active candidate when all four fields match exactly', () => {
    const r = classifyExactMatch(baseIncoming, [baseCandidate]);
    assert.equal(r.reason, 'ok');
    assert.equal(r.match?.id, 'c1');
  });

  it('tolerates case differences (Albrecht vs ALBRECHT)', () => {
    const r = classifyExactMatch(
      { ...baseIncoming, name: 'ALBRECHT STOWITSCH' },
      [baseCandidate],
    );
    assert.equal(r.reason, 'ok');
  });

  it('tolerates str. vs strasse abbreviation', () => {
    const r = classifyExactMatch(
      { ...baseIncoming, street: 'Schartenstr. 27' },
      [baseCandidate],
    );
    assert.equal(r.reason, 'ok');
  });

  it('tolerates umlaut folding (Wädenswil vs Waedenswil)', () => {
    const cand = { ...baseCandidate, city: 'Wädenswil' };
    const r = classifyExactMatch(
      { ...baseIncoming, city: 'Waedenswil' },
      [cand],
    );
    assert.equal(r.reason, 'ok');
  });
});

describe('exact-customer-match: incomplete incoming', () => {
  const cases: Array<[string, Record<string, any>]> = [
    ['missing name', { ...baseIncoming, name: '' }],
    ['missing street', { ...baseIncoming, street: '' }],
    ['missing plz', { ...baseIncoming, plz: '' }],
    ['missing city', { ...baseIncoming, city: '' }],
    ['plz too short', { ...baseIncoming, plz: '54' }],
  ];
  for (const [label, incoming] of cases) {
    it(`drops to incomplete_incoming on: ${label}`, () => {
      const r = classifyExactMatch(incoming, [baseCandidate]);
      assert.equal(r.reason, 'incomplete_incoming');
      assert.equal(r.match, null);
    });
  }
});

describe('exact-customer-match: no candidate', () => {
  it('returns no_candidate when name differs', () => {
    const r = classifyExactMatch({ ...baseIncoming, name: 'Someone Else' }, [baseCandidate]);
    assert.equal(r.reason, 'no_candidate');
  });
  it('returns no_candidate when house number differs', () => {
    const r = classifyExactMatch({ ...baseIncoming, street: 'Schartenstrasse 27a' }, [baseCandidate]);
    assert.equal(r.reason, 'no_candidate');
  });
  it('returns no_candidate when plz differs', () => {
    const r = classifyExactMatch({ ...baseIncoming, plz: '5431' }, [baseCandidate]);
    assert.equal(r.reason, 'no_candidate');
  });
  it('returns no_candidate when candidate pool is empty', () => {
    const r = classifyExactMatch(baseIncoming, []);
    assert.equal(r.reason, 'no_candidate');
  });
});

describe('exact-customer-match: ambiguity', () => {
  it('returns multiple_candidates when two active customers share the identity', () => {
    const twin: CandidateCustomer = { ...baseCandidate, id: 'c2', customerNumber: 'K-002' };
    const r = classifyExactMatch(baseIncoming, [baseCandidate, twin]);
    assert.equal(r.reason, 'multiple_candidates');
    assert.equal(r.candidateCount, 2);
    assert.equal(r.match, null);
  });
});

describe('exact-customer-match: archived guard', () => {
  it('ignores archived candidates', () => {
    const archived: CandidateCustomer = { ...baseCandidate, deletedAt: new Date() };
    const r = classifyExactMatch(baseIncoming, [archived]);
    assert.equal(r.reason, 'no_candidate');
  });
  it('when one active + one archived share identity → still ok (the active one)', () => {
    const archived: CandidateCustomer = { ...baseCandidate, id: 'c2', deletedAt: new Date() };
    const r = classifyExactMatch(baseIncoming, [baseCandidate, archived]);
    assert.equal(r.reason, 'ok');
    assert.equal(r.match?.id, 'c1');
  });
});

describe('exact-customer-match: phone conflict guard', () => {
  it('rejects reuse when incoming phone ≠ candidate phone (both parseable)', () => {
    const r = classifyExactMatch(
      { ...baseIncoming, phone: '+41799999999' },
      [baseCandidate],
    );
    assert.equal(r.reason, 'phone_conflict');
    assert.equal(r.match, null);
  });
  it('allows reuse when incoming phone matches (different formatting)', () => {
    const r = classifyExactMatch(
      { ...baseIncoming, phone: '+41 79 123 45 67' },
      [baseCandidate],
    );
    assert.equal(r.reason, 'ok');
  });
  it('allows reuse when incoming has no phone', () => {
    const r = classifyExactMatch({ ...baseIncoming, phone: null }, [baseCandidate]);
    assert.equal(r.reason, 'ok');
  });
  it('allows reuse when candidate has no phone', () => {
    const r = classifyExactMatch(
      { ...baseIncoming, phone: '+41799999999' },
      [{ ...baseCandidate, phone: null }],
    );
    assert.equal(r.reason, 'ok');
  });
  it('allows reuse when candidate phone is unparseable (no strict E.164 conflict provable)', () => {
    const r = classifyExactMatch(
      { ...baseIncoming, phone: '+41799999999' },
      [{ ...baseCandidate, phone: '0766 xxx yy zz' }],
    );
    assert.equal(r.reason, 'ok');
  });
});

describe('exact-customer-match: email conflict guard', () => {
  it('rejects reuse when incoming email ≠ candidate email', () => {
    const r = classifyExactMatch(
      { ...baseIncoming, email: 'other@x.ch' },
      [baseCandidate],
    );
    assert.equal(r.reason, 'email_conflict');
  });
  it('allows reuse when emails match case-insensitively', () => {
    const r = classifyExactMatch(
      { ...baseIncoming, email: 'A@B.CH' },
      [baseCandidate],
    );
    assert.equal(r.reason, 'ok');
  });
  it('allows reuse when incoming has no email', () => {
    const r = classifyExactMatch({ ...baseIncoming, email: null }, [baseCandidate]);
    assert.equal(r.reason, 'ok');
  });
  it('allows reuse when candidate has no email', () => {
    const r = classifyExactMatch(
      { ...baseIncoming, email: 'whatever@x.ch' },
      [{ ...baseCandidate, email: null }],
    );
    assert.equal(r.reason, 'ok');
  });
});

describe('exact-customer-match: regression — "Albrecht exact" scenario', () => {
  it('direct reuse if name+street+plz+city all present in message and candidate is unique', () => {
    const r = classifyExactMatch(
      {
        name: 'Albrecht Stowitsch',
        street: 'Schartenstrasse 27',
        plz: '5430',
        city: 'Wettingen',
        phone: null,
        email: null,
      },
      [baseCandidate],
    );
    assert.equal(r.reason, 'ok');
    assert.equal(r.match?.customerNumber, 'K-001');
  });
});
