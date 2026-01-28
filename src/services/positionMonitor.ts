import { useStore } from '../store/useStore';
import { getQuote } from './alphaVantage';
import { getBinancePrice, isCryptoSymbol } from './binanceApi';
import { logger } from '../utils/logger';
import type { Position, ShortPosition, TradingRule, AutoTradeExecution } from '../types';

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

// Short position target - for short selling (profit when price goes DOWN)
interface ShortPositionTarget {
  symbol: string;
  positionId: string;
  ruleId: string;
  ruleName: string;
  entryPrice: number;  // Price at which we shorted
  shares: number;
  stopLossPrice?: number;  // Cover if price rises to this level (loss)
  trailingStopPercent?: number;  // Cover if price rises X% from lowest
}

// Track positions with active targets
let monitoredPositions: PositionTarget[] = [];
let monitoredShortPositions: ShortPositionTarget[] = [];
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
 * Calculate short position targets (inverse logic - profit when price drops)
 */
function calculateShortTargets(position: ShortPosition, rule: TradingRule): ShortPositionTarget | null {
  if (!rule.stopLossPercent && !rule.trailingStopPercent) {
    return null;
  }

  const target: ShortPositionTarget = {
    symbol: position.symbol,
    positionId: position.id,
    ruleId: rule.id,
    ruleName: rule.name,
    entryPrice: position.entryPrice,
    shares: position.shares,
  };

  // For shorts, stop loss triggers when price RISES (we lose money)
  if (rule.stopLossPercent) {
    target.stopLossPrice = position.entryPrice * (1 + rule.stopLossPercent / 100);
  }

  if (rule.trailingStopPercent) {
    target.trailingStopPercent = rule.trailingStopPercent;
  }

  return target;
}

/**
 * Check if a short position should be covered based on current price
 * For shorts: profit when price drops, loss when price rises
 */
function shouldCover(
  target: ShortPositionTarget,
  currentPrice: number,
  lowestPrice?: number
): { cover: boolean; reason: 'stop_loss' | 'trailing_stop' | null; targetPrice: number | null } {
  // Check trailing stop first (dynamic)
  // For shorts, we cover if price RISES from the lowest point
  if (target.trailingStopPercent && lowestPrice) {
    const trailingStopPrice = lowestPrice * (1 + target.trailingStopPercent / 100);
    // Only trigger if we've made some profit (price below entry)
    if (lowestPrice < target.entryPrice && currentPrice >= trailingStopPrice) {
      return { cover: true, reason: 'trailing_stop', targetPrice: trailingStopPrice };
    }
  }

  // Check fixed stop-loss (cover if price rises too much)
  if (target.stopLossPrice && currentPrice >= target.stopLossPrice) {
    return { cover: true, reason: 'stop_loss', targetPrice: target.stopLossPrice };
  }

  return { cover: false, reason: null, targetPrice: null };
}

/**
 * Execute auto-cover for a short position
 */
