// Crypto Backtesting Service
// Tests trading rules against historical crypto data from Binance

import type { CryptoBacktestConfig, CryptoBacktestResult, CryptoBacktestTrade, CandlestickPattern } from '../types';
import { getBinanceCandles } from './binanceApi';
import { detectPatterns, type Candle } from './candlestickPatterns';

interface Position {
  ruleId: string;
  ruleName: string;
  pattern?: CandlestickPattern;
  type: 'buy';
  amount: number;
  entryPrice: number;
  entryDate: Date;
  highestPrice: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingStopPercent?: number;
}

interface EquityPoint {
  date: Date;
  equity: number;
}

export async function runCryptoBacktest(config: CryptoBacktestConfig): Promise<CryptoBacktestResult> {
  const { symbol, startDate, endDate, initialCapital, positionSizePercent, rules } = config;

  // Fetch historical data from Binance (1h candles for better granularity)
  // Binance API limits to 1000 candles per request
  const historicalData = await getBinanceCandles(symbol, '1h', 1000);

  if (!historicalData || historicalData.length === 0) {
    throw new Error(`No historical data returned for ${symbol}. Check if the symbol is valid.`);
  }

  if (historicalData.length < 20) {
    throw new Error(`Insufficient historical data for ${symbol}. Only ${historicalData.length} candles available.`);
  }

  // Filter data to the specified date range
  const filteredData = historicalData.filter((d) => {
    const date = new Date(d.date);
    return date >= startDate && date <= endDate;
  }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (filteredData.length < 20) {
    throw new Error(`Insufficient data in the selected date range. Only ${filteredData.length} candles.`);
  }

  // Initialize tracking variables
  let capital = initialCapital;
  const trades: CryptoBacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  const openPositions: Position[] = [];

  // Filter rules to only enabled buy rules for the symbol
  const activeRules = rules.filter(
    (r) => r.enabled && r.ruleType === 'pattern' && r.symbol.toUpperCase() === symbol.toUpperCase() && r.type === 'buy'
  );

  if (activeRules.length === 0) {
    throw new Error(`No enabled buy rules found for ${symbol}`);
  }

  // Walk through historical data
  for (let i = 10; i < filteredData.length; i++) {
    const currentData = filteredData[i];
    const currentDate = new Date(currentData.date);
    const currentPrice = currentData.close;

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
        // Check confidence threshold
        if (matchingRule.minConfidence && pattern.confidence < matchingRule.minConfidence) {
          continue;
        }

        // Check if we already have an open position from this rule
        const existingPosition = openPositions.find((p) => p.ruleId === matchingRule.id);

        if (!existingPosition) {
          // Calculate position size
          const portfolioValue = capital + openPositions.reduce((sum, p) => sum + p.amount * currentPrice, 0);
          const maxPositionValue = portfolioValue * (positionSizePercent / 100);
          const tradeValue = Math.min(maxPositionValue, capital);

          if (tradeValue >= 10) {
            const amount = tradeValue / currentPrice;

            const position: Position = {
              ruleId: matchingRule.id,
              ruleName: matchingRule.name,
              pattern: pattern.pattern,
              type: 'buy',
              amount,
              entryPrice: currentPrice,
              entryDate: currentDate,
              highestPrice: currentPrice,
              stopLossPrice: matchingRule.stopLossPercent
                ? currentPrice * (1 - matchingRule.stopLossPercent / 100)
                : undefined,
              takeProfitPrice: matchingRule.takeProfitPercent
                ? currentPrice * (1 + matchingRule.takeProfitPercent / 100)
                : undefined,
              trailingStopPercent: matchingRule.trailingStopPercent,
            };

            openPositions.push(position);
            capital -= tradeValue;
          }
        }
      }
    }

    // Check exit conditions for open positions
    for (let j = openPositions.length - 1; j >= 0; j--) {
      const position = openPositions[j];
      let shouldExit = false;
      let exitReason = '';

      // Update highest price
      if (currentPrice > position.highestPrice) {
        position.highestPrice = currentPrice;
      }

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

      if (shouldExit) {
        const exitPrice = currentPrice;
        const profitLoss = (exitPrice - position.entryPrice) * position.amount;
        const profitLossPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
        const holdingPeriodHours = Math.floor(
          (currentDate.getTime() - position.entryDate.getTime()) / (1000 * 60 * 60)
        );

        const trade: CryptoBacktestTrade = {
          id: crypto.randomUUID(),
          ruleId: position.ruleId,
          ruleName: `${position.ruleName} (${exitReason})`,
          pattern: position.pattern,
          type: 'buy',
          amount: position.amount,
          entryPrice: position.entryPrice,
          entryDate: position.entryDate,
          exitPrice,
          exitDate: currentDate,
          profitLoss,
          profitLossPercent,
          holdingPeriodHours,
        };

        trades.push(trade);
        capital += position.amount * exitPrice;
        openPositions.splice(j, 1);
      }
    }

    // Calculate current equity
    const positionsValue = openPositions.reduce((sum, p) => sum + p.amount * currentPrice, 0);
    equityCurve.push({
      date: currentDate,
      equity: capital + positionsValue,
    });
  }

  // Close any remaining open positions at the last price
  const lastData = filteredData[filteredData.length - 1];
  const lastPrice = lastData.close;
  const lastDate = new Date(lastData.date);

  for (const position of openPositions) {
    const profitLoss = (lastPrice - position.entryPrice) * position.amount;
    const profitLossPercent = ((lastPrice - position.entryPrice) / position.entryPrice) * 100;
    const holdingPeriodHours = Math.floor(
      (lastDate.getTime() - position.entryDate.getTime()) / (1000 * 60 * 60)
    );

    const trade: CryptoBacktestTrade = {
      id: crypto.randomUUID(),
      ruleId: position.ruleId,
      ruleName: `${position.ruleName} (End of Period)`,
      pattern: position.pattern,
      type: 'buy',
      amount: position.amount,
      entryPrice: position.entryPrice,
      entryDate: position.entryDate,
      exitPrice: lastPrice,
      exitDate: lastDate,
      profitLoss,
      profitLossPercent,
      holdingPeriodHours,
    };

    trades.push(trade);
    capital += position.amount * lastPrice;
  }

  // Calculate metrics
  const metrics = calculateCryptoMetrics(trades, initialCapital, capital, equityCurve);

  return {
    id: crypto.randomUUID(),
    config,
    trades,
    metrics,
    equityCurve,
    runAt: new Date(),
  };
}

function calculateCryptoMetrics(
  trades: CryptoBacktestTrade[],
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
    averageHoldingPeriodHours: completedTrades.length > 0
      ? completedTrades.reduce((sum, t) => sum + (t.holdingPeriodHours || 0), 0) / completedTrades.length
      : 0,
    finalCapital,
  };
}
