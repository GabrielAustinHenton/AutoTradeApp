// ============================================================================
// Swing Trader Service
// ============================================================================
// Adaptive swing trading engine that detects market regime (uptrend, downtrend,
// sideways) and applies the appropriate strategy for each condition.
//
// Goal: Grow $5,000 to $10,000+ in ~2 years regardless of market conditions.
//
// Market Regime Detection:
//   - SMA crossover (20/50) for trend direction
//   - ADX for trend strength (>25 = trending, <25 = sideways)
//   - RSI for overbought/oversold extremes
//
// Strategies:
//   Uptrend:   Buy pullbacks to SMA support, ride momentum, wider targets
//   Downtrend: Short rallies or go to cash, tight risk management
//   Sideways:  Mean reversion at Bollinger Band extremes, tight ranges
// ============================================================================

import type {
  MarketRegime,
  SwingTraderConfig,
  SwingStrategyConfig,
  SwingTradePosition,
  SwingTrade,
  SwingEquitySnapshot,
  RegimeDetectionConfig,
} from '../types';

// ============================================================================
// Technical Indicator Calculations
// ============================================================================

export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Calculate Simple Moving Average */
export function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Calculate Exponential Moving Average */
export function calculateEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  if (prices.length < period) return calculateSMA(prices, prices.length);

  const multiplier = 2 / (period + 1);
  let ema = calculateSMA(prices.slice(0, period), period);

  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  return ema;
}

/** Calculate RSI (Relative Strength Index) */
export function calculateRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - change) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/** Calculate MACD (returns { macd, signal, histogram }) */
export function calculateMACD(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: number; signal: number; histogram: number } {
  if (closes.length < slowPeriod + signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  const fastEMA = calculateEMA(closes, fastPeriod);
  const slowEMA = calculateEMA(closes, slowPeriod);
  const macdLine = fastEMA - slowEMA;

  // Calculate MACD line history for signal
  const macdHistory: number[] = [];
  for (let i = slowPeriod; i <= closes.length; i++) {
    const fEma = calculateEMA(closes.slice(0, i), fastPeriod);
    const sEma = calculateEMA(closes.slice(0, i), slowPeriod);
    macdHistory.push(fEma - sEma);
  }

  const signal = calculateEMA(macdHistory, signalPeriod);
  return { macd: macdLine, signal, histogram: macdLine - signal };
}

/** Calculate ADX (Average Directional Index) */
export function calculateADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): { adx: number; plusDI: number; minusDI: number } {
  if (highs.length < period * 2) return { adx: 20, plusDI: 0, minusDI: 0 };

  const trueRanges: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);

    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  if (trueRanges.length < period) return { adx: 20, plusDI: 0, minusDI: 0 };

  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let smoothedPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let smoothedMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0) / period;

  const dx: number[] = [];
  let lastPlusDI = 0;
  let lastMinusDI = 0;

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    smoothedPlusDM = (smoothedPlusDM * (period - 1) + plusDM[i]) / period;
    smoothedMinusDM = (smoothedMinusDM * (period - 1) + minusDM[i]) / period;

    lastPlusDI = atr > 0 ? (smoothedPlusDM / atr) * 100 : 0;
    lastMinusDI = atr > 0 ? (smoothedMinusDM / atr) * 100 : 0;
    const diSum = lastPlusDI + lastMinusDI;
    const dxValue = diSum > 0 ? (Math.abs(lastPlusDI - lastMinusDI) / diSum) * 100 : 0;
    dx.push(dxValue);
  }

  if (dx.length < period) return { adx: 20, plusDI: lastPlusDI, minusDI: lastMinusDI };

  let adx = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }

  return { adx, plusDI: lastPlusDI, minusDI: lastMinusDI };
}

/** Calculate Bollinger Bands */
export function calculateBollingerBands(
  closes: number[],
  period: number = 20,
  stdDevMultiplier: number = 2
): { upper: number; middle: number; lower: number; bandwidth: number } {
  if (closes.length < period) {
    const avg = closes.reduce((a, b) => a + b, 0) / closes.length;
    return { upper: avg, middle: avg, lower: avg, bandwidth: 0 };
  }

  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = middle + stdDev * stdDevMultiplier;
  const lower = middle - stdDev * stdDevMultiplier;
  const bandwidth = middle > 0 ? ((upper - lower) / middle) * 100 : 0;

  return { upper, middle, lower, bandwidth };
}

