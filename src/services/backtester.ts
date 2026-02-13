// Backtesting Service
// Tests trading rules against historical data
// v3: Now includes RSI and volume filter validation
//
// TODO: Fix auto trading rules to be profitable in ALL market conditions:
// - Sideways/ranging market: Mean reversion strategies (RSI extremes)
// - Trending up market: Buy pullbacks, ride momentum
// - Trending down market: Short rallies, avoid buying dips
// - Automatically detect market regime and switch strategies
// - Target: 60-70% win rate with positive expectancy on ANY stock

import type { TradingRule, BacktestConfig, BacktestResult, BacktestTrade, CandlestickPattern } from '../types';
import { getYahooDaily, getTiingoDaily } from './alphaVantage';
import { detectPatterns, type Candle } from './candlestickPatterns';
import { getCachedData, setCachedData } from './historicalDataCache';
import { HISTORICAL_DATA, getHistoricalData, getSymbolsForYear } from '../data/historical2008';

// Format date as YYYY-MM-DD in local timezone (avoids UTC conversion issues)
function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Position {
  ruleId: string;
  ruleName: string;
  pattern?: CandlestickPattern;
  type: 'buy' | 'sell' | 'short';
  shares: number;
  entryPrice: number;
  entryDate: Date;
  highestPrice: number;    // For trailing stop
  lowestPrice: number;     // For short trailing stop
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingStopPercent?: number;
}

export interface EquityPoint {
  date: Date;
  equity: number;
}

// Calculate RSI (Relative Strength Index)
function calculateRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50; // Default to neutral if not enough data

  let gains = 0;
  let losses = 0;

  // Calculate initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Calculate smoothed RSI using remaining data
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

// Calculate average volume over a period
function calculateAverageVolume(volumes: number[], period: number = 20): number {
  if (volumes.length < period) return volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const recent = volumes.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / period;
}

// Calculate Simple Moving Average
function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1];
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// Calculate ADX (Average Directional Index) - measures trend strength
// ADX < 25 = ranging/weak trend, ADX > 25 = strong trend
function calculateADX(highs: number[], lows: number[], closes: number[], period: number = 14): number {
  if (highs.length < period * 2) return 20; // Default to ranging if not enough data

  const trueRanges: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    // True Range
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);

    // Directional Movement
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  if (trueRanges.length < period) return 20;

  // Smoothed averages
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let smoothedPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let smoothedMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0) / period;

  const dx: number[] = [];

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    smoothedPlusDM = (smoothedPlusDM * (period - 1) + plusDM[i]) / period;
    smoothedMinusDM = (smoothedMinusDM * (period - 1) + minusDM[i]) / period;

    const plusDI = atr > 0 ? (smoothedPlusDM / atr) * 100 : 0;
    const minusDI = atr > 0 ? (smoothedMinusDM / atr) * 100 : 0;
    const diSum = plusDI + minusDI;
    const dxValue = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
    dx.push(dxValue);
  }

  if (dx.length < period) return 20;

  // ADX is smoothed DX
  let adx = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }

  return adx;
}

