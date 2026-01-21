import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { getIntradayData } from '../services/alphaVantage';
import { getBinanceCandles, isCryptoSymbol } from '../services/binanceApi';
import { detectPatterns, PATTERN_INFO, type Candle } from '../services/candlestickPatterns';
import { calculateRSI } from '../services/technicalIndicators';
import { playSound } from '../services/sounds';
import { canExecuteAutoTrade, executeAutoTrade } from '../services/autoTrader';
import type { Alert, PriceHistory, TradingRule } from '../types';

// Cache RSI values per symbol to avoid recalculating
const rsiCache = new Map<string, { rsi: number; timestamp: number }>();
const RSI_CACHE_TTL = 60000; // 1 minute

function getCachedRSI(symbol: string, prices: number[]): number | null {
  const cached = rsiCache.get(symbol);
  if (cached && Date.now() - cached.timestamp < RSI_CACHE_TTL) {
    return cached.rsi;
  }
  const rsi = calculateRSI(prices, 14);
  if (rsi !== null) {
    rsiCache.set(symbol, { rsi, timestamp: Date.now() });
  }
  return rsi;
}

function checkRSIFilter(rule: TradingRule, rsi: number | null): { passed: boolean; reason?: string } {
  if (!rule.rsiFilter?.enabled) {
    return { passed: true };
  }

  if (rsi === null) {
    return { passed: false, reason: 'Not enough data to calculate RSI' };
  }

  const { minRSI, maxRSI } = rule.rsiFilter;

  if (minRSI !== undefined && rsi < minRSI) {
    return { passed: false, reason: `RSI ${rsi.toFixed(1)} < min ${minRSI}` };
  }

  if (maxRSI !== undefined && rsi > maxRSI) {
    return { passed: false, reason: `RSI ${rsi.toFixed(1)} > max ${maxRSI}` };
  }

  return { passed: true };
}

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
    scanRequestTimestamp,
  } = useStore();

  const lastScannedRef = useRef<Map<string, string>>(new Map());
  const scanningRef = useRef(false);

  const scanSymbol = useCallback(async (symbol: string): Promise<{ alerts: Alert[]; rsi: number | null; prices: number[] }> => {
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

      if (data.length < 3) return { alerts: newAlerts, rsi: null, prices: [] };

      // Extract close prices for RSI calculation
      const closePrices = data.map(d => d.close);
      const rsi = getCachedRSI(symbol, closePrices);

      if (rsi !== null) {
        console.log(`${symbol} RSI(14): ${rsi.toFixed(1)}`);
      }

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

      return { alerts: newAlerts, rsi, prices: closePrices };
    } catch (error) {
      console.error(`Error scanning ${symbol}:`, error);
    }

    return { alerts: [], rsi: null, prices: [] };
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
      const { alerts: newAlerts, rsi } = await scanSymbol(symbol);

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
              // Check RSI filter first
              const rsiCheck = checkRSIFilter(rule, rsi);
              if (!rsiCheck.passed) {
                console.log(`Auto-trade blocked for ${alert.symbol}: RSI filter - ${rsiCheck.reason}`);
                continue;
              }

              const canExecute = canExecuteAutoTrade(rule, autoTradeConfig);
              if (canExecute.allowed) {
                console.log(`Auto-trading: Executing ${rule.type} for ${alert.symbol}${rsi !== null ? ` (RSI: ${rsi.toFixed(1)})` : ''}`);
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

  // Respond to manual scan requests
  useEffect(() => {
    if (scanRequestTimestamp && alertsEnabled) {
      console.log('Manual scan requested');
      runScan();
    }
  }, [scanRequestTimestamp, alertsEnabled, runScan]);

  return {
    runScan,
    isEnabled: alertsEnabled,
  };
}
