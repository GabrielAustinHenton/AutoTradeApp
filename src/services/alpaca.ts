// ============================================================================
// Alpaca Markets API Service
// ============================================================================
// Paper and Live credentials are stored SEPARATELY.
// The trading mode (paper/live) in the app store determines which set of
// credentials — and which Alpaca endpoint — is used for every API call.
//
// Paper trading:  https://paper-api.alpaca.markets/v2  (paper keys)
// Live trading:   https://api.alpaca.markets/v2         (live keys)
//
// It is IMPOSSIBLE to use live money while in paper mode because:
//   - Paper mode always calls paper-api.alpaca.markets with paper keys
//   - Live mode always calls api.alpaca.markets with live keys
//   - The two sets of keys are stored under different localStorage keys
// ============================================================================

export interface AlpacaCredentials {
  keyId: string;
  secretKey: string;
}

export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  cash: string;
  buying_power: string;
  portfolio_value: string;
  equity: string;
  last_equity: string;
  long_market_value: string;
  short_market_value: string;
  daytrade_count: number;
  pattern_day_trader: boolean;
}

export interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: string;
  qty: string;
  qty_available: string;
  avg_entry_price: string;
  side: 'long' | 'short';
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  created_at: string;
  submitted_at: string;
  filled_at: string | null;
  canceled_at: string | null;
  failed_at: string | null;
  symbol: string;
  qty: string;
  filled_qty: string;
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  side: 'buy' | 'sell';
  time_in_force: string;
  limit_price: string | null;
  filled_avg_price: string | null;
  status: string;
}

export interface CreateOrderParams {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  time_in_force?: string;
  limit_price?: number;
  order_class?: 'bracket' | 'simple';
  take_profit?: { limit_price: number };
  stop_loss?: { stop_price: number };
}

const PAPER_BASE_URL = 'https://paper-api.alpaca.markets/v2';
const LIVE_BASE_URL = 'https://api.alpaca.markets/v2';

const PAPER_STORAGE_KEY = 'alpaca_paper_config';
const LIVE_STORAGE_KEY = 'alpaca_live_config';
const SWING_TRADER_STORAGE_KEY = 'alpaca_swing_trader_config';

class AlpacaService {
  private paperCreds: AlpacaCredentials | null = null;
  private liveCreds: AlpacaCredentials | null = null;
  private swingTraderCreds: AlpacaCredentials | null = null;

  private baseUrl(isPaper: boolean): string {
    return isPaper ? PAPER_BASE_URL : LIVE_BASE_URL;
  }

  private headers(isPaper: boolean): Record<string, string> {
    const creds = isPaper ? this.paperCreds : this.liveCreds;
    if (!creds || !creds.keyId || !creds.secretKey) {
      throw new Error(`Alpaca ${isPaper ? 'paper' : 'live'} credentials not configured`);
    }
    return {
      'APCA-API-KEY-ID': creds.keyId,
      'APCA-API-SECRET-KEY': creds.secretKey,
      'Content-Type': 'application/json',
    };
  }

