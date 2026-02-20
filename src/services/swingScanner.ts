// ============================================================================
// Swing Scanner Service
// ============================================================================
// Scans watchlist symbols for swing trading entries at 9:35 AM ET (morning)
// and optionally 3:45 PM ET (EOD). Uses RSI + SMA50 + MACD to determine
// regime and entry conditions. Places bracket orders on the separate swing
// trader Alpaca account (GTC — exits persist even after browser closes).
//
// Strategy per regime:
//   Uptrend  (price > SMA50×1.02): RSI(14) 30–50 pullback + MACD improving
//             → bracket: 15% TP, 5% SL
//   Sideways (price within ±3% of SMA50): RSI(14) < 35 + MACD histogram up
//             → bracket: 8% TP, 4% SL (tighter — mean reversion)
//   Downtrend (price < SMA50×0.97): Skip — no long entries in downtrend
// ============================================================================

import { alpaca } from './alpaca';
import { calculateSMA, calculateRSI, calculateMACD } from './swingTrader';

// ── ET Timezone Helpers ───────────────────────────────────────────────────────

function getETDateStr(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$1-$2');
}

function getETHourMinute(): { h: number; m: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  return {
    h: parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10),
    m: parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10),
  };
}

function isMarketWeekday(): boolean {
  const dayStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short',
  }).format(new Date());
  return !['Sat', 'Sun'].includes(dayStr);
}

// Returns YYYY-MM-DD for N calendar days ago (for bar start date)
function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

// ── Scanner State ─────────────────────────────────────────────────────────────

export type SwingRegime = 'uptrend' | 'sideways' | 'downtrend';

export interface SwingCandidateState {
  symbol: string;
  regime: SwingRegime;
  price?: number;
  rsi?: number;
  sma50?: number;
  macdHistogram?: number;
  prevMacdHistogram?: number;
  tradedToday: boolean;
  date: string;           // YYYY-MM-DD ET
  entryPrice?: number;
  orderId?: string;
  skipReason?: string;    // why the scanner skipped this symbol
}

const scanMap = new Map<string, SwingCandidateState>();
let scanInterval: ReturnType<typeof setInterval> | null = null;
export let scannerRunning = false;

let lastMorningScanDate = '';
let lastEodScanDate = '';

// ── Technical Analysis ────────────────────────────────────────────────────────

interface SymbolAnalysis {
  regime: SwingRegime;
  price: number;
  rsi: number;
  sma50: number;
  macdHistogram: number;
  prevMacdHistogram: number;
}

async function analyzeSymbol(symbol: string): Promise<SymbolAnalysis | null> {
  try {
    const today = getETDateStr();
    const start = daysAgoStr(120);  // fetch ~4 months to get 50+ trading days

    const bars = await alpaca.getSwingHistoricalBars(symbol, start, today);
    if (bars.length < 52) {
      console.warn(`[SwingScanner] ${symbol}: insufficient bar data (${bars.length} bars)`);
      return null;
    }

    const closes = bars.map(b => b.close);
    const price = closes[closes.length - 1];

    // Compute indicators on full history
    const sma50 = calculateSMA(closes, 50);
    const rsi = calculateRSI(closes, 14);

    // MACD crossover: compare current vs previous bar
    const currMACD = calculateMACD(closes, 12, 26, 9);
    const prevMACD = calculateMACD(closes.slice(0, -1), 12, 26, 9);

    // Regime classification
    const pctFromSMA = (price - sma50) / sma50;
    let regime: SwingRegime;
    if (pctFromSMA > 0.02) {
      regime = 'uptrend';
    } else if (pctFromSMA < -0.03) {
      regime = 'downtrend';
    } else {
      regime = 'sideways';
    }

    return {
      regime,
      price,
      rsi,
      sma50,
      macdHistogram: currMACD.histogram,
      prevMacdHistogram: prevMACD.histogram,
    };
  } catch (err) {
    console.error(`[SwingScanner] analyzeSymbol ${symbol}:`, err);
    return null;
  }
}

// ── Entry Signal Logic ────────────────────────────────────────────────────────

function evaluateEntry(analysis: SymbolAnalysis): {
  shouldEnter: boolean;
  tpPercent: number;
  slPercent: number;
  reason: string;
} {
  const { regime, rsi, macdHistogram, prevMacdHistogram } = analysis;
  const histImproving = macdHistogram > prevMacdHistogram;

  if (regime === 'downtrend') {
    return { shouldEnter: false, tpPercent: 0, slPercent: 0, reason: 'Downtrend — skipping long entry' };
  }

  if (regime === 'uptrend') {
    // RSI pullback: oversold but not extreme; MACD histogram recovering
    if (rsi >= 30 && rsi <= 50 && histImproving) {
      return { shouldEnter: true, tpPercent: 15, slPercent: 5, reason: `Uptrend pullback: RSI ${rsi.toFixed(1)}, MACD recovering` };
    }
    return { shouldEnter: false, tpPercent: 0, slPercent: 0, reason: `Uptrend but no signal: RSI ${rsi.toFixed(1)}, MACD ${histImproving ? 'improving' : 'declining'}` };
  }

  // sideways
  if (rsi < 35 && histImproving) {
    return { shouldEnter: true, tpPercent: 8, slPercent: 4, reason: `Sideways mean reversion: RSI ${rsi.toFixed(1)}, MACD turning up` };
  }
  return { shouldEnter: false, tpPercent: 0, slPercent: 0, reason: `Sideways but no signal: RSI ${rsi.toFixed(1)}` };
}

