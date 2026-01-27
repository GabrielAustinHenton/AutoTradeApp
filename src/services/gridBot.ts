import { getBinancePrice } from './binanceApi';
import type { GridConfig, GridOrder, CryptoTrade, CryptoPosition } from '../types';

export interface GridExecutionResult {
  success: boolean;
  trade?: CryptoTrade;
  updatedOrders: GridOrder[];
  error?: string;
}

/**
 * Calculate grid levels (prices) between lower and upper bounds
 */
export function calculateGridLevels(
  lowerPrice: number,
  upperPrice: number,
  gridLevels: number
): number[] {
  const step = (upperPrice - lowerPrice) / (gridLevels + 1);
  const levels: number[] = [];

  for (let i = 1; i <= gridLevels; i++) {
    levels.push(lowerPrice + step * i);
  }

  return levels;
}

/**
 * Initialize grid orders for a config
 */
export function initializeGridOrders(config: GridConfig): GridOrder[] {
  const levels = calculateGridLevels(
    config.lowerPrice,
    config.upperPrice,
    config.gridLevels
  );

  // Create buy orders below current midpoint, sell orders above
  const midpoint = (config.lowerPrice + config.upperPrice) / 2;

  return levels.map((price, index) => ({
    id: `grid-${config.id}-${index}`,
    price,
    type: price < midpoint ? 'buy' : 'sell',
    amount: config.amountPerGrid,
    filled: false,
  }));
}

/**
 * Check if any grid orders should be executed based on current price
 */
export async function checkGridOrders(
  config: GridConfig,
  currentPrice: number,
  usdBalance: number,
  position: CryptoPosition | undefined
): Promise<GridExecutionResult> {
  const orders = config.activeOrders.length > 0
    ? config.activeOrders
    : initializeGridOrders(config);

  // Find unfilled orders that should be triggered
  for (const order of orders) {
    if (order.filled) continue;

    if (order.type === 'buy' && currentPrice <= order.price) {
      // Execute buy order
      const usdNeeded = order.amount;
      if (usdBalance < usdNeeded) {
        continue; // Skip if insufficient balance
      }

      const cryptoAmount = usdNeeded / currentPrice;

      const trade: CryptoTrade = {
        id: crypto.randomUUID(),
        symbol: config.symbol,
        type: 'buy',
        amount: cryptoAmount,
        price: currentPrice,
        total: usdNeeded,
        date: new Date(),
      };

      // Mark order as filled and flip to sell at next grid level up
      const updatedOrders = orders.map(o => {
        if (o.id === order.id) {
          return { ...o, filled: true, type: 'sell' as const };
        }
        return o;
      });

      return {
        success: true,
        trade,
        updatedOrders,
      };
    }

    if (order.type === 'sell' && currentPrice >= order.price) {
      // Execute sell order
      const cryptoToSell = order.amount / currentPrice;
      if (!position || position.amount < cryptoToSell) {
        continue; // Skip if insufficient crypto
      }

      const trade: CryptoTrade = {
        id: crypto.randomUUID(),
        symbol: config.symbol,
        type: 'sell',
        amount: cryptoToSell,
        price: currentPrice,
        total: cryptoToSell * currentPrice,
        date: new Date(),
      };

      // Mark order as filled and flip to buy at next grid level down
      const updatedOrders = orders.map(o => {
        if (o.id === order.id) {
          return { ...o, filled: true, type: 'buy' as const };
        }
        return o;
      });

      return {
        success: true,
        trade,
        updatedOrders,
      };
    }
  }

  // No orders triggered, return current orders
  return {
    success: false,
    updatedOrders: orders,
    error: 'No orders triggered',
  };
}

/**
 * Get grid profit summary
 */
export function getGridProfit(config: GridConfig): number {
  // Calculate profit from filled orders
  const filledBuys = config.activeOrders.filter(o => o.filled && o.type === 'sell'); // Were buys, now sells
  const filledSells = config.activeOrders.filter(o => o.filled && o.type === 'buy'); // Were sells, now buys

  // Each completed buy-sell pair captures the grid spread
  const completedPairs = Math.min(filledBuys.length, filledSells.length);
  const gridSpread = (config.upperPrice - config.lowerPrice) / (config.gridLevels + 1);

  return completedPairs * gridSpread * (config.amountPerGrid / config.upperPrice);
}
