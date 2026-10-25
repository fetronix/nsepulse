import { describe, expect, it } from 'vitest';
import {
  calculateDividend,
  calculatePaperPosition,
  evaluateAlert,
  marketCapitalization,
  marketCapShare,
  scoreResearch,
  type ResearchComponents,
  type ResearchWeights
} from '../../src/server/services/calculations.js';

const fullWeights: ResearchWeights = {
  quality: 1,
  earnings: 1,
  valuation: 1,
  dividend: 1,
  technical: 1,
  liquidity: 1,
  risk: 1,
  freshness: 1
};
const fullComponents: ResearchComponents = {
  quality: 80,
  earnings: 70,
  valuation: 60,
  dividend: 50,
  technical: 40,
  liquidity: 30,
  risk: 20,
  freshness: 10
};

describe('dividend scenarios', () => {
  it('calculates gross dividend without silently assuming tax', () => {
    expect(calculateDividend({ shares: 100, dividendPerShare: 2.5 })).toMatchObject({
      gross: 250,
      estimatedTax: null,
      estimatedNet: null
    });
  });

  it('applies a user-supplied tax rate as a scenario only', () => {
    const result = calculateDividend({ shares: 100, dividendPerShare: 2.5, taxRatePercent: 10 });
    expect(result).toMatchObject({ gross: 250, estimatedTax: 25, estimatedNet: 225 });
    expect(result.warning).toContain('not tax advice');
  });

  it('accepts boundary tax rates and zero values', () => {
    expect(calculateDividend({ shares: 10, dividendPerShare: 1, taxRatePercent: 0 }).estimatedNet).toBe(10);
    expect(calculateDividend({ shares: 10, dividendPerShare: 1, taxRatePercent: 100 }).estimatedNet).toBe(0);
    expect(calculateDividend({ shares: 0, dividendPerShare: 5 }).gross).toBe(0);
    expect(calculateDividend({ shares: 10, dividendPerShare: 0 }).gross).toBe(0);
  });

  it('keeps fractional results unrounded and rejects invalid input', () => {
    expect(calculateDividend({ shares: 3, dividendPerShare: 0.333_333 }).gross).toBeCloseTo(0.999_999, 10);
    expect(() => calculateDividend({ shares: -1, dividendPerShare: 1 })).toThrow(/non-negative/);
    expect(() => calculateDividend({ shares: Number.NaN, dividendPerShare: 1 })).toThrow(/non-negative/);
    expect(() => calculateDividend({ shares: 1, dividendPerShare: Number.POSITIVE_INFINITY })).toThrow(/non-negative/);
    expect(() => calculateDividend({ shares: 10, dividendPerShare: 1, taxRatePercent: -1 })).toThrow(/0 to 100/);
    expect(() => calculateDividend({ shares: 10, dividendPerShare: 1, taxRatePercent: 101 })).toThrow(/0 to 100/);
  });
});

describe('market capitalisation', () => {
  it('requires timestamped share count and price', () => {
    expect(marketCapitalization(10, 1_000_000, '2026-01-01', '2025-12-31')).toMatchObject({
      value: 10_000_000,
      currency: 'KES',
      priceAsOf: '2026-01-01',
      shareCountAsOf: '2025-12-31'
    });
  });

  it('refuses to compute from missing, zero or non-finite inputs', () => {
    for (const failure of [
      marketCapitalization(null, 1_000, '2026-01-01', '2026-01-01'),
      marketCapitalization(10, null, '2026-01-01', '2026-01-01'),
      marketCapitalization(0, 1_000, '2026-01-01', '2026-01-01'),
      marketCapitalization(10, 0, '2026-01-01', '2026-01-01'),
      marketCapitalization(Number.NaN, 1_000, '2026-01-01', '2026-01-01'),
      marketCapitalization(10, 1_000, null, '2026-01-01'),
      marketCapitalization(10, 1_000, '2026-01-01', null)
    ]) {
      expect(failure.value).toBeNull();
      expect(failure.reason).toContain('Requires valid share price');
    }
  });

  it('computes an index share without treating missing data as zero', () => {
    expect(marketCapShare(25, 100, 'NSE 20')).toEqual({ percent: 25, universe: 'NSE 20' });
    expect(marketCapShare(0, 100, 'NSE 20').percent).toBe(0);
    expect(marketCapShare(null, 100, 'NSE 20').percent).toBeNull();
    expect(marketCapShare(25, null, 'NSE 20').reason).toContain('missing data is not treated as zero');
    expect(marketCapShare(25, 0, 'NSE 20').percent).toBeNull();
    expect(marketCapShare(-1, 100, 'NSE 20').percent).toBeNull();
  });
});

