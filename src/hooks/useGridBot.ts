import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { getBinancePrice } from '../services/binanceApi';
import { checkGridOrders, initializeGridOrders } from '../services/gridBot';

const CHECK_INTERVAL = 30000; // Check every 30 seconds (grid trading needs faster checks)

export function useGridBot() {
  const {
    gridConfigs,
    cryptoPortfolio,
    updateGridConfig,
    addCryptoTrade,
    addCryptoPosition,
    updateCryptoPosition,
    setCryptoUsdBalance,
  } = useStore();

  const checkingRef = useRef(false);

  const runGridCheck = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;

    const enabledConfigs = gridConfigs.filter(c => c.enabled);

    for (const config of enabledConfigs) {
      // Initialize orders if needed
      if (config.activeOrders.length === 0) {
        const initialOrders = initializeGridOrders(config);
        updateGridConfig(config.id, { activeOrders: initialOrders });
        continue; // Will check on next cycle
      }

      // Get current price
      const currentPrice = await getBinancePrice(config.symbol);
      if (!currentPrice) {
        console.error(`Grid: Failed to fetch price for ${config.symbol}`);
        continue;
      }

      // Check if price is within grid range
      if (currentPrice < config.lowerPrice || currentPrice > config.upperPrice) {
        console.log(`Grid: ${config.symbol} price $${currentPrice.toFixed(2)} outside range $${config.lowerPrice}-${config.upperPrice}`);
        continue;
      }

      const position = cryptoPortfolio.positions.find(p => p.symbol === config.symbol);

      const result = await checkGridOrders(
        config,
        currentPrice,
        cryptoPortfolio.usdBalance,
        position
      );

      if (result.success && result.trade) {
        // Add trade record
        addCryptoTrade(result.trade);

        if (result.trade.type === 'buy') {
          // Deduct USD
          setCryptoUsdBalance(cryptoPortfolio.usdBalance - result.trade.total);

          // Update or create position
          if (position) {
            const newAmount = position.amount + result.trade.amount;
            const newAvgCost = ((position.avgCost * position.amount) + result.trade.total) / newAmount;
            updateCryptoPosition(position.id, {
              amount: newAmount,
              avgCost: newAvgCost,
              currentPrice,
            });
          } else {
            addCryptoPosition({
              id: crypto.randomUUID(),
              symbol: config.symbol,
              amount: result.trade.amount,
              avgCost: result.trade.price,
              currentPrice,
            });
          }

          console.log(`Grid: BUY ${result.trade.amount.toFixed(6)} ${config.symbol} at $${result.trade.price.toFixed(2)}`);
        } else {
          // Add USD from sale
          setCryptoUsdBalance(cryptoPortfolio.usdBalance + result.trade.total);

          // Update position
          if (position) {
            updateCryptoPosition(position.id, {
              amount: position.amount - result.trade.amount,
              currentPrice,
            });
          }

          console.log(`Grid: SELL ${result.trade.amount.toFixed(6)} ${config.symbol} at $${result.trade.price.toFixed(2)}`);
        }

        // Update grid orders
        updateGridConfig(config.id, { activeOrders: result.updatedOrders });
      } else {
        // Still update orders state (for initialization)
        if (result.updatedOrders.length > 0 && config.activeOrders.length === 0) {
          updateGridConfig(config.id, { activeOrders: result.updatedOrders });
        }
      }
    }

    checkingRef.current = false;
  }, [
    gridConfigs,
    cryptoPortfolio,
    updateGridConfig,
    addCryptoTrade,
    addCryptoPosition,
    updateCryptoPosition,
    setCryptoUsdBalance,
  ]);

  // Run grid check on interval
  useEffect(() => {
    // Initial check after a short delay
    const initialTimeout = setTimeout(runGridCheck, 3000);

    // Regular interval checks
    const interval = setInterval(runGridCheck, CHECK_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [runGridCheck]);

  return {
    runGridCheck,
    enabledCount: gridConfigs.filter(c => c.enabled).length,
  };
}
