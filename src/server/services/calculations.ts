export interface DividendScenario {
  shares: number;
  dividendPerShare: number;
  taxRatePercent?: number;
}
export function calculateDividend(input: DividendScenario): {
  gross: number;
  estimatedTax: number | null;
  estimatedNet: number | null;
  warning: string;
} {
  if (
    !Number.isFinite(input.shares) ||
    input.shares < 0 ||
    !Number.isFinite(input.dividendPerShare) ||
    input.dividendPerShare < 0
  )
    throw new Error('Shares and dividend per share must be finite, non-negative values.');
  const gross = input.shares * input.dividendPerShare;
  if (input.taxRatePercent === undefined)
    return {
      gross,
      estimatedTax: null,
      estimatedNet: null,
      warning:
        'Illustrative gross amount only. Tax is not assumed; verify eligibility, withholding, fees and payment with official sources.'
    };
  if (!Number.isFinite(input.taxRatePercent) || input.taxRatePercent < 0 || input.taxRatePercent > 100)
    throw new Error('Tax rate must be from 0 to 100 percent.');
  const estimatedTax = (gross * input.taxRatePercent) / 100;
  return {
    gross,
    estimatedTax,
    estimatedNet: gross - estimatedTax,
    warning: 'Tax rate is a user-entered scenario, not tax advice or a verified Kenyan rate.'
  };
}
export function marketCapitalization(
  price: number | null,
  sharesOutstanding: number | null,
  priceAsOf: string | null,
  shareCountAsOf: string | null
) {
  if (
    price == null ||
    sharesOutstanding == null ||
    price <= 0 ||
    sharesOutstanding <= 0 ||
    !Number.isFinite(price) ||
    !Number.isFinite(sharesOutstanding) ||
    !priceAsOf ||
    !shareCountAsOf
  )
    return {
      value: null,
      reason: 'Requires valid share price, applicable shares outstanding, and timestamps for both inputs.'
    };
  return { value: price * sharesOutstanding, priceAsOf, shareCountAsOf, currency: 'KES' as const };
}
export function marketCapShare(
  companyMarketCap: number | null,
  universeMarketCap: number | null,
  universeName: string
) {
  if (companyMarketCap == null || universeMarketCap == null || companyMarketCap < 0 || universeMarketCap <= 0)
    return {
      percent: null,
      reason: 'Reliable market capitalizations are required; missing data is not treated as zero.'
    };
  return { percent: (companyMarketCap / universeMarketCap) * 100, universe: universeName };
}
export interface ResearchComponents {
  quality: number | null;
  earnings: number | null;
  valuation: number | null;
  dividend: number | null;
  technical: number | null;
  liquidity: number | null;
  risk: number | null;
  freshness: number | null;
}
export type ResearchWeights = Record<keyof ResearchComponents, number>;
export function scoreResearch(components: ResearchComponents, weights: ResearchWeights) {
  const entries = Object.entries(components) as [keyof ResearchComponents, number | null][];
  const weightSum = entries.reduce(
    (sum, [key]) => sum + (Number.isFinite(weights[key]) && weights[key] > 0 ? weights[key] : 0),
    0
  );
  if (!weightSum) throw new Error('At least one positive research weight is required.');
  let availableWeight = 0;
  let weightedTotal = 0;
  const missing: string[] = [];
  for (const [key, value] of entries) {
    const weight = Math.max(0, Number.isFinite(weights[key]) ? weights[key] : 0);
    if (value == null || !Number.isFinite(value) || value < 0 || value > 100) {
      if (weight > 0) missing.push(key);
      continue;
    }
    weightedTotal += value * weight;
    availableWeight += weight;
  }
  return {
    score: availableWeight ? weightedTotal / weightSum : null,
    availableWeightPercent: (availableWeight / weightSum) * 100,
    missingComponents: missing,
    methodology:
      'Weighted 0–100 components; unavailable inputs retain their weight as a missing-data penalty (the score is not renormalized). Research aid, not an objective truth.'
  };
}
export type AlertCondition = {
  type: 'PRICE_ABOVE' | 'PRICE_BELOW' | 'PERCENT_CHANGE_ABOVE' | 'RSI_ABOVE' | 'RSI_BELOW';
  threshold: number;
};
export function evaluateAlert(
  condition: AlertCondition,
  observation: { price?: number | null; percentChange?: number | null; rsi?: number | null }
): { triggered: boolean; observed: number | null; reason: string } {
  const key = condition.type.startsWith('PRICE')
    ? 'price'
    : condition.type.startsWith('PERCENT')
      ? 'percentChange'
      : 'rsi';
  const value = observation[key];
  if (value == null || !Number.isFinite(value))
    return { triggered: false, observed: null, reason: `Required ${key} value is unavailable.` };
  const triggered = condition.type.endsWith('ABOVE') ? value >= condition.threshold : value <= condition.threshold;
  return {
    triggered,
    observed: value,
    reason: triggered
      ? `${key} ${value} met rule ${condition.type} ${condition.threshold}.`
      : `${key} ${value} did not meet rule ${condition.type} ${condition.threshold}.`
  };
}
export interface PaperTransaction {
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  fees?: number;
}
export function calculatePaperPosition(transactions: PaperTransaction[], currentPrice: number | null) {
  let shares = 0,
    cashFlow = 0,
    fees = 0,
    realized = 0;
  for (const tx of transactions) {
    if (
      !Number.isFinite(tx.quantity) ||
      tx.quantity <= 0 ||
      !Number.isFinite(tx.price) ||
      tx.price < 0 ||
      (tx.fees ?? 0) < 0
    )
      throw new Error('Paper transactions require valid positive quantity, non-negative price and fees.');
    const fee = tx.fees ?? 0;
    fees += fee;
    if (tx.side === 'BUY') {
      shares += tx.quantity;
      cashFlow += tx.quantity * tx.price + fee;
    } else {
      if (tx.quantity > shares) throw new Error('Cannot sell more shares than the hypothetical position holds.');
      const averageCost = shares ? cashFlow / shares : 0;
      realized += tx.quantity * (tx.price - averageCost) - fee;
      shares -= tx.quantity;
      cashFlow -= tx.quantity * averageCost;
    }
  }
  const marketValue =
    currentPrice != null && Number.isFinite(currentPrice) && currentPrice > 0 ? shares * currentPrice : null;
  const unrealized = marketValue == null ? null : marketValue - cashFlow;
  return {
    shares,
    costBasis: cashFlow,
    fees,
    realized,
    marketValue,
    unrealized,
    currentPriceAvailable: marketValue != null,
    note:
      marketValue == null
        ? 'Current valuation unavailable without a supported current price.'
        : 'Paper-only estimate; excludes any unmodelled fees, taxes and corporate actions.'
  };
}