// ── Main Scan ─────────────────────────────────────────────────────────────────

type OnTradeFn = (symbol: string, qty: number, price: number, orderId: string) => void;
type OnErrorFn = (err: string) => void;

async function runScan(
  symbols: string[],
  capitalPerTrade: number,
  onTrade: OnTradeFn,
  onError: OnErrorFn,
): Promise<void> {
  console.log(`[SwingScanner] Running scan for: ${symbols.join(', ')}`);

  // Fetch latest prices in one call for all symbols
  let latestPrices: Map<string, number>;
  try {
    latestPrices = await alpaca.getSwingLatestPrices(symbols);
  } catch (err) {
    onError(`Failed to fetch prices: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  for (const symbol of symbols) {
    const today = getETDateStr();
    const existing = scanMap.get(symbol);

    // Reset stale entries from previous days
    if (existing && existing.date !== today) {
      scanMap.set(symbol, { symbol, regime: 'sideways', tradedToday: false, date: today });
    }

    // Skip if already traded today
    if (scanMap.get(symbol)?.tradedToday) {
      continue;
    }

    const latestPrice = latestPrices.get(symbol);

    // Analyze symbol
    const analysis = await analyzeSymbol(symbol);
    if (!analysis) {
      scanMap.set(symbol, {
        symbol, regime: 'sideways', tradedToday: false, date: today,
        skipReason: 'Insufficient data',
      });
      continue;
    }

    // Override price with latest real-time price if available
    const price = latestPrice ?? analysis.price;

    // Update regime/indicators in state
    scanMap.set(symbol, {
      symbol,
      regime: analysis.regime,
      price,
      rsi: analysis.rsi,
      sma50: analysis.sma50,
      macdHistogram: analysis.macdHistogram,
      prevMacdHistogram: analysis.prevMacdHistogram,
      tradedToday: false,
      date: today,
    });

    const entry = evaluateEntry({ ...analysis, price });

    if (!entry.shouldEnter) {
      scanMap.set(symbol, { ...scanMap.get(symbol)!, skipReason: entry.reason });
      console.log(`[SwingScanner] ${symbol}: no entry — ${entry.reason}`);
      continue;
    }

    // Calculate position size
    const qty = Math.max(1, Math.floor(capitalPerTrade / price));

    // Place bracket order on swing trader account (GTC — persists until TP or SL fills)
    try {
      const order = await alpaca.createSwingOrder({
        symbol,
        qty,
        side: 'buy',
        type: 'market',
        time_in_force: 'gtc',
        order_class: 'bracket',
        take_profit: { limit_price: parseFloat((price * (1 + entry.tpPercent / 100)).toFixed(2)) },
        stop_loss: { stop_price: parseFloat((price * (1 - entry.slPercent / 100)).toFixed(2)) },
      });

      scanMap.set(symbol, {
        ...scanMap.get(symbol)!,
        tradedToday: true,
        entryPrice: price,
        orderId: order.id,
      });

      console.log(`[SwingScanner] ENTRY: ${symbol} @ $${price.toFixed(2)} — ${entry.reason} | TP ${entry.tpPercent}%, SL ${entry.slPercent}%`);
      onTrade(symbol, qty, price, order.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SwingScanner] ${symbol}: order failed — ${msg}`);
      onError(`${symbol}: ${msg}`);
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startSwingScanner(
  symbols: string[],
  capitalPerTrade: number,
  onTrade: OnTradeFn,
  onError: OnErrorFn,
): void {
  if (scannerRunning) stopSwingScanner();

  scannerRunning = true;
  console.log('[SwingScanner] Scanner started');

  // Tick every 60 seconds, check if we're in a scan window
  scanInterval = setInterval(() => {
    if (!isMarketWeekday()) return;

    const { h, m } = getETHourMinute();
    const etMinutes = h * 60 + m;
    const today = getETDateStr();

    // Morning scan window: 9:35–9:45 AM ET
    const isMorning = etMinutes >= 575 && etMinutes < 585;
    // EOD scan window: 3:45–3:55 PM ET
    const isEod = etMinutes >= 945 && etMinutes < 955;

    if (isMorning && lastMorningScanDate !== today) {
      lastMorningScanDate = today;
      console.log(`[SwingScanner] Running morning scan (${h}:${String(m).padStart(2, '0')} ET)`);
      runScan(symbols, capitalPerTrade, onTrade, onError).catch(onError);
    } else if (isEod && lastEodScanDate !== today) {
      lastEodScanDate = today;
      console.log(`[SwingScanner] Running EOD scan (${h}:${String(m).padStart(2, '0')} ET)`);
      runScan(symbols, capitalPerTrade, onTrade, onError).catch(onError);
    }
  }, 60_000);
}

export function stopSwingScanner(): void {
  if (scanInterval !== null) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  scannerRunning = false;
  console.log('[SwingScanner] Scanner stopped');
}

export function resetSwingScanner(): void {
  stopSwingScanner();
  scanMap.clear();
  lastMorningScanDate = '';
  lastEodScanDate = '';
}

export function getSwingStates(): SwingCandidateState[] {
  return Array.from(scanMap.values());
}