async function executeAutoCover(
  target: ShortPositionTarget,
  currentPrice: number,
  reason: 'stop_loss' | 'trailing_stop'
): Promise<boolean> {
  const store = useStore.getState();
  const { tradingMode, autoTradeConfig, paperPortfolio, addAutoTradeExecution, coverShortPosition } = store;

  if (tradingMode !== 'paper') {
    logger.warn('PositionMonitor', `Auto-cover skipped: not in paper mode`);
    return false;
  }

  if (!autoTradeConfig.enabled) {
    logger.warn('PositionMonitor', `Auto-cover skipped: auto-trading disabled`);
    return false;
  }

  const shortPosition = paperPortfolio.shortPositions?.find((p) => p.id === target.positionId);
  if (!shortPosition) {
    logger.warn('PositionMonitor', `Short position ${target.positionId} no longer exists`);
    return false;
  }

  const sharesToCover = shortPosition.shares;
  const total = sharesToCover * currentPrice;
  // For shorts: profit = (entry - current) * shares
  const profitLoss = (target.entryPrice - currentPrice) * sharesToCover;
  const profitLossPercent = ((target.entryPrice - currentPrice) / target.entryPrice) * 100;

  const reasonLabel = reason === 'trailing_stop' ? 'TRAILING STOP' : 'STOP LOSS';
  const plEmoji = profitLoss >= 0 ? '💰' : '📉';

  // Clear, prominent P/L logging
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${plEmoji} SHORT COVERED: ${target.symbol} - ${reasonLabel}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`   Shares Covered: ${sharesToCover}`);
  console.log(`   Short Entry: $${target.entryPrice.toFixed(2)}`);
  console.log(`   Cover Price: $${currentPrice.toFixed(2)}`);
  console.log(`   ---`);
  console.log(`   P/L: ${profitLoss >= 0 ? '+' : ''}$${profitLoss.toFixed(2)} (${profitLossPercent >= 0 ? '+' : ''}${profitLossPercent.toFixed(2)}%)`);
  console.log(`${'='.repeat(60)}\n`);

  logger.info(
    'PositionMonitor',
    `${reasonLabel} triggered for SHORT ${target.symbol}: ` +
      `covering ${sharesToCover} shares @ $${currentPrice.toFixed(2)} ` +
      `(${profitLoss >= 0 ? '+' : ''}$${profitLoss.toFixed(2)}, ${profitLossPercent >= 0 ? '+' : ''}${profitLossPercent.toFixed(2)}%)`
  );

  const success = coverShortPosition(target.symbol, sharesToCover, currentPrice);

  if (success) {
    const reasonDisplayName = reason === 'trailing_stop' ? 'Trailing Stop' : 'Stop Loss';
    const execution: AutoTradeExecution = {
      id: `exec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      ruleId: target.ruleId,
      ruleName: `${target.ruleName} (${reasonDisplayName})`,
      alertId: `auto-cover-${reason}-${Date.now()}`,
      symbol: target.symbol,
      type: 'cover',
      shares: sharesToCover,
      price: currentPrice,
      total,
      status: 'executed',
      mode: 'paper',
      timestamp: new Date(),
    };
    addAutoTradeExecution(execution);

    // Remove from monitored short positions
    monitoredShortPositions = monitoredShortPositions.filter((p) => p.positionId !== target.positionId);

    logger.info('PositionMonitor', `Auto-cover executed successfully for ${target.symbol}`);
    return true;
  } else {
    logger.error('PositionMonitor', `Failed to execute auto-cover for ${target.symbol}`);
    return false;
  }
}

// Track last log time to avoid spamming console
let lastStatusLogTime = 0;
const STATUS_LOG_INTERVAL = 30000; // Log status every 30 seconds

/**
 * Scan positions and check targets
 */
async function scanPositions(): Promise<void> {
  const hasLongPositions = monitoredPositions.length > 0;
  const hasShortPositions = monitoredShortPositions.length > 0;

  const store = useStore.getState();
  const now = Date.now();

  // Log status periodically even when no positions to confirm monitor is running
  if (now - lastStatusLogTime > STATUS_LOG_INTERVAL) {
    lastStatusLogTime = now;
    if (!hasLongPositions && !hasShortPositions) {
      console.log(`🔄 Position Monitor: Running, no positions registered for monitoring`);
    } else {
      console.log(`🔄 Position Monitor: Watching ${monitoredPositions.length} long + ${monitoredShortPositions.length} short positions`);
    }
  }

  if (!hasLongPositions && !hasShortPositions) {
    return;
  }

  if (!store.autoTradeConfig.enabled || store.tradingMode !== 'paper') {
    return;
  }

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

  // Scan short positions
  for (const target of [...monitoredShortPositions]) {
    try {
      let currentPrice: number | null = null;
      if (isCryptoSymbol(target.symbol)) {
        currentPrice = await getBinancePrice(target.symbol);
      } else {
        const quote = await getQuote(target.symbol);
        currentPrice = quote?.price ?? null;
      }

      if (currentPrice === null) {
        logger.warn('PositionMonitor', `Could not get quote for SHORT ${target.symbol}`);
        continue;
      }

      // Get the position's lowest price from the store (for trailing stop)
      const shortPosition = store.paperPortfolio.shortPositions?.find((p) => p.id === target.positionId);
      let lowestPrice = shortPosition?.lowestPrice || target.entryPrice;

      // Update lowest price if current price is lower
      if (currentPrice < lowestPrice) {
        lowestPrice = currentPrice;
        // Update in store
        useStore.setState((s) => ({
          paperPortfolio: {
            ...s.paperPortfolio,
            shortPositions: (s.paperPortfolio.shortPositions || []).map((p) =>
              p.id === target.positionId ? { ...p, lowestPrice: currentPrice, currentPrice } : p
            ),
          },
        }));
        logger.debug('PositionMonitor', `New low for SHORT ${target.symbol}: $${currentPrice.toFixed(2)}`);
      }

      const { cover, reason, targetPrice } = shouldCover(target, currentPrice, lowestPrice);

      if (cover && reason) {
        const reasonLabel = reason === 'trailing_stop' ? 'TRAILING_STOP' : 'STOP_LOSS';
        logger.info(
          'PositionMonitor',
          `${reasonLabel} hit for SHORT ${target.symbol}: ` +
            `current $${currentPrice.toFixed(2)}, target $${targetPrice?.toFixed(2)}` +
            (reason === 'trailing_stop' ? `, lowest $${lowestPrice?.toFixed(2)}` : '')
        );
        await executeAutoCover(target, currentPrice, reason);
      } else if (target.trailingStopPercent && lowestPrice < target.entryPrice) {
        // Log trailing stop status for short positions in profit
        const trailingStopPrice = lowestPrice * (1 + target.trailingStopPercent / 100);
        const profitPercent = ((target.entryPrice - currentPrice) / target.entryPrice * 100).toFixed(2);
        const distanceToStop = ((trailingStopPrice - currentPrice) / currentPrice * 100).toFixed(2);
        logger.debug(
          'PositionMonitor',
          `SHORT ${target.symbol}: $${currentPrice.toFixed(2)} (+${profitPercent}% profit) | ` +
            `Trail stop @ $${trailingStopPrice.toFixed(2)} (${distanceToStop}% away) | ` +
            `Low: $${lowestPrice.toFixed(2)}`
        );
      }

      await new Promise((r) => setTimeout(r, 300));
    } catch (error) {
      logger.error('PositionMonitor', `Error checking SHORT ${target.symbol}`, error);
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
 * Register a SHORT position for monitoring with stop-loss/trailing-stop targets
 * For shorts: stop loss triggers when price RISES, trailing stop from LOWEST price
 */
export function registerShortPositionForMonitoring(position: ShortPosition, rule: TradingRule): void {
  const target = calculateShortTargets(position, rule);
  if (!target) {
    return;
  }

  const existing = monitoredShortPositions.find((p) => p.positionId === position.id);
  if (existing) {
    Object.assign(existing, target);
    logger.info('PositionMonitor', `Updated targets for SHORT ${position.symbol}`);
  } else {
    monitoredShortPositions.push(target);
    logger.info(
      'PositionMonitor',
      `Monitoring SHORT ${position.symbol}: ` +
        `SL (cover if rises): ${target.stopLossPrice ? '$' + target.stopLossPrice.toFixed(2) : 'none'}, ` +
        `Trailing: ${target.trailingStopPercent ? target.trailingStopPercent + '% from low' : 'none'}`
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
  // Also check short positions
  const removedShort = monitoredShortPositions.find((p) => p.positionId === positionId);
  if (removedShort) {
    monitoredShortPositions = monitoredShortPositions.filter((p) => p.positionId !== positionId);
    logger.info('PositionMonitor', `Stopped monitoring SHORT position ${removedShort.symbol}`);
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
