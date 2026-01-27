import { useStore } from '../store/useStore';
import { getQuote } from './alphaVantage';
import { getBinancePrice, isCryptoSymbol } from './binanceApi';
import { logger } from '../utils/logger';
import type { Position, TradingRule, AutoTradeExecution } from '../types';

/**
 * Position Monitor Service
 * Monitors open positions and auto-sells when take-profit or stop-loss targets are hit
 */

interface PositionTarget {
  symbol: string;
  positionId: string;
  ruleId: string;
  ruleName: string;
  avgCost: number;
  shares: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  trailingStopPercent?: number; // Trailing stop percentage from highest price
}

// Track positions with active targets
let monitoredPositions: PositionTarget[] = [];
let monitorInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Calculate target prices based on rule settings
 */
function calculateTargets(position: Position, rule: TradingRule): PositionTarget | null {
  if (!rule.takeProfitPercent && !rule.stopLossPercent && !rule.trailingStopPercent) {
    return null;
  }

  const target: PositionTarget = {
    symbol: position.symbol,
    positionId: position.id,
    ruleId: rule.id,
    ruleName: rule.name,
    avgCost: position.avgCost,
    shares: position.shares,
  };

  if (rule.takeProfitPercent) {
    target.takeProfitPrice = position.avgCost * (1 + rule.takeProfitPercent / 100);
  }

  if (rule.stopLossPercent) {
    target.stopLossPrice = position.avgCost * (1 - rule.stopLossPercent / 100);
  }

  if (rule.trailingStopPercent) {
    target.trailingStopPercent = rule.trailingStopPercent;
  }

  return target;
}

/**
 * Check if a position should be sold based on current price
 */
function shouldSell(
  target: PositionTarget,
  currentPrice: number,
  highestPrice?: number
): { sell: boolean; reason: 'take_profit' | 'stop_loss' | 'trailing_stop' | null; targetPrice: number | null } {
  // Check take-profit first (prioritize locking in gains)
  if (target.takeProfitPrice && currentPrice >= target.takeProfitPrice) {
    return { sell: true, reason: 'take_profit', targetPrice: target.takeProfitPrice };
  }

  // Check trailing stop (before fixed stop-loss since it's dynamic)
  if (target.trailingStopPercent && highestPrice) {
    const trailingStopPrice = highestPrice * (1 - target.trailingStopPercent / 100);
    // Only trigger if we've made some profit (price above avg cost)
    if (highestPrice > target.avgCost && currentPrice <= trailingStopPrice) {
      return { sell: true, reason: 'trailing_stop', targetPrice: trailingStopPrice };
    }
  }

  // Check fixed stop-loss
  if (target.stopLossPrice && currentPrice <= target.stopLossPrice) {
    return { sell: true, reason: 'stop_loss', targetPrice: target.stopLossPrice };
  }

  return { sell: false, reason: null, targetPrice: null };
}

/**
 * Execute auto-sell for a position
 */
