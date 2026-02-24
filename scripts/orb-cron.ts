// ============================================================================
// ORB Scanner — Standalone Node.js cron script
// ============================================================================
// Runs via GitHub Actions on a schedule (weekdays 8:30 AM EST / 9:30 AM EDT).
// Reads Alpaca credentials from environment variables instead of localStorage.
// Exits when all watchlist symbols have been traded or noon ET is reached.
// Bracket orders (TP/SL) execute server-side on Alpaca — no monitoring needed.
//
// Required env vars:
//   ALPACA_KEY_ID      — Alpaca API key ID
//   ALPACA_SECRET_KEY  — Alpaca API secret key
//   ALPACA_IS_PAPER    — "false" for live, anything else (or absent) = paper
// ============================================================================

// ── Config ───────────────────────────────────────────────────────────────────

const KEY_ID     = process.env.ALPACA_KEY_ID ?? '';
const SECRET_KEY = process.env.ALPACA_SECRET_KEY ?? '';
const IS_PAPER   = process.env.ALPACA_IS_PAPER !== 'false';

const WATCHLIST: string[] = [
  'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'SPY', 'KO', 'POR', 'EPD', 'HOOD',
];

const CAPITAL_PER_TRADE = 3_750;
const MAX_TRADES_PER_DAY = 20;
const MAX_DAILY_EXPOSURE = MAX_TRADES_PER_DAY * CAPITAL_PER_TRADE; // $75k cap
const SCAN_INTERVAL_MS  = 60_000; // poll every 60 seconds
const TAKE_PROFIT_PCT   = 0.02;   // 2%
const STOP_LOSS_PCT     = 0.01;   // 1%

const PAPER_BASE = 'https://paper-api.alpaca.markets/v2';
const LIVE_BASE  = 'https://api.alpaca.markets/v2';
const DATA_BASE  = 'https://data.alpaca.markets/v2';

if (!KEY_ID || !SECRET_KEY) {
  console.error('[ORB] ALPACA_KEY_ID and ALPACA_SECRET_KEY must be set.');
  process.exit(1);
}

const BASE_URL = IS_PAPER ? PAPER_BASE : LIVE_BASE;
const MODE_TAG = IS_PAPER ? 'PAPER' : 'LIVE';

console.log(`[ORB] Starting — mode: ${MODE_TAG} | watchlist: ${WATCHLIST.join(', ')}`);

// ── ET timezone helpers ──────────────────────────────────────────────────────

function getETOffset(): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      timeZoneName: 'shortOffset',
    });
    const parts = fmt.formatToParts(new Date());
    const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT-5';
    const match = offsetPart.match(/GMT([+-]\d+)/);
    if (match) {
      const h = parseInt(match[1], 10);
      return `${h < 0 ? '-' : '+'}${String(Math.abs(h)).padStart(2, '0')}:00`;
    }
  } catch { /* fall through */ }
  return '-05:00';
}

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
  const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  return { h, m };
}

function getETTimeStr(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date());
}

function isAfterOpeningRange(): boolean {
  const { h, m } = getETHourMinute();
  return h * 60 + m >= 600; // 10:00 AM
}

function isPastNoon(): boolean {
  const { h } = getETHourMinute();
  return h >= 12; // 12:00 PM — exit cron, bracket orders handle the rest
}

// ── Minimal Alpaca client ────────────────────────────────────────────────────

const AUTH_HEADERS = {
  'APCA-API-KEY-ID': KEY_ID,
  'APCA-API-SECRET-KEY': SECRET_KEY,
  'Content-Type': 'application/json',
};

async function alpacaRequest(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  return fetch(url, { ...options, headers: { ...AUTH_HEADERS, ...(options.headers as Record<string, string> | undefined) } });
}

interface Position { symbol: string; avg_entry_price: string; }
interface Bar { t: string; o: number; h: number; l: number; c: number; }
interface Order { id: string; symbol: string; }

async function getPositions(): Promise<Position[]> {
  const res = await alpacaRequest('/positions');
  if (!res.ok) throw new Error(`getPositions: ${res.status} ${await res.text()}`);
  return res.json();
}

