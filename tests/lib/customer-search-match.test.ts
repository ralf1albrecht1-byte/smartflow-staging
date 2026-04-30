/**
 * Phase 2a — customer-search-match tests.
 *
 * Verifies:
 *   - Strict E.164 path: when query parses (+41..., +49...), phone bucket
 *     matches ONLY via phoneEqualsStrict; other fields still via text contains.
 *   - Text fallback: when query does NOT parse ("Müller", "4567", "079",
 *     "056 426", partial digits), phone bucket uses legacy digit-substring.
 *   - rankCustomers ordering: exactNumber > phoneStrict > nameStarts >
 *     nameContains > phoneTextContains > emailContains.
 *   - Empty query returns all (combobox full list, Kundenliste full list).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchesQuery, rankCustomers, type CustomerSearchable } from '@/lib/customer-search-match';

const cust = (overrides: Partial<CustomerSearchable> & Pick<CustomerSearchable, 'id' | 'name'>): CustomerSearchable => ({
  id: overrides.id,
  name: overrides.name,
  customerNumber: overrides.customerNumber ?? null,
  phone: overrides.phone ?? null,
  email: overrides.email ?? null,
  address: overrides.address ?? null,
  plz: overrides.plz ?? null,
  city: overrides.city ?? null,
});

describe('customer-search-match: matchesQuery', () => {
  const c1 = cust({ id: '1', name: 'Max Müller', phone: '+41 79 123 45 67', email: 'max@example.ch', customerNumber: 'K-100', city: 'Zürich', plz: '8000', address: 'Bahnhofstr. 1' });
  const c2 = cust({ id: '2', name: 'Anna Schmidt', phone: '+41564261234', email: 'anna@example.de', customerNumber: 'K-200', city: 'Bern', plz: '3000' });
  const c3 = cust({ id: '3', name: 'Peter Keller', phone: '0766232723', customerNumber: 'K-300' }); // legacy CH-local (unparseable strictly)
  const c4 = cust({ id: '4', name: 'Lisa Weber', phone: null, email: 'lisa@example.ch', customerNumber: 'K-400' });

  describe('empty / whitespace query', () => {
    it('empty string matches everyone', () => {
      assert.equal(matchesQuery(c1, ''), true);
      assert.equal(matchesQuery(c2, ''), true);
      assert.equal(matchesQuery(c4, ''), true);
    });
    it('whitespace-only matches everyone', () => {
      assert.equal(matchesQuery(c1, '   '), true);
      assert.equal(matchesQuery(c3, '\t\n'), true);
    });
  });

  describe('strict E.164 query', () => {
    it('exact E.164 matches the stored E.164 phone', () => {
      assert.equal(matchesQuery(c1, '+41791234567'), true);
      assert.equal(matchesQuery(c2, '+41564261234'), true);
    });
    it('E.164 with spaces matches stored E.164 phone', () => {
      assert.equal(matchesQuery(c1, '+41 79 123 45 67'), true);
    });
    it('E.164 with extension matches', () => {
      assert.equal(matchesQuery(c1, '+41791234567;ext=42'), true);
    });
    it('different E.164 does NOT match via phone (no digit-substring heuristic)', () => {
      // c1.phone E.164 = +41791234567; query +41791234568 differs by last digit.
      assert.equal(matchesQuery(c1, '+41791234568'), false);
    });
    it('E.164 query does NOT match customer with unparseable legacy phone', () => {
      // c3.phone = '0766232723' — unparseable strict; strict E.164 query cannot
      // match it (no fallback on the strict path).
      assert.equal(matchesQuery(c3, '+41766232723'), false);
    });
    it('E.164 query does NOT match when customer has no phone', () => {
      assert.equal(matchesQuery(c4, '+41791234567'), false);
    });
    it('E.164 query still triggers match via other fields (name, email, number)', () => {
      // Fabricated E.164 that happens to be contained in no real phone —
      // verify other-field matching still works when query is E.164 but happens
      // to also be part of the customer number.
      const cOddNumber = cust({ id: 'x', name: 'X', customerNumber: '+41791234567' });
      assert.equal(matchesQuery(cOddNumber, '+41791234567'), true);
    });
  });

  describe('text fallback query (not strictly E.164)', () => {
    it('name substring matches', () => {
      assert.equal(matchesQuery(c1, 'Müller'), true);
      assert.equal(matchesQuery(c1, 'müller'), true);
      assert.equal(matchesQuery(c2, 'Schmidt'), true);
    });
    it('customerNumber substring matches', () => {
      assert.equal(matchesQuery(c1, 'K-100'), true);
      assert.equal(matchesQuery(c1, 'k-100'), true);
    });
    it('email substring matches', () => {
      assert.equal(matchesQuery(c1, 'example.ch'), true);
      assert.equal(matchesQuery(c4, 'lisa@'), true);
    });
    it('city matches', () => {
      assert.equal(matchesQuery(c1, 'Zürich'), true);
      assert.equal(matchesQuery(c2, 'Bern'), true);
    });
    it('PLZ matches', () => {
      assert.equal(matchesQuery(c1, '8000'), true);
      assert.equal(matchesQuery(c2, '3000'), true);
    });
    it('partial digit string (legacy UX) still matches phone via text fallback', () => {
      // User types partial digits "4567" — not parseable to E.164; text fallback.
      assert.equal(matchesQuery(c1, '4567'), true);
      assert.equal(matchesQuery(c2, '2612'), true);
    });
    it('CH-local without + (unparseable) matches legacy phone via text', () => {
      assert.equal(matchesQuery(c3, '0766'), true);
      assert.equal(matchesQuery(c3, '0766232723'), true);
    });
    it('address substring matches', () => {
      assert.equal(matchesQuery(c1, 'Bahnhofstr'), true);
    });
    it('does not match when no field contains query', () => {
      assert.equal(matchesQuery(c1, 'Zurich-NOT-THERE'), false);
      assert.equal(matchesQuery(c2, 'Hamburg'), false);
    });
  });
});

describe('customer-search-match: rankCustomers ordering', () => {
  const a = cust({ id: 'a', name: 'Alice', customerNumber: 'K-999' });
  const b = cust({ id: 'b', name: 'Bob', phone: '+41791234567' });
  const c = cust({ id: 'c', name: 'Max Starter', phone: null });
  const d = cust({ id: 'd', name: 'Hans Max-Ende', phone: null });
  const e = cust({ id: 'e', name: 'No-name', phone: '+41 79 999 00 11' }); // different E.164
  const f = cust({ id: 'f', name: 'Emily', email: 'emily@domain.ch' });
  const all = [a, b, c, d, e, f];

  it('empty query returns original list unchanged', () => {
    assert.deepEqual(rankCustomers(all, '').map(x => x.id), ['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('exact customerNumber outranks everything', () => {
    const result = rankCustomers(all, 'K-999');
    assert.equal(result[0].id, 'a');
  });

  it('strict E.164 phone outranks name matches', () => {
    // Query +41791234567 -> strict match on b.phone; names don't match.
    const result = rankCustomers(all, '+41791234567');
    assert.equal(result[0].id, 'b');
    // e has a DIFFERENT E.164, so e must NOT be in result (phone differs, name differs).
    assert.equal(result.find(x => x.id === 'e'), undefined);
  });

  it('strict E.164 query does NOT produce false-positive text-contains on phone', () => {
    // '+41791234567' would, under legacy text contains on normalized phone, match '+41799990011'
    // because both contain '417'. Under the strict E.164 path, e must not be matched by phone.
    const result = rankCustomers([b, e], '+41791234567');
    assert.deepEqual(result.map(x => x.id), ['b']);
  });

  it('name starts-with outranks name contains', () => {
    const result = rankCustomers([c, d], 'Max');
    assert.deepEqual(result.map(x => x.id), ['c', 'd']);
  });

  it('text fallback partial-digit phone search still works', () => {
    // Query '4567' — not E.164; should text-fallback-match b (which has 4567 in phone).
    const result = rankCustomers([a, b, e], '4567');
    assert.deepEqual(result.map(x => x.id), ['b']);
  });

  it('email bucket is last in ranking', () => {
    const result = rankCustomers([a, f], 'emily');
    assert.deepEqual(result.map(x => x.id), ['f']);
  });

  it('non-matching customers are excluded', () => {
    const result = rankCustomers(all, 'zzzzz-nothing');
    assert.deepEqual(result, []);
  });
});

describe('customer-search-match: Phase 2a behaviour contracts', () => {
  it('strict E.164 query rejects digit-suffix false-positives', () => {
    // Legacy behaviour: phone text contains '4567' would match both.
    // Strict behaviour: only the exact E.164 wins.
    const c1 = cust({ id: '1', name: 'A', phone: '+41791234567' });
    const c2 = cust({ id: '2', name: 'B', phone: '+41 41 000 45 67' });
    const result = rankCustomers([c1, c2], '+41791234567');
    assert.deepEqual(result.map(x => x.id), ['1']);
  });

  it('legacy CH-local customer (unparseable) is only reachable via text fallback', () => {
    const legacy = cust({ id: '1', name: 'Alt-Kunde', phone: '056 426 12 34' });
    // Strict E.164 query like '+41564261234' does NOT match the legacy phone.
    assert.equal(matchesQuery(legacy, '+41564261234'), false);
    // But text-based queries still find it.
    assert.equal(matchesQuery(legacy, '056 426'), true);
    assert.equal(matchesQuery(legacy, '4261234'), true);
    assert.equal(matchesQuery(legacy, 'Alt-Kunde'), true);
  });

  it('extension on stored number does not prevent strict match', () => {
    const c = cust({ id: '1', name: 'Ext', phone: '+41791234567 ext. 5' });
    assert.equal(matchesQuery(c, '+41791234567'), true);
    assert.equal(matchesQuery(c, '+41 79 123 45 67'), true);
  });
});
