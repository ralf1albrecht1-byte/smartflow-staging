/**
 * Phase 2b — intake sanitize (defense-in-depth) contract tests.
 *
 * Guards the behaviour that the create-new-customer path in intake pipelines
 * may never persist master-data fields (street/plz/city/phone/email) unless
 * they are demonstrably present in the raw incoming message.
 *
 * Concretely reproduces the Musterfrau regression:
 *   raw text = "Guten tag hier ist musterfrau, ich hätte einen Baum zu fällen"
 *   LLM-proposed fields = plz 76788, city "Addition"
 *   expected             = both dropped.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeNewCustomerFields, normalizeForMatch } from '@/lib/intake-sanitize';

describe('intake-sanitize: normalizeForMatch', () => {
  it('folds umlauts', () => {
    assert.equal(normalizeForMatch('Wädenswil'), 'waedenswil');
    assert.equal(normalizeForMatch('Straße'), 'strasse');
  });
  it('unifies str. / strasse', () => {
    assert.equal(normalizeForMatch('Bahnhofstr.'), 'bahnhofstrasse');
    assert.equal(normalizeForMatch('Bahnhofstrasse'), 'bahnhofstrasse');
  });
  it('collapses whitespace', () => {
    assert.equal(normalizeForMatch('  Foo   Bar  '), 'foo bar');
  });
  it('returns empty on null', () => {
    assert.equal(normalizeForMatch(null), '');
    assert.equal(normalizeForMatch(undefined), '');
  });
});

describe('intake-sanitize: Musterfrau regression', () => {
  const raw = 'Guten tag hier ist musterfrau, ich hätte einen Baum zu fällen';
  it('drops plz that is not in the message', () => {
    const r = sanitizeNewCustomerFields({ rawText: raw, street: null, plz: '76788', city: null });
    assert.equal(r.plz, null);
    assert.ok(r.dropped.includes('plz'));
  });
  it('drops city that is not in the message', () => {
    const r = sanitizeNewCustomerFields({ rawText: raw, street: null, plz: null, city: 'Addition' });
    assert.equal(r.city, null);
    assert.ok(r.dropped.includes('city'));
  });
  it('drops street that is not in the message', () => {
    const r = sanitizeNewCustomerFields({ rawText: raw, street: 'Bahnhofstrasse 15', plz: null, city: null });
    assert.equal(r.street, null);
    assert.ok(r.dropped.includes('street'));
  });
  it('drops phone that is not in the message', () => {
    const r = sanitizeNewCustomerFields({ rawText: raw, street: null, plz: null, city: null, phone: '0041766232623' });
    assert.equal(r.phone, null);
    assert.ok(r.dropped.includes('phone'));
  });
  it('drops all of plz+city+phone when combined (regression case)', () => {
    const r = sanitizeNewCustomerFields({
      rawText: raw,
      street: null,
      plz: '76788',
      city: 'Addition',
      phone: '0041766232623',
    });
    assert.equal(r.plz, null);
    assert.equal(r.city, null);
    assert.equal(r.phone, null);
    assert.deepEqual(r.dropped.sort(), ['city', 'phone', 'plz']);
  });
});

describe('intake-sanitize: KEEP when verifiable in raw text', () => {
  it('keeps plz when present as exact digit run', () => {
    const r = sanitizeNewCustomerFields({
      rawText: 'Bitte zu 5430 Wettingen kommen',
      street: null, plz: '5430', city: 'Wettingen',
    });
    assert.equal(r.plz, '5430');
    assert.equal(r.city, 'Wettingen');
    assert.equal(r.dropped.length, 0);
  });
  it('keeps city with umlaut tolerance', () => {
    const r = sanitizeNewCustomerFields({
      rawText: 'in zuerich', street: null, plz: null, city: 'Zürich',
    });
    assert.equal(r.city, 'Zürich');
  });
  it('keeps street with str./strasse normalization', () => {
    const r = sanitizeNewCustomerFields({
      rawText: 'Schartenstr. 27 brauche Rasenmähen',
      street: 'Schartenstrasse 27', plz: null, city: null,
    });
    assert.equal(r.street, 'Schartenstrasse 27');
  });
  it('keeps phone when 6-digit tail is present in raw text', () => {
    const r = sanitizeNewCustomerFields({
      rawText: 'Tel 076 623 26 23', street: null, plz: null, city: null,
      phone: '+41766232623',
    });
    assert.equal(r.phone, '+41766232623');
  });
  it('keeps email when present verbatim (case-insensitive)', () => {
    const r = sanitizeNewCustomerFields({
      rawText: 'Meine Email: Foo.Bar@Example.COM',
      street: null, plz: null, city: null,
      email: 'foo.bar@example.com',
    });
    assert.equal(r.email, 'foo.bar@example.com');
  });
});

describe('intake-sanitize: edge cases', () => {
  it('empty rawText drops every auto-derived field', () => {
    const r = sanitizeNewCustomerFields({
      rawText: '', street: 'Bahnhofstrasse 1', plz: '5430', city: 'Wettingen',
      phone: '+41791234567', email: 'x@y.ch',
    });
    assert.equal(r.street, null);
    assert.equal(r.plz, null);
    assert.equal(r.city, null);
    assert.equal(r.phone, null);
    assert.equal(r.email, null);
    assert.deepEqual(r.dropped.sort(), ['city', 'email', 'phone', 'plz', 'street']);
  });
  it('null rawText drops every auto-derived field', () => {
    const r = sanitizeNewCustomerFields({
      rawText: null, street: 'X', plz: '5430', city: 'Y', phone: '+41791234567',
    });
    assert.equal(r.street, null);
    assert.equal(r.plz, null);
    assert.equal(r.city, null);
    assert.equal(r.phone, null);
  });
  it('no input fields → no drops', () => {
    const r = sanitizeNewCustomerFields({ rawText: 'hello', street: null, plz: null, city: null });
    assert.equal(r.dropped.length, 0);
    assert.equal(r.street, null);
  });
  it('plz of wrong length is dropped', () => {
    const r = sanitizeNewCustomerFields({ rawText: '123', street: null, plz: '123', city: null });
    assert.equal(r.plz, null);
  });
  it('plz must be an isolated digit run (no substring match)', () => {
    // 5430 appears inside 54305 → regex has digit boundary, so it must NOT match.
    const r = sanitizeNewCustomerFields({ rawText: 'order 54305x', street: null, plz: '5430', city: null });
    assert.equal(r.plz, null);
  });
  it('short phone tail overlap (<6) is not enough', () => {
    const r = sanitizeNewCustomerFields({
      rawText: 'order 2623 only', street: null, plz: null, city: null,
      phone: '+41766232623',
    });
    assert.equal(r.phone, null);
  });
});