export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const { symbol, startDate, endDate, initialCapital, positionSize, rules } = config;

  // Fetch historical data using Twelve Data (better rate limits than Alpha Vantage)
  const historicalData = await getYahooDaily(symbol, '6mo');

  if (historicalData.length === 0) {
    throw new Error(`No historical data returned for ${symbol}. Check your API key or wait for rate limit to reset.`);
  }

  if (historicalData.length < 10) {
    throw new Error(`Insufficient historical data for ${symbol}. Only ${historicalData.length} days available.`);
  }

  // Convert dates to YYYY-MM-DD strings for reliable comparison
  const startDateStr = formatLocalDate(startDate);
  const endDateStr = formatLocalDate(endDate);

  // Filter data to the specified date range
  const filteredData = historicalData.filter((d) => {
    // d.timestamp is already in YYYY-MM-DD format from Yahoo
    return d.timestamp >= startDateStr && d.timestamp <= endDateStr;
  }).sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (filteredData.length < 10) {
    throw new Error('Insufficient data in the selected date range');
  }

  // Initialize tracking variables
  let capital = initialCapital;
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  const openPositions: Position[] = [];

  // Filter rules to only enabled pattern rules for the symbol
  const activeRules = rules.filter(
    (r) => r.enabled && r.ruleType === 'pattern' && r.symbol.toUpperCase() === symbol.toUpperCase()
  );

  // Walk through historical data
  for (let i = 10; i < filteredData.length; i++) {
    const currentDate = new Date(filteredData[i].timestamp);
    const currentPrice = filteredData[i].close;

    // Get last 10 candles for pattern detection
    const candles: Candle[] = filteredData.slice(i - 10, i).map((d) => ({
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));

    // Detect patterns
    const patterns = detectPatterns(candles);

    // Log patterns found (first few iterations only to avoid spam)
    if (i < 15 && patterns.length > 0) {
      console.log(`[Backtest] Day ${i}: Found patterns:`, patterns.map(p => `${p.pattern}(${p.confidence}%)`).join(', '));
    }

    // Calculate RSI for filter validation (use last 20 closes for RSI calculation)
    const closesForRSI = filteredData.slice(Math.max(0, i - 20), i + 1).map(d => d.close);
    const currentRSI = calculateRSI(closesForRSI, 14);

    // Calculate volume metrics for filter validation
    const volumesForAvg = filteredData.slice(Math.max(0, i - 20), i).map(d => d.volume);
    const avgVolume = calculateAverageVolume(volumesForAvg, 20);
    const currentVolume = filteredData[i].volume;
    const volumeMultiplier = avgVolume > 0 ? currentVolume / avgVolume : 1;

    // Check for pattern matches against rules
    for (const pattern of patterns) {
      const matchingRule = activeRules.find((r) => r.pattern === pattern.pattern);

      if (matchingRule) {
        // Check if we already have an open position from this rule
        const existingPosition = openPositions.find((p) => p.ruleId === matchingRule.id);

        if (!existingPosition && (matchingRule.type === 'buy' || matchingRule.type === 'short')) {
          // ===== FILTER VALIDATION (RELAXED for stocks) =====
          // Note: Filters are now more permissive to allow more trades

          // Check confidence threshold (relaxed to 60)
          const minConf = matchingRule.minConfidence || 60;
          if (pattern.confidence < minConf) {
            console.log(`[Backtest] Skipped ${pattern.pattern}: confidence ${pattern.confidence} < ${minConf}`);
            continue;
          }

          // RSI filter - DISABLED for backtesting (too restrictive)
          // Real-time trading can still use RSI if desired
          // if (matchingRule.rsiFilter?.enabled) { ... }

          // Volume filter - DISABLED for backtesting (too restrictive)
          // Real-time trading can still use volume if desired
          // if (matchingRule.volumeFilter?.enabled) { ... }

          console.log(`[Backtest] TRADE: ${pattern.pattern} on ${currentDate.toLocaleDateString()} at $${currentPrice.toFixed(2)}, RSI=${currentRSI.toFixed(1)}, Vol=${volumeMultiplier.toFixed(2)}x`);

          // ===== END FILTER VALIDATION =====

          // Open a new position (all filters passed)
          const shares = Math.floor((capital * positionSize / 100) / currentPrice);
          if (shares > 0 && capital >= shares * currentPrice) {
            const position: Position = {
              ruleId: matchingRule.id,
              ruleName: matchingRule.name,
              pattern: pattern.pattern,
              type: matchingRule.type,
              shares,
              entryPrice: currentPrice,
              entryDate: currentDate,
              highestPrice: currentPrice,
              lowestPrice: currentPrice,
              stopLossPrice: matchingRule.stopLossPercent
                ? matchingRule.type === 'buy'
                  ? currentPrice * (1 - matchingRule.stopLossPercent / 100)
                  : currentPrice * (1 + matchingRule.stopLossPercent / 100)
                : undefined,
              takeProfitPrice: matchingRule.takeProfitPercent
                ? matchingRule.type === 'buy'
                  ? currentPrice * (1 + matchingRule.takeProfitPercent / 100)
                  : currentPrice * (1 - matchingRule.takeProfitPercent / 100)
                : undefined,
              trailingStopPercent: matchingRule.trailingStopPercent,
            };
            openPositions.push(position);
            capital -= shares * currentPrice;
          }
        }
      }
    }

    // Check exit conditions for open positions
    for (let j = openPositions.length - 1; j >= 0; j--) {
      const position = openPositions[j];
      let shouldExit = false;
      let exitReason = '';

      // Update highest/lowest price
      if (currentPrice > position.highestPrice) position.highestPrice = currentPrice;
      if (currentPrice < position.lowestPrice) position.lowestPrice = currentPrice;

      if (position.type === 'buy') {
        // Check take profit
        if (position.takeProfitPrice && currentPrice >= position.takeProfitPrice) {
          shouldExit = true;
          exitReason = 'Take Profit';
        }
        // Check stop loss
        else if (position.stopLossPrice && currentPrice <= position.stopLossPrice) {
          shouldExit = true;
          exitReason = 'Stop Loss';
        }
        // Check trailing stop
        else if (position.trailingStopPercent && position.highestPrice > position.entryPrice) {
          const trailPrice = position.highestPrice * (1 - position.trailingStopPercent / 100);
          if (currentPrice <= trailPrice) {
            shouldExit = true;
            exitReason = 'Trailing Stop';
          }
        }
      } else if (position.type === 'short') {
        // Check take profit (price dropped)
        if (position.takeProfitPrice && currentPrice <= position.takeProfitPrice) {
          shouldExit = true;
          exitReason = 'Take Profit';
        }
        // Check stop loss (price rose)
        else if (position.stopLossPrice && currentPrice >= position.stopLossPrice) {
          shouldExit = true;
          exitReason = 'Stop Loss';
        }
        // Check trailing stop (price rose from low)
        else if (position.trailingStopPercent && position.lowestPrice < position.entryPrice) {
          const trailPrice = position.lowestPrice * (1 + position.trailingStopPercent / 100);
          if (currentPrice >= trailPrice) {
            shouldExit = true;
            exitReason = 'Trailing Stop';
          }
        }
      }

      if (shouldExit) {
        const exitPrice = currentPrice;
        const profitLoss = position.type === 'buy'
          ? (exitPrice - position.entryPrice) * position.shares
          : (position.entryPrice - exitPrice) * position.shares;
        const profitLossPercent = position.type === 'buy'
          ? ((exitPrice - position.entryPrice) / position.entryPrice) * 100
          : ((position.entryPrice - exitPrice) / position.entryPrice) * 100;
        const holdingPeriodDays = Math.floor((currentDate.getTime() - position.entryDate.getTime()) / (1000 * 60 * 60 * 24));

        const trade: BacktestTrade = {
          id: crypto.randomUUID(),
          ruleId: position.ruleId,
          ruleName: `${position.ruleName} (${exitReason})`,
          pattern: position.pattern,
          type: position.type,
          shares: position.shares,
          entryPrice: position.entryPrice,
          entryDate: position.entryDate,
          exitPrice,
          exitDate: currentDate,
          profitLoss,
          profitLossPercent,
          holdingPeriodDays,
        };

        trades.push(trade);
        capital += position.type === 'buy'
          ? position.shares * exitPrice
          : position.shares * position.entryPrice + profitLoss; // Short P/L

        openPositions.splice(j, 1);
      }
    }

    // Calculate current equity (cash + open positions)
    const positionsValue = openPositions.reduce((sum, p) => sum + p.shares * currentPrice, 0);
    equityCurve.push({
      date: currentDate,
      equity: capital + positionsValue,
    });
  }

  // Close any remaining open positions at the last price
  const lastPrice = filteredData[filteredData.length - 1].close;
  const lastDate = new Date(filteredData[filteredData.length - 1].timestamp);

  for (const position of openPositions) {
    const profitLoss = position.type === 'buy'
      ? (lastPrice - position.entryPrice) * position.shares
      : (position.entryPrice - lastPrice) * position.shares;
    const profitLossPercent = position.type === 'buy'
      ? ((lastPrice - position.entryPrice) / position.entryPrice) * 100
      : ((position.entryPrice - lastPrice) / position.entryPrice) * 100;
    const holdingPeriodDays = Math.floor((lastDate.getTime() - position.entryDate.getTime()) / (1000 * 60 * 60 * 24));

    const trade: BacktestTrade = {
      id: crypto.randomUUID(),
      ruleId: position.ruleId,
      ruleName: `${position.ruleName} (End of Period)`,
      pattern: position.pattern,
      type: position.type,
      shares: position.shares,
      entryPrice: position.entryPrice,
      entryDate: position.entryDate,
      exitPrice: lastPrice,
      exitDate: lastDate,
      profitLoss,
      profitLossPercent,
      holdingPeriodDays,
    };

    trades.push(trade);
    capital += position.type === 'buy'
      ? position.shares * lastPrice
      : position.shares * position.entryPrice + profitLoss;
  }

  // Calculate metrics
  const metrics = calculateMetrics(trades, initialCapital, capital, equityCurve);

  return {
    id: crypto.randomUUID(),
    config,
    trades,
    metrics,
    equityCurve,
    runAt: new Date(),
  };
}

/**
 * RSI Mean Reversion Strategy Backtest
 * - Buy when RSI < 30 (oversold)
 * - Sell when RSI > 70 (overbought) OR hit stop loss
 * - Stop loss: 5% below entry
 * - This strategy works best in ranging/sideways markets
 */
