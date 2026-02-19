import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { startOrbScanner, stopOrbScanner, getOrbStates } from '../services/orbScanner';
import type { OrbData } from '../services/orbScanner';

export function useOrbScanner(): { orbStates: OrbData[]; isRunning: boolean } {
  const { autoTradeConfig, tradingMode, watchlist, syncFromAlpaca } = useStore();
  const [orbStates, setOrbStates] = useState<OrbData[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isPaper = tradingMode === 'paper';
  const enabled = autoTradeConfig.enabled;
  // watchlist is string[] in the store
  const symbols = watchlist.filter(Boolean);

  useEffect(() => {
    if (!enabled || symbols.length === 0) {
      stopOrbScanner();
      setIsRunning(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setOrbStates([]);
      return;
    }

    const capitalPerTrade = autoTradeConfig.maxTradeDollarAmount ?? 3750;

    const onTrade = (symbol: string, qty: number, price: number, orderId: string) => {
      console.log(`[ORB] Trade executed: ${symbol} x${qty} @ $${price.toFixed(2)} — order ${orderId}`);
      setTimeout(() => syncFromAlpaca(), 3000);
    };

    const onError = (err: string) => {
      console.error('[ORB]', err);
    };

    startOrbScanner(symbols, isPaper, capitalPerTrade, onTrade, onError);
    setIsRunning(true);

    // Refresh displayed states every 60s
    intervalRef.current = setInterval(() => {
      setOrbStates(getOrbStates());
    }, 60_000);

    // Initial display
    setOrbStates(getOrbStates());

    return () => {
      stopOrbScanner();
      setIsRunning(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, isPaper, symbols.join(','), autoTradeConfig.maxTradeDollarAmount]);

  return { orbStates, isRunning };
}