  private async request(isPaper: boolean, path: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl(isPaper)}${path}`;
    return fetch(url, {
      ...options,
      headers: {
        ...this.headers(isPaper),
        ...(options.headers as Record<string, string> | undefined),
      },
    });
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  configurePaper(keyId: string, secretKey: string): void {
    this.paperCreds = { keyId, secretKey };
    localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify({ keyId, secretKey }));
  }

  configureLive(keyId: string, secretKey: string): void {
    this.liveCreds = { keyId, secretKey };
    localStorage.setItem(LIVE_STORAGE_KEY, JSON.stringify({ keyId, secretKey }));
  }

  loadConfigs(): void {
    try {
      const paper = localStorage.getItem(PAPER_STORAGE_KEY);
      if (paper) this.paperCreds = JSON.parse(paper);
    } catch { /* ignore */ }
    try {
      const live = localStorage.getItem(LIVE_STORAGE_KEY);
      if (live) this.liveCreds = JSON.parse(live);
    } catch { /* ignore */ }
    try {
      const swing = localStorage.getItem(SWING_TRADER_STORAGE_KEY);
      if (swing) this.swingTraderCreds = JSON.parse(swing);
    } catch { /* ignore */ }
  }

  clearPaper(): void {
    this.paperCreds = null;
    localStorage.removeItem(PAPER_STORAGE_KEY);
  }

  clearLive(): void {
    this.liveCreds = null;
    localStorage.removeItem(LIVE_STORAGE_KEY);
  }

  isPaperConfigured(): boolean {
    return this.paperCreds !== null && this.paperCreds.keyId.length > 0;
  }

  isLiveConfigured(): boolean {
    return this.liveCreds !== null && this.liveCreds.keyId.length > 0;
  }

  getPaperKeyId(): string {
    return this.paperCreds?.keyId ?? '';
  }

  getLiveKeyId(): string {
    return this.liveCreds?.keyId ?? '';
  }

  configureSwingTrader(keyId: string, secretKey: string): void {
    this.swingTraderCreds = { keyId, secretKey };
    localStorage.setItem(SWING_TRADER_STORAGE_KEY, JSON.stringify({ keyId, secretKey }));
  }

  clearSwingTrader(): void {
    this.swingTraderCreds = null;
    localStorage.removeItem(SWING_TRADER_STORAGE_KEY);
  }

  isSwingTraderConfigured(): boolean {
    return this.swingTraderCreds !== null && this.swingTraderCreds.keyId.length > 0;
  }

  getSwingTraderKeyId(): string {
    return this.swingTraderCreds?.keyId ?? '';
  }

  // ── Private swing trader request helper ──────────────────────────────────────

  private swingRequest(path: string, options: RequestInit = {}): Promise<Response> {
    if (!this.swingTraderCreds?.keyId || !this.swingTraderCreds.secretKey) {
      throw new Error('Alpaca swing trader credentials not configured');
    }
    const url = `${LIVE_BASE_URL}${path}`;
    return fetch(url, {
      ...options,
      headers: {
        'APCA-API-KEY-ID': this.swingTraderCreds.keyId,
        'APCA-API-SECRET-KEY': this.swingTraderCreds.secretKey,
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> | undefined),
      },
    });
  }

  // ── API Methods (all require isPaper to pick correct endpoint + credentials) ─

  async getAccount(isPaper: boolean): Promise<AlpacaAccount> {
    const res = await this.request(isPaper, '/account');
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${text}`);
    }
    return res.json();
  }

  async getPositions(isPaper: boolean): Promise<AlpacaPosition[]> {
    const res = await this.request(isPaper, '/positions');
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${text}`);
    }
    return res.json();
  }

  async createOrder(isPaper: boolean, params: CreateOrderParams): Promise<AlpacaOrder> {
    const body: Record<string, unknown> = {
      symbol: params.symbol,
      qty: params.qty.toString(),
      side: params.side,
      type: params.type,
      time_in_force: params.time_in_force ?? 'day',
      ...(params.limit_price !== undefined && { limit_price: params.limit_price.toString() }),
      ...(params.order_class && { order_class: params.order_class }),
      ...(params.take_profit && { take_profit: { limit_price: params.take_profit.limit_price.toFixed(2) } }),
      ...(params.stop_loss && { stop_loss: { stop_price: params.stop_loss.stop_price.toFixed(2) } }),
    };
    const res = await this.request(isPaper, '/orders', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${text}`);
    }
    return res.json();
  }

  // Close ALL open positions and cancel all open orders in one call.
  // Use at end of day to ensure flat (cash-only) overnight.
  async closeAllPositions(isPaper: boolean): Promise<void> {
    const res = await this.request(isPaper, '/positions?cancel_orders=true', { method: 'DELETE' });
    // 207 = multi-status (partial success is still success), 204 = no positions to close
    if (!res.ok && res.status !== 207 && res.status !== 204) {
      const text = await res.text();
      throw new Error(`${res.status} ${text}`);
    }
  }

  // Close a single position by symbol (market sell).
  async closePosition(isPaper: boolean, symbol: string): Promise<void> {
    const res = await this.request(isPaper, `/positions/${encodeURIComponent(symbol.toUpperCase())}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) {
      const text = await res.text();
      throw new Error(`${res.status} ${text}`);
    }
  }

  async getOrders(isPaper: boolean, status = 'open'): Promise<AlpacaOrder[]> {
    const res = await this.request(isPaper, `/orders?status=${status}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${text}`);
    }
    return res.json();
  }

  async cancelOrder(isPaper: boolean, orderId: string): Promise<void> {
    const res = await this.request(isPaper, `/orders/${orderId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      const text = await res.text();
      throw new Error(`${res.status} ${text}`);
    }
  }

  // Convenience helpers — caller passes isPaper explicitly so there's no ambiguity
  async buyMarket(isPaper: boolean, symbol: string, qty: number): Promise<AlpacaOrder> {
    return this.createOrder(isPaper, { symbol, qty, side: 'buy', type: 'market' });
  }

  async sellMarket(isPaper: boolean, symbol: string, qty: number): Promise<AlpacaOrder> {
    return this.createOrder(isPaper, { symbol, qty, side: 'sell', type: 'market' });
  }

  async buyLimit(isPaper: boolean, symbol: string, qty: number, limitPrice: number): Promise<AlpacaOrder> {
    return this.createOrder(isPaper, { symbol, qty, side: 'buy', type: 'limit', limit_price: limitPrice, time_in_force: 'gtc' });
  }

  async sellLimit(isPaper: boolean, symbol: string, qty: number, limitPrice: number): Promise<AlpacaOrder> {
    return this.createOrder(isPaper, { symbol, qty, side: 'sell', type: 'limit', limit_price: limitPrice, time_in_force: 'gtc' });
  }

  // ── Multi-symbol Minute Bars (for ORB calculation) ──────────────────────────

  async getMultipleMinuteBars(
    isPaper: boolean,
    symbols: string[],
    start: string,  // ISO 8601 e.g. "2026-02-18T14:30:00Z"
    end: string,    // ISO 8601 e.g. "2026-02-18T15:00:00Z"
  ): Promise<Map<string, { t: string; o: number; h: number; l: number; c: number }[]>> {
    const creds = isPaper ? this.paperCreds : this.liveCreds;
    if (!creds || !creds.keyId || !creds.secretKey) {
      throw new Error(`Alpaca ${isPaper ? 'paper' : 'live'} credentials not configured`);
    }

    const params = new URLSearchParams({
      symbols: symbols.join(','),
      timeframe: '1Min',
      start,
      end,
      limit: '1000',
      feed: 'iex',
    });

    const url = `https://data.alpaca.markets/v2/stocks/bars?${params}`;
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': creds.keyId,
        'APCA-API-SECRET-KEY': creds.secretKey,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Alpaca multi-bars: ${res.status} ${text}`);
    }

    const data = await res.json();
    const result = new Map<string, { t: string; o: number; h: number; l: number; c: number }[]>();
    const barsObj: Record<string, any[]> = data.bars ?? {};
    for (const [sym, bars] of Object.entries(barsObj)) {
      result.set(sym, (bars as any[]).map(b => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c })));
    }
    return result;
  }

  // ── Latest Trade Prices (for breakout detection) ─────────────────────────────

  async getLatestTradePrices(
    isPaper: boolean,
    symbols: string[],
  ): Promise<Map<string, number>> {
    const creds = isPaper ? this.paperCreds : this.liveCreds;
    if (!creds || !creds.keyId || !creds.secretKey) {
      throw new Error(`Alpaca ${isPaper ? 'paper' : 'live'} credentials not configured`);
    }

    const params = new URLSearchParams({
      symbols: symbols.join(','),
      feed: 'iex',
    });

    const url = `https://data.alpaca.markets/v2/stocks/trades/latest?${params}`;
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': creds.keyId,
        'APCA-API-SECRET-KEY': creds.secretKey,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Alpaca latest trades: ${res.status} ${text}`);
    }

    const data = await res.json();
    const result = new Map<string, number>();
    const trades: Record<string, any> = data.trades ?? {};
    for (const [sym, trade] of Object.entries(trades)) {
      result.set(sym, (trade as any).p);
    }
    return result;
  }

  // ── Swing Trader Account Methods (separate $5k account credentials) ──────────

  async getSwingAccount(): Promise<AlpacaAccount> {
    const res = await this.swingRequest('/account');
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${text}`);
    }
    return res.json();
  }

  async getSwingPositions(): Promise<AlpacaPosition[]> {
    const res = await this.swingRequest('/positions');
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${text}`);
    }
    return res.json();
  }

  async createSwingOrder(params: CreateOrderParams): Promise<AlpacaOrder> {
    const body: Record<string, unknown> = {
      symbol: params.symbol,
      qty: params.qty.toString(),
      side: params.side,
      type: params.type,
      time_in_force: params.time_in_force ?? 'gtc',  // GTC for multi-day swing holds
      ...(params.limit_price !== undefined && { limit_price: params.limit_price.toString() }),
      ...(params.order_class && { order_class: params.order_class }),
      ...(params.take_profit && { take_profit: { limit_price: params.take_profit.limit_price.toFixed(2) } }),
      ...(params.stop_loss && { stop_loss: { stop_price: params.stop_loss.stop_price.toFixed(2) } }),
    };
    const res = await this.swingRequest('/orders', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${text}`);
    }
    return res.json();
  }

  // Historical daily bars using swing trader credentials (data API)
  async getSwingHistoricalBars(
    symbol: string,
    start: string,  // YYYY-MM-DD
    end: string,    // YYYY-MM-DD
  ): Promise<{ timestamp: string; open: number; high: number; low: number; close: number; volume: number }[]> {
    if (!this.swingTraderCreds?.keyId || !this.swingTraderCreds.secretKey) {
      throw new Error('Alpaca swing trader credentials not configured');
    }
    const params = new URLSearchParams({
      timeframe: '1Day',
      start,
      end,
      limit: '10000',
      feed: 'iex',
    });
    const url = `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol.toUpperCase())}/bars?${params}`;
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': this.swingTraderCreds.keyId,
        'APCA-API-SECRET-KEY': this.swingTraderCreds.secretKey,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Alpaca swing bars ${symbol}: ${res.status} ${text}`);
    }
    const data = await res.json();
    return (data.bars || [])
      .map((bar: any) => ({
        timestamp: bar.t.split('T')[0],
        open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v,
      }))
      .sort((a: any, b: any) => a.timestamp.localeCompare(b.timestamp));
  }

  // Latest trade prices using swing trader credentials
  async getSwingLatestPrices(symbols: string[]): Promise<Map<string, number>> {
    if (!this.swingTraderCreds?.keyId || !this.swingTraderCreds.secretKey) {
      throw new Error('Alpaca swing trader credentials not configured');
    }
    const params = new URLSearchParams({ symbols: symbols.join(','), feed: 'iex' });
    const url = `https://data.alpaca.markets/v2/stocks/trades/latest?${params}`;
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': this.swingTraderCreds.keyId,
        'APCA-API-SECRET-KEY': this.swingTraderCreds.secretKey,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Alpaca swing latest prices: ${res.status} ${text}`);
    }
    const data = await res.json();
    const result = new Map<string, number>();
    const trades: Record<string, any> = data.trades ?? {};
    for (const [sym, trade] of Object.entries(trades)) {
      result.set(sym, (trade as any).p);
    }
    return result;
  }

  // ── Asset Info (company name lookup) ─────────────────────────────────────────

  async getAssetName(isPaper: boolean, symbol: string): Promise<string> {
    try {
      const res = await this.request(isPaper, `/assets/${symbol.toUpperCase()}`);
      if (!res.ok) return symbol;
      const data = await res.json();
      return data.name || symbol;
    } catch {
      return symbol;
    }
  }

  // ── Intraday Bars (15-minute candles for a single trading day) ───────────────

  async getIntradayBars(
    isPaper: boolean,
    symbol: string,
    date: string,   // YYYY-MM-DD
  ): Promise<{ timestamp: string; open: number; high: number; low: number; close: number; volume: number }[]> {
    const creds = isPaper ? this.paperCreds : this.liveCreds;
    if (!creds || !creds.keyId || !creds.secretKey) {
      throw new Error(`Alpaca ${isPaper ? 'paper' : 'live'} credentials not configured`);
    }

    // Use UTC times that cover 9:30–16:00 ET regardless of DST
    const params = new URLSearchParams({
      timeframe: '15Min',
      start: `${date}T13:00:00Z`,  // 9:00 AM ET in UTC (catches both EST/EDT opens)
      end:   `${date}T21:30:00Z`,  // 5:30 PM ET in UTC (catches both EST/EDT closes)
      limit: '400',
      feed:  'iex',
    });

    const url = `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol.toUpperCase())}/bars?${params}`;
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': creds.keyId,
        'APCA-API-SECRET-KEY': creds.secretKey,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Alpaca intraday bars ${symbol}: ${res.status} ${text}`);
    }

    const data = await res.json();
    return (data.bars || []).map((bar: any) => ({
      timestamp: bar.t.substring(11, 16),  // "HH:MM" from ISO string
      open:  bar.o,
      high:  bar.h,
      low:   bar.l,
      close: bar.c,
      volume: bar.v,
    }));
  }

  // ── Historical Market Data (Alpaca Data API — CORS-friendly, works in browser) ─

  async getHistoricalBars(
    isPaper: boolean,
    symbol: string,
    start: string,  // YYYY-MM-DD
    end: string,    // YYYY-MM-DD
  ): Promise<{ timestamp: string; open: number; high: number; low: number; close: number; volume: number }[]> {
    const creds = isPaper ? this.paperCreds : this.liveCreds;
    if (!creds || !creds.keyId || !creds.secretKey) {
      throw new Error(`Alpaca ${isPaper ? 'paper' : 'live'} credentials not configured`);
    }

    const params = new URLSearchParams({
      timeframe: '1Day',
      start,
      end,
      limit: '10000',
      feed: 'iex',  // IEX feed works on free Alpaca accounts; SIP requires paid tier
    });

    const url = `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol.toUpperCase())}/bars?${params}`;
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': creds.keyId,
        'APCA-API-SECRET-KEY': creds.secretKey,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Alpaca bars ${symbol}: ${res.status} ${text}`);
    }

    const data = await res.json();
    const bars = data.bars || [];
    if (bars.length === 0) {
      console.warn(`[Alpaca] ${symbol}: 0 bars returned for ${start}→${end}. Full response:`, JSON.stringify(data).substring(0, 400));
    }
    return bars
      .map((bar: any) => ({
        timestamp: bar.t.split('T')[0],
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
      }))
      .sort((a: any, b: any) => a.timestamp.localeCompare(b.timestamp));
  }

}

// Singleton — load any saved credentials immediately on import
export const alpaca = new AlpacaService();
alpaca.loadConfigs();