async function getMultipleMinuteBars(
  symbols: string[], start: string, end: string,
): Promise<Map<string, Bar[]>> {
  const params = new URLSearchParams({ symbols: symbols.join(','), timeframe: '1Min', start, end, limit: '1000', feed: 'iex' });
  const res = await fetch(`${DATA_BASE}/stocks/bars?${params}`, {
    headers: { 'APCA-API-KEY-ID': KEY_ID, 'APCA-API-SECRET-KEY': SECRET_KEY },
  });
  if (!res.ok) throw new Error(`getMultipleMinuteBars: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const result = new Map<string, Bar[]>();
  for (const [sym, bars] of Object.entries(data.bars ?? {} as Record<string, Bar[]>)) {
    result.set(sym, (bars as Bar[]).map(b => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c })));
  }
  return result;
}

async function getLatestTradePrices(symbols: string[]): Promise<Map<string, number>> {
  const params = new URLSearchParams({ symbols: symbols.join(','), feed: 'iex' });
  const res = await fetch(`${DATA_BASE}/stocks/trades/latest?${params}`, {
    headers: { 'APCA-API-KEY-ID': KEY_ID, 'APCA-API-SECRET-KEY': SECRET_KEY },
  });
  if (!res.ok) throw new Error(`getLatestTradePrices: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const result = new Map<string, number>();
  for (const [sym, trade] of Object.entries(data.trades ?? {} as Record<string, { p: number }>)) {
    result.set(sym, (trade as { p: number }).p);
  }
  return result;
}

async function createBracketOrder(
  symbol: string, qty: number, price: number,
): Promise<Order> {
  const body = {
    symbol,
    qty: qty.toString(),
    side: 'buy',
    type: 'market',
    time_in_force: 'day',
    order_class: 'bracket',
    take_profit: { limit_price: (price * (1 + TAKE_PROFIT_PCT)).toFixed(2) },
    stop_loss:   { stop_price: (price * (1 - STOP_LOSS_PCT)).toFixed(2) },
  };
  const res = await alpacaRequest('/orders', { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`createBracketOrder ${symbol}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── ORB state ─────────────────────────────────────────────────────────────────

interface OrbData {
  symbol: string;
  orbHigh: number;
  orbLow: number;
  tradedToday: boolean;
  entryPrice?: number;
}

const orbMap = new Map<string, OrbData>();
let totalDeployedToday = 0;

// ── Main scan loop ────────────────────────────────────────────────────────────

async function runScan(): Promise<void> {
  const today = getETDateStr();

  if (!isAfterOpeningRange()) {
    console.log(`[ORB] ${getETTimeStr()} — waiting for 10:00 AM ET opening range to complete...`);
    return;
  }

  if (isPastNoon()) {
    console.log('[ORB] Past noon ET — bracket orders handle the rest. Exiting.');
    process.exit(0);
  }

  // Stop if daily exposure cap reached
  if (totalDeployedToday >= MAX_DAILY_EXPOSURE) {
    console.log(`[ORB] Daily cap reached ($${totalDeployedToday.toFixed(0)}) — done for today.`);
    process.exit(0);
  }

  // Sync existing positions to avoid re-buying
  try {
    const positions = await getPositions();
    const posMap = new Map(positions.map(p => [p.symbol.toUpperCase(), p]));
    for (const sym of WATCHLIST) {
      const pos = posMap.get(sym);
      if (pos) {
        const existing = orbMap.get(sym);
        if (existing && !existing.tradedToday) {
          existing.tradedToday = true;
          existing.entryPrice = parseFloat(pos.avg_entry_price);
          console.log(`[ORB] ${sym}: position already open @ $${pos.avg_entry_price} — marking as traded`);
        } else if (!existing) {
          orbMap.set(sym, { symbol: sym, orbHigh: 0, orbLow: 0, tradedToday: true, entryPrice: parseFloat(pos.avg_entry_price) });
        }
      }
    }
  } catch (err) {
    console.warn(`[ORB] Position sync warning: ${err}`);
  }

  // Fetch ORB range for symbols that don't have it yet
  const needsOrb = WATCHLIST.filter(s => !orbMap.has(s));
  if (needsOrb.length > 0) {
    try {
      const offset = getETOffset();
      const orbStart = `${today}T09:30:00${offset}`;
      const orbEnd   = `${today}T10:00:00${offset}`;
      const barsMap  = await getMultipleMinuteBars(needsOrb, orbStart, orbEnd);

      for (const sym of needsOrb) {
        const bars = barsMap.get(sym);
        if (!bars || bars.length === 0) {
          console.warn(`[ORB] ${sym}: no opening range bars`);
          continue;
        }
        const orbHigh = Math.max(...bars.map(b => b.h));
        const orbLow  = Math.min(...bars.map(b => b.l));
        orbMap.set(sym, { symbol: sym, orbHigh, orbLow, tradedToday: false });
        console.log(`[ORB] ${sym}: range $${orbLow.toFixed(2)}–$${orbHigh.toFixed(2)}`);
      }
    } catch (err) {
      console.error(`[ORB] Range fetch failed: ${err}`);
      return;
    }
  }

  // Check for breakouts on untraded symbols
  const watchable = WATCHLIST.filter(s => {
    const d = orbMap.get(s);
    return d && !d.tradedToday && d.orbHigh > 0;
  });

  if (watchable.length === 0) {
    const allTraded = WATCHLIST.every(s => orbMap.get(s)?.tradedToday);
    if (allTraded) {
      console.log('[ORB] All symbols traded. Exiting.');
      process.exit(0);
    }
    return;
  }

  let prices: Map<string, number>;
  try {
    prices = await getLatestTradePrices(watchable);
  } catch (err) {
    console.error(`[ORB] Price fetch failed: ${err}`);
    return;
  }

  for (const sym of watchable) {
    const orbData = orbMap.get(sym)!;
    const price   = prices.get(sym);
    if (price === undefined) continue;

    if (price <= orbData.orbHigh) continue;

    const qty = Math.floor(CAPITAL_PER_TRADE / price);
    if (qty < 1) {
      console.warn(`[ORB] ${sym}: price $${price.toFixed(2)} too high for capital $${CAPITAL_PER_TRADE}`);
      continue;
    }

    const orderCost = qty * price;
    if (totalDeployedToday + orderCost > MAX_DAILY_EXPOSURE) {
      console.log(`[ORB] ${sym}: would exceed daily cap — skipping`);
      continue;
    }

    console.log(`[ORB] BREAKOUT: ${sym} @ $${price.toFixed(2)} > ORB $${orbData.orbHigh.toFixed(2)} — buying ${qty} shares ($${orderCost.toFixed(0)})`);

    // Optimistic lock — prevent duplicate orders during async
    orbData.tradedToday = true;
    orbData.entryPrice  = price;

    try {
      const order = await createBracketOrder(sym, qty, price);
      totalDeployedToday += orderCost;
      console.log(`[ORB] Order placed: ${order.id} | TP: $${(price * 1.02).toFixed(2)} | SL: $${(price * 0.99).toFixed(2)} | Daily deployed: $${totalDeployedToday.toFixed(0)}`);
    } catch (err) {
      // Roll back so we retry next scan
      orbData.tradedToday = false;
      orbData.entryPrice  = undefined;
      console.error(`[ORB] Order failed for ${sym}: ${err}`);
    }
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Run once immediately, then on interval
  await runScan();
  const interval = setInterval(async () => {
    try {
      await runScan();
    } catch (err) {
      console.error(`[ORB] Unexpected error in scan: ${err}`);
    }
  }, SCAN_INTERVAL_MS);

  // Safety exit at noon ET regardless (GitHub Actions timeout guard)
  // The setInterval above exits via process.exit when done
  // This fallback ensures we never hang past noon
  const { h, m } = getETHourMinute();
  const minutesUntilNoon = Math.max(0, (12 * 60) - (h * 60 + m));
  setTimeout(() => {
    console.log('[ORB] Noon ET fallback timeout reached. Exiting.');
    clearInterval(interval);
    process.exit(0);
  }, minutesUntilNoon * 60_000 + 60_000); // +1 min buffer
}

main().catch(err => {
  console.error('[ORB] Fatal error:', err);
  process.exit(1);
});
