/**
 * Technical Indicators
 */

export interface OHLCData {
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Calculate RSI (Relative Strength Index)
 * @param data - Array of OHLC data
 * @param period - RSI period (default 14)
 * @returns Array of RSI values (null for periods where RSI can't be calculated)
 */
export function calculateRSI(data: OHLCData[], period: number = 14): (number | null)[] {
  if (data.length < period + 1) {
    return data.map(() => null);
  }

  const rsiValues: (number | null)[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  // Calculate price changes
  for (let i = 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  // First RSI value uses simple average
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Fill nulls for periods where RSI can't be calculated
  for (let i = 0; i < period; i++) {
    rsiValues.push(null);
  }

  // Calculate first RSI
  if (avgLoss === 0) {
    rsiValues.push(100);
  } else {
    const rs = avgGain / avgLoss;
    rsiValues.push(100 - (100 / (1 + rs)));
  }

  // Calculate subsequent RSI values using smoothed averages
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

    if (avgLoss === 0) {
      rsiValues.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsiValues.push(100 - (100 / (1 + rs)));
    }
  }

  return rsiValues;
}

/**
 * Calculate Simple Moving Average (SMA)
 * @param data - Array of OHLC data
 * @param period - SMA period
 * @returns Array of SMA values
 */
export function calculateSMA(data: OHLCData[], period: number): (number | null)[] {
  if (data.length < period) {
    return data.map(() => null);
  }

  const smaValues: (number | null)[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      smaValues.push(null);
    } else {
      const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b.close, 0);
      smaValues.push(sum / period);
    }
  }

  return smaValues;
}

/**
 * Calculate Exponential Moving Average (EMA)
 * @param data - Array of OHLC data
 * @param period - EMA period
 * @returns Array of EMA values
 */
export function calculateEMA(data: OHLCData[], period: number): (number | null)[] {
  if (data.length < period) {
    return data.map(() => null);
  }

  const emaValues: (number | null)[] = [];
  const multiplier = 2 / (period + 1);

  // Calculate initial SMA for first EMA value
  let ema = data.slice(0, period).reduce((a, b) => a + b.close, 0) / period;

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      emaValues.push(null);
    } else if (i === period - 1) {
      emaValues.push(ema);
    } else {
      ema = (data[i].close - ema) * multiplier + ema;
      emaValues.push(ema);
    }
  }

  return emaValues;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * @param data - Array of OHLC data
 * @param fastPeriod - Fast EMA period (default 12)
 * @param slowPeriod - Slow EMA period (default 26)
 * @param signalPeriod - Signal line period (default 9)
 */
export function calculateMACD(
  data: OHLCData[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } {
  const fastEMA = calculateEMA(data, fastPeriod);
  const slowEMA = calculateEMA(data, slowPeriod);

  const macdLine: (number | null)[] = fastEMA.map((fast, i) => {
    const slow = slowEMA[i];
    if (fast === null || slow === null) return null;
    return fast - slow;
  });

  // Calculate signal line (EMA of MACD)
  const macdData = macdLine
    .filter((v): v is number => v !== null)
    .map((v) => ({ open: v, high: v, low: v, close: v }));

  const signalEMA = calculateEMA(macdData, signalPeriod);

  // Align signal with original data
  const signal: (number | null)[] = [];
  let signalIndex = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] === null) {
      signal.push(null);
    } else {
      signal.push(signalEMA[signalIndex] ?? null);
      signalIndex++;
    }
  }

  // Calculate histogram
  const histogram: (number | null)[] = macdLine.map((macd, i) => {
    const sig = signal[i];
    if (macd === null || sig === null) return null;
    return macd - sig;
  });

  return { macd: macdLine, signal, histogram };
}

/**
 * Get RSI signal interpretation
 */
export function getRSISignal(rsi: number): { level: 'oversold' | 'neutral' | 'overbought'; signal: 'buy' | 'sell' | 'hold' } {
  if (rsi <= 30) {
    return { level: 'oversold', signal: 'buy' };
  } else if (rsi >= 70) {
    return { level: 'overbought', signal: 'sell' };
  }
  return { level: 'neutral', signal: 'hold' };
}

/**
 * Calculate Bollinger Bands
 * @param data - Array of OHLC data
 * @param period - SMA period (default 20)
 * @param stdDev - Number of standard deviations (default 2)
 * @returns Object with upper, middle (SMA), and lower bands
 */
export function calculateBollingerBands(
  data: OHLCData[],
  period: number = 20,
  stdDev: number = 2
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  if (data.length < period) {
    return {
      upper: data.map(() => null),
      middle: data.map(() => null),
      lower: data.map(() => null),
    };
  }

  const upper: (number | null)[] = [];
  const middle: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      upper.push(null);
      middle.push(null);
      lower.push(null);
    } else {
      // Calculate SMA (middle band)
      const slice = data.slice(i - period + 1, i + 1);
      const sma = slice.reduce((a, b) => a + b.close, 0) / period;

      // Calculate standard deviation
      const squaredDiffs = slice.map((d) => Math.pow(d.close - sma, 2));
      const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
      const standardDeviation = Math.sqrt(variance);

      middle.push(sma);
      upper.push(sma + stdDev * standardDeviation);
      lower.push(sma - stdDev * standardDeviation);
    }
  }

  return { upper, middle, lower };
}

/**
 * Get Bollinger Bands signal interpretation
 */
export function getBBSignal(
  price: number,
  upper: number,
  lower: number
): { level: 'above_upper' | 'near_upper' | 'middle' | 'near_lower' | 'below_lower'; signal: 'sell' | 'hold' | 'buy' } {
  if (price >= upper) {
    return { level: 'above_upper', signal: 'sell' };
  } else if (price <= lower) {
    return { level: 'below_lower', signal: 'buy' };
  } else if (price >= upper * 0.98) {
    return { level: 'near_upper', signal: 'hold' };
  } else if (price <= lower * 1.02) {
    return { level: 'near_lower', signal: 'hold' };
  }
  return { level: 'middle', signal: 'hold' };
}
