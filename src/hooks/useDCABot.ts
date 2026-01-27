import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { isDCADue, executeDCA, getNextExecutionTime } from '../services/dcaBot';

const CHECK_INTERVAL = 60000; // Check every minute

export function useDCABot() {
  const {
    dcaConfigs,
    cryptoPortfolio,
    updateDCAConfig,
    addCryptoTrade,
    addCryptoPosition,
    updateCryptoPosition,
    setCryptoUsdBalance,
  } = useStore();

  const checkingRef = useRef(false);

  const runDCACheck = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;

    const enabledConfigs = dcaConfigs.filter(c => c.enabled);

    for (const config of enabledConfigs) {
      if (!isDCADue(config)) continue;

      console.log(`DCA: Executing for ${config.symbol} - $${config.amount}`);

      const existingPosition = cryptoPortfolio.positions.find(
        p => p.symbol === config.symbol
      );

      const result = await executeDCA(
        config,
        cryptoPortfolio.usdBalance,
        existingPosition
      );

      if (result.success && result.trade && result.position) {
        // Add trade
        addCryptoTrade(result.trade);

        // Update USD balance
        setCryptoUsdBalance(cryptoPortfolio.usdBalance - config.amount);

        // Update or create position
        if (existingPosition) {
          updateCryptoPosition(existingPosition.id, {
            amount: result.position.amount,
            avgCost: result.position.avgCost,
            currentPrice: result.position.currentPrice,
          });
        } else {
          addCryptoPosition(result.position);
        }

        // Update DCA config with execution time
        const now = new Date();
        updateDCAConfig(config.id, {
          lastExecuted: now,
          nextExecution: getNextExecutionTime(config.interval, now),
        });

        console.log(`DCA: Successfully bought ${result.trade.amount.toFixed(6)} ${config.symbol} at $${result.trade.price.toFixed(2)}`);
      } else {
        console.error(`DCA failed for ${config.symbol}: ${result.error}`);
      }
    }

    checkingRef.current = false;
  }, [
    dcaConfigs,
    cryptoPortfolio,
    updateDCAConfig,
    addCryptoTrade,
    addCryptoPosition,
    updateCryptoPosition,
    setCryptoUsdBalance,
  ]);

  // Run DCA check on interval
  useEffect(() => {
    // Initial check after a short delay
    const initialTimeout = setTimeout(runDCACheck, 5000);

    // Regular interval checks
    const interval = setInterval(runDCACheck, CHECK_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [runDCACheck]);

  return {
    runDCACheck,
    enabledCount: dcaConfigs.filter(c => c.enabled).length,
  };
}
