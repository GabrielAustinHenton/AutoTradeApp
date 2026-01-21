/**
 * Technical Indicators Service
 * Provides calculations for RSI, moving averages, and other indicators
 */

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Calculate Relative Strength Index (RSI)
 * RSI measures momentum on a scale of 0-100
 * - RSI > 70 = overbought (potential sell)
 * - RSI < 30 = oversold (potential buy)
 *
 * @param prices - Array of closing prices (oldest to newest)
 * @param period - RSI period (default 14)
 * @returns RSI value (0-100) or null if not enough data
 */
export function calculateRSI(prices: number[], period: number = 14): number | null {
  if (prices.length < period + 1) {
    return null;
  }

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  // Separate gains and losses
  const gains: number[] = [];
  const losses: number[] = [];
  for (const change of changes) {
    if (change > 0) {
      gains.push(change);
      losses.push(0);
    } else {
      gains.push(0);
      losses.push(Math.abs(change));
    }
  }

  // Calculate initial average gain/loss (simple average for first period)
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Calculate smoothed averages for remaining periods
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  // Calculate RS and RSI
  if (avgLoss === 0) {
    return 100; // No losses means maximum strength
  }

  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  return Math.round(rsi * 100) / 100; // Round to 2 decimals
}

/**
 * Calculate Simple Moving Average (SMA)
 * @param prices - Array of prices
 * @param period - SMA period
 * @returns SMA value or null if not enough data
 */
export function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period) {
    return null;
  }

  const relevantPrices = prices.slice(-period);
  const sum = relevantPrices.reduce((a, b) => a + b, 0);
  return sum / period;
}

/**
 * Calculate Exponential Moving Average (EMA)
 * @param prices - Array of prices
 * @param period - EMA period
 * @returns EMA value or null if not enough data
 */
export function calculateEMA(prices: number[], period: number): number | null {
  if (prices.length < period) {
    return null;
  }

  const multiplier = 2 / (period + 1);

  // Start with SMA for initial EMA
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Calculate EMA for remaining prices
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return Math.round(ema * 100) / 100;
}

/**
 * Calculate RSI from candle data
 * @param candles - Array of candles (oldest to newest)
 * @param period - RSI period (default 14)
 * @returns RSI value or null
 */
export function calculateRSIFromCandles(candles: Candle[], period: number = 14): number | null {
  const closePrices = candles.map(c => c.close);
  return calculateRSI(closePrices, period);
}

/**
 * Get RSI interpretation
 * @param rsi - RSI value
 * @returns Interpretation string
 */
export function getRSIInterpretation(rsi: number): {
  status: 'oversold' | 'neutral' | 'overbought';
  signal: 'buy' | 'neutral' | 'sell';
  description: string;
} {
  if (rsi <= 30) {
    return {
      status: 'oversold',
      signal: 'buy',
      description: 'RSI indicates oversold conditions - potential buying opportunity',
    };
  } else if (rsi >= 70) {
    return {
      status: 'overbought',
      signal: 'sell',
      description: 'RSI indicates overbought conditions - potential selling opportunity',
    };
  } else {
    return {
      status: 'neutral',
      signal: 'neutral',
      description: 'RSI is in neutral territory',
    };
  }
}
