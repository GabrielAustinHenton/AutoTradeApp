import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { getFinnhubCandles } from '../services/alphaVantage';
import { getBinanceCandles, isCryptoSymbol } from '../services/binanceApi';
import { detectPatterns, PATTERN_INFO, type Candle } from '../services/candlestickPatterns';
import { calculateRSI, calculateMACD, detectMACDCrossover } from '../services/technicalIndicators';
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

function checkVolumeFilter(
  rule: TradingRule,
  volumeData: { current: number; average: number } | null
): { passed: boolean; reason?: string } {
  if (!rule.volumeFilter?.enabled) {
    return { passed: true };
  }

  if (!volumeData || volumeData.average === 0) {
    return { passed: false, reason: 'Not enough data to calculate volume average' };
  }

  const volumeRatio = volumeData.current / volumeData.average;
  const requiredMultiplier = rule.volumeFilter.minMultiplier;

  if (volumeRatio < requiredMultiplier) {
    return {
      passed: false,
      reason: `Volume ${volumeRatio.toFixed(2)}x < min ${requiredMultiplier}x avg`,
    };
  }

  return { passed: true };
}

// Cache MACD values per symbol to avoid recalculating
const macdCache = new Map<string, { macd: ReturnType<typeof calculateMACD>; timestamp: number }>();
const MACD_CACHE_TTL = 60000; // 1 minute

