// ============================================================================
// ORB (Opening Range Breakout) Scanner
// ============================================================================
// Strategy:
//   - Opening Range = 9:30–10:00 AM ET high/low for each symbol
//   - After 10:00 AM ET: poll every 60s for price > ORB high (breakout)
//   - On breakout: place bracket order (2% TP, 1% SL) via Alpaca
//   - One trade per symbol per day; stop scanning at 3:30 PM ET
// ============================================================================

import { alpaca } from './alpaca';

export interface OrbData {
  symbol: string;
  orbHigh: number;
  orbLow: number;
  date: string;         // YYYY-MM-DD ET
  tradedToday: boolean;
  entryPrice?: number;
  tradedAt?: string;    // HH:MM AM/PM ET — when the order was placed
}

// ── ET timezone helpers ──────────────────────────────────────────────────────

function getETOffset(): string {
  // Returns "-05:00" (EST) or "-04:00" (EDT)
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      timeZoneName: 'shortOffset',
    });
    const parts = fmt.formatToParts(new Date());
    const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT-5';
    // "GMT-5" → "-05:00", "GMT-4" → "-04:00"
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
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()).replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$1-$2');
}

function getETHourMinute(): { h: number; m: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  return { h, m };
}

function getETTimeStr(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date());
}

function isMarketWeekday(): boolean {
  const dayStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  }).format(new Date());
  return !['Sat', 'Sun'].includes(dayStr);
}

function isAfterOpeningRange(): boolean {
  const { h, m } = getETHourMinute();
  return h * 60 + m >= 600; // 10:00 AM
}

function isBeforeNewTradesCutoff(): boolean {
  const { h, m } = getETHourMinute();
  return h * 60 + m < 930; // no new entries after 3:30 PM
}

function isEODCloseWindow(): boolean {
  const { h, m } = getETHourMinute();
  const t = h * 60 + m;
  return t >= 955 && t < 960; // 3:55–4:00 PM — force-close window
}

function isPastMarketHours(): boolean {
  const { h, m } = getETHourMinute();
  return h * 60 + m >= 960; // 4:00 PM — scanner fully shuts down
}

// ── State ────────────────────────────────────────────────────────────────────

const orbMap = new Map<string, OrbData>();
let scanInterval: ReturnType<typeof setInterval> | null = null;
export let scannerRunning = false;

// Daily exposure tracking
let totalDeployedToday = 0;
let deployedDate = '';        // YYYY-MM-DD ET — reset when date changes
let dailyExposureCap = 0;     // set by startOrbScanner
let eodCloseDate = '';        // YYYY-MM-DD ET — prevents duplicate EOD close calls

export function getTotalDeployedToday(): number { return totalDeployedToday; }
export function getDailyExposureCap(): number { return dailyExposureCap; }

// ── Core scan logic ──────────────────────────────────────────────────────────

