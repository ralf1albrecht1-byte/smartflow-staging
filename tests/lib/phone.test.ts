/**
 * Unit tests for lib/phone.ts (Phase 1 — additive utility).
 *
 * Runner: node:test (built-in, requires Node ≥ 18). Execute with:
 *   cd nextjs_space && npx --no-install tsx --test tests/lib/phone.test.ts
 * or via yarn:
 *   yarn tsx --test tests/lib/phone.test.ts
 *
 * These tests are ADDITIVE and do not touch any production path.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parsePhoneStrict,
  toE164Strict,
  phoneEqualsStrict,
  maskPhoneForLog,
  sanitizePhoneInput,
  classifyParseError,
} from '../../lib/phone';

describe('sanitizePhoneInput', () => {
  it('handles null and empty inputs safely', () => {
    assert.deepEqual(sanitizePhoneInput(null), { inputForParse: '', hadWhatsappPrefix: false, isBsuidOnly: false, maybeConverted00ToPlus: false });
    assert.deepEqual(sanitizePhoneInput(''),   { inputForParse: '', hadWhatsappPrefix: false, isBsuidOnly: false, maybeConverted00ToPlus: false });
    assert.deepEqual(sanitizePhoneInput('  '), { inputForParse: '', hadWhatsappPrefix: false, isBsuidOnly: false, maybeConverted00ToPlus: false });
  });

  it('strips whatsapp: prefix and flags it', () => {
    const r = sanitizePhoneInput('whatsapp:+41791234567');
    assert.equal(r.hadWhatsappPrefix, true);
    assert.equal(r.isBsuidOnly, false);
    assert.equal(r.inputForParse, '+41791234567');
  });

  it('detects BSUID-only payloads as isBsuidOnly', () => {
    const r = sanitizePhoneInput('whatsapp:CH.BSUID123ABC');
    assert.equal(r.isBsuidOnly, true);
    assert.equal(r.hadWhatsappPrefix, true);
  });

  it('converts leading 00<digits> to +<digits>', () => {
    const r = sanitizePhoneInput('0041791234567');
    assert.equal(r.maybeConverted00ToPlus, true);
    assert.equal(r.inputForParse, '+41791234567');
  });

  it('does NOT convert bare national-number format', () => {
    const r = sanitizePhoneInput('0791234567');
    assert.equal(r.maybeConverted00ToPlus, false);
    assert.equal(r.inputForParse, '0791234567');
  });
});

describe('parsePhoneStrict — valid inputs', () => {
  it('PARSE_OK for +41791234567', () => {
    const r = parsePhoneStrict('+41791234567');
    assert.equal(r.parseStatus, 'PARSE_OK');
    assert.equal(r.normalizedE164, '+41791234567');
    assert.equal(r.country, 'CH');
    assert.equal(r.extension, null);
  });

  it('PARSE_OK for 0041791234567 (via 00→+ shim)', () => {
    const r = parsePhoneStrict('0041791234567');
    assert.equal(r.parseStatus, 'PARSE_OK');
    assert.equal(r.normalizedE164, '+41791234567');
    assert.equal(r.country, 'CH');
  });

  it('PARSE_OK for DE +491711234567', () => {
    const r = parsePhoneStrict('+491711234567');
    assert.equal(r.parseStatus, 'PARSE_OK');
    assert.equal(r.normalizedE164, '+491711234567');
    assert.equal(r.country, 'DE');
  });

  it('PARSE_OK for DE 00491711234567 (via 00→+ shim)', () => {
    const r = parsePhoneStrict('00491711234567');
    assert.equal(r.parseStatus, 'PARSE_OK');
    assert.equal(r.normalizedE164, '+491711234567');
    assert.equal(r.country, 'DE');
  });

  it('PARSE_OK for AT +436641234567', () => {
    const r = parsePhoneStrict('+436641234567');
    assert.equal(r.parseStatus, 'PARSE_OK');
    assert.equal(r.normalizedE164, '+436641234567');
    assert.equal(r.country, 'AT');
  });

  it('Extension separated: +41 79 123 45 67 ext. 99', () => {
    const r = parsePhoneStrict('+41 79 123 45 67 ext. 99');
    assert.equal(r.parseStatus, 'PARSE_OK');
    assert.equal(r.normalizedE164, '+41791234567');
    assert.equal(r.extension, '99');
  });

  it('PARSE_OK_CHANNEL for whatsapp:+41791234567', () => {
    const r = parsePhoneStrict('whatsapp:+41791234567');
    assert.equal(r.parseStatus, 'PARSE_OK_CHANNEL');
    assert.equal(r.normalizedE164, '+41791234567');
  });
});

describe('parsePhoneStrict — invalid / ambiguous inputs', () => {
  it('MISSING_COUNTRY_CODE for Swiss national 0791234567', () => {
    const r = parsePhoneStrict('0791234567');
    assert.equal(r.parseStatus, 'MISSING_COUNTRY_CODE');
    assert.equal(r.normalizedE164, null);
  });

  it('MISSING_COUNTRY_CODE for DE national 01711234567', () => {
    const r = parsePhoneStrict('01711234567');
    assert.equal(r.parseStatus, 'MISSING_COUNTRY_CODE');
    assert.equal(r.normalizedE164, null);
  });

  it('MISSING_COUNTRY_CODE for AT national 06641234567', () => {
    const r = parsePhoneStrict('06641234567');
    assert.equal(r.parseStatus, 'MISSING_COUNTRY_CODE');
    assert.equal(r.normalizedE164, null);
  });

  it('BSUID_ONLY for whatsapp:CH.BSUID123ABC', () => {
    const r = parsePhoneStrict('whatsapp:CH.BSUID123ABC');
    assert.equal(r.parseStatus, 'BSUID_ONLY');
    assert.equal(r.normalizedE164, null);
  });

  it('NOT_A_NUMBER or error for "Call me +41791234567" with extract:false', () => {
    const r = parsePhoneStrict('Call me +41791234567');
    assert.notEqual(r.parseStatus, 'PARSE_OK');
    assert.notEqual(r.parseStatus, 'PARSE_OK_CHANNEL');
    assert.equal(r.normalizedE164, null);
  });

  it('NOT_A_NUMBER for empty string', () => {
    const r = parsePhoneStrict('');
    assert.equal(r.parseStatus, 'NOT_A_NUMBER');
    assert.equal(r.normalizedE164, null);
  });

  it('INVALID_COUNTRY or error for +999123', () => {
    const r = parsePhoneStrict('+999123');
    assert.notEqual(r.parseStatus, 'PARSE_OK');
    assert.notEqual(r.parseStatus, 'PARSE_OK_CHANNEL');
    assert.equal(r.normalizedE164, null);
  });

  it('TOO_SHORT (or error) for +41 1', () => {
    const r = parsePhoneStrict('+41 1');
    assert.notEqual(r.parseStatus, 'PARSE_OK');
    assert.equal(r.normalizedE164, null);
  });

  it('TOO_LONG (or error) for very long number', () => {
    const r = parsePhoneStrict('+41791234567891234567890');
    assert.notEqual(r.parseStatus, 'PARSE_OK');
    assert.equal(r.normalizedE164, null);
  });

  it('null input → NOT_A_NUMBER', () => {
    const r = parsePhoneStrict(null);
    assert.equal(r.parseStatus, 'NOT_A_NUMBER');
    assert.equal(r.normalizedE164, null);
  });

  it('undefined input → NOT_A_NUMBER', () => {
    const r = parsePhoneStrict(undefined);
    assert.equal(r.parseStatus, 'NOT_A_NUMBER');
    assert.equal(r.normalizedE164, null);
  });
});

describe('toE164Strict', () => {
  it('returns canonical E.164', () => {
    assert.equal(toE164Strict('+41 79 123 45 67'), '+41791234567');
    assert.equal(toE164Strict('whatsapp:+41791234567'), '+41791234567');
  });
  it('returns null on ambiguous / invalid', () => {
    assert.equal(toE164Strict('0791234567'), null);
    assert.equal(toE164Strict('whatsapp:CH.BSUID123ABC'), null);
    assert.equal(toE164Strict(''), null);
  });
});

describe('phoneEqualsStrict', () => {
  it('true for E.164 equivalents in different formats', () => {
    assert.equal(phoneEqualsStrict('+41 79 123 45 67', '0041791234567'), true);
    assert.equal(phoneEqualsStrict('whatsapp:+41791234567', '+41791234567'), true);
  });

  it('false for national-only format vs international', () => {
    // '0791234567' cannot be normalized at all → no match
    assert.equal(phoneEqualsStrict('0791234567', '+41791234567'), false);
  });

  it('false when either side is null/empty', () => {
    assert.equal(phoneEqualsStrict(null, '+41791234567'), false);
    assert.equal(phoneEqualsStrict('+41791234567', ''), false);
    assert.equal(phoneEqualsStrict('', ''), false);
  });
});

describe('maskPhoneForLog', () => {
  it('masks phone numbers, showing last 3 digits', () => {
    const m = maskPhoneForLog('+41791234567');
    assert.match(m, /\+?\d{0,3}\**\d{0,3}567$/);
    assert.notEqual(m, '+41791234567');
    assert.ok(m.endsWith('567'));
  });

  it('returns [redacted] when no digits present', () => {
    assert.equal(maskPhoneForLog('hello'), '[redacted]');
    assert.equal(maskPhoneForLog(''), '[redacted]');
    assert.equal(maskPhoneForLog(null), '[redacted]');
  });
});

describe('classifyParseError', () => {
  it('returns UNKNOWN_PARSE_ERROR for non-ParseError input', () => {
    assert.equal(classifyParseError(new Error('weird')), 'UNKNOWN_PARSE_ERROR');
    assert.equal(classifyParseError('string'), 'UNKNOWN_PARSE_ERROR');
    assert.equal(classifyParseError(null), 'UNKNOWN_PARSE_ERROR');
  });
});
