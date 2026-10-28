import { describe, expect, it } from 'vitest';
import { formatSetupTime, statusTone } from '../../src/client/ui/components/status.js';

/**
 * The status vocabulary on the provider screens.
 *
 * These are small functions, but they decide what an operator reads as "fine" at a glance,
 * so the rule that matters most is the last one: anything unrecognised stays neutral.
 */
describe('statusTone', () => {
  it('marks verified states as positive', () => {
    for (const value of ['READY', 'PASSED', 'AVAILABLE', 'GRANTED', 'SATISFIED', 'CONFIGURED']) {
      expect(statusTone(value), value).toBe('green-pill');
    }
  });

  it('marks missing configuration as attention, not success', () => {
    for (const value of ['UNCONFIGURED', 'NOT_RUN', 'MISSING', 'NOT_CONFIGURED', 'DISABLED']) {
      expect(statusTone(value), value).toBe('amber-pill');
    }
  });

  it('marks blocked and demo states as muted rather than healthy', () => {
    for (const value of ['DEMO', 'BLOCKED', 'PERMISSION_BLOCKED', 'STORE_UNAVAILABLE', 'UNCONFIRMED']) {
      expect(statusTone(value), value).toBe('muted-pill');
    }
  });

  it('marks failures as negative', () => {
    expect(statusTone('ERROR')).toBe('red-pill');
    expect(statusTone('FAILED')).toBe('red-pill');
  });

  it('leaves an unknown status neutral instead of guessing', () => {
    expect(statusTone('SOMETHING_NEW')).toBe('muted-pill');
    expect(statusTone('')).toBe('muted-pill');
  });
});

describe('formatSetupTime', () => {
  it('says "Never recorded" for an absent value', () => {
    expect(formatSetupTime(null)).toBe('Never recorded');
    expect(formatSetupTime(undefined)).toBe('Never recorded');
    expect(formatSetupTime('')).toBe('Never recorded');
  });

  it('renders an ISO timestamp in Nairobi time', () => {
    const formatted = formatSetupTime('2026-01-05T09:00:00.000Z');
    expect(formatted).toContain('EAT');
    expect(formatted).toContain('2026');
    // 09:00 UTC is 12:00 in Nairobi (UTC+3).
    expect(formatted).toMatch(/12:00/);
  });

  it('flags an unparseable timestamp rather than showing one', () => {
    expect(formatSetupTime('not-a-date')).toBe('Invalid timestamp');
  });
});
