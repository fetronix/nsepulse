import type { MarketObservation, ValidationStatus } from '../../shared/domain.js';

export interface RawObservation extends Omit<MarketObservation, 'validationStatus'> { validationStatus?: ValidationStatus }
export interface QualityResult { accepted: boolean; observation: MarketObservation | null; reasons: string[] }

/** Validate payloads conservatively. Unknown timing remains UNKNOWN rather than inferred as live. */
export function validateObservation(input: RawObservation, now = new Date()): QualityResult {
  const reasons: string[] = [];
  const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (!input.securityId || !input.symbol) reasons.push('Missing security identity');
  if (!positive(input.price)) reasons.push('Price must be a finite positive number');
  if (input.currency !== 'KES') reasons.push('Unexpected currency; expected KES');
  if (!input.source?.trim()) reasons.push('Source is required');
  const ingested = new Date(input.ingestedAt);
  if (!Number.isFinite(ingested.getTime()) || ingested.getTime() > now.getTime() + 5 * 60_000) reasons.push('Invalid or future ingestion timestamp');
  for (const field of ['marketEventAt', 'publishedAt'] as const) {
    if (input[field] && !Number.isFinite(new Date(input[field]!).getTime())) reasons.push(`Invalid ${field} timestamp`);
  }
  if (input.volume != null && (!Number.isFinite(input.volume) || input.volume < 0)) reasons.push('Volume must be non-negative');
  for (const field of ['open', 'high', 'low', 'previousClose'] as const) {
    const value = input[field];
    if (value != null && (!Number.isFinite(value) || value <= 0)) reasons.push(`${field} must be positive`);
  }
  if (input.high != null && input.low != null && input.high < input.low) reasons.push('High is lower than low');
  const accepted = reasons.length === 0;
  return { accepted, observation: accepted ? { ...input, validationStatus: 'UNVERIFIED' } : null, reasons };
}

export function isStale(observedAt: string | null, now = new Date(), maxAgeMs = 24 * 60 * 60_000): boolean {
  if (!observedAt) return true;
  const time = new Date(observedAt).getTime();
  return !Number.isFinite(time) || time > now.getTime() || now.getTime() - time > maxAgeMs;
}
