import { getBinancePrice } from './binanceApi';
import type { DCAConfig, CryptoTrade, CryptoPosition } from '../types';

export interface DCAExecutionResult {
  success: boolean;
  trade?: CryptoTrade;
  position?: CryptoPosition;
  error?: string;
}

/**
 * Calculate the next execution time based on interval
 */
export function getNextExecutionTime(interval: DCAConfig['interval'], from: Date = new Date()): Date {
  const next = new Date(from);

  switch (interval) {
    case 'hourly':
      next.setHours(next.getHours() + 1);
      next.setMinutes(0);
      next.setSeconds(0);
      next.setMilliseconds(0);
      break;
    case 'daily':
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0); // 9 AM next day
      break;
    case 'weekly':
      next.setDate(next.getDate() + 7);
      next.setHours(9, 0, 0, 0);
      break;
  }

  return next;
}

/**
 * Check if a DCA config is due for execution
 */
export function isDCADue(config: DCAConfig): boolean {
  if (!config.enabled) return false;
  if (!config.lastExecuted) return true; // Never executed, so due now

  const now = new Date();
  const nextExecution = config.nextExecution
    ? new Date(config.nextExecution)
    : getNextExecutionTime(config.interval, new Date(config.lastExecuted));

  return now >= nextExecution;
}

/**
 * Execute a DCA buy for a given config
 */
export async function executeDCA(
  config: DCAConfig,
  usdBalance: number,
  existingPosition: CryptoPosition | undefined
): Promise<DCAExecutionResult> {
  // Check if we have enough balance
  if (usdBalance < config.amount) {
    return {
      success: false,
      error: `Insufficient balance: $${usdBalance.toFixed(2)} < $${config.amount}`,
    };
  }

  // Fetch current price
  const price = await getBinancePrice(config.symbol);
  if (!price) {
    return {
      success: false,
      error: `Failed to fetch price for ${config.symbol}`,
    };
  }

  const cryptoAmount = config.amount / price;

  // Create trade record
  const trade: CryptoTrade = {
    id: crypto.randomUUID(),
    symbol: config.symbol,
    type: 'buy',
    amount: cryptoAmount,
    price,
    total: config.amount,
    date: new Date(),
  };

  // Calculate new position
  let newPosition: CryptoPosition;
  if (existingPosition) {
    const newAmount = existingPosition.amount + cryptoAmount;
    const newAvgCost = ((existingPosition.avgCost * existingPosition.amount) + config.amount) / newAmount;
    newPosition = {
      ...existingPosition,
      amount: newAmount,
      avgCost: newAvgCost,
      currentPrice: price,
    };
  } else {
    newPosition = {
      id: crypto.randomUUID(),
      symbol: config.symbol,
      amount: cryptoAmount,
      avgCost: price,
      currentPrice: price,
    };
  }

  return {
    success: true,
    trade,
    position: newPosition,
  };
}

/**
 * Get interval display string
 */
export function getIntervalDisplay(interval: DCAConfig['interval']): string {
  switch (interval) {
    case 'hourly':
      return 'Every hour';
    case 'daily':
      return 'Daily at 9 AM';
    case 'weekly':
      return 'Weekly';
    default:
      return interval;
  }
}