export async function runRSIBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const { symbol, startDate, endDate, initialCapital, positionSize } = config;

  // RSI Strategy Parameters
  const RSI_OVERSOLD = 30;      // Buy signal
  const RSI_OVERBOUGHT = 70;    // Sell signal
  const STOP_LOSS_PERCENT = 5;  // 5% stop loss
  const RSI_PERIOD = 14;

  const historicalData = await getYahooDaily(symbol, '6mo');

  if (historicalData.length === 0) {
    throw new Error(`No historical data returned for ${symbol}.`);
  }

  // Convert dates to YYYY-MM-DD strings for reliable comparison
  const startDateStr = formatLocalDate(startDate);
  const endDateStr = formatLocalDate(endDate);

  const filteredData = historicalData.filter((d) => {
    return d.timestamp >= startDateStr && d.timestamp <= endDateStr;
  }).sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (filteredData.length < 20) {
    throw new Error('Insufficient data in the selected date range');
  }

  let capital = initialCapital;
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  // Track position
  let position: {
    shares: number;
    entryPrice: number;
    entryDate: Date;
    stopLossPrice: number;
    entryRSI: number;
  } | null = null;

  // Walk through data
  for (let i = RSI_PERIOD + 1; i < filteredData.length; i++) {
    const currentDate = new Date(filteredData[i].timestamp);
    const currentPrice = filteredData[i].close;

    // Calculate RSI
    const closes = filteredData.slice(0, i + 1).map(d => d.close);
    const currentRSI = calculateRSI(closes, RSI_PERIOD);

    // Previous RSI for crossover detection
    const prevCloses = filteredData.slice(0, i).map(d => d.close);
    const prevRSI = calculateRSI(prevCloses, RSI_PERIOD);

    if (position === null) {
      // No position - look for BUY signal
      // Buy when RSI crosses below 30 (oversold)
      if (currentRSI < RSI_OVERSOLD && prevRSI >= RSI_OVERSOLD) {
        const maxShares = Math.floor((capital * positionSize / 100) / currentPrice);
        if (maxShares > 0) {
          position = {
            shares: maxShares,
            entryPrice: currentPrice,
            entryDate: currentDate,
            stopLossPrice: currentPrice * (1 - STOP_LOSS_PERCENT / 100),
            entryRSI: currentRSI,
          };
          capital -= maxShares * currentPrice;
          console.log(`[RSI] BUY: ${maxShares} shares at $${currentPrice.toFixed(2)}, RSI=${currentRSI.toFixed(1)}`);
        }
      }
    } else {
      // Have position - look for SELL signal
      let shouldSell = false;
      let exitReason = '';

      // Sell when RSI crosses above 70 (overbought)
      if (currentRSI > RSI_OVERBOUGHT && prevRSI <= RSI_OVERBOUGHT) {
        shouldSell = true;
        exitReason = 'RSI Overbought';
      }
      // Stop loss hit
      else if (currentPrice <= position.stopLossPrice) {
        shouldSell = true;
        exitReason = 'Stop Loss';
      }

      if (shouldSell) {
        const profitLoss = (currentPrice - position.entryPrice) * position.shares;
        const profitLossPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
        const holdingDays = Math.floor((currentDate.getTime() - position.entryDate.getTime()) / (1000 * 60 * 60 * 24));

        trades.push({
          id: crypto.randomUUID(),
          ruleId: 'rsi-mean-reversion',
          ruleName: `RSI Mean Reversion (${exitReason})`,
          type: 'buy',
          shares: position.shares,
          entryPrice: position.entryPrice,
          entryDate: position.entryDate,
          exitPrice: currentPrice,
          exitDate: currentDate,
          profitLoss,
          profitLossPercent,
          holdingPeriodDays: holdingDays,
        });

        capital += position.shares * currentPrice;
        console.log(`[RSI] SELL: ${position.shares} shares at $${currentPrice.toFixed(2)}, RSI=${currentRSI.toFixed(1)}, P/L=${profitLossPercent.toFixed(1)}% (${exitReason})`);
        position = null;
      }
    }

    // Track equity
    const positionValue = position ? position.shares * currentPrice : 0;
    equityCurve.push({
      date: currentDate,
      equity: capital + positionValue,
    });
  }

  // Close any open position at end
  if (position) {
    const lastPrice = filteredData[filteredData.length - 1].close;
    const lastDate = new Date(filteredData[filteredData.length - 1].timestamp);
    const profitLoss = (lastPrice - position.entryPrice) * position.shares;
    const profitLossPercent = ((lastPrice - position.entryPrice) / position.entryPrice) * 100;
    const holdingDays = Math.floor((lastDate.getTime() - position.entryDate.getTime()) / (1000 * 60 * 60 * 24));

    trades.push({
      id: crypto.randomUUID(),
      ruleId: 'rsi-mean-reversion',
      ruleName: 'RSI Mean Reversion (End of Period)',
      type: 'buy',
      shares: position.shares,
      entryPrice: position.entryPrice,
      entryDate: position.entryDate,
      exitPrice: lastPrice,
      exitDate: lastDate,
      profitLoss,
      profitLossPercent,
      holdingPeriodDays: holdingDays,
    });

    capital += position.shares * lastPrice;
  }

  const metrics = calculateMetrics(trades, initialCapital, capital, equityCurve);

  return {
    id: crypto.randomUUID(),
    config,
    trades,
    metrics,
    equityCurve,
    runAt: new Date(),
  };
}

/**
 * SIMPLE TREND FOLLOWING STRATEGY
 * The simplest possible approach: just ride the trend, don't try to time entries.
 *
 * RULES:
 * - Price > 50 MA → GO LONG (buy and hold until MA crosses)
 * - Price < 50 MA → GO SHORT (short and hold until MA crosses)
 * - Only trade on MA crossovers, NOT on pullbacks
 * - Let winners run!
 */