function getCachedMACD(symbol: string, prices: number[], fast: number, slow: number, signal: number) {
  const cacheKey = `${symbol}-${fast}-${slow}-${signal}`;
  const cached = macdCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < MACD_CACHE_TTL) {
    return cached.macd;
  }
  const macd = calculateMACD(prices, fast, slow, signal);
  if (macd !== null) {
    macdCache.set(cacheKey, { macd, timestamp: Date.now() });
  }
  return macd;
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

  const scanSymbol = useCallback(async (symbol: string): Promise<{ alerts: Alert[]; rsi: number | null; prices: number[]; volumeData: { current: number; average: number } | null }> => {
    const newAlerts: Alert[] = [];

    try {
      // Use Finnhub for stocks (60 calls/min vs Alpha Vantage's 5 calls/min)
      // Binance for crypto is disabled - crypto removed from app
      let data: PriceHistory[];
      if (isCryptoSymbol(symbol)) {
        data = await getBinanceCandles(symbol, '15min', 100);
      } else {
        data = await getFinnhubCandles(symbol, '15', 100);
      }

      if (data.length < 3) {
        console.log(`  ⚠️ ${symbol}: Insufficient data (${data.length} candles)`);
        return { alerts: newAlerts, rsi: null, prices: [], volumeData: null };
      }

      console.log(`  📊 ${symbol}: ${data.length} candles, last price: $${data[data.length - 1]?.close?.toFixed(2) || 'N/A'}`);

      // Extract close prices for RSI calculation
      const closePrices = data.map(d => d.close);
      const rsi = getCachedRSI(symbol, closePrices);

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
        console.log(`  ✅ ${symbol}: Found ${patterns.length} pattern(s):`, patterns.map(p => `${p.pattern} (${p.confidence}%)`).join(', '));
      } else {
        console.log(`  ⬜ ${symbol}: No patterns detected`);
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

      // Calculate volume data
      const volumes = data.map(d => d.volume);
      const currentVolume = volumes[volumes.length - 1];
      const avgVolume = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1);
      const volumeData = { current: currentVolume, average: avgVolume };

      // Get enabled MACD rules for this symbol
      const enabledMACDRules = tradingRules.filter(
        (r) =>
          r.enabled &&
          r.ruleType === 'macd' &&
          r.symbol === symbol &&
          r.macdSettings
      );

      // Check MACD crossovers
      for (const rule of enabledMACDRules) {
        const { fastPeriod, slowPeriod, signalPeriod, crossoverType } = rule.macdSettings!;
        const macd = getCachedMACD(symbol, closePrices, fastPeriod, slowPeriod, signalPeriod);

        if (macd) {
          const crossover = detectMACDCrossover(macd);

          if (crossover && crossover.type === crossoverType) {
            // Create unique key to avoid duplicate alerts
            const alertKey = `${symbol}-macd-${crossoverType}-${Date.now().toString().slice(0, -4)}`; // Round to ~10 second buckets

            // Skip if we already alerted for this crossover recently
            if (lastScannedRef.current.get(`${symbol}-macd-${crossoverType}`) === alertKey) {
              continue;
            }

            lastScannedRef.current.set(`${symbol}-macd-${crossoverType}`, alertKey);

            console.log(`MACD ${crossoverType} crossover detected for ${symbol}: MACD=${macd.macdLine}, Signal=${macd.signalLine}`);

            const alert: Alert = {
              id: crypto.randomUUID(),
              type: 'pattern',
              symbol,
              message: `MACD ${crossoverType} crossover on ${symbol} (MACD: ${macd.macdLine.toFixed(4)}, Signal: ${macd.signalLine.toFixed(4)})`,
              signal: crossover.signal,
              ruleId: rule.id,
              confidence: 75, // MACD crossovers are generally reliable
              timestamp: new Date(),
              read: false,
              dismissed: false,
            };

            newAlerts.push(alert);
          }
        }
      }

      return { alerts: newAlerts, rsi, prices: closePrices, volumeData };
    } catch (error) {
      console.error(`Error scanning ${symbol}:`, error);
    }

    return { alerts: [], rsi: null, prices: [], volumeData: null };
  }, [tradingRules]);

  const runScan = useCallback(async () => {
    // Debug: Log why scan might not run
    if (!alertsEnabled) {
      console.log('🔴 SCAN SKIPPED: Alerts are disabled. Enable in Settings.');
      return;
    }
    if (scanningRef.current) {
      console.log('🔴 SCAN SKIPPED: Previous scan still running.');
      return;
    }

    scanningRef.current = true;

    // Debug: Log current config
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 PATTERN SCANNER STARTING');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('Config:', {
      alertsEnabled,
      autoTradeEnabled: autoTradeConfig.enabled,
      tradingMode,
      maxTradesPerDay: autoTradeConfig.maxTradesPerDay,
      tradingHoursOnly: autoTradeConfig.tradingHoursOnly,
    });

    // Get unique symbols from rules and watchlist
    const enabledRules = tradingRules.filter((r) => r.enabled && (r.ruleType === 'pattern' || r.ruleType === 'macd'));
    const ruleSymbols = enabledRules.map((r) => r.symbol);
    const symbolsToScan = [...new Set([...ruleSymbols, ...watchlist])];

    console.log(`Enabled rules: ${enabledRules.length} (${enabledRules.filter(r => r.autoTrade).length} with auto-trade)`);
    console.log(`Symbols to scan: ${symbolsToScan.length}`);

    for (const symbol of symbolsToScan) {
      const { alerts: newAlerts, rsi, volumeData } = await scanSymbol(symbol);

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
              // Check minimum confidence threshold
              if (rule.minConfidence && alert.confidence !== undefined) {
                if (alert.confidence < rule.minConfidence) {
                  console.log(`Auto-trade blocked for ${alert.symbol}: Confidence ${alert.confidence}% < min ${rule.minConfidence}%`);
                  continue;
                }
              }

              // Check volume filter
              const volumeCheck = checkVolumeFilter(rule, volumeData);
              if (!volumeCheck.passed) {
                console.log(`Auto-trade blocked for ${alert.symbol}: Volume filter - ${volumeCheck.reason}`);
                continue;
              }

              // Check RSI filter
              const rsiCheck = checkRSIFilter(rule, rsi);
              if (!rsiCheck.passed) {
                console.log(`Auto-trade blocked for ${alert.symbol}: RSI filter - ${rsiCheck.reason}`);
                continue;
              }

              const canExecute = canExecuteAutoTrade(rule, autoTradeConfig);
              if (canExecute.allowed) {
                const volRatio = volumeData ? (volumeData.current / volumeData.average).toFixed(2) : 'N/A';
                console.log(`Auto-trading: Executing ${rule.type} for ${alert.symbol} (Confidence: ${alert.confidence ?? 'N/A'}%, Vol: ${volRatio}x avg${rsi !== null ? `, RSI: ${rsi.toFixed(1)}` : ''})`);
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

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 SCAN COMPLETE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('Next scan in 60 seconds. Check above for any blocked trades.');
    console.log('If no patterns found, market may be quiet or data unavailable.');

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
