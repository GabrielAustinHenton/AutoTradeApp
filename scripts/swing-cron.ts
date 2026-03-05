// ============================================================================
// Swing Scanner — Standalone Node.js cron script
// ============================================================================
// Runs via GitHub Actions on a schedule (weekdays at 9:35 AM and 3:45 PM ET).
// Reads Alpaca credentials from environment variables instead of localStorage.
// Uses daily bars to detect market regime (uptrend/sideways/downtrend) then
// places GTC bracket orders for qualifying setups.
//
// Strategy:
//   Uptrend  (price > SMA50×1.02): RSI(14) 30–50 pullback + MACD improving
//             → bracket: 15% TP, 5% SL (GTC)
//   Sideways (price within ±3% of SMA50): RSI(14) < 35 + MACD histogram up
//             → bracket: 8% TP, 4% SL (GTC)
//   Downtrend (price < SMA50×0.97): Skip — no long entries
//
// Bracket orders are GTC so they persist until TP or SL fills — no monitoring
// needed after placement.
//
// Required env vars:
//   ALPACA_SWING_KEY_ID     — Alpaca swing account API key ID
//   ALPACA_SWING_SECRET_KEY — Alpaca swing account secret key
//   SWING_CAPITAL_PER_TRADE — Capital per trade in dollars (default: 500)
//   SWING_MAX_POSITIONS     — Max concurrent positions (default: 3)
// ============================================================================

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Config ──────────────────────────────────────────────────────────────────

const KEY_ID     = process.env.ALPACA_SWING_KEY_ID ?? '';
const SECRET_KEY = process.env.ALPACA_SWING_SECRET_KEY ?? '';
const CAPITAL_PER_TRADE = parseInt(process.env.SWING_CAPITAL_PER_TRADE || '500', 10);
const MAX_POSITIONS     = parseInt(process.env.SWING_MAX_POSITIONS || '3', 10);

const __cronDir = dirname(fileURLToPath(import.meta.url));
let WATCHLIST: string[];
try {
  WATCHLIST = JSON.parse(readFileSync(resolve(__cronDir, '../config/swing-watchlist.json'), 'utf-8'));
} catch {
  WATCHLIST = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'JPM', 'V', 'HD', 'KO'];
}

// Alpaca uses the same live API for all funded accounts
const BASE_URL = 'https://api.alpaca.markets/v2';
const DATA_BASE = 'https://data.alpaca.markets/v2';

if (!KEY_ID || !SECRET_KEY) {
  console.error('[SWING] ALPACA_SWING_KEY_ID and ALPACA_SWING_SECRET_KEY must be set.');
  process.exit(1);
}

console.log(`[SWING] Starting — watchlist: ${WATCHLIST.join(', ')} | capital/trade: $${CAPITAL_PER_TRADE} | max positions: ${MAX_POSITIONS}`);

// ── Alpaca client ──────────────────────────────────────────────────────────

const AUTH_HEADERS = {
  'APCA-API-KEY-ID': KEY_ID,
  'APCA-API-SECRET-KEY': SECRET_KEY,
  'Content-Type': 'application/json',
};

async function alpacaRequest(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...AUTH_HEADERS, ...(options.headers as Record<string, string> | undefined) },
  });
}

async function dataRequest(path: string): Promise<Response> {
  return fetch(`${DATA_BASE}${path}`, {
    headers: { 'APCA-API-KEY-ID': KEY_ID, 'APCA-API-SECRET-KEY': SECRET_KEY },
  });
}

interface Position { symbol: string; qty: string; avg_entry_price: string; }
interface Order { id: string; symbol: string; }

async function getPositions(): Promise<Position[]> {
  const res = await alpacaRequest('/positions');
  if (!res.ok) throw new Error(`getPositions: ${res.status} ${await res.text()}`);
  return res.json();
}

