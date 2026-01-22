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

/**
 * MACD (Moving Average Convergence Divergence) Result
 */
export interface MACDResult {
  macdLine: number;      // MACD Line = 12 EMA - 26 EMA
  signalLine: number;    // Signal Line = 9 EMA of MACD Line
  histogram: number;     // Histogram = MACD Line - Signal Line
  previousMacdLine?: number;
  previousSignalLine?: number;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * MACD is a trend-following momentum indicator that shows the relationship
 * between two moving averages of a security's price.
 *
 * Standard settings: 12-period EMA, 26-period EMA, 9-period signal
 *
 * Trading signals:
 * - Bullish crossover: MACD crosses above signal line = BUY
 * - Bearish crossover: MACD crosses below signal line = SELL
 * - Histogram positive and growing = bullish momentum
 * - Histogram negative and shrinking = bearish momentum
 *
 * @param prices - Array of closing prices (oldest to newest)
 * @param fastPeriod - Fast EMA period (default 12)
 * @param slowPeriod - Slow EMA period (default 26)
 * @param signalPeriod - Signal line EMA period (default 9)
 * @returns MACD result or null if not enough data
 */
export function calculateMACD(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult | null {
  // Need at least slowPeriod + signalPeriod prices for reliable MACD
  const minPrices = slowPeriod + signalPeriod;
  if (prices.length < minPrices) {
    return null;
  }

  // Calculate EMA helper that returns all EMA values
  const calculateEMASequence = (data: number[], period: number): number[] => {
    const multiplier = 2 / (period + 1);
    const emaValues: number[] = [];

    // Start with SMA for initial EMA
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    emaValues.push(ema);

    // Calculate EMA for remaining prices
    for (let i = period; i < data.length; i++) {
      ema = (data[i] - ema) * multiplier + ema;
      emaValues.push(ema);
    }

    return emaValues;
  };

  // Calculate fast and slow EMAs
  const fastEMAs = calculateEMASequence(prices, fastPeriod);
  const slowEMAs = calculateEMASequence(prices, slowPeriod);

  // Calculate MACD line (fast EMA - slow EMA)
  // We need to align them - slowEMAs starts at index slowPeriod-1 of prices
  // fastEMAs starts at index fastPeriod-1 of prices
  const macdValues: number[] = [];
  const offset = slowPeriod - fastPeriod;

  for (let i = 0; i < slowEMAs.length; i++) {
    const fastIdx = i + offset;
    if (fastIdx >= 0 && fastIdx < fastEMAs.length) {
      macdValues.push(fastEMAs[fastIdx] - slowEMAs[i]);
    }
  }

  if (macdValues.length < signalPeriod) {
    return null;
  }

  // Calculate signal line (9 EMA of MACD)
  const signalEMAs = calculateEMASequence(macdValues, signalPeriod);

  // Get current and previous values
  const currentMacd = macdValues[macdValues.length - 1];
  const previousMacd = macdValues.length > 1 ? macdValues[macdValues.length - 2] : undefined;
  const currentSignal = signalEMAs[signalEMAs.length - 1];
  const previousSignal = signalEMAs.length > 1 ? signalEMAs[signalEMAs.length - 2] : undefined;
  const histogram = currentMacd - currentSignal;

  return {
    macdLine: Math.round(currentMacd * 10000) / 10000,
    signalLine: Math.round(currentSignal * 10000) / 10000,
    histogram: Math.round(histogram * 10000) / 10000,
    previousMacdLine: previousMacd !== undefined ? Math.round(previousMacd * 10000) / 10000 : undefined,
    previousSignalLine: previousSignal !== undefined ? Math.round(previousSignal * 10000) / 10000 : undefined,
  };
}

/**
 * Detect MACD crossover signal
 * @param macd - MACD result
 * @returns Crossover signal or null if no crossover
 */
export function detectMACDCrossover(macd: MACDResult): {
  type: 'bullish' | 'bearish';
  signal: 'buy' | 'sell';
  description: string;
} | null {
  if (macd.previousMacdLine === undefined || macd.previousSignalLine === undefined) {
    return null;
  }

  const wasBelowSignal = macd.previousMacdLine < macd.previousSignalLine;
  const isAboveSignal = macd.macdLine > macd.signalLine;

  const wasAboveSignal = macd.previousMacdLine > macd.previousSignalLine;
  const isBelowSignal = macd.macdLine < macd.signalLine;

  // Bullish crossover: MACD crosses above signal line
  if (wasBelowSignal && isAboveSignal) {
    return {
      type: 'bullish',
      signal: 'buy',
      description: 'MACD crossed above signal line - bullish momentum',
    };
  }

  // Bearish crossover: MACD crosses below signal line
  if (wasAboveSignal && isBelowSignal) {
    return {
      type: 'bearish',
      signal: 'sell',
      description: 'MACD crossed below signal line - bearish momentum',
    };
  }

  return null;
}

/**
 * Get MACD interpretation for display
 * @param macd - MACD result
 * @returns Interpretation with status and description
 */
export function getMACDInterpretation(macd: MACDResult): {
  trend: 'bullish' | 'bearish' | 'neutral';
  momentum: 'strengthening' | 'weakening' | 'neutral';
  description: string;
} {
  const trend = macd.histogram > 0 ? 'bullish' : macd.histogram < 0 ? 'bearish' : 'neutral';

  // Check if histogram is growing or shrinking (momentum)
  let momentum: 'strengthening' | 'weakening' | 'neutral' = 'neutral';
  if (macd.previousMacdLine !== undefined && macd.previousSignalLine !== undefined) {
    const previousHistogram = macd.previousMacdLine - macd.previousSignalLine;
    if (Math.abs(macd.histogram) > Math.abs(previousHistogram)) {
      momentum = 'strengthening';
    } else if (Math.abs(macd.histogram) < Math.abs(previousHistogram)) {
      momentum = 'weakening';
    }
  }

  let description = '';
  if (trend === 'bullish') {
    description = momentum === 'strengthening'
      ? 'Bullish trend with strengthening momentum'
      : momentum === 'weakening'
      ? 'Bullish trend but momentum weakening'
      : 'Bullish trend';
  } else if (trend === 'bearish') {
    description = momentum === 'strengthening'
      ? 'Bearish trend with strengthening momentum'
      : momentum === 'weakening'
      ? 'Bearish trend but momentum weakening'
      : 'Bearish trend';
  } else {
    description = 'Neutral - no clear trend';
  }

  return { trend, momentum, description };
}
