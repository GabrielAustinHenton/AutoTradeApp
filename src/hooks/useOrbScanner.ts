import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { startOrbScanner, stopOrbScanner, getOrbStates, getTotalDeployedToday, getDailyExposureCap } from '../services/orbScanner';
import type { OrbData } from '../services/orbScanner';

export function useOrbScanner(): {
  orbStates: OrbData[];
  isRunning: boolean;
  totalDeployed: number;
  exposureCap: number;
} {
  const { autoTradeConfig, tradingMode, watchlist, paperPortfolio, cashBalance, syncFromAlpaca } = useStore();
  const [orbStates, setOrbStates] = useState<OrbData[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [totalDeployed, setTotalDeployed] = useState(0);
  const [exposureCap, setExposureCap] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isPaper = tradingMode === 'paper';
  const enabled = autoTradeConfig.enabled;
  const symbols = watchlist.filter(Boolean);

  // Available cash: paper portfolio cash in paper mode, live cash otherwise
  const availableCash = isPaper
    ? (paperPortfolio?.cashBalance ?? 0)
    : (cashBalance ?? 0);

  // Daily cap = available cash (can't spend what you don't have)
  // Also bounded by maxTradesPerDay * capitalPerTrade
  const capitalPerTrade = autoTradeConfig.maxTradeDollarAmount ?? 3750;
  const maxTradesPerDay = autoTradeConfig.maxTradesPerDay ?? 20;
  const maxDailyExposure = Math.min(
    Math.max(availableCash, 0),
    maxTradesPerDay * capitalPerTrade,
  );

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

    const onTrade = (symbol: string, qty: number, price: number, orderId: string) => {
      console.log(`[ORB] Trade executed: ${symbol} x${qty} @ $${price.toFixed(2)} — order ${orderId}`);
      setTimeout(() => syncFromAlpaca(), 3000);
    };

    const onError = (err: string) => {
      console.error('[ORB]', err);
    };

    startOrbScanner(symbols, isPaper, capitalPerTrade, maxDailyExposure, onTrade, onError);
    setIsRunning(true);
    setExposureCap(getDailyExposureCap());

    // Refresh displayed states + deployed amount every 60s
    intervalRef.current = setInterval(() => {
      setOrbStates(getOrbStates());
      setTotalDeployed(getTotalDeployedToday());
    }, 60_000);

    // Initial display
    setOrbStates(getOrbStates());
    setTotalDeployed(getTotalDeployedToday());

    return () => {
      stopOrbScanner();
      setIsRunning(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, isPaper, symbols.join(','), capitalPerTrade, maxDailyExposure]);

  return { orbStates, isRunning, totalDeployed, exposureCap };
}