async function getAccount(): Promise<{ equity: string; cash: string }> {
  const res = await alpacaRequest('/account');
  if (!res.ok) throw new Error(`getAccount: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Technical Analysis ──────────────────────────────────────────────────────

interface DailyBar { t: string; o: number; h: number; l: number; c: number; v: number; }

async function getDailyBars(symbol: string, days: number = 120): Promise<DailyBar[]> {
  const end = new Date().toISOString().split('T')[0];
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const params = new URLSearchParams({
    timeframe: '1Day', start, end, limit: '200', feed: 'iex', sort: 'asc',
  });
  const res = await dataRequest(`/stocks/${encodeURIComponent(symbol)}/bars?${params}`);
  if (!res.ok) throw new Error(`getDailyBars ${symbol}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.bars || [];
}

async function getLatestPrices(symbols: string[]): Promise<Map<string, number>> {
  const params = new URLSearchParams({ symbols: symbols.join(','), feed: 'iex' });
  const res = await dataRequest(`/stocks/trades/latest?${params}`);
  if (!res.ok) throw new Error(`getLatestPrices: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const result = new Map<string, number>();
  for (const [sym, trade] of Object.entries(data.trades ?? {} as Record<string, { p: number }>)) {
    result.set(sym, (trade as { p: number }).p);
  }
  return result;
}

function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  if (prices.length < period) return calculateSMA(prices, prices.length);
  const multiplier = 2 / (period + 1);
  let ema = calculateSMA(prices.slice(0, period), period);
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  return ema;
}

function calculateRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - change) / period;
    }
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calculateMACD(closes: number[]): { histogram: number } {
  if (closes.length < 35) return { histogram: 0 };
  const fast = calculateEMA(closes, 12);
  const slow = calculateEMA(closes, 26);
  const macdLine = fast - slow;
  const macdHistory: number[] = [];
  for (let i = 26; i <= closes.length; i++) {
    const f = calculateEMA(closes.slice(0, i), 12);
    const s = calculateEMA(closes.slice(0, i), 26);
    macdHistory.push(f - s);
  }
  const signal = calculateEMA(macdHistory, 9);
  return { histogram: macdLine - signal };
}

// ── Regime + Entry Logic ──────────────────────────────────────────────────

type Regime = 'uptrend' | 'sideways' | 'downtrend';

interface Analysis {
  regime: Regime;
  price: number;
  rsi: number;
  sma50: number;
  macdHistogram: number;
  prevMacdHistogram: number;
}

function analyzeSymbol(bars: DailyBar[], latestPrice: number): Analysis | null {
  if (bars.length < 52) return null;

  const closes = bars.map(b => b.c);
  const price = latestPrice;
  const sma50 = calculateSMA(closes, 50);
  const rsi = calculateRSI(closes, 14);
  const currMACD = calculateMACD(closes);
  const prevMACD = calculateMACD(closes.slice(0, -1));

  const pctFromSMA = (price - sma50) / sma50;
  let regime: Regime;
  if (pctFromSMA > 0.02) regime = 'uptrend';
  else if (pctFromSMA < -0.03) regime = 'downtrend';
  else regime = 'sideways';

  return {
    regime, price, rsi, sma50,
    macdHistogram: currMACD.histogram,
    prevMacdHistogram: prevMACD.histogram,
  };
}

function evaluateEntry(a: Analysis): {
  shouldEnter: boolean; tpPercent: number; slPercent: number; reason: string;
} {
  const histImproving = a.macdHistogram > a.prevMacdHistogram;

  if (a.regime === 'downtrend') {
    return { shouldEnter: false, tpPercent: 0, slPercent: 0, reason: 'Downtrend — skipping' };
  }

  if (a.regime === 'uptrend') {
    if (a.rsi >= 30 && a.rsi <= 50 && histImproving) {
      return { shouldEnter: true, tpPercent: 15, slPercent: 5, reason: `Uptrend pullback: RSI ${a.rsi.toFixed(1)}, MACD recovering` };
    }
    return { shouldEnter: false, tpPercent: 0, slPercent: 0, reason: `Uptrend but no signal: RSI ${a.rsi.toFixed(1)}` };
  }

  // sideways
  if (a.rsi < 35 && histImproving) {
    return { shouldEnter: true, tpPercent: 8, slPercent: 4, reason: `Sideways mean reversion: RSI ${a.rsi.toFixed(1)}, MACD turning up` };
  }
  return { shouldEnter: false, tpPercent: 0, slPercent: 0, reason: `Sideways but no signal: RSI ${a.rsi.toFixed(1)}` };
}

// ── Main Scan ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Check account
  const account = await getAccount();
  console.log(`[SWING] Account equity: $${parseFloat(account.equity).toFixed(2)} | cash: $${parseFloat(account.cash).toFixed(2)}`);

  // Get existing positions to avoid exceeding max and to skip held symbols
  const positions = await getPositions();
  const heldSymbols = new Set(positions.map(p => p.symbol.toUpperCase()));
  const openCount = positions.length;

  console.log(`[SWING] Open positions: ${openCount}/${MAX_POSITIONS} — ${positions.map(p => p.symbol).join(', ') || 'none'}`);

  if (openCount >= MAX_POSITIONS) {
    console.log(`[SWING] Already at max positions (${MAX_POSITIONS}). No new entries.`);
    process.exit(0);
  }

  const slotsAvailable = MAX_POSITIONS - openCount;

  // Filter watchlist to symbols we don't already hold
  const candidates = WATCHLIST.filter(s => !heldSymbols.has(s));
  if (candidates.length === 0) {
    console.log('[SWING] All watchlist symbols already held. Nothing to scan.');
    process.exit(0);
  }

  // Get latest prices for all candidates
  let latestPrices: Map<string, number>;
  try {
    latestPrices = await getLatestPrices(candidates);
  } catch (err) {
    console.error(`[SWING] Failed to fetch latest prices: ${err}`);
    process.exit(1);
  }

  // Analyze each candidate
  let tradesPlaced = 0;

  for (const symbol of candidates) {
    if (tradesPlaced >= slotsAvailable) {
      console.log(`[SWING] All ${slotsAvailable} slots filled. Done.`);
      break;
    }

    const latestPrice = latestPrices.get(symbol);
    if (latestPrice === undefined) {
      console.warn(`[SWING] ${symbol}: no latest price — skipping`);
      continue;
    }

    // Fetch daily bars for technical analysis
    let bars: DailyBar[];
    try {
      bars = await getDailyBars(symbol);
    } catch (err) {
      console.error(`[SWING] ${symbol}: failed to fetch bars — ${err}`);
      continue;
    }

    const analysis = analyzeSymbol(bars, latestPrice);
    if (!analysis) {
      console.warn(`[SWING] ${symbol}: insufficient data (${bars.length} bars)`);
      continue;
    }

    const entry = evaluateEntry(analysis);
    console.log(`[SWING] ${symbol}: ${analysis.regime} | RSI ${analysis.rsi.toFixed(1)} | price $${analysis.price.toFixed(2)} | SMA50 $${analysis.sma50.toFixed(2)} | ${entry.reason}`);

    if (!entry.shouldEnter) continue;

    // Position sizing
    const qty = Math.max(1, Math.floor(CAPITAL_PER_TRADE / analysis.price));
    const tpPrice = parseFloat((analysis.price * (1 + entry.tpPercent / 100)).toFixed(2));
    const slPrice = parseFloat((analysis.price * (1 - entry.slPercent / 100)).toFixed(2));

    // Place GTC bracket order
    try {
      const body = {
        symbol,
        qty: qty.toString(),
        side: 'buy',
        type: 'market',
        time_in_force: 'gtc',
        order_class: 'bracket',
        take_profit: { limit_price: tpPrice.toFixed(2) },
        stop_loss: { stop_price: slPrice.toFixed(2) },
      };

      const res = await alpacaRequest('/orders', { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status} ${text}`);
      }
      const order: Order = await res.json();

      tradesPlaced++;
      console.log(`[SWING] ENTRY: ${symbol} x${qty} @ $${analysis.price.toFixed(2)} | TP $${tpPrice} | SL $${slPrice} | order ${order.id}`);
    } catch (err) {
      console.error(`[SWING] ${symbol}: order failed — ${err}`);
    }
  }

  if (tradesPlaced === 0) {
    console.log('[SWING] No qualifying entries found today.');
  } else {
    console.log(`[SWING] Placed ${tradesPlaced} trade(s).`);
  }
}

main().catch(err => {
  console.error('[SWING] Fatal error:', err);
  process.exit(1);
});
