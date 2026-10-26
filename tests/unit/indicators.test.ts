import { describe, expect, it } from 'vitest';
import { atr, ema, historicalVolatility, macd, rsi, sma } from '../../src/server/market/indicators.js';

describe('simple moving average', () => {
  it('averages the most recent window', () => {
    expect(sma([1, 2, 3, 4], 3).value).toBe(3);
    expect(sma([1, 2, 3, 4], 4).value).toBe(2.5);
    expect(sma([5], 1).value).toBe(5);
  });

  it('refuses insufficient and invalid history', () => {
    expect(sma([1, 2], 3).value).toBeNull();
    expect(sma([1, 2], 3).reason).toBe('Requires 3 observations; received 2');
    expect(sma([1, Number.NaN], 2).reason).toBe('Invalid input values');
    expect(() => sma([1], 0)).toThrow(/positive integer/);
    expect(() => sma([1], 1.5)).toThrow(/positive integer/);
  });
});

describe('exponential moving average', () => {
  it('uses an SMA seed and then weights new values', () => {
    expect(ema([1, 2, 3, 4], 3).value).toBeCloseTo(3);
    expect(ema([10, 10, 10, 10], 3).value).toBe(10);
  });

  it('refuses insufficient and invalid history', () => {
    expect(ema([1, 2], 3).value).toBeNull();
    expect(ema([1, Number.POSITIVE_INFINITY], 2).reason).toBe('Invalid input values');
    expect(() => ema([1], -1)).toThrow(/positive integer/);
  });
});

describe('relative strength index', () => {
  it('reports flat, rising and falling markets', () => {
    expect(rsi([10, 10, 10, 10], 3).value).toBe(50);
    expect(rsi([10, 11, 12, 13], 3).value).toBe(100);
    expect(rsi([13, 12, 11, 10], 3).value).toBe(0);
  });

  it('reports the classical 14-period default and sample requirements', () => {
    const closes = Array.from({ length: 20 }, (_, index) => 100 + Math.sin(index) * 5);
    const value = rsi(closes).value;
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(100);
    expect(rsi([10, 11], 3).reason).toContain('Requires 4 closes');
    expect(rsi([10, Number.NaN, 12, 13], 3).reason).toBe('Invalid input values');
    expect(() => rsi([1], 0)).toThrow(/positive integer/);
  });
});

describe('MACD', () => {
  it('calculates the line, signal and histogram with sufficient history', () => {
    const closes = Array.from({ length: 40 }, (_, index) => 100 + index);
    const result = macd(closes, 3, 6, 2);
    expect(result.macd).not.toBeNull();
    expect(result.signal).not.toBeNull();
    expect(result.histogram).toBeCloseTo(0);
  });

  it('returns nulls with a reason when history is short', () => {
    const result = macd([1, 2, 3], 2, 3, 2);
    expect(result).toMatchObject({ macd: null, signal: null, histogram: null });
    expect(result.reason).toContain('Requires at least 4 closes');
  });

  it('rejects an invalid fast/slow ordering', () => {
    expect(() => macd([1, 2, 3], 5, 5)).toThrow(/fast period must be smaller/);
  });
});

describe('average true range', () => {
  const candles = [
    { close: 10, high: 11, low: 9 },
    { close: 11, high: 12, low: 10 },
    { close: 12, high: 13, low: 11 }
  ];

  it('uses true range including gaps', () => {
    expect(atr(candles, 2).value).toBe(2);
    expect(atr([...candles, { close: 20, high: 21, low: 19 }], 3).value).toBeGreaterThan(0);
  });

  it('explains missing high/low data and short windows', () => {
    expect(atr([{ close: 10 }, { close: 11 }], 1).reason).toBe('Missing or invalid high/low/close data');
    expect(atr([candles[0]!], 2).reason).toContain('Requires 3 candles');
  });
});

describe('historical volatility', () => {
  it('annualizes the sample standard deviation of log returns', () => {
    expect(historicalVolatility([100, 101, 100]).value).toBeGreaterThan(0);
    expect(historicalVolatility([100, 100, 100]).value).toBe(0);
    const low = historicalVolatility([100, 100.1, 100.2], 252).value!;
    const high = historicalVolatility([100, 110, 100], 252).value!;
    expect(high).toBeGreaterThan(low);
  });

  it('refuses short series and non-positive closes', () => {
    expect(historicalVolatility([100, 101]).reason).toContain('at least 3 closes');
    expect(historicalVolatility([100, 0, 100]).reason).toBe('Closes must be finite and positive');
  });
});
