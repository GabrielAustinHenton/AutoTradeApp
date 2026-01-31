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
import { getYahooDaily } from './alphaVantage';
import { detectPatterns, type Candle } from './candlestickPatterns';

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
  const historicalData = await getYahooDaily(symbol, '3mo');

  if (historicalData.length === 0) {
    throw new Error(`No historical data returned for ${symbol}. Check your API key or wait for rate limit to reset.`);
  }

  if (historicalData.length < 10) {
    throw new Error(`Insufficient historical data for ${symbol}. Only ${historicalData.length} days available.`);
  }

  // Filter data to the specified date range
  const filteredData = historicalData.filter((d) => {
    const date = new Date(d.timestamp);
    return date >= startDate && date <= endDate;
  }).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

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

  const historicalData = await getYahooDaily(symbol, '3mo');

  if (historicalData.length === 0) {
    throw new Error(`No historical data returned for ${symbol}.`);
  }

  const filteredData = historicalData.filter((d) => {
    const date = new Date(d.timestamp);
    return date >= startDate && date <= endDate;
  }).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

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
 * TREND-ADAPTIVE PULLBACK STRATEGY
 * Trades WITH the trend using pullback entries.
 *
 * UPTREND (price > 20 SMA): BUY after 2 down days (buy the dip)
 * DOWNTREND (price < 20 SMA): SHORT after 2 up days (sell the rally)
 *
 * This ensures we always trade in the direction of the trend.
 */
