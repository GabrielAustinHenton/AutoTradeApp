// Crypto Pattern Scanner Hook
// Scans crypto symbols for candlestick patterns and executes auto-trades

import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { getBinanceCandles, getBinancePrice } from '../services/binanceApi';
import { detectPatterns, type Candle } from '../services/candlestickPatterns';
import type { Alert, CryptoTradingRule } from '../types';

const SCAN_INTERVAL = 60000; // Scan every 60 seconds (crypto markets are 24/7)
const CRYPTO_SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'DOT', 'AVAX', 'LINK', 'POL'];

export function useCryptoPatternScanner() {
  const {
    cryptoTradingRules,
    cryptoAutoTradeConfig,
    addAlert,
    alertsEnabled,
    soundEnabled,
    updateCryptoTradingRule,
    addCryptoTrade,
    addCryptoPosition,
    updateCryptoPosition,
    setCryptoUsdBalance,
    addCryptoAutoTradeExecution,
    getTodayCryptoAutoTradeCount,
  } = useStore();

  const scanningRef = useRef(false);
  const recentAlertsRef = useRef<Map<string, number>>(new Map());

  // Check if we recently created a similar alert (within 5 minutes)
  const hasRecentAlert = (symbol: string, pattern: string, type: string): boolean => {
    const key = `${symbol}-${pattern}-${type}`;
    const lastAlertTime = recentAlertsRef.current.get(key);
    if (lastAlertTime && Date.now() - lastAlertTime < 5 * 60 * 1000) {
      return true;
    }
    return false;
  };

  const recordAlert = (symbol: string, pattern: string, type: string) => {
    const key = `${symbol}-${pattern}-${type}`;
    recentAlertsRef.current.set(key, Date.now());
  };

  const scanCrypto = useCallback(async () => {
    if (!alertsEnabled || scanningRef.current) return;
    scanningRef.current = true;

    console.log('[Crypto Scanner] Starting scan...');

    try {
      for (const symbol of CRYPTO_SYMBOLS) {
        // Get candle data from Binance
        const candles = await getBinanceCandles(symbol, '1h', 20);
        if (!candles || candles.length < 10) continue;

        // Convert to Candle format
        const candleData: Candle[] = candles.slice(-10).map(c => ({
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));

        // Detect patterns
        const patterns = detectPatterns(candleData);
        if (patterns.length === 0) continue;

        // Get current price
        const currentPrice = await getBinancePrice(symbol);
        if (!currentPrice) continue;

        // Check each detected pattern against rules
        for (const pattern of patterns) {
          const matchingRules = cryptoTradingRules.filter(
            (r: CryptoTradingRule) => r.enabled && r.symbol === symbol && r.pattern === pattern.pattern
          );

          for (const rule of matchingRules) {
            // Skip if we already have a recent alert for this
            if (hasRecentAlert(symbol, pattern.pattern, rule.type)) {
              continue;
            }

            // Check confidence threshold
            if (rule.minConfidence && pattern.confidence < rule.minConfidence) {
              continue;
            }

            // Check cooldown
            if (rule.lastExecutedAt) {
              const cooldownMs = (rule.cooldownMinutes || 15) * 60 * 1000;
              if (Date.now() - new Date(rule.lastExecutedAt).getTime() < cooldownMs) {
                continue;
              }
            }

            // Create alert
            const alert: Alert = {
              id: crypto.randomUUID(),
              type: 'pattern',
              symbol,
              message: `${pattern.pattern.replace(/_/g, ' ')} detected on ${symbol} (${pattern.confidence}% confidence)`,
              signal: rule.type === 'buy' ? 'buy' : 'sell',
              pattern: pattern.pattern,
              ruleId: rule.id,
              confidence: pattern.confidence,
              timestamp: new Date(),
              read: false,
              dismissed: false,
            };

            addAlert(alert);
            recordAlert(symbol, pattern.pattern, rule.type);

            // Play sound if enabled
            if (soundEnabled) {
              try {
                const audio = new Audio('/alert.mp3');
                audio.volume = 0.5;
                audio.play().catch(() => {});
              } catch {}
            }

            console.log(`[Crypto Scanner] ${rule.type.toUpperCase()} alert: ${symbol} - ${pattern.pattern}`);

            // Auto-trade if enabled
            if (rule.autoTrade && cryptoAutoTradeConfig.enabled && rule.type === 'buy') {
              await executeCryptoAutoTrade(rule, currentPrice, alert.id);
            }
          }
        }

        // Small delay between symbols to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) {
      console.error('[Crypto Scanner] Error:', error);
    }

    scanningRef.current = false;
  }, [
    alertsEnabled,
    soundEnabled,
    cryptoTradingRules,
    cryptoAutoTradeConfig,
    addAlert,
  ]);

  // Execute crypto auto-trade
  const executeCryptoAutoTrade = async (
    rule: CryptoTradingRule,
    price: number,
    alertId: string
  ) => {
    const state = useStore.getState();

    // Check daily trade limit
    const todayCount = getTodayCryptoAutoTradeCount();
    if (todayCount >= cryptoAutoTradeConfig.maxTradesPerDay) {
      console.log(`[Crypto Auto-Trade] Daily limit reached (${todayCount}/${cryptoAutoTradeConfig.maxTradesPerDay})`);
      return;
    }

    // Calculate position size
    const portfolioValue = state.cryptoPortfolio.usdBalance +
      state.cryptoPortfolio.positions.reduce((sum: number, p: { amount: number; currentPrice: number }) => sum + p.amount * p.currentPrice, 0);
    const maxPositionValue = portfolioValue * (cryptoAutoTradeConfig.maxPositionSizePercent / 100);
    const tradeAmount = Math.min(maxPositionValue, state.cryptoPortfolio.usdBalance);

    if (tradeAmount < 10) {
      console.log(`[Crypto Auto-Trade] Insufficient balance for ${rule.symbol}`);
      return;
    }

    const cryptoAmount = tradeAmount / price;

    // Check if we already have a position (add to it)
    const existingPosition = state.cryptoPortfolio.positions.find((p: { symbol: string }) => p.symbol === rule.symbol);

    try {
      // Execute buy
      if (rule.type === 'buy') {
        // Deduct USD
        setCryptoUsdBalance(state.cryptoPortfolio.usdBalance - tradeAmount);

        // Update or create position
        if (existingPosition) {
          const newAmount = existingPosition.amount + cryptoAmount;
          const newAvgCost = ((existingPosition.avgCost * existingPosition.amount) + tradeAmount) / newAmount;
          updateCryptoPosition(existingPosition.id, {
            amount: newAmount,
            avgCost: newAvgCost,
            currentPrice: price,
            highestPrice: price,
          });
        } else {
          addCryptoPosition({
            id: crypto.randomUUID(),
            symbol: rule.symbol,
            amount: cryptoAmount,
            avgCost: price,
            currentPrice: price,
            highestPrice: price,
            openedAt: new Date(),
          });
        }

        // Add trade record
        addCryptoTrade({
          id: crypto.randomUUID(),
          symbol: rule.symbol,
          type: 'buy',
          amount: cryptoAmount,
          price,
          total: tradeAmount,
          date: new Date(),
        });

        // Update rule last executed time
        updateCryptoTradingRule(rule.id, { lastExecutedAt: new Date() });

        // Record execution
        addCryptoAutoTradeExecution({
          id: crypto.randomUUID(),
          ruleId: rule.id,
          ruleName: rule.name,
          alertId,
          symbol: rule.symbol,
          type: 'buy',
          shares: cryptoAmount,
          price,
          total: tradeAmount,
          status: 'executed',
          mode: 'paper',
          timestamp: new Date(),
        });

        console.log(`[Crypto Auto-Trade] BUY ${cryptoAmount.toFixed(6)} ${rule.symbol} @ $${price.toFixed(2)} ($${tradeAmount.toFixed(2)})`);
      }
    } catch (error) {
      console.error(`[Crypto Auto-Trade] Failed:`, error);
      addCryptoAutoTradeExecution({
        id: crypto.randomUUID(),
        ruleId: rule.id,
        ruleName: rule.name,
        alertId,
        symbol: rule.symbol,
        type: rule.type,
        shares: cryptoAmount,
        price,
        total: tradeAmount,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        mode: 'paper',
        timestamp: new Date(),
      });
    }
  };

  // Run scanner on interval
  useEffect(() => {
    if (!alertsEnabled) return;

    // Initial scan after short delay
    const initialTimeout = setTimeout(scanCrypto, 5000);

    // Regular interval
    const interval = setInterval(scanCrypto, SCAN_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [alertsEnabled, scanCrypto]);

  return {
    scanNow: scanCrypto,
    isScanning: scanningRef.current,
  };
}