/** Calculate Average True Range */
export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number {
  if (highs.length < 2) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) {
    return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
  }

  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  return atr;
}

// ============================================================================
// Market Regime Detection
// ============================================================================

export interface RegimeAnalysis {
  regime: MarketRegime;
  confidence: number;           // 0-100
  adx: number;
  rsi: number;
  smaFast: number;
  smaSlow: number;
  priceVsFastSMA: number;       // % price is above/below fast SMA
  priceVsSlowSMA: number;       // % price is above/below slow SMA
  bollingerPosition: number;    // 0 = at lower band, 1 = at upper band
  trendStrength: string;        // 'weak' | 'moderate' | 'strong'
  description: string;
}

/**
 * Detect the current market regime for a symbol using multiple indicators.
 *
 * Logic:
 * 1. ADX > threshold → market is trending
 *    - Fast SMA > Slow SMA AND price > Fast SMA → UPTREND
 *    - Fast SMA < Slow SMA AND price < Fast SMA → DOWNTREND
 * 2. ADX < threshold → SIDEWAYS (range-bound)
 */
export function detectMarketRegime(
  data: OHLCV[],
  config: RegimeDetectionConfig
): RegimeAnalysis {
  if (data.length < config.lookbackDays) {
    return {
      regime: 'sideways',
      confidence: 30,
      adx: 20,
      rsi: 50,
      smaFast: 0,
      smaSlow: 0,
      priceVsFastSMA: 0,
      priceVsSlowSMA: 0,
      bollingerPosition: 0.5,
      trendStrength: 'weak',
      description: 'Insufficient data for regime detection',
    };
  }

  const closes = data.map((d) => d.close);
  const highs = data.map((d) => d.high);
  const lows = data.map((d) => d.low);
  const currentPrice = closes[closes.length - 1];

  // Calculate indicators
  const smaFast = calculateSMA(closes, config.smaFastPeriod);
  const smaSlow = calculateSMA(closes, config.smaSlowPeriod);
  const { adx, plusDI, minusDI } = calculateADX(highs, lows, closes, config.adxPeriod);
  const rsi = calculateRSI(closes, config.rsiPeriod);
  const bollinger = calculateBollingerBands(closes, 20, 2);

  const priceVsFastSMA = ((currentPrice - smaFast) / smaFast) * 100;
  const priceVsSlowSMA = ((currentPrice - smaSlow) / smaSlow) * 100;
  const bollingerRange = bollinger.upper - bollinger.lower;
  const bollingerPosition = bollingerRange > 0
    ? (currentPrice - bollinger.lower) / bollingerRange
    : 0.5;

  // Determine regime
  let regime: MarketRegime;
  let confidence: number;
  let trendStrength: string;
  let description: string;

  if (adx >= config.adxTrendThreshold) {
    // Market is trending
    if (adx >= 40) trendStrength = 'strong';
    else if (adx >= 30) trendStrength = 'moderate';
    else trendStrength = 'weak';

    if (plusDI > minusDI && smaFast > smaSlow && currentPrice > smaFast) {
      regime = 'uptrend';
      confidence = Math.min(95, 50 + adx + (priceVsFastSMA > 0 ? 10 : 0));
      description = `Strong uptrend: ADX ${adx.toFixed(1)}, price above both SMAs, +DI > -DI`;
    } else if (minusDI > plusDI && smaFast < smaSlow && currentPrice < smaFast) {
      regime = 'downtrend';
      confidence = Math.min(95, 50 + adx + (priceVsFastSMA < 0 ? 10 : 0));
      description = `Downtrend: ADX ${adx.toFixed(1)}, price below both SMAs, -DI > +DI`;
    } else if (plusDI > minusDI) {
      // Mixed signals but leaning bullish
      regime = 'uptrend';
      confidence = Math.min(70, 40 + adx * 0.5);
      description = `Weak uptrend: ADX ${adx.toFixed(1)}, +DI > -DI but mixed SMA signals`;
    } else {
      regime = 'downtrend';
      confidence = Math.min(70, 40 + adx * 0.5);
      description = `Weak downtrend: ADX ${adx.toFixed(1)}, -DI > +DI but mixed SMA signals`;
    }
  } else {
    // Market is ranging / sideways
    regime = 'sideways';
    trendStrength = 'weak';
    confidence = Math.min(90, 50 + (config.adxTrendThreshold - adx) * 2);
    description = `Sideways/ranging: ADX ${adx.toFixed(1)} (below ${config.adxTrendThreshold} threshold), Bollinger BW: ${bollinger.bandwidth.toFixed(1)}%`;
  }

  return {
    regime,
    confidence,
    adx,
    rsi,
    smaFast,
    smaSlow,
    priceVsFastSMA,
    priceVsSlowSMA,
    bollingerPosition,
    trendStrength: trendStrength!,
    description,
  };
}

