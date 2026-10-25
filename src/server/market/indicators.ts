export interface Candle { close: number; high?: number; low?: number; volume?: number; timestamp?: string }
export interface IndicatorPoint { value: number | null; reason?: string }
const valid = (values: number[]) => values.every((v) => Number.isFinite(v));

export function sma(values: number[], period: number): IndicatorPoint {
  if (!Number.isInteger(period) || period < 1) throw new Error('period must be a positive integer');
  if (!valid(values)) return { value: null, reason: 'Invalid input values' };
  if (values.length < period) return { value: null, reason: `Requires ${period} observations; received ${values.length}` };
  const slice = values.slice(-period);
  return { value: slice.reduce((sum, x) => sum + x, 0) / period };
}
export function ema(values: number[], period: number): IndicatorPoint {
  if (!Number.isInteger(period) || period < 1) throw new Error('period must be a positive integer');
  if (!valid(values)) return { value: null, reason: 'Invalid input values' };
  if (values.length < period) return { value: null, reason: `Requires ${period} observations; received ${values.length}` };
  let result = values.slice(0, period).reduce((s, x) => s + x, 0) / period;
  const multiplier = 2 / (period + 1);
  for (const value of values.slice(period)) result = value * multiplier + result * (1 - multiplier);
  return { value: result };
}
export function rsi(closes: number[], period = 14): IndicatorPoint {
  if (!Number.isInteger(period) || period < 1) throw new Error('period must be a positive integer');
  if (!valid(closes)) return { value: null, reason: 'Invalid input values' };
  if (closes.length < period + 1) return { value: null, reason: `Requires ${period + 1} closes; received ${closes.length}` };
  const diffs = closes.slice(1).map((x, i) => x - closes[i]!);
  let gains = diffs.slice(0, period).reduce((s, x) => s + Math.max(x, 0), 0) / period;
  let losses = diffs.slice(0, period).reduce((s, x) => s + Math.max(-x, 0), 0) / period;
  for (const d of diffs.slice(period)) { gains = (gains * (period - 1) + Math.max(d, 0)) / period; losses = (losses * (period - 1) + Math.max(-d, 0)) / period; }
  if (losses === 0) return { value: gains === 0 ? 50 : 100 };
  return { value: 100 - 100 / (1 + gains / losses) };
}
export function macd(closes: number[], fast = 12, slow = 26, signal = 9): { macd: number | null; signal: number | null; histogram: number | null; reason?: string } {
  if (fast >= slow) throw new Error('fast period must be smaller than slow period');
  if (closes.length < slow + signal - 1) return { macd: null, signal: null, histogram: null, reason: `Requires at least ${slow + signal - 1} closes` };
  const line: number[] = [];
  for (let end = slow; end <= closes.length; end++) {
    const slice = closes.slice(0, end);
    const fastEma = ema(slice, fast).value!;
    const slowEma = ema(slice, slow).value!;
    line.push(fastEma - slowEma);
  }
  const signalLine = ema(line, signal).value;
  const value = line.at(-1)!;
  return { macd: value, signal: signalLine, histogram: signalLine == null ? null : value - signalLine };
}
export function atr(candles: Candle[], period = 14): IndicatorPoint {
  if (candles.length < period + 1) return { value: null, reason: `Requires ${period + 1} candles` };
  if (candles.some(c => !Number.isFinite(c.high) || !Number.isFinite(c.low) || !Number.isFinite(c.close))) return { value: null, reason: 'Missing or invalid high/low/close data' };
  const tr = candles.slice(1).map((c, i) => Math.max(c.high! - c.low!, Math.abs(c.high! - candles[i]!.close), Math.abs(c.low! - candles[i]!.close)));
  let result = tr.slice(0, period).reduce((s, x) => s + x, 0) / period;
  for (const value of tr.slice(period)) result = (result * (period - 1) + value) / period;
  return { value: result };
}
export function historicalVolatility(closes: number[], periodsPerYear = 252): IndicatorPoint {
  if (closes.length < 3) return { value: null, reason: 'Requires at least 3 closes' };
  if (closes.some(x => !Number.isFinite(x) || x <= 0)) return { value: null, reason: 'Closes must be finite and positive' };
  const returns = closes.slice(1).map((x, i) => Math.log(x / closes[i]!));
  const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
  const variance = returns.reduce((s, x) => s + (x - mean) ** 2, 0) / (returns.length - 1);
  return { value: Math.sqrt(variance * periodsPerYear) };
}