async function executeAutoSell(
  target: PositionTarget,
  currentPrice: number,
  reason: 'take_profit' | 'stop_loss' | 'trailing_stop'
): Promise<boolean> {
  const store = useStore.getState();
  const { tradingMode, autoTradeConfig, paperPortfolio, addAutoTradeExecution } = store;

  // Only execute in paper mode for now
  if (tradingMode !== 'paper') {
    logger.warn('PositionMonitor', `Auto-sell skipped: not in paper mode`);
    return false;
  }

  if (!autoTradeConfig.enabled) {
    logger.warn('PositionMonitor', `Auto-sell skipped: auto-trading disabled`);
    return false;
  }

  // Find the position
  const position = paperPortfolio.positions.find((p) => p.id === target.positionId);
  if (!position) {
    logger.warn('PositionMonitor', `Position ${target.positionId} no longer exists`);
    return false;
  }

  const sharesToSell = position.shares;
  const total = sharesToSell * currentPrice;
  const profitLoss = (currentPrice - target.avgCost) * sharesToSell;
  const profitLossPercent = ((currentPrice - target.avgCost) / target.avgCost) * 100;

  const reasonLabel = reason === 'take_profit' ? 'TAKE PROFIT' : reason === 'trailing_stop' ? 'TRAILING STOP' : 'STOP LOSS';
  const plEmoji = profitLoss >= 0 ? '💰' : '📉';
  const plColor = profitLoss >= 0 ? 'profit' : 'loss';

  // Clear, prominent P/L logging
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${plEmoji} TRADE CLOSED: ${target.symbol} - ${reasonLabel}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`   Shares Sold: ${sharesToSell}`);
  console.log(`   Entry Price: $${target.avgCost.toFixed(2)}`);
  console.log(`   Exit Price:  $${currentPrice.toFixed(2)}`);
  console.log(`   ---`);
  console.log(`   P/L: ${profitLoss >= 0 ? '+' : ''}$${profitLoss.toFixed(2)} (${profitLossPercent >= 0 ? '+' : ''}${profitLossPercent.toFixed(2)}%)`);
  console.log(`${'='.repeat(60)}\n`);

  logger.info(
    'PositionMonitor',
    `${reasonLabel} triggered for ${target.symbol}: ` +
      `selling ${sharesToSell} shares @ $${currentPrice.toFixed(2)} ` +
      `(${profitLoss >= 0 ? '+' : ''}$${profitLoss.toFixed(2)}, ${profitLossPercent >= 0 ? '+' : ''}${profitLossPercent.toFixed(2)}%)`
  );

  // Execute the sell in paper portfolio
  const executePaperSell = useStore.getState().executePaperSell;
  const success = executePaperSell(target.symbol, sharesToSell, currentPrice);

  if (success) {
    // Record the auto-trade execution
    const reasonDisplayName = reason === 'take_profit' ? 'Take Profit' : reason === 'trailing_stop' ? 'Trailing Stop' : 'Stop Loss';
    const execution: AutoTradeExecution = {
      id: `exec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      ruleId: target.ruleId,
      ruleName: `${target.ruleName} (${reasonDisplayName})`,
      alertId: `auto-${reason}-${Date.now()}`,
      symbol: target.symbol,
      type: 'sell',
      shares: sharesToSell,
      price: currentPrice,
      total,
      status: 'executed',
      mode: 'paper',
      timestamp: new Date(),
    };
    addAutoTradeExecution(execution);

    // Remove from monitored positions
    monitoredPositions = monitoredPositions.filter((p) => p.positionId !== target.positionId);

    logger.info('PositionMonitor', `Auto-sell executed successfully for ${target.symbol}`);
    return true;
  } else {
    logger.error('PositionMonitor', `Failed to execute auto-sell for ${target.symbol}`);
    return false;
  }
}

/**
 * Scan positions and check targets
 */
async function scanPositions(): Promise<void> {
  if (monitoredPositions.length === 0) {
    return;
  }

  const store = useStore.getState();
  if (!store.autoTradeConfig.enabled || store.tradingMode !== 'paper') {
    return;
  }

  logger.debug('PositionMonitor', `Scanning ${monitoredPositions.length} monitored positions`);

  for (const target of [...monitoredPositions]) {
    try {
      // Use Binance for crypto, Alpha Vantage for stocks
      let currentPrice: number | null = null;
      if (isCryptoSymbol(target.symbol)) {
        currentPrice = await getBinancePrice(target.symbol);
      } else {
        const quote = await getQuote(target.symbol);
        currentPrice = quote?.price ?? null;
      }

      if (currentPrice === null) {
        logger.warn('PositionMonitor', `Could not get quote for ${target.symbol}`);
        continue;
      }

      // Get the position's highest price from the store
      const position = store.paperPortfolio.positions.find((p) => p.id === target.positionId);
      let highestPrice = position?.highestPrice || target.avgCost;

      // Update highest price if current price is higher
      if (currentPrice > highestPrice) {
        highestPrice = currentPrice;
        // Update in store
        useStore.setState((s) => ({
          paperPortfolio: {
            ...s.paperPortfolio,
            positions: s.paperPortfolio.positions.map((p) =>
              p.id === target.positionId ? { ...p, highestPrice: currentPrice, currentPrice } : p
            ),
          },
        }));
        logger.debug('PositionMonitor', `New high for ${target.symbol}: $${currentPrice.toFixed(2)}`);
      }

      const { sell, reason, targetPrice } = shouldSell(target, currentPrice, highestPrice);

      if (sell && reason) {
        const reasonLabel = reason === 'trailing_stop' ? 'TRAILING_STOP' : reason.toUpperCase();
        logger.info(
          'PositionMonitor',
          `${reasonLabel} hit for ${target.symbol}: ` +
            `current $${currentPrice.toFixed(2)}, target $${targetPrice?.toFixed(2)}` +
            (reason === 'trailing_stop' ? `, highest $${highestPrice?.toFixed(2)}` : '')
        );
        await executeAutoSell(target, currentPrice, reason);
      } else if (target.trailingStopPercent && highestPrice > target.avgCost) {
        // Log trailing stop status for active positions in profit
        const trailingStopPrice = highestPrice * (1 - target.trailingStopPercent / 100);
        const profitPercent = ((currentPrice - target.avgCost) / target.avgCost * 100).toFixed(2);
        const distanceToStop = ((currentPrice - trailingStopPrice) / currentPrice * 100).toFixed(2);
        logger.debug(
          'PositionMonitor',
          `${target.symbol}: $${currentPrice.toFixed(2)} (+${profitPercent}%) | ` +
            `Trail stop @ $${trailingStopPrice.toFixed(2)} (${distanceToStop}% away) | ` +
            `High: $${highestPrice.toFixed(2)}`
        );
      }

      // Small delay between checks to avoid rate limiting
      await new Promise((r) => setTimeout(r, 300));
    } catch (error) {
      logger.error('PositionMonitor', `Error checking ${target.symbol}`, error);
    }
  }
}

/**
 * Register a position for monitoring with take-profit/stop-loss targets
 */
export function registerPositionForMonitoring(position: Position, rule: TradingRule): void {
  const target = calculateTargets(position, rule);
  if (!target) {
    return;
  }

  // Check if already monitoring this position
  const existing = monitoredPositions.find((p) => p.positionId === position.id);
  if (existing) {
    // Update targets
    Object.assign(existing, target);
    logger.info('PositionMonitor', `Updated targets for ${position.symbol}`);
  } else {
    monitoredPositions.push(target);
    logger.info(
      'PositionMonitor',
      `Monitoring ${position.symbol}: ` +
        `TP: ${target.takeProfitPrice ? '$' + target.takeProfitPrice.toFixed(2) : 'none'}, ` +
        `SL: ${target.stopLossPrice ? '$' + target.stopLossPrice.toFixed(2) : 'none'}, ` +
        `Trailing: ${target.trailingStopPercent ? target.trailingStopPercent + '%' : 'none'}`
    );
  }
}

/**
 * Remove a position from monitoring
 */
export function unregisterPosition(positionId: string): void {
  const removed = monitoredPositions.find((p) => p.positionId === positionId);
  if (removed) {
    monitoredPositions = monitoredPositions.filter((p) => p.positionId !== positionId);
    logger.info('PositionMonitor', `Stopped monitoring position ${removed.symbol}`);
  }
}

/**
 * Get currently monitored positions
 */
export function getMonitoredPositions(): PositionTarget[] {
  return [...monitoredPositions];
}

/**
 * Start the position monitor
 */
export function startPositionMonitor(intervalMs: number = 30000): void {
  if (monitorInterval) {
    logger.warn('PositionMonitor', 'Monitor already running');
    return;
  }

  logger.info('PositionMonitor', `Starting position monitor (interval: ${intervalMs / 1000}s)`);

  // Initial scan
  scanPositions();

  // Set up interval
  monitorInterval = setInterval(scanPositions, intervalMs);
}

/**
 * Stop the position monitor
 */
export function stopPositionMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    logger.info('PositionMonitor', 'Position monitor stopped');
  }
}

/**
 * Check if monitor is running
 */
export function isMonitorRunning(): boolean {
  return monitorInterval !== null;
}
