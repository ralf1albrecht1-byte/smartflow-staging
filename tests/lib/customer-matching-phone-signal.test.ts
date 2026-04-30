/**
 * Phase 2a — Strong-Signal Phone contract tests.
 *
 * Scope:
 *   - Validates the strict-phone contract used by verifyCustomerMatch's
 *     Strong-Signal-1 branch: phoneEqualsStrict(incoming.phone, cust.phone).
 *   - We don't boot Prisma here (pure contract tests); the Strong-Signal
 *     branch is a single boolean expression around phoneEqualsStrict,
 *     so testing phoneEqualsStrict over the realistic matrix proves the
 *     contract end-to-end for that branch.
 *
 * Scope-Change von Phase 2a:
 *   - Vorher: phoneEquals (lib/normalize) — toleriert Default-Region CH
 *     und einige Ziffern-Heuristiken.
 *   - Jetzt: phoneEqualsStrict — beide Seiten MÜSSEN parseable sein
 *     zu derselben E.164. Keine Default-Region, keine Suffix-Fallbacks.
 *
 * Hinweis: Downstream-Verhalten (verdict='auto_assign' vs 'moeglicher_treffer')
 *   wird durch die hier getestete Strict-Equality-Logik deterministisch
 *   bestimmt. Integration (DB-Lookup, archived-guard) ist nicht Teil dieser
 *   Phase-2a-Änderung und wird dort nicht nochmal getestet.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { phoneEqualsStrict, toE164Strict } from '@/lib/phone';

describe('customer-matching Phase 2a: phoneEqualsStrict Strong-Signal contract', () => {
  describe('POSITIVE: must allow auto_assign', () => {
    it('identical E.164 numbers', () => {
      assert.equal(phoneEqualsStrict('+41791234567', '+41791234567'), true);
    });
    it('same E.164 with different formatting (spaces)', () => {
      assert.equal(phoneEqualsStrict('+41 79 123 45 67', '+41791234567'), true);
    });
    it('same E.164 with hyphens and parentheses', () => {
      assert.equal(phoneEqualsStrict('+41 (79) 123-45-67', '+41791234567'), true);
    });
    it('whatsapp: prefix is sanitized on incoming side', () => {
      assert.equal(phoneEqualsStrict('whatsapp:+41791234567', '+41791234567'), true);
    });
    it('extension on one side, both share same main E.164', () => {
      assert.equal(phoneEqualsStrict('+41791234567;ext=42', '+41791234567'), true);
    });
    it('extension on both sides (different ext) — main E.164 equal', () => {
      assert.equal(phoneEqualsStrict('+41791234567 ext. 12', '+41791234567 x99'), true);
    });
  });

  describe('NEGATIVE: must NOT allow auto_assign', () => {
    it('different parseable E.164 numbers (CH)', () => {
      assert.equal(phoneEqualsStrict('+41791234567', '+41791234568'), false);
    });
    it('CH vs DE E.164 with matching digit suffix', () => {
      assert.equal(phoneEqualsStrict('+41791234567', '+49791234567'), false);
    });
    it('local CH number without + on stored side is UNPARSEABLE without default region', () => {
      // Phase 2a removes default region; '0791234567' alone is not E.164.
      assert.equal(toE164Strict('0791234567'), null);
      assert.equal(phoneEqualsStrict('+41791234567', '0791234567'), false);
    });
    it('local CH on both sides (both unparseable strictly) — no phone signal', () => {
      assert.equal(phoneEqualsStrict('056 426 12 34', '056 426 12 34'), false);
    });
    it('legacy 4-digit suffix overlap does not trigger match', () => {
      // e.g. '+41441234567' vs '+41791234567' — same last 4 digits ('4567')
      // under the legacy fallback might have matched; strict rejects.
      assert.equal(phoneEqualsStrict('+41441234567', '+41791234567'), false);
    });
    it('legacy 8-digit suffix overlap does not trigger match', () => {
      // '+41441234567' vs '+43441234567' — same last 8 ('41234567'); strict rejects.
      assert.equal(phoneEqualsStrict('+41441234567', '+43441234567'), false);
    });
    it('incoming is junk, stored is parseable — no match', () => {
      assert.equal(phoneEqualsStrict('abc123', '+41791234567'), false);
    });
    it('incoming is parseable, stored is junk — no match', () => {
      assert.equal(phoneEqualsStrict('+41791234567', 'n/a'), false);
    });
    it('both sides junk — no match', () => {
      assert.equal(phoneEqualsStrict('abc', 'xyz'), false);
    });
    it('empty string either side — no match', () => {
      assert.equal(phoneEqualsStrict('', '+41791234567'), false);
      assert.equal(phoneEqualsStrict('+41791234567', ''), false);
    });
    it('null/undefined either side — no match', () => {
      assert.equal(phoneEqualsStrict(null, '+41791234567'), false);
      assert.equal(phoneEqualsStrict('+41791234567', null), false);
      assert.equal(phoneEqualsStrict(null, null), false);
      assert.equal(phoneEqualsStrict(undefined, undefined), false);
    });
  });

  describe('LEGACY ROWS (from Phase-0 dev audit, falling off Strong-Signal)', () => {
    // These are the representative rows captured in
    // reports/phase2a-dev-falling-strong-signals.csv — all CH-local, no +country.
    const legacyStored = ['0766232723', '056 426 12 34', '056 222 56 78', '056 437 71 11'];

    it('legacy stored CH-local vs incoming E.164: all reject', () => {
      for (const stored of legacyStored) {
        // Even a parseable incoming +4156... cannot match, because stored
        // side has no country info and toE164Strict returns null.
        assert.equal(phoneEqualsStrict('+41564261234', stored), false,
          `expected false for stored='${stored}'`);
      }
    });

    it('legacy stored CH-local vs same-text incoming: still reject (both unparseable)', () => {
      for (const stored of legacyStored) {
        assert.equal(phoneEqualsStrict(stored, stored), false,
          `expected false for stored='${stored}' (both sides unparseable)`);
      }
    });
  });
});
