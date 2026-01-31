export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type PatternType =
  | 'hammer'
  | 'inverted_hammer'
  | 'bullish_engulfing'
  | 'bearish_engulfing'
  | 'shooting_star'
  | 'evening_star'
  | 'gravestone_doji'
  | 'bullish_breakout'
  | 'bearish_breakout';

export interface PatternResult {
  pattern: PatternType;
  signal: 'buy' | 'sell';
  confidence: number; // 0-100
  description: string;
}

// Helper functions
const bodySize = (candle: Candle) => Math.abs(candle.close - candle.open);
const upperShadow = (candle: Candle) => candle.high - Math.max(candle.open, candle.close);
const lowerShadow = (candle: Candle) => Math.min(candle.open, candle.close) - candle.low;
const isBullish = (candle: Candle) => candle.close > candle.open;
const isBearish = (candle: Candle) => candle.close < candle.open;
const candleRange = (candle: Candle) => candle.high - candle.low;

/**
 * Hammer: Small body at top, long lower shadow (2x body), little/no upper shadow
 * Bullish reversal pattern - appears after downtrend
 * v3: Tightened thresholds for higher quality signals
 */
export function isHammer(candle: Candle): boolean {
  const body = bodySize(candle);
  const lower = lowerShadow(candle);
  const upper = upperShadow(candle);
  const range = candleRange(candle);

  if (range === 0) return false;

  return (
    lower >= body * 2.0 && // Long lower shadow (strict: 2x body minimum)
    upper <= body * 0.3 && // Very little upper shadow (strict)
    body <= range * 0.35 && // Small body relative to range (strict)
    body > 0 // Must have some body (not a doji)
  );
}

/**
 * Inverted Hammer: Small body at bottom, long upper shadow, little/no lower shadow
 * Bullish reversal pattern - appears after downtrend
 * v3: Tightened thresholds for higher quality signals
 */
export function isInvertedHammer(candle: Candle): boolean {
  const body = bodySize(candle);
  const lower = lowerShadow(candle);
  const upper = upperShadow(candle);
  const range = candleRange(candle);

  if (range === 0) return false;

  return (
    upper >= body * 2.0 && // Long upper shadow (strict: 2x body minimum)
    lower <= body * 0.3 && // Very little lower shadow (strict)
    body <= range * 0.35 && // Small body relative to range (strict)
    body > 0 // Must have some body (not a doji)
  );
}

/**
 * Shooting Star: Small body at bottom, long upper shadow, little/no lower shadow
 * Bearish reversal pattern - appears after uptrend (same shape as inverted hammer)
 */
export function isShootingStar(candle: Candle, prevCandle?: Candle): boolean {
  // Shape is same as inverted hammer
  if (!isInvertedHammer(candle)) return false;

  // Should appear after uptrend (previous candle bullish or close higher)
  if (prevCandle) {
    return isBullish(prevCandle) || candle.open > prevCandle.close;
  }
  return true;
}

/**
 * Gravestone Doji: Open and close at low, long upper shadow
 * Bearish reversal pattern
 */
export function isGravestoneDoji(candle: Candle): boolean {
  const body = bodySize(candle);
  const upper = upperShadow(candle);
  const lower = lowerShadow(candle);
  const range = candleRange(candle);

  if (range === 0) return false;

  return (
    body <= range * 0.1 && // Very small body (doji)
    upper >= range * 0.6 && // Long upper shadow
    lower <= range * 0.1 // Little/no lower shadow
  );
}

/**
 * Bullish Engulfing: Bearish candle followed by larger bullish candle that engulfs it
 * v4: Relaxed - just needs to engulf (1.1x body, was 1.5x)
 */
export function isBullishEngulfing(current: Candle, previous: Candle): boolean {
  const currentBody = bodySize(current);
  const previousBody = bodySize(previous);

  return (
    isBearish(previous) &&
    isBullish(current) &&
    current.open <= previous.close &&
    current.close >= previous.open &&
    currentBody >= previousBody * 1.1 && // Just needs to be slightly larger
    previousBody > 0 // Previous must have a body
  );
}

