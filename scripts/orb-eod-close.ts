// ============================================================================
// ORB EOD Position Closer — Standalone Node.js script
// ============================================================================
// Runs via GitHub Actions at ~3:55 PM ET on weekdays.
// Cancels all open orders and closes all positions to ensure flat overnight.
// Bracket orders should handle TP/SL intraday, but this is a safety net for
// any positions still open at end of day.
//
// Required env vars:
//   ALPACA_KEY_ID      — Alpaca API key ID
//   ALPACA_SECRET_KEY  — Alpaca API secret key
//   ALPACA_IS_PAPER    — "false" for live, anything else (or absent) = paper
// ============================================================================

const KEY_ID     = process.env.ALPACA_KEY_ID ?? '';
const SECRET_KEY = process.env.ALPACA_SECRET_KEY ?? '';
const IS_PAPER   = process.env.ALPACA_IS_PAPER !== 'false';

const PAPER_BASE = 'https://paper-api.alpaca.markets/v2';
const LIVE_BASE  = 'https://api.alpaca.markets/v2';

if (!KEY_ID || !SECRET_KEY) {
  console.error('[EOD] ALPACA_KEY_ID and ALPACA_SECRET_KEY must be set.');
  process.exit(1);
}

const BASE_URL = IS_PAPER ? PAPER_BASE : LIVE_BASE;
const MODE_TAG = IS_PAPER ? 'PAPER' : 'LIVE';

console.log(`[EOD] Running EOD close — mode: ${MODE_TAG}`);

async function closeAllPositions(): Promise<void> {
  const res = await fetch(`${BASE_URL}/positions?cancel_orders=true`, {
    method: 'DELETE',
    headers: {
      'APCA-API-KEY-ID': KEY_ID,
      'APCA-API-SECRET-KEY': SECRET_KEY,
      'Content-Type': 'application/json',
    },
  });

  // 207 = multi-status (partial success), 204 = no positions to close — both OK
  if (!res.ok && res.status !== 207 && res.status !== 204) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }

  if (res.status === 204) {
    console.log('[EOD] No open positions — nothing to close.');
    return;
  }

  // 200 or 207: response is an array of close attempt results
  const results = await res.json().catch(() => []);
  if (Array.isArray(results)) {
    for (const r of results) {
      const sym    = r.symbol ?? r.body?.symbol ?? '?';
      const status = r.status ?? (r.body?.status ?? '?');
      console.log(`[EOD] Closed: ${sym} → ${status}`);
    }
    console.log(`[EOD] Closed ${results.length} position(s). Flat for the night.`);
  } else {
    console.log('[EOD] Positions close request sent.');
  }
}

closeAllPositions()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[EOD] Failed to close positions:', err);
    process.exit(1);
  });
