import { useStore } from '../store/useStore';
import { getQuote } from './alphaVantage';
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
}

// Track positions with active targets
let monitoredPositions: PositionTarget[] = [];
let monitorInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Calculate target prices based on rule settings
 */
function calculateTargets(position: Position, rule: TradingRule): PositionTarget | null {
  if (!rule.takeProfitPercent && !rule.stopLossPercent) {
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

  return target;
}

/**
 * Check if a position should be sold based on current price
 */
function shouldSell(
  target: PositionTarget,
  currentPrice: number
): { sell: boolean; reason: 'take_profit' | 'stop_loss' | null; targetPrice: number | null } {
  // Check take-profit first (prioritize locking in gains)
  if (target.takeProfitPrice && currentPrice >= target.takeProfitPrice) {
    return { sell: true, reason: 'take_profit', targetPrice: target.takeProfitPrice };
  }

  // Check stop-loss
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
  reason: 'take_profit' | 'stop_loss'
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

  logger.info(
    'PositionMonitor',
    `${reason === 'take_profit' ? 'TAKE PROFIT' : 'STOP LOSS'} triggered for ${target.symbol}: ` +
      `selling ${sharesToSell} shares @ $${currentPrice.toFixed(2)} ` +
      `(${profitLoss >= 0 ? '+' : ''}$${profitLoss.toFixed(2)}, ${profitLossPercent >= 0 ? '+' : ''}${profitLossPercent.toFixed(2)}%)`
  );

  // Execute the sell in paper portfolio
  const executePaperSell = useStore.getState().executePaperSell;
  const success = executePaperSell(target.symbol, sharesToSell, currentPrice);

  if (success) {
    // Record the auto-trade execution
    const execution: AutoTradeExecution = {
      id: `exec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      ruleId: target.ruleId,
      ruleName: `${target.ruleName} (${reason === 'take_profit' ? 'Take Profit' : 'Stop Loss'})`,
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
      const quote = await getQuote(target.symbol);
      if (!quote) {
        logger.warn('PositionMonitor', `Could not get quote for ${target.symbol}`);
        continue;
      }

      const { sell, reason, targetPrice } = shouldSell(target, quote.price);

      if (sell && reason) {
        logger.info(
          'PositionMonitor',
          `${reason.toUpperCase()} hit for ${target.symbol}: ` +
            `current $${quote.price.toFixed(2)}, target $${targetPrice?.toFixed(2)}`
        );
        await executeAutoSell(target, quote.price, reason);
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
        `SL: ${target.stopLossPrice ? '$' + target.stopLossPrice.toFixed(2) : 'none'}`
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