/**
 * Bearish Engulfing: Bullish candle followed by larger bearish candle that engulfs it
 * v4: Relaxed - just needs to engulf (1.1x body, was 1.5x)
 */
export function isBearishEngulfing(current: Candle, previous: Candle): boolean {
  const currentBody = bodySize(current);
  const previousBody = bodySize(previous);

  return (
    isBullish(previous) &&
    isBearish(current) &&
    current.open >= previous.close &&
    current.close <= previous.open &&
    currentBody >= previousBody * 1.1 && // Just needs to be slightly larger
    previousBody > 0 // Previous must have a body
  );
}

/**
 * Evening Star: 3-candle pattern - bullish, small body/doji, bearish
 * Bearish reversal pattern
 */
export function isEveningStar(
  current: Candle,
  middle: Candle,
  first: Candle
): boolean {
  const firstBody = bodySize(first);
  const middleBody = bodySize(middle);
  const currentBody = bodySize(current);

  return (
    isBullish(first) && // First candle bullish
    firstBody > middleBody * 2 && // First has larger body
    middleBody < candleRange(middle) * 0.3 && // Middle is small/doji
    middle.low > first.close && // Middle gaps up from first
    isBearish(current) && // Current is bearish
    currentBody > middleBody * 2 && // Current has larger body
    current.close < (first.open + first.close) / 2 // Closes below midpoint of first
  );
}

/**
 * Bullish Breakout: Price closes above recent high with strong momentum
 * Looks for price breaking above the highest high of the lookback period
 * v4: Relaxed to 0.3% move (1% was too strict for daily stock data)
 */
export function isBullishBreakout(candles: Candle[], lookbackPeriod: number = 5): boolean {
  if (candles.length < lookbackPeriod + 1) return false;

  const current = candles[candles.length - 1];
  const lookbackCandles = candles.slice(-lookbackPeriod - 1, -1);

  // Find the highest high in the lookback period
  const highestHigh = Math.max(...lookbackCandles.map((c) => c.high));

  // Current candle should close above the highest high
  // and be a bullish candle (close > open)
  const closeAboveHigh = current.close > highestHigh;
  const bullishCandle = current.close > current.open;
  const strongMove = (current.close - current.open) / current.open > 0.003; // At least 0.3% move (relaxed)
  const breakoutMargin = current.close > highestHigh * 1.001; // Close at least 0.1% above high

  return closeAboveHigh && bullishCandle && strongMove && breakoutMargin;
}

/**
 * Bearish Breakout: Price closes below recent low with strong momentum
 * Looks for price breaking below the lowest low of the lookback period
 * v4: Relaxed to 0.3% move (1% was too strict for daily stock data)
 */
export function isBearishBreakout(candles: Candle[], lookbackPeriod: number = 5): boolean {
  if (candles.length < lookbackPeriod + 1) return false;

  const current = candles[candles.length - 1];
  const lookbackCandles = candles.slice(-lookbackPeriod - 1, -1);

  // Find the lowest low in the lookback period
  const lowestLow = Math.min(...lookbackCandles.map((c) => c.low));

  // Current candle should close below the lowest low
  // and be a bearish candle (close < open)
  const closeBelowLow = current.close < lowestLow;
  const bearishCandle = current.close < current.open;
  const strongMove = (current.open - current.close) / current.open > 0.003; // At least 0.3% move (relaxed)
  const breakoutMargin = current.close < lowestLow * 0.999; // Close at least 0.1% below low

  return closeBelowLow && bearishCandle && strongMove && breakoutMargin;
}

/**
 * Detect all patterns in the given candles
 */