describe('weighted research scorecard', () => {
  it('returns the weighted average when every component is available', () => {
    const result = scoreResearch(fullComponents, fullWeights);
    expect(result.score).toBe(45);
    expect(result.availableWeightPercent).toBe(100);
    expect(result.missingComponents).toEqual([]);
  });

  it('penalises missing components instead of renormalising', () => {
    const result = scoreResearch(
      {
        ...fullComponents,
        earnings: null,
        valuation: null,
        dividend: null,
        technical: null,
        liquidity: null,
        risk: null,
        freshness: null
      },
      fullWeights
    );
    expect(result.score).toBe(10);
    expect(result.availableWeightPercent).toBe(12.5);
    expect(result.missingComponents).toContain('earnings');
  });

  it('ignores zero-weight components when listing missing data', () => {
    const weights = { ...fullWeights, quality: 0 };
    const result = scoreResearch({ ...fullComponents, quality: null }, weights);
    expect(result.missingComponents).not.toContain('quality');
    expect(result.availableWeightPercent).toBe(100);
  });

  it('treats out-of-range and non-finite components as unavailable', () => {
    const result = scoreResearch({ ...fullComponents, quality: 101, earnings: -1, valuation: Number.NaN }, fullWeights);
    expect(result.missingComponents).toEqual(expect.arrayContaining(['quality', 'earnings', 'valuation']));
  });

  it('rejects a weight set with no positive weight', () => {
    const zero = Object.fromEntries(Object.keys(fullWeights).map((key) => [key, 0])) as ResearchWeights;
    expect(() => scoreResearch(fullComponents, zero)).toThrow(/positive research weight/);
    const negative = { ...fullWeights, quality: -5 };
    expect(negative.quality).toBe(-5);
  });
});

describe('alert conditions', () => {
  it('evaluates price thresholds inclusively', () => {
    expect(evaluateAlert({ type: 'PRICE_ABOVE', threshold: 10 }, { price: 10 }).triggered).toBe(true);
    expect(evaluateAlert({ type: 'PRICE_ABOVE', threshold: 10 }, { price: 9.99 })).toMatchObject({
      triggered: false,
      observed: 9.99
    });
    expect(evaluateAlert({ type: 'PRICE_BELOW', threshold: 10 }, { price: 10 }).triggered).toBe(true);
  });

  it('evaluates percentage and RSI rules against the correct field', () => {
    expect(evaluateAlert({ type: 'PERCENT_CHANGE_ABOVE', threshold: 2 }, { percentChange: 2.5 }).triggered).toBe(true);
    expect(evaluateAlert({ type: 'RSI_BELOW', threshold: 30 }, { rsi: 25 }).triggered).toBe(true);
    expect(evaluateAlert({ type: 'RSI_ABOVE', threshold: 70 }, { rsi: 75 }).reason).toContain('met rule RSI_ABOVE 70');
  });

  it('refuses to evaluate without the required value', () => {
    const result = evaluateAlert({ type: 'RSI_BELOW', threshold: 30 }, {});
    expect(result).toMatchObject({ triggered: false, observed: null });
    expect(result.reason).toContain('Required rsi value is unavailable');
    expect(evaluateAlert({ type: 'PRICE_ABOVE', threshold: 1 }, { price: Number.NaN }).triggered).toBe(false);
  });
});

describe('hypothetical paper positions', () => {
  it('tracks shares, cost basis and realised gain', () => {
    expect(
      calculatePaperPosition(
        [
          { side: 'BUY', quantity: 4, price: 10, fees: 2 },
          { side: 'SELL', quantity: 1, price: 15 }
        ],
        12
      )
    ).toMatchObject({ shares: 3, marketValue: 36, realized: 4.5, fees: 2 });
  });

  it('reports valuation as unavailable without a supported current price', () => {
    const result = calculatePaperPosition([{ side: 'BUY', quantity: 2, price: 5 }], null);
    expect(result).toMatchObject({ shares: 2, marketValue: null, unrealized: null, currentPriceAvailable: false });
    expect(result.note).toContain('Current valuation unavailable');
    expect(calculatePaperPosition([{ side: 'BUY', quantity: 2, price: 5 }], 0).marketValue).toBeNull();
  });

  it('tracks an empty position and unrealised loss', () => {
    expect(calculatePaperPosition([], 10)).toMatchObject({ shares: 0, costBasis: 0, marketValue: 0 });
    expect(calculatePaperPosition([{ side: 'BUY', quantity: 2, price: 10 }], 5).unrealized).toBe(-10);
  });

  it('rejects impossible and malformed transactions', () => {
    expect(() => calculatePaperPosition([{ side: 'SELL', quantity: 1, price: 10 }], 10)).toThrow(/more shares/);
    expect(() => calculatePaperPosition([{ side: 'BUY', quantity: 0, price: 10 }], 10)).toThrow(/positive quantity/);
    expect(() => calculatePaperPosition([{ side: 'BUY', quantity: 1, price: -1 }], 10)).toThrow(/non-negative price/);
    expect(() => calculatePaperPosition([{ side: 'BUY', quantity: 1, price: 1, fees: -1 }], 10)).toThrow(/fees/);
  });
});