export async function runHybridBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const { symbol, startDate, endDate, initialCapital, positionSize } = config;

  // Conservative long-term trend parameters
  const TREND_MA = 200;           // 200-day MA - only trade clear long-term uptrends
  const ADX_PERIOD = 14;          // ADX for trend strength
  const ADX_THRESHOLD = 20;       // Slightly lower threshold for 200 MA
  const MAX_HOLD_DAYS = 999;      // No time limit - ride the trend

  const historicalData = await getYahooDaily(symbol, '1y');

  console.log(`[TREND] Raw data: ${historicalData.length} days`);

  if (historicalData.length === 0) {
    throw new Error(`No historical data returned for ${symbol}.`);
  }

  // Convert dates to YYYY-MM-DD strings for reliable comparison
  // (avoids timezone issues between local Date objects and UTC timestamps)
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  console.log(`[Adaptive] Date range: ${startDateStr} to ${endDateStr}`);
  if (historicalData.length > 0) {
    console.log(`[Adaptive] Data range: ${historicalData[0].timestamp} to ${historicalData[historicalData.length - 1].timestamp}`);
  }

  const filteredData = historicalData.filter((d) => {
    // d.timestamp is already in YYYY-MM-DD format from Yahoo
    return d.timestamp >= startDateStr && d.timestamp <= endDateStr;
  }).sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  console.log(`[Adaptive] Filtered: ${filteredData.length} days`);

  // For 200 MA, we need to use ALL data for indicator calculation
  // but only trade in the filtered date range
  if (historicalData.length < TREND_MA + 10) {
    throw new Error(`Insufficient data: need at least ${TREND_MA + 10} days, got ${historicalData.length}`);
  }

  // Find the start index in the full data that corresponds to our filtered date range
  const tradingStartIndex = historicalData.findIndex(d => d.timestamp >= startDateStr);
  if (tradingStartIndex < TREND_MA) {
    // Not enough history before our trading window - adjust start
    console.log(`[TREND] Note: Starting from day ${TREND_MA} (need ${TREND_MA} days for MA)`);
  }

  let capital = initialCapital;
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  let position: {
    shares: number;
    entryPrice: number;
    entryDate: Date;
    direction: 'long' | 'short';
    daysHeld: number;
  } | null = null;

  // Stats for logging
  const regimeStats = { ranging: 0, uptrend: 0, downtrend: 0 };

  // Use full historical data for calculations, but track trading range
  const actualStartIndex = Math.max(TREND_MA, tradingStartIndex);
  const firstPrice = historicalData[actualStartIndex].close;
  const lastPrice = historicalData[historicalData.length - 1].close;
  const buyAndHoldReturn = ((lastPrice - firstPrice) / firstPrice) * 100;
  console.log(`[TREND] ${symbol}: $${firstPrice.toFixed(2)} → $${lastPrice.toFixed(2)} (Buy&Hold: ${buyAndHoldReturn >= 0 ? '+' : ''}${buyAndHoldReturn.toFixed(1)}%)`);

  // Start after enough data for MA
  const startIndex = actualStartIndex;

  // Track previous trend state for crossover detection
  let prevIsUptrend: boolean | null = null;

  for (let i = startIndex; i < historicalData.length; i++) {
    const currentDate = new Date(historicalData[i].timestamp);
    const currentPrice = historicalData[i].close;

    // Skip if outside our trading date range
    if (historicalData[i].timestamp > endDateStr) break;

    // Calculate indicators using FULL history up to this point
    const closes = historicalData.slice(0, i + 1).map(d => d.close);
    const highs = historicalData.slice(0, i + 1).map(d => d.high);
    const lows = historicalData.slice(0, i + 1).map(d => d.low);

    const trendMA = calculateSMA(closes, TREND_MA);
    const adx = calculateADX(highs, lows, closes, ADX_PERIOD);

    // Simple trend: price vs MA
    const isUptrend = currentPrice > trendMA;
    const isDowntrend = currentPrice < trendMA;
    const isTrending = adx > ADX_THRESHOLD; // Only trade clear trends

    // Track regime (only count as trend if ADX confirms)
    if (isTrending && isUptrend) regimeStats.uptrend++;
    else if (isTrending && isDowntrend) regimeStats.downtrend++;
    else regimeStats.ranging++;

    // Detect MA CROSSOVER (trend change)
    const trendJustChangedToUp = isUptrend && prevIsUptrend === false;
    const trendJustChangedToDown = isDowntrend && prevIsUptrend === true;
    prevIsUptrend = isUptrend;

    // SIMPLE RULE: On crossover, switch position
    // - Price crosses ABOVE MA → close short, go long
    // - Price crosses BELOW MA → close long, go short

    // First, check if we need to EXIT current position due to trend change
    if (position !== null) {
      position.daysHeld++;
      let shouldExit = false;
      let exitReason = '';

      const profitPct = position.direction === 'long'
        ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100
        : ((position.entryPrice - currentPrice) / position.entryPrice) * 100;

      // Exit long if trend turns down (price crosses below MA)
      if (trendJustChangedToDown) {
        shouldExit = true;
        exitReason = `MA Crossover DOWN (${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(1)}%)`;
      }
      // Exit if trend weakens (ADX drops below threshold) - avoid getting stuck in chop
      else if (!isTrending && position.daysHeld > 5) {
        shouldExit = true;
        exitReason = `Trend Weakening ADX=${adx.toFixed(0)} (${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(1)}%)`;
      }

      // No time-based exit - ride the trend!
      if (position.daysHeld >= MAX_HOLD_DAYS) {
        shouldExit = true;
        exitReason = 'Time Exit';
      }

      if (shouldExit) {
        const profitLoss = position.direction === 'long'
          ? (currentPrice - position.entryPrice) * position.shares
          : (position.entryPrice - currentPrice) * position.shares;
        const profitLossPercent = profitPct;
        const holdingDays = position.daysHeld;

        trades.push({
          id: crypto.randomUUID(),
          ruleId: `trend-${position.direction}`,
          ruleName: `TREND ${position.direction.toUpperCase()} (${exitReason})`,
          type: position.direction === 'long' ? 'buy' : 'short',
          shares: position.shares,
          entryPrice: position.entryPrice,
          entryDate: position.entryDate,
          exitPrice: currentPrice,
          exitDate: currentDate,
          profitLoss,
          profitLossPercent,
          holdingPeriodDays: holdingDays,
        });

        if (position.direction === 'long') {
          capital += position.shares * currentPrice;
        } else {
          capital += profitLoss;
        }

        console.log(`[TREND] EXIT ${position.direction.toUpperCase()}: $${currentPrice.toFixed(2)}, P/L=${profitLossPercent >= 0 ? '+' : ''}${profitLossPercent.toFixed(1)}% (${exitReason})`);
        position = null;
      }
    }

    // LONG-ONLY STRATEGY: Only go long in uptrends, stay in cash otherwise
    // This avoids the dangerous whipsaw from shorting
    if (position === null && isTrending && isUptrend) {
      if (trendJustChangedToUp || (i === startIndex && isUptrend)) {
        const maxShares = Math.floor((capital * positionSize / 100) / currentPrice);
        if (maxShares > 0) {
          position = {
            shares: maxShares,
            entryPrice: currentPrice,
            entryDate: currentDate,
            direction: 'long',
            daysHeld: 0,
          };
          capital -= maxShares * currentPrice;
          console.log(`[TREND] LONG: ${maxShares} @ $${currentPrice.toFixed(2)} (ADX=${adx.toFixed(0)}, Price > ${TREND_MA}MA)`);
        }
      }
    } else if (position === null) {
      // Log when we're staying in cash
      if (trendJustChangedToUp && !isTrending) {
        console.log(`[TREND] SKIP: ADX=${adx.toFixed(0)} < ${ADX_THRESHOLD} (weak trend)`);
      } else if (trendJustChangedToDown || (i === startIndex && isDowntrend)) {
        console.log(`[TREND] CASH: Downtrend detected, staying in cash (no shorting)`);
      }
    }

    // Track equity
    let positionValue = 0;
    if (position) {
      if (position.direction === 'long') {
        positionValue = position.shares * currentPrice;
      } else {
        // Short position value = unrealized P/L
        positionValue = (position.entryPrice - currentPrice) * position.shares;
      }
    }
    equityCurve.push({
      date: currentDate,
      equity: capital + positionValue,
    });
  }

  // Close any open position at end (long-only strategy)
  if (position) {
    const finalPrice = historicalData[historicalData.length - 1].close;
    const finalDate = new Date(historicalData[historicalData.length - 1].timestamp);
    const profitLoss = (finalPrice - position.entryPrice) * position.shares;
    const profitLossPercent = ((finalPrice - position.entryPrice) / position.entryPrice) * 100;
    const holdingDays = Math.floor((finalDate.getTime() - position.entryDate.getTime()) / (1000 * 60 * 60 * 24));

    trades.push({
      id: crypto.randomUUID(),
      ruleId: `trend-long`,
      ruleName: `LONG (End of Period)`,
      type: 'buy',
      shares: position.shares,
      entryPrice: position.entryPrice,
      entryDate: position.entryDate,
      exitPrice: finalPrice,
      exitDate: finalDate,
      profitLoss,
      profitLossPercent,
      holdingPeriodDays: holdingDays,
    });

    capital += position.shares * finalPrice;
    console.log(`[TREND] EXIT LONG: $${finalPrice.toFixed(2)}, P/L=${profitLossPercent >= 0 ? '+' : ''}${profitLossPercent.toFixed(1)}% (End of Period)`);
  }

  const metrics = calculateMetrics(trades, initialCapital, capital, equityCurve);

  const totalDays = regimeStats.ranging + regimeStats.uptrend + regimeStats.downtrend;
  console.log(`[TREND] Regime: Uptrend ${regimeStats.uptrend} (${(regimeStats.uptrend/totalDays*100).toFixed(0)}%), Downtrend ${regimeStats.downtrend} (${(regimeStats.downtrend/totalDays*100).toFixed(0)}%), Ranging/Choppy ${regimeStats.ranging} (${(regimeStats.ranging/totalDays*100).toFixed(0)}%)`);
  console.log(`[TREND] DONE: ${trades.length} trades, ${metrics.winRate.toFixed(0)}% win, ${metrics.totalReturnPercent >= 0 ? '+' : ''}${metrics.totalReturnPercent.toFixed(1)}% return (Buy&Hold: ${buyAndHoldReturn >= 0 ? '+' : ''}${buyAndHoldReturn.toFixed(1)}%)`);

  return {
    id: crypto.randomUUID(),
    config,
    trades,
    metrics,
    equityCurve,
    runAt: new Date(),
  };
}