// ============================================================================
// Signal Generation per Regime
// ============================================================================

export interface TradeSignal {
  symbol: string;
  direction: 'long' | 'short';
  regime: MarketRegime;
  confidence: number;
  reasons: string[];
  suggestedEntry: number;
  suggestedStopLoss: number;
  suggestedTakeProfit: number;
}

/**
 * Generate trade signals based on the current market regime and strategy config.
 */
export function generateSwingSignals(
  symbol: string,
  data: OHLCV[],
  regime: RegimeAnalysis,
  strategy: SwingStrategyConfig
): TradeSignal[] {
  if (!strategy.enabled) return [];

  const signals: TradeSignal[] = [];
  const closes = data.map((d) => d.close);
  const highs = data.map((d) => d.high);
  const lows = data.map((d) => d.low);
  const currentPrice = closes[closes.length - 1];

  const rsi = regime.rsi;
  const bollinger = calculateBollingerBands(closes, strategy.entryRules.bollingerPeriod, strategy.entryRules.bollingerStdDev);
  const macd = calculateMACD(closes);
  const atr = calculateATR(highs, lows, closes);

  const reasons: string[] = [];
  let signalConfidence = 0;
  let direction: 'long' | 'short' | null = null;

  // ===== UPTREND STRATEGY: Buy pullbacks =====
  if (regime.regime === 'uptrend') {
    if (strategy.direction === 'long' || strategy.direction === 'both') {
      // Buy on RSI pullback in uptrend
      if (strategy.entryRules.useRSI && rsi <= strategy.entryRules.rsiOversold + 10) {
        // In uptrend, RSI 30-40 is a pullback opportunity
        reasons.push(`RSI pullback to ${rsi.toFixed(1)} in uptrend`);
        signalConfidence += 30;
      }

      // Buy when price pulls back to fast SMA
      if (strategy.entryRules.useSMACross && regime.priceVsFastSMA <= 1 && regime.priceVsFastSMA >= -2) {
        reasons.push(`Price near SMA(${regime.smaFast.toFixed(2)}) support`);
        signalConfidence += 25;
      }

      // MACD histogram turning positive
      if (strategy.entryRules.useMACD && macd.histogram > 0 && macd.macd > macd.signal) {
        reasons.push('MACD bullish crossover');
        signalConfidence += 25;
      }

      // Bollinger lower band touch in uptrend = strong buy
      if (strategy.entryRules.useBollinger && currentPrice <= bollinger.lower * 1.01) {
        reasons.push(`Price at Bollinger lower band ($${bollinger.lower.toFixed(2)})`);
        signalConfidence += 30;
      }

      if (signalConfidence >= strategy.entryRules.minConfidence) {
        direction = 'long';
      }
    }
  }

  // ===== DOWNTREND STRATEGY: Short rallies or stay defensive =====
  if (regime.regime === 'downtrend') {
    if (strategy.direction === 'short' || strategy.direction === 'both') {
      // Short on RSI rally in downtrend
      if (strategy.entryRules.useRSI && rsi >= strategy.entryRules.rsiOverbought - 10) {
        reasons.push(`RSI overbought rally to ${rsi.toFixed(1)} in downtrend`);
        signalConfidence += 30;
      }

      // Short when price rallies to fast SMA resistance
      if (strategy.entryRules.useSMACross && regime.priceVsFastSMA >= -1 && regime.priceVsFastSMA <= 2) {
        reasons.push(`Price near SMA(${regime.smaFast.toFixed(2)}) resistance`);
        signalConfidence += 25;
      }

      // MACD bearish
      if (strategy.entryRules.useMACD && macd.histogram < 0 && macd.macd < macd.signal) {
        reasons.push('MACD bearish crossover');
        signalConfidence += 25;
      }

      // Bollinger upper band touch in downtrend = short opportunity
      if (strategy.entryRules.useBollinger && currentPrice >= bollinger.upper * 0.99) {
        reasons.push(`Price at Bollinger upper band ($${bollinger.upper.toFixed(2)})`);
        signalConfidence += 30;
      }

      if (signalConfidence >= strategy.entryRules.minConfidence) {
        direction = 'short';
      }
    }

    // Defensive long: only buy extreme oversold in downtrend (contrarian)
    if ((strategy.direction === 'long' || strategy.direction === 'both') && !direction) {
      if (strategy.entryRules.useRSI && rsi <= strategy.entryRules.rsiOversold) {
        reasons.push(`Extreme RSI oversold (${rsi.toFixed(1)}) - contrarian long`);
        signalConfidence += 20;
      }
      if (strategy.entryRules.useBollinger && currentPrice <= bollinger.lower * 0.99) {
        reasons.push(`Below Bollinger lower band - oversold bounce play`);
        signalConfidence += 20;
      }
      if (signalConfidence >= strategy.entryRules.minConfidence + 10) {
        direction = 'long';
      }
    }
  }

  // ===== SIDEWAYS STRATEGY: Mean reversion at extremes =====
  if (regime.regime === 'sideways') {
    // Buy at lower Bollinger Band (mean reversion)
    if ((strategy.direction === 'long' || strategy.direction === 'both') &&
        strategy.entryRules.useBollinger &&
        currentPrice <= bollinger.lower * 1.005) {
      reasons.push(`Price at Bollinger lower band ($${bollinger.lower.toFixed(2)}) - mean reversion buy`);
      signalConfidence += 35;

      if (strategy.entryRules.useRSI && rsi <= strategy.entryRules.rsiOversold) {
        reasons.push(`RSI oversold (${rsi.toFixed(1)}) confirms`);
        signalConfidence += 25;
      }

      if (signalConfidence >= strategy.entryRules.minConfidence) {
        direction = 'long';
      }
    }

    // Short at upper Bollinger Band (mean reversion)
    if ((strategy.direction === 'short' || strategy.direction === 'both') &&
        !direction &&
        strategy.entryRules.useBollinger &&
        currentPrice >= bollinger.upper * 0.995) {
      reasons.push(`Price at Bollinger upper band ($${bollinger.upper.toFixed(2)}) - mean reversion short`);
      signalConfidence += 35;

      if (strategy.entryRules.useRSI && rsi >= strategy.entryRules.rsiOverbought) {
        reasons.push(`RSI overbought (${rsi.toFixed(1)}) confirms`);
        signalConfidence += 25;
      }

      if (signalConfidence >= strategy.entryRules.minConfidence) {
        direction = 'short';
      }
    }
  }

  // Build signal if we have a direction
  if (direction && reasons.length > 0) {
    const tp = strategy.exitRules.takeProfitPercent / 100;
    const sl = strategy.exitRules.stopLossPercent / 100;

    signals.push({
      symbol,
      direction,
      regime: regime.regime,
      confidence: Math.min(signalConfidence, 100),
      reasons,
      suggestedEntry: currentPrice,
      suggestedStopLoss: direction === 'long'
        ? currentPrice * (1 - sl)
        : currentPrice * (1 + sl),
      suggestedTakeProfit: direction === 'long'
        ? currentPrice * (1 + tp)
        : currentPrice * (1 - tp),
    });
  }

  return signals;
}