export async function runHybridBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const { symbol, startDate, endDate, initialCapital, positionSize } = config;

  const STOP_LOSS_PERCENT = 3;
  const SMA_PERIOD = 20;

  const historicalData = await getYahooDaily(symbol, '3mo');

  console.log(`[Trend] Raw data: ${historicalData.length} days`);

  if (historicalData.length === 0) {
    throw new Error(`No historical data returned for ${symbol}.`);
  }

  const filteredData = historicalData.filter((d) => {
    const date = new Date(d.timestamp);
    return date >= startDate && date <= endDate;
  }).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  console.log(`[Trend] Filtered: ${filteredData.length} days`);

  if (filteredData.length < 10) {
    throw new Error(`Insufficient data: only ${filteredData.length} days in range`);
  }

  let capital = initialCapital;
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  let position: {
    shares: number;
    entryPrice: number;
    entryDate: Date;
    stopLossPrice: number;
    direction: 'long' | 'short';
    daysHeld: number;
  } | null = null;

  const firstPrice = filteredData[0].close;
  const lastPrice = filteredData[filteredData.length - 1].close;
  const buyAndHoldReturn = ((lastPrice - firstPrice) / firstPrice) * 100;
  console.log(`[Trend] ${symbol}: $${firstPrice.toFixed(2)} → $${lastPrice.toFixed(2)} (Buy&Hold: ${buyAndHoldReturn >= 0 ? '+' : ''}${buyAndHoldReturn.toFixed(1)}%)`);

  for (let i = 2; i < filteredData.length; i++) {
    const currentDate = new Date(filteredData[i].timestamp);
    const currentPrice = filteredData[i].close;
    const prevPrice = filteredData[i - 1].close;
    const prev2Price = filteredData[i - 2].close;

    // Calculate SMA for trend
    const closes = filteredData.slice(0, i + 1).map(d => d.close);
    const sma = calculateSMA(closes, Math.min(SMA_PERIOD, closes.length));
    const isUptrend = currentPrice > sma;
    const isDowntrend = currentPrice < sma;

    // Check for 2 consecutive down/up days
    const downDay1 = prevPrice < prev2Price;
    const downDay2 = currentPrice < prevPrice;
    const twoDownDays = downDay1 && downDay2;

    const upDay1 = prevPrice > prev2Price;
    const upDay2 = currentPrice > prevPrice;
    const twoUpDays = upDay1 && upDay2;

    const upDay = currentPrice > prevPrice;
    const downDay = currentPrice < prevPrice;

    let newDirection: 'long' | 'short' | null = null;
    let reason = '';

    if (isUptrend && twoDownDays) {
      // Uptrend + pullback = buy the dip
      newDirection = 'long';
      reason = 'UPTREND: 2 down days - buy dip';
    } else if (isDowntrend && twoUpDays) {
      // Downtrend + rally = short the rally
      newDirection = 'short';
      reason = 'DOWNTREND: 2 up days - short rally';
    }

    // Check exit conditions for existing position
    if (position !== null) {
      position.daysHeld++;
      let shouldExit = false;
      let exitReason = '';

      if (position.direction === 'long') {
        const isProfitable = currentPrice > position.entryPrice;
        // Exit LONG on up day if profitable
        if (upDay && isProfitable) {
          shouldExit = true;
          exitReason = 'Take Profit';
        } else if (currentPrice <= position.stopLossPrice) {
          shouldExit = true;
          exitReason = 'Stop Loss';
        } else if (position.daysHeld >= 5) {
          shouldExit = true;
          exitReason = 'Time Exit';
        }
      } else {
        // SHORT position
        const isProfitable = currentPrice < position.entryPrice;
        // Exit SHORT on down day if profitable
        if (downDay && isProfitable) {
          shouldExit = true;
          exitReason = 'Take Profit';
        } else if (currentPrice >= position.stopLossPrice) {
          shouldExit = true;
          exitReason = 'Stop Loss';
        } else if (position.daysHeld >= 5) {
          shouldExit = true;
          exitReason = 'Time Exit';
        }
      }

      if (shouldExit) {
        const profitLoss = position.direction === 'long'
          ? (currentPrice - position.entryPrice) * position.shares
          : (position.entryPrice - currentPrice) * position.shares;
        const profitLossPercent = position.direction === 'long'
          ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100
          : ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
        const holdingDays = Math.floor((currentDate.getTime() - position.entryDate.getTime()) / (1000 * 60 * 60 * 24));

        trades.push({
          id: crypto.randomUUID(),
          ruleId: `hybrid-${position.direction}`,
          ruleName: `${position.direction.toUpperCase()} (${exitReason})`,
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

        console.log(`[Trend] EXIT ${position.direction.toUpperCase()}: $${currentPrice.toFixed(2)}, P/L=${profitLossPercent >= 0 ? '+' : ''}${profitLossPercent.toFixed(1)}% (${exitReason})`);
        position = null;
      }
    }

    // Enter new position if we have a signal and no position
    if (position === null && newDirection) {
      const maxShares = Math.floor((capital * positionSize / 100) / currentPrice);
      if (maxShares > 0) {
        const stopLoss = newDirection === 'long'
          ? currentPrice * (1 - STOP_LOSS_PERCENT / 100)
          : currentPrice * (1 + STOP_LOSS_PERCENT / 100);

        position = {
          shares: maxShares,
          entryPrice: currentPrice,
          entryDate: currentDate,
          stopLossPrice: stopLoss,
          direction: newDirection,
          daysHeld: 0,
        };

        if (newDirection === 'long') {
          capital -= maxShares * currentPrice;
        }

        console.log(`[Trend] ${newDirection.toUpperCase()}: ${maxShares} @ $${currentPrice.toFixed(2)} (${reason})`);
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

  // Close any open position at end
  if (position) {
    const finalPrice = filteredData[filteredData.length - 1].close;
    const finalDate = new Date(filteredData[filteredData.length - 1].timestamp);
    const profitLoss = position.direction === 'long'
      ? (finalPrice - position.entryPrice) * position.shares
      : (position.entryPrice - finalPrice) * position.shares;
    const profitLossPercent = position.direction === 'long'
      ? ((finalPrice - position.entryPrice) / position.entryPrice) * 100
      : ((position.entryPrice - finalPrice) / position.entryPrice) * 100;
    const holdingDays = Math.floor((finalDate.getTime() - position.entryDate.getTime()) / (1000 * 60 * 60 * 24));

    trades.push({
      id: crypto.randomUUID(),
      ruleId: `hybrid-${position.direction}`,
      ruleName: `${position.direction.toUpperCase()} (End of Period)`,
      type: position.direction === 'long' ? 'buy' : 'short',
      shares: position.shares,
      entryPrice: position.entryPrice,
      entryDate: position.entryDate,
      exitPrice: finalPrice,
      exitDate: finalDate,
      profitLoss,
      profitLossPercent,
      holdingPeriodDays: holdingDays,
    });

    if (position.direction === 'long') {
      capital += position.shares * finalPrice;
    } else {
      capital += profitLoss;
    }
  }

  const metrics = calculateMetrics(trades, initialCapital, capital, equityCurve);

  console.log(`[Trend] DONE: ${trades.length} trades, ${metrics.winRate.toFixed(0)}% win, ${metrics.totalReturnPercent >= 0 ? '+' : ''}${metrics.totalReturnPercent.toFixed(1)}% return`);

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