export function detectPatterns(candles: Candle[]): PatternResult[] {
  const results: PatternResult[] = [];

  if (candles.length < 1) return results;

  const current = candles[candles.length - 1];
  const previous = candles.length > 1 ? candles[candles.length - 2] : undefined;
  const twoBefore = candles.length > 2 ? candles[candles.length - 3] : undefined;

  // Single candle patterns
  if (isHammer(current)) {
    results.push({
      pattern: 'hammer',
      signal: 'buy',
      confidence: 70,
      description: 'Hammer pattern detected - potential bullish reversal',
    });
  }

  if (isInvertedHammer(current) && (!previous || !isBullish(previous))) {
    results.push({
      pattern: 'inverted_hammer',
      signal: 'buy',
      confidence: 65,
      description: 'Inverted Hammer pattern detected - potential bullish reversal',
    });
  }

  if (previous && isShootingStar(current, previous)) {
    results.push({
      pattern: 'shooting_star',
      signal: 'sell',
      confidence: 70,
      description: 'Shooting Star pattern detected - potential bearish reversal',
    });
  }

  if (isGravestoneDoji(current)) {
    results.push({
      pattern: 'gravestone_doji',
      signal: 'sell',
      confidence: 75,
      description: 'Gravestone Doji pattern detected - potential bearish reversal',
    });
  }

  // Two candle patterns
  if (previous) {
    if (isBullishEngulfing(current, previous)) {
      results.push({
        pattern: 'bullish_engulfing',
        signal: 'buy',
        confidence: 80,
        description: 'Bullish Engulfing pattern detected - strong bullish reversal signal',
      });
    }

    if (isBearishEngulfing(current, previous)) {
      results.push({
        pattern: 'bearish_engulfing',
        signal: 'sell',
        confidence: 80,
        description: 'Bearish Engulfing pattern detected - strong bearish reversal signal',
      });
    }
  }

  // Three candle patterns
  if (previous && twoBefore) {
    if (isEveningStar(current, previous, twoBefore)) {
      results.push({
        pattern: 'evening_star',
        signal: 'sell',
        confidence: 85,
        description: 'Evening Star pattern detected - strong bearish reversal signal',
      });
    }
  }

  // Breakout patterns
  if (isBullishBreakout(candles)) {
    results.push({
      pattern: 'bullish_breakout',
      signal: 'buy',
      confidence: 75,
      description: 'Bullish Breakout detected - price closed above recent highs',
    });
  }

  if (isBearishBreakout(candles)) {
    results.push({
      pattern: 'bearish_breakout',
      signal: 'sell',
      confidence: 75,
      description: 'Bearish Breakout detected - price closed below recent lows',
    });
  }

  return results;
}

export const PATTERN_INFO: Record<PatternType, { name: string; signal: 'buy' | 'sell'; description: string }> = {
  hammer: {
    name: 'Hammer',
    signal: 'buy',
    description: 'Bullish reversal pattern with small body and long lower shadow',
  },
  inverted_hammer: {
    name: 'Inverted Hammer',
    signal: 'buy',
    description: 'Bullish reversal pattern with small body and long upper shadow',
  },
  bullish_engulfing: {
    name: 'Bullish Engulfing',
    signal: 'buy',
    description: 'Two-candle bullish reversal where current candle engulfs previous',
  },
  bearish_engulfing: {
    name: 'Bearish Engulfing',
    signal: 'sell',
    description: 'Two-candle bearish reversal where current candle engulfs previous',
  },
  shooting_star: {
    name: 'Shooting Star',
    signal: 'sell',
    description: 'Bearish reversal pattern with small body and long upper shadow',
  },
  evening_star: {
    name: 'Evening Star',
    signal: 'sell',
    description: 'Three-candle bearish reversal pattern',
  },
  gravestone_doji: {
    name: 'Gravestone Doji',
    signal: 'sell',
    description: 'Bearish doji pattern with long upper shadow',
  },
  bullish_breakout: {
    name: 'Bullish Breakout',
    signal: 'buy',
    description: 'Price breaks above recent highs with strong momentum',
  },
  bearish_breakout: {
    name: 'Bearish Breakout',
    signal: 'sell',
    description: 'Price breaks below recent lows with strong momentum',
  },
};
