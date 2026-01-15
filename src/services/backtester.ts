// Backtesting Service
// Tests trading rules against historical data

import type { TradingRule, BacktestConfig, BacktestResult, BacktestTrade, CandlestickPattern } from '../types';
import { getDailyData } from './alphaVantage';
import { detectPatterns, type Candle } from './candlestickPatterns';

interface Position {
  ruleId: string;
  ruleName: string;
  pattern?: CandlestickPattern;
  type: 'buy' | 'sell';
  shares: number;
  entryPrice: number;
  entryDate: Date;
}

export interface EquityPoint {
  date: Date;
  equity: number;
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

    // Check for pattern matches against rules
    for (const pattern of patterns) {
      const matchingRule = activeRules.find((r) => r.pattern === pattern.pattern);

      if (matchingRule) {
        // Check if we already have an open position from this rule
        const existingPosition = openPositions.find((p) => p.ruleId === matchingRule.id);

        if (!existingPosition && matchingRule.type === 'buy') {
          // Open a new long position
          const shares = Math.floor((capital * positionSize / 100) / currentPrice);
          if (shares > 0 && capital >= shares * currentPrice) {
            const position: Position = {
              ruleId: matchingRule.id,
              ruleName: matchingRule.name,
              pattern: pattern.pattern,
              type: 'buy',
              shares,
              entryPrice: currentPrice,
              entryDate: currentDate,
            };
            openPositions.push(position);
            capital -= shares * currentPrice;
          }
        } else if (existingPosition && matchingRule.type === 'sell') {
          // Close the position
          const exitPrice = currentPrice;
          const profitLoss = (exitPrice - existingPosition.entryPrice) * existingPosition.shares;
          const profitLossPercent = ((exitPrice - existingPosition.entryPrice) / existingPosition.entryPrice) * 100;
          const holdingPeriodDays = Math.floor((currentDate.getTime() - existingPosition.entryDate.getTime()) / (1000 * 60 * 60 * 24));

          const trade: BacktestTrade = {
            id: crypto.randomUUID(),
            ruleId: existingPosition.ruleId,
            ruleName: existingPosition.ruleName,
            pattern: existingPosition.pattern,
            type: existingPosition.type,
            shares: existingPosition.shares,
            entryPrice: existingPosition.entryPrice,
            entryDate: existingPosition.entryDate,
            exitPrice,
            exitDate: currentDate,
            profitLoss,
            profitLossPercent,
            holdingPeriodDays,
          };

          trades.push(trade);
          capital += existingPosition.shares * exitPrice;

          // Remove from open positions
          const index = openPositions.findIndex((p) => p.ruleId === matchingRule.id);
          if (index > -1) openPositions.splice(index, 1);
        }
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
    const profitLoss = (lastPrice - position.entryPrice) * position.shares;
    const profitLossPercent = ((lastPrice - position.entryPrice) / position.entryPrice) * 100;
    const holdingPeriodDays = Math.floor((lastDate.getTime() - position.entryDate.getTime()) / (1000 * 60 * 60 * 24));

    const trade: BacktestTrade = {
      id: crypto.randomUUID(),
      ruleId: position.ruleId,
      ruleName: position.ruleName,
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
    capital += position.shares * lastPrice;
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
