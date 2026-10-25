import { describe, expect, it } from 'vitest';
import { calculateDividend, calculatePaperPosition, evaluateAlert, marketCapitalization, scoreResearch } from '../../src/server/services/calculations.js';

describe('transparent research calculations', () => {
  it('calculates gross dividend without silently assuming tax', () => {
    expect(calculateDividend({ shares: 100, dividendPerShare: 2.5 })).toMatchObject({ gross: 250, estimatedTax: null, estimatedNet: null });
    expect(calculateDividend({ shares: 100, dividendPerShare: 2.5, taxRatePercent: 10 }).estimatedNet).toBe(225);
    expect(() => calculateDividend({ shares: 10, dividendPerShare: 1, taxRatePercent: 101 })).toThrow();
  });
  it('requires timestamped share count and price for market cap', () => {
    expect(marketCapitalization(10, 1_000_000, '2026-01-01', '2025-12-31').value).toBe(10_000_000);
    expect(marketCapitalization(10, null, null, null).value).toBeNull();
  });
  it('penalizes missing score components instead of renormalizing', () => {
    const weights = { quality: 1, earnings: 1, valuation: 1, dividend: 1, technical: 1, liquidity: 1, risk: 1, freshness: 1 };
    const result = scoreResearch({ quality: 80, earnings: null, valuation: null, dividend: null, technical: null, liquidity: null, risk: null, freshness: null }, weights);
    expect(result.score).toBe(10);
    expect(result.availableWeightPercent).toBe(12.5);
    expect(result.missingComponents).toContain('earnings');
  });
  it('evaluates alert rules only with available values', () => {
    expect(evaluateAlert({ type: 'PRICE_ABOVE', threshold: 10 }, { price: 11 }).triggered).toBe(true);
    expect(evaluateAlert({ type: 'RSI_BELOW', threshold: 30 }, {}).reason).toContain('unavailable');
  });
  it('tracks hypothetical transactions and refuses impossible sales', () => {
    expect(calculatePaperPosition([{ side: 'BUY', quantity: 4, price: 10, fees: 2 }, { side: 'SELL', quantity: 1, price: 15 }], 12)).toMatchObject({ shares: 3, marketValue: 36, realized: 4.5 });
    expect(() => calculatePaperPosition([{ side: 'SELL', quantity: 1, price: 10 }], 10)).toThrow();
  });
});
