// Crypto Position Monitor Hook
// Monitors crypto positions for take profit, stop loss, and trailing stop triggers

import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { getBinancePrice } from '../services/binanceApi';
import type { CryptoTradingRule } from '../types';

const CHECK_INTERVAL = 30000; // Check every 30 seconds (faster than stocks for 24/7 market)
const TIME_BASED_EXIT_HOURS = 24; // Close positions after 24 hours if no movement (crypto is 24/7)

interface PositionTarget {
  symbol: string;
  positionId: string;
  takeProfitPercent?: number;
  stopLossPercent?: number;
  trailingStopPercent?: number;
  highestPrice: number;
  avgCost: number;
  openedAt?: Date;
}

export function useCryptoPositionMonitor() {
  const {
    cryptoPortfolio,
    cryptoTradingRules,
    cryptoAutoTradeConfig,
    updateCryptoPositionPrices,
    executeCryptoSell,
    addAlert,
  } = useStore();

  const checkingRef = useRef(false);
  const positionTargetsRef = useRef<Map<string, PositionTarget>>(new Map());

  // Register position for monitoring based on rules
  const registerPositionTargets = useCallback(() => {
    const targets = new Map<string, PositionTarget>();

    for (const position of cryptoPortfolio.positions) {
      // Find matching buy rules for this symbol to get target settings
      const buyRules = cryptoTradingRules.filter(
        (r: CryptoTradingRule) => r.symbol === position.symbol && r.type === 'buy' && r.enabled
      );

      if (buyRules.length === 0) continue;

      // Use the most conservative targets from all matching rules
      let takeProfitPercent: number | undefined;
      let stopLossPercent: number | undefined;
      let trailingStopPercent: number | undefined;

      for (const rule of buyRules) {
        if (rule.takeProfitPercent !== undefined) {
          takeProfitPercent = takeProfitPercent !== undefined
            ? Math.min(takeProfitPercent, rule.takeProfitPercent)
            : rule.takeProfitPercent;
        }
        if (rule.stopLossPercent !== undefined) {
          stopLossPercent = stopLossPercent !== undefined
            ? Math.min(stopLossPercent, rule.stopLossPercent)
            : rule.stopLossPercent;
        }
        if (rule.trailingStopPercent !== undefined) {
          trailingStopPercent = trailingStopPercent !== undefined
            ? Math.min(trailingStopPercent, rule.trailingStopPercent)
            : rule.trailingStopPercent;
        }
      }

      // Only register if at least one exit condition is set
      if (takeProfitPercent || stopLossPercent || trailingStopPercent) {
        targets.set(position.symbol, {
          symbol: position.symbol,
          positionId: position.id,
          takeProfitPercent,
          stopLossPercent,
          trailingStopPercent,
          highestPrice: position.highestPrice || position.avgCost,
          avgCost: position.avgCost,
          openedAt: position.openedAt,
        });
      }
    }

    positionTargetsRef.current = targets;
    return targets.size;
  }, [cryptoPortfolio.positions, cryptoTradingRules]);

  // Check if position should be sold
  const shouldSell = (
    target: PositionTarget,
    currentPrice: number
  ): { sell: boolean; reason: 'take_profit' | 'stop_loss' | 'trailing_stop' | 'time_exit' | null; targetPrice?: number } => {
    const { avgCost, highestPrice, takeProfitPercent, stopLossPercent, trailingStopPercent, openedAt } = target;

    // Check take profit
    if (takeProfitPercent) {
      const takeProfitPrice = avgCost * (1 + takeProfitPercent / 100);
      if (currentPrice >= takeProfitPrice) {
        return { sell: true, reason: 'take_profit', targetPrice: takeProfitPrice };
      }
    }

    // Check stop loss
    if (stopLossPercent) {
      const stopLossPrice = avgCost * (1 - stopLossPercent / 100);
      if (currentPrice <= stopLossPrice) {
        return { sell: true, reason: 'stop_loss', targetPrice: stopLossPrice };
      }
    }

    // Check trailing stop
    if (trailingStopPercent && highestPrice > avgCost) {
      const trailStopPrice = highestPrice * (1 - trailingStopPercent / 100);
      if (currentPrice <= trailStopPrice) {
        return { sell: true, reason: 'trailing_stop', targetPrice: trailStopPrice };
      }
    }

    // Check time-based exit (24 hours for crypto)
    if (openedAt) {
      const hoursOpen = (Date.now() - new Date(openedAt).getTime()) / (1000 * 60 * 60);
      if (hoursOpen >= TIME_BASED_EXIT_HOURS) {
        return { sell: true, reason: 'time_exit', targetPrice: currentPrice };
      }
    }

    return { sell: false, reason: null };
  };

  // Check positions and execute sells if needed
  const checkPositions = useCallback(async () => {
    if (checkingRef.current || !cryptoAutoTradeConfig.enabled) return;
    checkingRef.current = true;

    try {
      // Register/update position targets
      const registeredCount = registerPositionTargets();
      if (registeredCount === 0) {
        checkingRef.current = false;
        return;
      }

      // Get prices for all monitored positions
      const prices = new Map<string, number>();
      for (const [symbol] of positionTargetsRef.current) {
        const price = await getBinancePrice(symbol);
        if (price) {
          prices.set(symbol, price);
        }
        // Small delay to avoid rate limiting
        await new Promise<void>(resolve => setTimeout(resolve, 100));
      }

      // Update position prices in store
      if (prices.size > 0) {
        updateCryptoPositionPrices(prices);
      }

      // Check each position for exit conditions
      for (const [symbol, target] of positionTargetsRef.current) {
        const currentPrice = prices.get(symbol);
        if (!currentPrice) continue;

        // Update highest price tracking
        if (currentPrice > target.highestPrice) {
          target.highestPrice = currentPrice;
        }

        const { sell, reason, targetPrice } = shouldSell(target, currentPrice);

        if (sell && reason) {
          // Get position from store
          const position = cryptoPortfolio.positions.find((p: { symbol: string; amount: number }) => p.symbol === symbol);
          if (!position || position.amount <= 0) continue;

          // Format reason for display
          const reasonText = reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

          console.log(`\n${'='.repeat(60)}`);
          console.log(`[Crypto Monitor] ${reasonText} triggered for ${symbol}`);
          console.log(`   Entry: $${target.avgCost.toFixed(2)}`);
          console.log(`   Current: $${currentPrice.toFixed(2)}`);
          console.log(`   Highest: $${target.highestPrice.toFixed(2)}`);
          console.log(`   Target: $${targetPrice?.toFixed(2) || 'N/A'}`);
          console.log(`${'='.repeat(60)}\n`);

          // Execute sell
          const success = executeCryptoSell(
            symbol,
            position.amount,
            currentPrice,
            `Auto-sell (${reasonText})`
          );

          if (success) {
            // Add alert
            addAlert({
              id: crypto.randomUUID(),
              type: 'rule',
              symbol,
              message: `${symbol} auto-sold: ${reasonText} at $${currentPrice.toFixed(2)}`,
              signal: 'sell',
              timestamp: new Date(),
              read: false,
              dismissed: false,
            });

            // Remove from monitoring
            positionTargetsRef.current.delete(symbol);
          }
        }
      }
    } catch (error) {
      console.error('[Crypto Monitor] Error:', error);
    }

    checkingRef.current = false;
  }, [
    cryptoAutoTradeConfig.enabled,
    cryptoPortfolio.positions,
    registerPositionTargets,
    updateCryptoPositionPrices,
    executeCryptoSell,
    addAlert,
  ]);

  // Run position check on interval
  useEffect(() => {
    if (!cryptoAutoTradeConfig.enabled) return;

    // Initial check after short delay
    const initialTimeout = setTimeout(checkPositions, 3000);

    // Regular interval
    const interval = setInterval(checkPositions, CHECK_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [cryptoAutoTradeConfig.enabled, checkPositions]);

  return {
    checkNow: checkPositions,
    registeredPositions: positionTargetsRef.current.size,
  };
}