// ============================================================================
// Position Exit Logic
// ============================================================================

export interface ExitSignal {
  positionId: string;
  reason: string;
  exitPrice: number;
}

/**
 * Check if any open positions should be closed.
 */
export function checkExitConditions(
  position: SwingTradePosition,
  currentPrice: number,
  strategy: SwingStrategyConfig,
  currentRegime: MarketRegime,
  daysSinceEntry: number
): ExitSignal | null {
  const { exitRules } = strategy;

  if (position.direction === 'long') {
    // Take profit
    const tpPrice = position.entryPrice * (1 + exitRules.takeProfitPercent / 100);
    if (currentPrice >= tpPrice) {
      return { positionId: position.id, reason: 'take_profit', exitPrice: currentPrice };
    }

    // Stop loss
    const slPrice = position.entryPrice * (1 - exitRules.stopLossPercent / 100);
    if (currentPrice <= slPrice) {
      return { positionId: position.id, reason: 'stop_loss', exitPrice: currentPrice };
    }

    // Trailing stop
    if (exitRules.trailingStopPercent !== null && exitRules.trailingStopPercent > 0) {
      const trailingPrice = position.highestPrice * (1 - exitRules.trailingStopPercent / 100);
      if (currentPrice <= trailingPrice && currentPrice > position.entryPrice) {
        return { positionId: position.id, reason: 'trailing_stop', exitPrice: currentPrice };
      }
    }
  } else {
    // Short position exits
    const tpPrice = position.entryPrice * (1 - exitRules.takeProfitPercent / 100);
    if (currentPrice <= tpPrice) {
      return { positionId: position.id, reason: 'take_profit', exitPrice: currentPrice };
    }

    const slPrice = position.entryPrice * (1 + exitRules.stopLossPercent / 100);
    if (currentPrice >= slPrice) {
      return { positionId: position.id, reason: 'stop_loss', exitPrice: currentPrice };
    }

    if (exitRules.trailingStopPercent !== null && exitRules.trailingStopPercent > 0) {
      const trailingPrice = position.lowestPrice * (1 + exitRules.trailingStopPercent / 100);
      if (currentPrice >= trailingPrice && currentPrice < position.entryPrice) {
        return { positionId: position.id, reason: 'trailing_stop', exitPrice: currentPrice };
      }
    }
  }

  // Time stop
  if (exitRules.timeStopDays !== null && daysSinceEntry >= exitRules.timeStopDays) {
    return { positionId: position.id, reason: 'time_stop', exitPrice: currentPrice };
  }

  // Regime change exit: if regime flips against position direction
  if (position.direction === 'long' && currentRegime === 'downtrend' && position.regime === 'uptrend') {
    return { positionId: position.id, reason: 'regime_change', exitPrice: currentPrice };
  }
  if (position.direction === 'short' && currentRegime === 'uptrend' && position.regime === 'downtrend') {
    return { positionId: position.id, reason: 'regime_change', exitPrice: currentPrice };
  }

  return null;
}

