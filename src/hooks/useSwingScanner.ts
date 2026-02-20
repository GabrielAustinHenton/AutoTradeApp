// ============================================================================
// useSwingScanner Hook
// ============================================================================
// Manages the swing scanner lifecycle based on SwingTrader store state.
// Starts/stops the scanner when store.isRunning changes.
// Computes PDT (Pattern Day Trader) usage from completed trades.
// ============================================================================

import { useState, useEffect } from 'react';
import { useSwingStore } from '../store/useSwingStore';
import { alpaca } from '../services/alpaca';
import {
  startSwingScanner,
  stopSwingScanner,
  getSwingStates,
  scannerRunning,
  type SwingCandidateState,
} from '../services/swingScanner';

// PDT rule: max 3 round-trip day trades in rolling 5 business days
// when account equity < $25k
const PDT_LIMIT = 3;

function countBusinessDaysAgo(n: number): Date {
  const result = new Date();
  let count = 0;
  while (count < n) {
    result.setDate(result.getDate() - 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return result;
}

export interface SwingScannerStatus {
  scanStates: SwingCandidateState[];
  isRunning: boolean;
  pdtDayTrades: number;     // day trades in last 5 business days
  pdtWarning: boolean;      // true when >= 2 (approaching limit)
  pdtBlocked: boolean;      // true when >= 3 (at limit)
}

export function useSwingScanner(): SwingScannerStatus {
  const store = useSwingStore();
  const [scanStates, setScanStates] = useState<SwingCandidateState[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // Compute PDT day trade count from completed trades
  const pdtWindowStart = countBusinessDaysAgo(5);
  const pdtDayTrades = store.completedTrades.filter((trade) => {
    const entry = new Date(trade.entryDate);
    const exit = trade.exitDate ? new Date(trade.exitDate) : null;
    if (!exit) return false;
    // Day trade: opened and closed on same calendar date, within last 5 business days
    const sameDay = entry.toDateString() === exit.toDateString();
    const recent = entry >= pdtWindowStart;
    return sameDay && recent;
  }).length;

  useEffect(() => {
    // Only run scanner if store says active AND swing credentials are configured
    if (!store.isRunning || !alpaca.isSwingTraderConfigured()) {
      if (scannerRunning) {
        stopSwingScanner();
        setIsRunning(false);
      }
      return;
    }

    // Capital per trade: position size % of initial capital
    const positionSizePct = store.config.uptrendStrategy?.positionSizePercent ?? 20;
    const capitalPerTrade = store.config.initialCapital * (positionSizePct / 100);

    startSwingScanner(
      store.config.symbols,
      capitalPerTrade,
      (symbol, qty, price, orderId) => {
        console.log(`[useSwingScanner] Trade placed: ${symbol} ×${qty} @ $${price.toFixed(2)} (order ${orderId})`);
        // Record position in store for display
        store.openPosition({
          id: orderId,
          symbol,
          direction: 'long',
          regime: 'uptrend',
          shares: qty,
          entryPrice: price,
          entryDate: new Date(),
          currentPrice: price,
          highestPrice: price,
          lowestPrice: price,
          unrealizedPnL: 0,
          unrealizedPnLPercent: 0,
          entrySignals: ['Swing Scanner'],
        });
      },
      (err) => {
        console.error('[useSwingScanner] Error:', err);
      },
    );

    setIsRunning(true);

    // Refresh displayed states every 5 seconds
    const refreshInterval = setInterval(() => {
      setScanStates(getSwingStates());
    }, 5_000);

    return () => {
      stopSwingScanner();
      clearInterval(refreshInterval);
      setIsRunning(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.isRunning, store.config.symbols, store.config.initialCapital]);

  return {
    scanStates,
    isRunning,
    pdtDayTrades,
    pdtWarning: pdtDayTrades >= 2,
    pdtBlocked: pdtDayTrades >= PDT_LIMIT,
  };
}