async function runOrbScan(
  symbols: string[],
  isPaper: boolean,
  capitalPerTrade: number,
  onTrade: (symbol: string, qty: number, price: number, orderId: string) => void,
  onError: (err: string) => void,
): Promise<void> {
  if (!isMarketWeekday()) return;

  // Past 3:58 PM — full shutdown
  if (isPastMarketHours()) {
    console.log('[ORB] Market closed — stopping scanner.');
    stopOrbScanner();
    return;
  }

  // 3:45–3:58 PM — EOD forced close (once per day)
  if (isEODCloseWindow()) {
    const today = getETDateStr();
    if (eodCloseDate !== today) {
      eodCloseDate = today; // guard immediately to prevent re-entry next tick
      console.log('[ORB] EOD close window — closing all positions and cancelling orders...');
      try {
        await alpaca.closeAllPositions(isPaper);
        console.log('[ORB] EOD close complete. Flat for the night.');
        onTrade('EOD_CLOSE', 0, 0, 'eod-close'); // triggers syncFromAlpaca in hook
      } catch (err) {
        eodCloseDate = ''; // reset so we retry next minute
        onError(`EOD close failed: ${err}`);
      }
    }
    return;
  }

  if (!isAfterOpeningRange()) {
    console.log('[ORB] Waiting for 10:00 AM ET opening range to complete...');
    return;
  }

  // After 3:30 PM cutoff — no new trades, but keep scanner alive for EOD close window
  if (!isBeforeNewTradesCutoff()) {
    console.log('[ORB] Past 3:30 PM ET — no new entries. Waiting for 3:45 PM EOD close...');
    return;
  }

  const today = getETDateStr();

  // Reset daily exposure counter on a new trading day
  if (deployedDate !== today) {
    totalDeployedToday = 0;
    deployedDate = today;
    console.log(`[ORB] New day ${today} — daily exposure reset. Cap: $${dailyExposureCap.toFixed(0)}`);
  }

  // Stop trading if daily exposure cap is reached
  if (dailyExposureCap > 0 && totalDeployedToday >= dailyExposureCap) {
    console.log(`[ORB] Daily exposure cap reached ($${totalDeployedToday.toFixed(0)} / $${dailyExposureCap.toFixed(0)}) — no new trades today.`);
    return;
  }

  // Reset stale entries from a previous day
  for (const [sym, data] of orbMap.entries()) {
    if (data.date !== today) orbMap.delete(sym);
  }

  // Sync tradedToday with live Alpaca positions so page reloads don't re-buy
  try {
    const openPositions = await alpaca.getPositions(isPaper);
    const positionMap = new Map(openPositions.map(p => [p.symbol.toUpperCase(), p]));
    for (const sym of symbols) {
      const position = positionMap.get(sym.toUpperCase());
      if (position) {
        const entryPrice = parseFloat(position.avg_entry_price);
        const existing = orbMap.get(sym);
        if (existing && !existing.tradedToday) {
          existing.tradedToday = true;
          existing.entryPrice = entryPrice;
          existing.tradedAt = existing.tradedAt ?? getETTimeStr();
          console.log(`[ORB] ${sym}: already have a position @ $${entryPrice.toFixed(2)} — marking as traded`);
        } else if (!existing) {
          // Position exists but no ORB data yet — pre-mark so we don't buy on top of it
          orbMap.set(sym, { symbol: sym, orbHigh: 0, orbLow: 0, date: today, tradedToday: true, entryPrice, tradedAt: getETTimeStr() });
        }
      }
    }
  } catch {
    // Non-fatal — if we can't check positions, continue with existing state
  }

  // Determine which symbols still need their ORB calculated
  const needsOrb = symbols.filter(s => !orbMap.has(s));

  if (needsOrb.length > 0) {
    try {
      const offset = getETOffset();
      const orbStart = `${today}T09:30:00${offset}`;
      const orbEnd   = `${today}T10:00:00${offset}`;
      const barsMap  = await alpaca.getMultipleMinuteBars(isPaper, needsOrb, orbStart, orbEnd);

      for (const sym of needsOrb) {
        const bars = barsMap.get(sym);
        if (!bars || bars.length === 0) {
          console.warn(`[ORB] ${sym}: no opening range bars (market closed or no data)`);
          continue;
        }
        const orbHigh = Math.max(...bars.map(b => b.h));
        const orbLow  = Math.min(...bars.map(b => b.l));
        orbMap.set(sym, { symbol: sym, orbHigh, orbLow, date: today, tradedToday: false });
        console.log(`[ORB] ${sym}: range $${orbLow.toFixed(2)}–$${orbHigh.toFixed(2)}`);
      }
    } catch (err) {
      onError(`ORB range fetch failed: ${err}`);
      return;
    }
  }

  // Check for breakouts on symbols that have ORB but haven't traded today
  const watchable = symbols.filter(s => {
    const d = orbMap.get(s);
    return d && !d.tradedToday;
  });

  if (watchable.length === 0) return;

  let prices: Map<string, number>;
  try {
    prices = await alpaca.getLatestTradePrices(isPaper, watchable);
  } catch (err) {
    onError(`ORB price fetch failed: ${err}`);
    return;
  }

  for (const sym of watchable) {
    const orbData = orbMap.get(sym);
    if (!orbData) continue;

    const price = prices.get(sym);
    if (price === undefined) continue;

    if (price > orbData.orbHigh) {
      const qty = Math.floor(capitalPerTrade / price);
      if (qty < 1) {
        console.warn(`[ORB] ${sym}: capital per trade ($${capitalPerTrade}) too small for price $${price.toFixed(2)}`);
        continue;
      }

      const orderCost = qty * price;

      // Check daily exposure cap before placing
      if (dailyExposureCap > 0 && totalDeployedToday + orderCost > dailyExposureCap) {
        console.log(`[ORB] ${sym}: skipping — would exceed daily cap ($${(totalDeployedToday + orderCost).toFixed(0)} > $${dailyExposureCap.toFixed(0)})`);
        continue;
      }

      console.log(`[ORB] BREAKOUT: ${sym} @ $${price.toFixed(2)} > ORB high $${orbData.orbHigh.toFixed(2)} — buying ${qty} shares ($${orderCost.toFixed(0)})`);

      // Mark as traded immediately to prevent duplicate orders during async call
      orbData.tradedToday = true;
      orbData.entryPrice = price;
      orbData.tradedAt = getETTimeStr();

      try {
        const order = await alpaca.createOrder(isPaper, {
          symbol: sym,
          qty,
          side: 'buy',
          type: 'market',
          time_in_force: 'day',
          order_class: 'bracket',
          take_profit: { limit_price: parseFloat((price * 1.02).toFixed(2)) },
          stop_loss:   { stop_price: parseFloat((price * 0.99).toFixed(2)) },
        });
        totalDeployedToday += orderCost;
        console.log(`[ORB] Order placed: ${order.id} | Daily deployed: $${totalDeployedToday.toFixed(0)} / $${dailyExposureCap.toFixed(0)}`);
        onTrade(sym, qty, price, order.id);
      } catch (err) {
        // Undo tradedToday so we can retry next scan
        orbData.tradedToday = false;
        orbData.entryPrice = undefined;
        onError(`ORB order failed for ${sym}: ${err}`);
      }
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function startOrbScanner(
  symbols: string[],
  isPaper: boolean,
  capitalPerTrade: number,
  maxDailyExposure: number,
  onTrade: (symbol: string, qty: number, price: number, orderId: string) => void,
  onError: (err: string) => void,
): void {
  if (scanInterval !== null) return; // already running

  dailyExposureCap = maxDailyExposure;
  // Reset deployed counter if starting fresh on a new day
  const today = getETDateStr();
  if (deployedDate !== today) {
    totalDeployedToday = 0;
    deployedDate = today;
  }

  scannerRunning = true;
  console.log(`[ORB] Scanner started — watching ${symbols.join(', ')} | Cap: $${maxDailyExposure.toFixed(0)}`);

  // Run immediately, then every 60s
  runOrbScan(symbols, isPaper, capitalPerTrade, onTrade, onError);
  scanInterval = setInterval(() => {
    runOrbScan(symbols, isPaper, capitalPerTrade, onTrade, onError);
  }, 60_000);
}

export function stopOrbScanner(): void {
  if (scanInterval !== null) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  scannerRunning = false;
  console.log('[ORB] Scanner stopped.');
}

export function resetOrbScanner(): void {
  stopOrbScanner();
  orbMap.clear();
  totalDeployedToday = 0;
  deployedDate = '';
  dailyExposureCap = 0;
  eodCloseDate = '';
  console.log('[ORB] Scanner state reset.');
}

export function getOrbStates(): OrbData[] {
  return Array.from(orbMap.values());
}