// ============================================================================
// Default Configurations
// ============================================================================

export const DEFAULT_REGIME_CONFIG: RegimeDetectionConfig = {
  smaFastPeriod: 20,
  smaSlowPeriod: 50,
  adxPeriod: 14,
  adxTrendThreshold: 25,
  rsiPeriod: 14,
  lookbackDays: 60,
};

export const DEFAULT_UPTREND_STRATEGY: SwingStrategyConfig = {
  enabled: true,
  direction: 'long',
  entryRules: {
    useRSI: true,
    rsiOversold: 30,
    rsiOverbought: 70,
    useSMACross: true,
    useMACD: true,
    useBollinger: true,
    bollingerPeriod: 20,
    bollingerStdDev: 2,
    minConfidence: 50,
  },
  exitRules: {
    takeProfitPercent: 8,     // Wider target in uptrend - let winners run
    stopLossPercent: 3,       // Moderate stop loss
    trailingStopPercent: 5,   // Trail profits in strong uptrends
    timeStopDays: 30,         // Max hold 30 days for swing
  },
  positionSizePercent: 15,
};

export const DEFAULT_DOWNTREND_STRATEGY: SwingStrategyConfig = {
  enabled: true,
  direction: 'both',         // Can short rallies OR buy extreme dips
  entryRules: {
    useRSI: true,
    rsiOversold: 25,          // More extreme oversold for longs in downtrend
    rsiOverbought: 65,        // Lower overbought for shorts
    useSMACross: true,
    useMACD: true,
    useBollinger: true,
    bollingerPeriod: 20,
    bollingerStdDev: 2,
    minConfidence: 60,        // Higher confidence required in downtrend
  },
  exitRules: {
    takeProfitPercent: 5,     // Tighter target in downtrend
    stopLossPercent: 2,       // Tight stop loss
    trailingStopPercent: null, // No trailing stop in choppy downtrend
    timeStopDays: 15,         // Shorter hold in downtrend
  },
  positionSizePercent: 10,    // Smaller positions in downtrend
};

