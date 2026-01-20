import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { startPositionMonitor, stopPositionMonitor, isMonitorRunning } from '../services/positionMonitor';

/**
 * Hook to manage the position monitor lifecycle
 * Starts/stops monitoring based on auto-trade config and trading mode
 */
export function usePositionMonitor() {
  const { autoTradeConfig, tradingMode } = useStore();

  useEffect(() => {
    // Only run position monitor when:
    // 1. Auto-trading is enabled
    // 2. In paper trading mode
    const shouldRun = autoTradeConfig.enabled && tradingMode === 'paper';

    if (shouldRun && !isMonitorRunning()) {
      // Check positions every 30 seconds for take-profit/stop-loss
      startPositionMonitor(30000);
    } else if (!shouldRun && isMonitorRunning()) {
      stopPositionMonitor();
    }

    return () => {
      // Don't stop on unmount - let it run while app is open
    };
  }, [autoTradeConfig.enabled, tradingMode]);
}