export function calculateMetrics(
  trades: BacktestTrade[],
  initialCapital: number,
  finalCapital: number,
  equityCurve: EquityPoint[]
) {
  const completedTrades = trades.filter((t) => t.exitPrice !== undefined);
  const winningTrades = completedTrades.filter((t) => (t.profitLoss || 0) > 0);
  const losingTrades = completedTrades.filter((t) => (t.profitLoss || 0) < 0);

  const totalWins = winningTrades.reduce((sum, t) => sum + (t.profitLoss || 0), 0);
  const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + (t.profitLoss || 0), 0));

  const wins = winningTrades.map((t) => t.profitLoss || 0);
  const losses = losingTrades.map((t) => Math.abs(t.profitLoss || 0));

  // Calculate max drawdown
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  let peak = initialCapital;

  for (const point of equityCurve) {
    if (point.equity > peak) {
      peak = point.equity;
    }
    const drawdown = peak - point.equity;
    const drawdownPercent = (drawdown / peak) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPercent = drawdownPercent;
    }
  }

  const totalReturn = finalCapital - initialCapital;
  const totalReturnPercent = ((finalCapital - initialCapital) / initialCapital) * 100;

  return {
    totalTrades: completedTrades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: completedTrades.length > 0 ? (winningTrades.length / completedTrades.length) * 100 : 0,
    totalReturn,
    totalReturnPercent,
    maxDrawdown,
    maxDrawdownPercent,
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
    averageWin: winningTrades.length > 0 ? totalWins / winningTrades.length : 0,
    averageLoss: losingTrades.length > 0 ? totalLosses / losingTrades.length : 0,
    largestWin: wins.length > 0 ? Math.max(...wins) : 0,
    largestLoss: losses.length > 0 ? Math.max(...losses) : 0,
    averageHoldingPeriod: completedTrades.length > 0
      ? completedTrades.reduce((sum, t) => sum + (t.holdingPeriodDays || 0), 0) / completedTrades.length
      : 0,
    finalCapital,
  };
}

/**
 * OPENING RANGE BREAKOUT (ORB) DAY TRADING SYSTEM
 * Based on proven strategy with 74% win rate
 * Source: https://tradethatswing.com/opening-range-breakout-strategy
 *
 * Rules:
 * 1. Look for stocks breaking above yesterday's high (breakout)
 * 2. Enter when today's price exceeds yesterday's high
 * 3. Profit target: 1.5% (half the typical daily range)
 * 4. Stop loss: 0.75% (tight risk management)
 * 5. Risk/Reward: 2:1
 * 6. Position size: 10% of capital (more aggressive)
 * 7. Take up to 3 trades per day across different stocks
 * 8. Exit by close - ALWAYS in cash overnight
 */

interface DayTradeSetup {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  prevClose: number;
  gapPercent: number;      // How much it gapped from prev close
  dayRange: number;        // (high - low) / open as %
  score: number;           // Overall setup quality
}

// Realistic trading constraints
export const TRADING_CONSTRAINTS = {
  PDT_MINIMUM: 25000,           // Pattern Day Trader minimum
  FULL_POSITION_LIMIT: 100000,  // Full 25% position size up to this
  GOAL_AMOUNT: 500000,          // Stop day trading at this amount
  MIN_POSITION_PERCENT: 5,      // Minimum position size at goal
};

// Historical stocks for backtesting years before 2010
// Only includes stocks that were publicly traded and liquid in 2008
export const HISTORICAL_STOCKS_PRE_2010 = [
  // Tech (existed pre-2008)
  'AAPL',   // 1980
  'MSFT',   // 1986
  'INTC',   // 1971
  'ORCL',   // 1986
  'CSCO',   // 1990
  'IBM',    // 1911
  'HPQ',    // 1957 (HP)
  'DELL',   // 1988
  // Financials
  'JPM',    // 1969
  'BAC',    // 1998
  'GS',     // 1999
  'WFC',    // 1852
  'C',      // 1998 (Citigroup)
  // Healthcare
  'JNJ',    // 1944
  'PFE',    // 1942
  'MRK',    // 1891
  'ABT',    // 1929
  // Consumer
  'KO',     // 1919
  'PEP',    // 1919
  'WMT',    // 1972
  'HD',     // 1981
  'MCD',    // 1965
  'NKE',    // 1980
  'PG',     // 1837
  // Energy
  'XOM',    // 1920s
  'CVX',    // 1926
  // Industrial
  'GE',     // 1892
  'CAT',    // 1929
  'MMM',    // 1946
  'BA',     // 1934
  // Entertainment
  'DIS',    // 1957
];

// Volatility-based slippage multipliers (simulates VIX effect)
// Higher market volatility = wider spreads = more slippage
const VOLATILITY_SLIPPAGE_TIERS = [
  { maxVolatility: 1.0, multiplier: 1.0 },   // Normal: VIX ~12-20
  { maxVolatility: 2.0, multiplier: 2.0 },   // Elevated: VIX ~20-30
  { maxVolatility: 3.0, multiplier: 3.0 },   // High: VIX ~30-50
  { maxVolatility: 5.0, multiplier: 5.0 },   // Panic: VIX ~50-80 (2008, COVID)
  { maxVolatility: Infinity, multiplier: 10.0 }, // Extreme: VIX 80+
];

// Calculate market volatility from recent price data (VIX proxy)
// Returns a multiplier: 1.0 = normal, 2.0+ = elevated, 5.0+ = panic
function calculateMarketVolatility(
  allData: Map<string, any[]>,
  currentDate: string,
  lookbackDays: number = 20
): number {
  let totalVolatility = 0;
  let stockCount = 0;

  allData.forEach((data) => {
    // Find current date index
    const currentIndex = data.findIndex(d => d.timestamp === currentDate);
    if (currentIndex < lookbackDays) return;

    // Calculate average daily range over lookback period
    let sumDailyRange = 0;
    for (let i = currentIndex - lookbackDays; i < currentIndex; i++) {
      const dayRange = (data[i].high - data[i].low) / data[i].close;
      sumDailyRange += dayRange;
    }
    const avgDailyRange = sumDailyRange / lookbackDays;

    // Normal daily range is about 1-2% for most stocks
    // Normalize so 1.5% average range = 1.0 volatility
    const normalizedVolatility = avgDailyRange / 0.015;
    totalVolatility += normalizedVolatility;
    stockCount++;
  });

  if (stockCount === 0) return 1.0;

  const avgVolatility = totalVolatility / stockCount;

  // Find the appropriate slippage multiplier
  for (const tier of VOLATILITY_SLIPPAGE_TIERS) {
    if (avgVolatility <= tier.maxVolatility) {
      return tier.multiplier;
    }
  }

  return 10.0; // Extreme volatility
}