export const DEFAULT_SIDEWAYS_STRATEGY: SwingStrategyConfig = {
  enabled: true,
  direction: 'both',         // Mean reversion both ways
  entryRules: {
    useRSI: true,
    rsiOversold: 30,
    rsiOverbought: 70,
    useSMACross: false,       // SMA crosses aren't reliable in sideways
    useMACD: false,           // MACD whipsaws in sideways
    useBollinger: true,       // Bollinger Bands are key for mean reversion
    bollingerPeriod: 20,
    bollingerStdDev: 2,
    minConfidence: 50,
  },
  exitRules: {
    takeProfitPercent: 4,     // Tight target - mean reversion to middle
    stopLossPercent: 2,       // Tight stop loss
    trailingStopPercent: null, // No trailing stop in range
    timeStopDays: 10,         // Short hold - quick in, quick out
  },
  positionSizePercent: 12,
};

export const DEFAULT_SWING_SYMBOLS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA',
  'META', 'JPM', 'V', 'HD', 'KO',
];

export function createDefaultSwingConfig(): SwingTraderConfig {
  return {
    enabled: false,
    initialCapital: 5000,
    goalCapital: 10000,
    goalMonths: 24,
    maxPositions: 3,
    maxPositionSizePercent: 20,
    symbols: [...DEFAULT_SWING_SYMBOLS],
    regimeDetection: { ...DEFAULT_REGIME_CONFIG },
    uptrendStrategy: { ...DEFAULT_UPTREND_STRATEGY },
    downtrendStrategy: { ...DEFAULT_DOWNTREND_STRATEGY },
    sidewaysStrategy: { ...DEFAULT_SIDEWAYS_STRATEGY },
  };
}

// ============================================================================
// Portfolio Calculation Helpers
// ============================================================================

/** Calculate current equity from cash + positions */
export function calculateSwingEquity(
  cashBalance: number,
  positions: SwingTradePosition[]
): number {
  const positionsValue = positions.reduce((sum, p) => {
    if (p.direction === 'long') {
      return sum + p.shares * p.currentPrice;
    }
    // Short: value = entry proceeds - current cost to cover
    return sum + (p.entryPrice - p.currentPrice) * p.shares;
  }, 0);
  return cashBalance + positionsValue;
}

/** Calculate required monthly return to reach goal */
export function calculateRequiredMonthlyReturn(
  currentCapital: number,
  goalCapital: number,
  monthsRemaining: number
): number {
  if (monthsRemaining <= 0 || currentCapital <= 0) return 0;
  // compound growth: goal = current * (1 + r)^months
  // r = (goal/current)^(1/months) - 1
  return (Math.pow(goalCapital / currentCapital, 1 / monthsRemaining) - 1) * 100;
}

/** Calculate win rate */
export function calculateWinRate(wins: number, losses: number): number {
  const total = wins + losses;
  if (total === 0) return 0;
  return (wins / total) * 100;
}

/** Get strategy for current regime */
export function getStrategyForRegime(
  config: SwingTraderConfig,
  regime: MarketRegime
): SwingStrategyConfig {
  switch (regime) {
    case 'uptrend': return config.uptrendStrategy;
    case 'downtrend': return config.downtrendStrategy;
    case 'sideways': return config.sidewaysStrategy;
  }
}
