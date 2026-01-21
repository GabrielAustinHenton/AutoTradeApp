import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { getIntradayData } from '../services/alphaVantage';
import { getBinanceCandles, isCryptoSymbol } from '../services/binanceApi';
import { detectPatterns, PATTERN_INFO, type Candle } from '../services/candlestickPatterns';
import { playSound } from '../services/sounds';
import { canExecuteAutoTrade, executeAutoTrade } from '../services/autoTrader';
import type { Alert, PriceHistory } from '../types';

const SCAN_INTERVAL = 60000; // Scan every 60 seconds

export function usePatternScanner() {
  const {
    tradingRules,
    watchlist,
    alerts,
    alertsEnabled,
    soundEnabled,
    addAlert,
    tradingMode,
    autoTradeConfig,
  } = useStore();

  const lastScannedRef = useRef<Map<string, string>>(new Map());
  const scanningRef = useRef(false);

  const scanSymbol = useCallback(async (symbol: string): Promise<Alert[]> => {
    const newAlerts: Alert[] = [];

    try {
      // Use Binance for crypto, Alpha Vantage for stocks
      let data: PriceHistory[];
      if (isCryptoSymbol(symbol)) {
        data = await getBinanceCandles(symbol, '15min', 100);
        console.log(`Fetched ${data.length} candles from Binance for ${symbol}`);
      } else {
        data = await getIntradayData(symbol, '15min');
      }

      if (data.length < 3) return newAlerts;

      // Convert to candle format
      const candles: Candle[] = data.slice(-10).map((d) => ({
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }));

      // Detect patterns
      const patterns = detectPatterns(candles);

      if (patterns.length > 0) {
        console.log(`Found ${patterns.length} pattern(s) for ${symbol}:`, patterns.map(p => p.pattern));
      }

      // Get enabled pattern rules for this symbol
      const enabledRules = tradingRules.filter(
        (r) =>
          r.enabled &&
          r.ruleType === 'pattern' &&
          r.symbol === symbol
      );

      for (const pattern of patterns) {
        // Check if we have a rule for this pattern
        const matchingRule = enabledRules.find((r) => r.pattern === pattern.pattern);

        // Create unique key to avoid duplicate alerts
        const lastCandle = data[data.length - 1];
        const candleTime = lastCandle?.date instanceof Date
          ? lastCandle.date.toISOString()
          : (lastCandle as any)?.timestamp || Date.now();
        const alertKey = `${symbol}-${pattern.pattern}-${candleTime}`;

        // Skip if we already alerted for this pattern at this time
        if (lastScannedRef.current.get(`${symbol}-${pattern.pattern}`) === alertKey) {
          continue;
        }

        lastScannedRef.current.set(`${symbol}-${pattern.pattern}`, alertKey);

        const alert: Alert = {
          id: crypto.randomUUID(),
          type: 'pattern',
          symbol,
          message: `${PATTERN_INFO[pattern.pattern].name} pattern detected on ${symbol}`,
          signal: matchingRule?.type || pattern.signal,
          pattern: pattern.pattern,
          ruleId: matchingRule?.id,
          confidence: pattern.confidence,
          timestamp: new Date(),
          read: false,
          dismissed: false,
        };

        newAlerts.push(alert);
      }
    } catch (error) {
      console.error(`Error scanning ${symbol}:`, error);
    }

    return newAlerts;
  }, [tradingRules]);

  const runScan = useCallback(async () => {
    if (!alertsEnabled || scanningRef.current) return;

    scanningRef.current = true;

    // Get unique symbols from rules and watchlist
    const ruleSymbols = tradingRules
      .filter((r) => r.enabled && r.ruleType === 'pattern')
      .map((r) => r.symbol);
    const symbolsToScan = [...new Set([...ruleSymbols, ...watchlist])];

    console.log(`Starting pattern scan for ${symbolsToScan.length} symbols:`, symbolsToScan);

    for (const symbol of symbolsToScan) {
      const newAlerts = await scanSymbol(symbol);

      for (const alert of newAlerts) {
        // Check if similar alert exists in last 5 minutes
        const recentSimilar = alerts.find(
          (a) =>
            a.symbol === alert.symbol &&
            a.pattern === alert.pattern &&
            !a.dismissed &&
            new Date(a.timestamp).getTime() > Date.now() - 5 * 60 * 1000
        );

        if (!recentSimilar) {
          addAlert(alert);

          // Play sound effect
          if (soundEnabled) {
            playSound(alert.signal);
          }

          // Show browser notification if supported
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(`${alert.signal.toUpperCase()} Signal: ${alert.symbol}`, {
              body: alert.message,
              icon: alert.signal === 'buy' ? '📈' : '📉',
            });
          }

          // Auto-trade execution
          if (alert.ruleId) {
            const rule = tradingRules.find((r) => r.id === alert.ruleId);
            if (rule && rule.autoTrade) {
              const canExecute = canExecuteAutoTrade(rule, autoTradeConfig);
              if (canExecute.allowed) {
                console.log(`Auto-trading: Executing ${rule.type} for ${alert.symbol}`);
                executeAutoTrade(alert, rule, tradingMode, autoTradeConfig).then((execution) => {
                  if (execution.status === 'executed') {
                    console.log(`Auto-trade executed: ${execution.shares} shares of ${execution.symbol} at $${execution.price}`);
                    // Play success sound
                    if (soundEnabled) {
                      playSound(rule.type);
                    }
                  } else {
                    console.error(`Auto-trade failed: ${execution.error}`);
                  }
                });
              } else {
                console.log(`Auto-trade blocked for ${alert.symbol}: ${canExecute.reason}`);
              }
            }
          }
        }
      }

      // Small delay between symbols to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    scanningRef.current = false;
  }, [alertsEnabled, soundEnabled, tradingRules, watchlist, alerts, scanSymbol, addAlert, tradingMode, autoTradeConfig]);

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Run scan on interval
  useEffect(() => {
    if (!alertsEnabled) return;

    // Initial scan after a short delay
    const initialTimeout = setTimeout(runScan, 5000);

    // Regular interval scans
    const interval = setInterval(runScan, SCAN_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [alertsEnabled, runScan]);

  return {
    runScan,
    isEnabled: alertsEnabled,
  };
}