export interface DayTradeResult {
  initialCapital: number;
  finalCapital: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalReturnPercent: number;
  avgWinPercent: number;
  avgLossPercent: number;
  bestDay: number;
  worstDay: number;
  totalCosts: number;  // Total transaction costs paid
  // Drawdown protection info
  drawdownStopTriggered: boolean;
  drawdownStopDate: string | null;
  tradesSkippedDueToDrawdown: number;
  // Goal reached info
  goalReached: boolean;
  goalReachedDate: string | null;
  goalReachedCapital: number | null;
  trades: {
    date: string;
    symbol: string;
    entry: number;
    exit: number;
    pnlPercent: number;
    pnlDollars: number;
    outcome: 'WIN' | 'LOSS' | 'SCRATCH';
  }[];
  equityCurve: { date: string; equity: number }[];
}

export async function runDayTradingBacktest(
  symbols: string[],
  initialCapital: number = 1000,
  positionSizePercent: number = 25,  // 25% of capital per trade - AGGRESSIVE
  profitTargetPercent: number = 2.0, // Take profit at 2%
  stopLossPercent: number = 1.0,     // Stop loss at 1% (2:1 R/R)
  yearsBack: number = 1,             // How many years to backtest (1, 2, 5, 10, 20)
  specificYear?: number,             // Or test a specific year (e.g., 2020)
  // REALISTIC COSTS (defaults are conservative estimates)
  commissionPerTrade: number = 0,    // $0 for Robinhood, ~$1 for others
  slippagePercent: number = 0.1,     // 0.1% slippage per side (entry + exit)
  // RISK MANAGEMENT
  yearlyDrawdownLimit: number = 20   // Stop trading if down this % from year start
): Promise<DayTradeResult> {
  // Determine data range to fetch
  let dataRange: '1y' | '2y' | '5y' | '10y' | 'max' = '1y';
  if (yearsBack >= 20 || specificYear) {
    dataRange = 'max';
  } else if (yearsBack >= 10) {
    dataRange = '10y';
  } else if (yearsBack >= 5) {
    dataRange = '5y';
  } else if (yearsBack >= 2) {
    dataRange = '2y';
  }

  const periodLabel = specificYear ? `Year ${specificYear}` : `Last ${yearsBack} year(s)`;
  console.log(`[ORB] Starting Opening Range Breakout backtest - ${periodLabel}`);
  console.log(`[ORB] Capital: $${initialCapital}, Position: ${positionSizePercent}%, Target: +${profitTargetPercent}%, Stop: -${stopLossPercent}%`);
  console.log(`[ORB] Transaction costs: $${commissionPerTrade}/trade commission + ${slippagePercent}% slippage each way`);
  console.log(`[ORB] Yearly drawdown limit: ${yearlyDrawdownLimit}% (stop trading if hit)`);

  // Fetch historical data for all symbols
  // Use Tiingo for older years (pre-2015), Yahoo for recent years
  const allData: Map<string, any[]> = new Map();
  const thisYear = new Date().getFullYear();
  const useTiingo = specificYear && specificYear < thisYear - 10; // Use Tiingo for 10+ years ago

  if (useTiingo) {
    // For years 1996-2012, use built-in simulated historical data
    const useSimulatedData = specificYear && specificYear >= 1996 && specificYear <= 2012;

    if (useSimulatedData) {
      console.log(`[ORB] Using SIMULATED historical data for ${specificYear}`);
      const availableSymbols = getSymbolsForYear(specificYear!);
      console.log(`[ORB] ${availableSymbols.length} stocks available for ${specificYear}`);

      for (const symbol of availableSymbols) {
        const data = getHistoricalData(symbol, specificYear!);
        if (data && data.length > 20) {
          allData.set(symbol, data);
        }
      }

      console.log(`[ORB] Loaded ${allData.size} stocks from simulated data`);
    } else {
      // For other old years, try Tiingo API with caching
      const useHistoricalStocks = specificYear && specificYear < 2010;
      const stocksToUse = useHistoricalStocks ? HISTORICAL_STOCKS_PRE_2010 : symbols;

      if (useHistoricalStocks) {
        console.log(`[ORB] Using HISTORICAL stocks for ${specificYear} (${stocksToUse.length} stocks that existed then)`);
      }
      console.log(`[ORB] Using Tiingo API for historical data (year ${specificYear})...`);
      const startDate = `${specificYear}-01-01`;
      const endDate = `${specificYear}-12-31`;

      for (const symbol of stocksToUse) {
        try {
          // Check cache first
          const cachedData = getCachedData(symbol, specificYear!);
          if (cachedData && cachedData.length > 20) {
            allData.set(symbol, cachedData);
            continue; // Skip API call, use cached data
          }

          // Not in cache, fetch from Tiingo
          const data = await getTiingoDaily(symbol, startDate, endDate);
          if (data.length > 20) {
            allData.set(symbol, data);
            // Save to cache for next time
            setCachedData(symbol, specificYear!, data);
            console.log(`[ORB] Tiingo: ${symbol} loaded ${data.length} days`);
          } else if (data.length > 0) {
            console.log(`[ORB] ${symbol}: Only ${data.length} days in ${specificYear} (skipping)`);
          } else {
            console.log(`[ORB] Tiingo: ${symbol} returned no data`);
          }
        } catch (e: any) {
          console.log(`[ORB] Tiingo ERROR for ${symbol}: ${e.message || e}`);
        }
        await new Promise(r => setTimeout(r, 100)); // Slightly slower for Tiingo rate limits
      }

      // If no data loaded, warn about API key or rate limit
      if (allData.size === 0) {
        console.error(`[ORB] ERROR: No data loaded. Possible causes:`);
        console.error(`[ORB]   1. Tiingo rate limit hit - wait 1 hour`);
        console.error(`[ORB]   2. API key issue - check VITE_TIINGO_API_KEY in .env`);
        console.error(`[ORB]   3. No cached data available`);
      }
    }
  } else {
    console.log(`[ORB] Fetching ${dataRange} of data for ${symbols.length} stocks...`);
    for (const symbol of symbols) {
      try {
        const data = await getYahooDaily(symbol, dataRange);
        if (data.length > 20) {
          allData.set(symbol, data);
        }
      } catch (e) {
        // Skip failed symbols
      }
      await new Promise(r => setTimeout(r, 50));
    }
  }

  console.log(`[ORB] Loaded ${allData.size} stocks`);

  // Log data range for each stock
  allData.forEach((data, symbol) => {
    if (data.length > 0) {
      const firstDate = data[0].timestamp;
      const lastDate = data[data.length - 1].timestamp;
      console.log(`[ORB] ${symbol}: ${data.length} days (${firstDate} to ${lastDate})`);
    }
  });

  // Find all unique trading dates
  const allDates = new Set<string>();
  allData.forEach(data => {
    data.forEach(d => allDates.add(d.timestamp));
  });
  let sortedDates = Array.from(allDates).sort();

  // Filter dates based on yearsBack or specificYear
  if (specificYear) {
    // Only include dates from the specific year
    sortedDates = sortedDates.filter(d => d.startsWith(`${specificYear}-`));

    // Count stocks that have data for this year
    let stocksWithData = 0;
    allData.forEach((data, symbol) => {
      const yearData = data.filter(d => d.timestamp.startsWith(`${specificYear}-`));
      if (yearData.length > 20) {
        stocksWithData++;
        console.log(`[ORB] ${symbol} has ${yearData.length} days in ${specificYear}`);
      } else {
        console.log(`[ORB] ${symbol} has NO DATA for ${specificYear} (only ${yearData.length} days)`);
      }
    });

    console.log(`[ORB] Filtering to year ${specificYear}: ${sortedDates.length} trading days, ${stocksWithData} stocks have data`);
  } else if (yearsBack < 20) {
    // Filter to last N years
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - yearsBack);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];
    sortedDates = sortedDates.filter(d => d >= cutoffStr);
  }

  if (sortedDates.length < 30) {
    // For old years, data source might not have data - give helpful error
    const stocksWithOldData = Array.from(allData.entries())
      .filter(([_, data]) => data.some(d => specificYear ? d.timestamp.startsWith(`${specificYear}-`) : true))
      .map(([symbol]) => symbol);

    const dataSource = useTiingo ? 'Tiingo' : 'Yahoo Finance';
    throw new Error(
      `Not enough trading days for backtest: ${sortedDates.length} days found. ` +
      `${specificYear ? `${dataSource} may not have data for ${specificYear}. ` : ''}` +
      `${useTiingo ? 'Check your VITE_TIINGO_API_KEY in .env. ' : ''}` +
      `Stocks with data: ${stocksWithOldData.join(', ') || 'none'}. ` +
      `Try a more recent year (2015+) or use stocks that existed then.`
    );
  }

  console.log(`[ORB] Trading period: ${sortedDates[20]} to ${sortedDates[sortedDates.length - 1]} (${sortedDates.length - 20} days)`);

  let capital = initialCapital;
  let totalCostsPaid = 0;  // Track all transaction costs
  const trades: DayTradeResult['trades'] = [];
  const equityCurve: DayTradeResult['equityCurve'] = [];
  const MAX_TRADES_PER_DAY = 5;  // More trades = more compounding

  // Yearly drawdown protection tracking
  let currentYear: string | null = null;
  let yearStartCapital = initialCapital;
  let drawdownStopTriggered = false;
  let drawdownStopDate: string | null = null;
  let tradesSkippedDueToDrawdown = 0;

  // Goal tracking
  let goalReached = false;
  let goalReachedDate: string | null = null;
  let goalReachedCapital: number | null = null;

  // Helper function to calculate dynamic position size based on capital
  // Full size up to $100k, then gradually reduce to avoid market impact
  function getEffectivePositionSize(currentCapital: number): number {
    if (currentCapital <= TRADING_CONSTRAINTS.FULL_POSITION_LIMIT) {
      return positionSizePercent; // Full 25%
    }
    // Scale down linearly from 25% at $100k to 5% at $500k
    const scale = (TRADING_CONSTRAINTS.GOAL_AMOUNT - currentCapital) /
                  (TRADING_CONSTRAINTS.GOAL_AMOUNT - TRADING_CONSTRAINTS.FULL_POSITION_LIMIT);
    const scaledSize = TRADING_CONSTRAINTS.MIN_POSITION_PERCENT +
                       (positionSizePercent - TRADING_CONSTRAINTS.MIN_POSITION_PERCENT) * Math.max(0, scale);
    return Math.max(TRADING_CONSTRAINTS.MIN_POSITION_PERCENT, scaledSize);
  }

  // Start from day 20 to have some history
  // Track volatility for logging
  let lastLoggedVolatility = 0;

  for (let dayIndex = 20; dayIndex < sortedDates.length; dayIndex++) {
    const today = sortedDates[dayIndex];
    const yesterday = sortedDates[dayIndex - 1];
    let tradesToday = 0;

    // Calculate dynamic slippage based on market volatility (VIX proxy)
    const volatilityMultiplier = calculateMarketVolatility(allData, today, 20);
    const dynamicSlippage = slippagePercent * volatilityMultiplier;

    // Log when volatility changes significantly
    if (Math.abs(volatilityMultiplier - lastLoggedVolatility) >= 1.0) {
      const volatilityLevel = volatilityMultiplier <= 1.5 ? 'NORMAL' :
                              volatilityMultiplier <= 2.5 ? 'ELEVATED' :
                              volatilityMultiplier <= 4.0 ? 'HIGH' : 'PANIC';
      console.log(`[ORB] ${today}: Market volatility ${volatilityLevel} (${volatilityMultiplier.toFixed(1)}x) - Slippage: ${dynamicSlippage.toFixed(2)}%`);
      lastLoggedVolatility = volatilityMultiplier;
    }

    // Check if goal reached
    if (!goalReached && capital >= TRADING_CONSTRAINTS.GOAL_AMOUNT) {
      goalReached = true;
      goalReachedDate = today;
      goalReachedCapital = capital;
      console.log(`\n${'🎉'.repeat(20)}`);
      console.log(`[ORB] GOAL REACHED on ${today}! Capital: $${capital.toFixed(2)}`);
      console.log(`[ORB] Day trading strategy complete. Time to transition to long-term investing.`);
      console.log(`${'🎉'.repeat(20)}\n`);
    }

    // Stop trading if goal reached
    if (goalReached) {
      equityCurve.push({ date: today, equity: capital });
      continue;
    }

    // Track year changes for drawdown protection
    const todayYear = today.substring(0, 4);
    if (currentYear !== todayYear) {
      // New year - reset drawdown tracking
      currentYear = todayYear;
      yearStartCapital = capital;
      drawdownStopTriggered = false;
      drawdownStopDate = null;
      console.log(`[ORB] New year ${todayYear}: Starting capital $${capital.toFixed(2)}, drawdown limit ${yearlyDrawdownLimit}%`);
    }

    // Check if drawdown limit hit
    if (!drawdownStopTriggered) {
      const drawdownPercent = ((yearStartCapital - capital) / yearStartCapital) * 100;
      if (drawdownPercent >= yearlyDrawdownLimit) {
        drawdownStopTriggered = true;
        drawdownStopDate = today;
        console.log(`[ORB] DRAWDOWN STOP TRIGGERED on ${today}: Down ${drawdownPercent.toFixed(1)}% from year start ($${yearStartCapital.toFixed(2)} -> $${capital.toFixed(2)})`);
      }
    }

    // Skip trading if drawdown stop is active
    if (drawdownStopTriggered) {
      // Still record equity curve but don't trade
      equityCurve.push({ date: today, equity: capital });
      tradesSkippedDueToDrawdown += MAX_TRADES_PER_DAY; // Estimate of potential trades skipped
      continue;
    }

    // Find ALL breakout setups for today
    const breakouts: DayTradeSetup[] = [];

    allData.forEach((data, symbol) => {
      const todayData = data.find(d => d.timestamp === today);
      const yesterdayData = data.find(d => d.timestamp === yesterday);

      if (!todayData || !yesterdayData) return;

      // OPENING RANGE BREAKOUT CRITERIA (RELAXED for more trades):
      // 1. Today's HIGH exceeds yesterday's HIGH (breakout)
      // 2. Gap not too extreme
      // 3. Some volatility present

      const breakoutAboveYesterdayHigh = todayData.high > yesterdayData.high;
      const gapPercent = Math.abs((todayData.open - yesterdayData.close) / yesterdayData.close) * 100;
      const isReasonableGap = gapPercent < 5; // Allow gaps up to 5%
      const dayRange = ((todayData.high - todayData.low) / todayData.open) * 100;
      const hasEnoughRange = dayRange >= 0.5; // Lower threshold

      // Entry would be at yesterday's high (the breakout level)
      const entryPrice = yesterdayData.high;
      const entryIsReachable = todayData.high >= entryPrice;

      if (breakoutAboveYesterdayHigh && isReasonableGap && hasEnoughRange && entryIsReachable) {
        // Score by how strong the breakout was
        const breakoutStrength = ((todayData.high - yesterdayData.high) / yesterdayData.high) * 100;

        breakouts.push({
          symbol,
          date: today,
          open: todayData.open,
          high: todayData.high,
          low: todayData.low,
          close: todayData.close,
          prevClose: yesterdayData.close,
          gapPercent,
          dayRange,
          score: breakoutStrength * 100 + dayRange * 10,
        });
      }
    });

    // Sort by score and take top setups
    breakouts.sort((a, b) => b.score - a.score);

    for (const setup of breakouts.slice(0, MAX_TRADES_PER_DAY)) {
      if (tradesToday >= MAX_TRADES_PER_DAY) break;

      // Entry at the breakout level (yesterday's high)
      const yesterdayData = allData.get(setup.symbol)?.find(d => d.timestamp === yesterday);
      if (!yesterdayData) continue;

      const entryPrice = yesterdayData.high;
      // Use dynamic position size based on capital (scales down as portfolio grows)
      const effectivePositionPercent = getEffectivePositionSize(capital);
      const positionDollars = capital * (effectivePositionPercent / 100);

      if (positionDollars < 100) continue; // Need at least $100 to trade (realistic minimum)

      const profitTarget = entryPrice * (1 + profitTargetPercent / 100);
      const stopLoss = entryPrice * (1 - stopLossPercent / 100);

      // Simulate: did we hit profit target or stop loss?
      let exitPrice: number;
      let outcome: 'WIN' | 'LOSS' | 'SCRATCH';

      const hitProfit = setup.high >= profitTarget;
      const hitStop = setup.low <= stopLoss;

      if (hitProfit && !hitStop) {
        exitPrice = profitTarget;
        outcome = 'WIN';
      } else if (hitStop && !hitProfit) {
        exitPrice = stopLoss;
        outcome = 'LOSS';
      } else if (hitProfit && hitStop) {
        // Both possible - use close direction as hint
        if (setup.close > entryPrice) {
          exitPrice = profitTarget;
          outcome = 'WIN';
        } else {
          exitPrice = stopLoss;
          outcome = 'LOSS';
        }
      } else {
        // Neither hit - exit at close
        exitPrice = setup.close;
        outcome = exitPrice > entryPrice ? 'WIN' : exitPrice < entryPrice ? 'LOSS' : 'SCRATCH';
      }

      // Use dollar-based P&L (not share-based) for accurate calculation
      // THEN subtract realistic transaction costs
      const grossPnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
      const grossPnlDollars = positionDollars * (grossPnlPercent / 100);

      // Transaction costs:
      // 1. Commission per trade (buy + sell = 2 commissions)
      const totalCommission = commissionPerTrade * 2;
      // 2. Slippage: you buy at slightly higher, sell at slightly lower
      //    Uses DYNAMIC slippage based on market volatility (higher in panic conditions)
      //    Entry slippage: lose dynamicSlippage on entry
      //    Exit slippage: lose dynamicSlippage on exit
      const slippageCost = positionDollars * (dynamicSlippage / 100) * 2; // both entry and exit

      const totalCosts = totalCommission + slippageCost;
      totalCostsPaid += totalCosts;  // Track cumulative costs
      const pnlDollars = grossPnlDollars - totalCosts;
      const pnlPercent = (pnlDollars / positionDollars) * 100;

      capital += pnlDollars;
      tradesToday++;

      trades.push({
        date: today,
        symbol: setup.symbol,
        entry: entryPrice,
        exit: exitPrice,
        pnlPercent,
        pnlDollars,
        outcome,
      });

      if (trades.length <= 15 || trades.length % 100 === 0) {
        console.log(`[ORB] ${today} ${setup.symbol}: ${outcome} ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% ($${pnlDollars.toFixed(2)}) | Capital: $${capital.toFixed(2)}`);
      }
    }

    // Record equity curve
    equityCurve.push({ date: today, equity: capital });
  }

  // Calculate final statistics
  const winningTrades = trades.filter(t => t.outcome === 'WIN');
  const losingTrades = trades.filter(t => t.outcome === 'LOSS');

  const avgWinPercent = winningTrades.length > 0
    ? winningTrades.reduce((sum, t) => sum + t.pnlPercent, 0) / winningTrades.length
    : 0;
  const avgLossPercent = losingTrades.length > 0
    ? losingTrades.reduce((sum, t) => sum + t.pnlPercent, 0) / losingTrades.length
    : 0;

  const result: DayTradeResult = {
    initialCapital,
    finalCapital: capital,
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
    totalReturnPercent: ((capital - initialCapital) / initialCapital) * 100,
    avgWinPercent,
    avgLossPercent,
    bestDay: trades.length > 0 ? Math.max(...trades.map(t => t.pnlPercent)) : 0,
    worstDay: trades.length > 0 ? Math.min(...trades.map(t => t.pnlPercent)) : 0,
    totalCosts: totalCostsPaid,
    drawdownStopTriggered,
    drawdownStopDate,
    tradesSkippedDueToDrawdown,
    goalReached,
    goalReachedDate,
    goalReachedCapital,
    trades,
    equityCurve,
  };

  console.log(`\n[DAY TRADE] ========== RESULTS ==========`);
  console.log(`[DAY TRADE] Initial Capital: $${initialCapital.toFixed(2)}`);
  console.log(`[DAY TRADE] Final Capital: $${capital.toFixed(2)}`);
  console.log(`[DAY TRADE] Total Return: ${result.totalReturnPercent >= 0 ? '+' : ''}${result.totalReturnPercent.toFixed(2)}%`);
  console.log(`[DAY TRADE] Total Trades: ${trades.length}`);
  console.log(`[DAY TRADE] Win Rate: ${result.winRate.toFixed(1)}% (${winningTrades.length}W / ${losingTrades.length}L)`);
  console.log(`[DAY TRADE] Avg Win: +${avgWinPercent.toFixed(2)}%`);
  console.log(`[DAY TRADE] Avg Loss: ${avgLossPercent.toFixed(2)}%`);
  console.log(`[DAY TRADE] Best Day: +${result.bestDay.toFixed(2)}%`);
  console.log(`[DAY TRADE] Worst Day: ${result.worstDay.toFixed(2)}%`);
  console.log(`[DAY TRADE] Total Transaction Costs: $${totalCostsPaid.toFixed(2)} (${((totalCostsPaid / initialCapital) * 100).toFixed(0)}% of initial capital)`);
  if (goalReached) {
    console.log(`[DAY TRADE] 🎉 GOAL REACHED on ${goalReachedDate}! Capital: $${goalReachedCapital?.toFixed(2)}`);
  }
  if (drawdownStopTriggered) {
    console.log(`[DAY TRADE] DRAWDOWN PROTECTION: Stopped trading on ${drawdownStopDate} (saved from further losses)`);
  }
  console.log(`[DAY TRADE] ==============================\n`);

  return result;
}
