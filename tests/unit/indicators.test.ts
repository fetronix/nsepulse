import { describe, expect, it } from 'vitest';
import { atr, ema, historicalVolatility, macd, rsi, sma } from '../../src/server/market/indicators.js';

describe('technical indicators use observation counts', () => {
  it('calculates simple moving average and refuses insufficient history', () => {
    expect(sma([1, 2, 3, 4], 3).value).toBe(3);
    expect(sma([1, 2], 3).value).toBeNull();
    expect(() => sma([1], 0)).toThrow();
  });
  it('calculates EMA with SMA seed', () => {
    expect(ema([1, 2, 3, 4], 3).value).toBeCloseTo(3);
    expect(ema([1, 2], 3).value).toBeNull();
  });
  it('handles flat/rising RSI and reports sample requirements', () => {
    expect(rsi([10, 10, 10, 10], 3).value).toBe(50);
    expect(rsi([10, 11, 12, 13], 3).value).toBe(100);
    expect(rsi([10, 11], 3).value).toBeNull();
  });
  it('calculates MACD with required signal history', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
    const result = macd(closes, 3, 6, 2);
    expect(result.macd).not.toBeNull();
    expect(result.histogram).toBeCloseTo(0);
    expect(macd([1, 2, 3], 2, 3, 2).macd).toBeNull();
  });
  it('uses true range and annualized sample log-return volatility', () => {
    const candles = [{ close: 10, high: 11, low: 9 }, { close: 11, high: 12, low: 10 }, { close: 12, high: 13, low: 11 }];
    expect(atr(candles, 2).value).toBe(2);
    expect(historicalVolatility([100, 101, 100]).value).toBeGreaterThan(0);
    expect(historicalVolatility([100, 100, 100]).value).toBe(0);
  });
});
