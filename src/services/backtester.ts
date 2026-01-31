// Backtesting Service
// Tests trading rules against historical data
// v3: Now includes RSI and volume filter validation

import type { TradingRule, BacktestConfig, BacktestResult, BacktestTrade, CandlestickPattern } from '../types';
import { getDailyData } from './alphaVantage';
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

export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const { symbol, startDate, endDate, initialCapital, positionSize, rules } = config;

  // Fetch historical data (compact = last 100 trading days, full requires premium)
  const historicalData = await getDailyData(symbol, 'compact');

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
          // ===== FILTER VALIDATION (v3) =====

          // Check confidence threshold
          if (matchingRule.minConfidence && pattern.confidence < matchingRule.minConfidence) {
            continue; // Skip - pattern confidence too low
          }

          // Check RSI filter
          if (matchingRule.rsiFilter?.enabled) {
            if (matchingRule.type === 'buy' && matchingRule.rsiFilter.maxRSI) {
              if (currentRSI > matchingRule.rsiFilter.maxRSI) {
                continue; // Skip - RSI too high for buy
              }
            }
            if (matchingRule.type === 'short' && matchingRule.rsiFilter.minRSI) {
              if (currentRSI < matchingRule.rsiFilter.minRSI) {
                continue; // Skip - RSI too low for short
              }
            }
          }

          // Check volume filter
          if (matchingRule.volumeFilter?.enabled && matchingRule.volumeFilter.minMultiplier) {
            if (volumeMultiplier < matchingRule.volumeFilter.minMultiplier) {
              continue; // Skip - volume too low
            }
          }

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
