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
}

const PAPER_BASE_URL = 'https://paper-api.alpaca.markets/v2';
const LIVE_BASE_URL = 'https://api.alpaca.markets/v2';

const PAPER_STORAGE_KEY = 'alpaca_paper_config';
const LIVE_STORAGE_KEY = 'alpaca_live_config';

class AlpacaService {
  private paperCreds: AlpacaCredentials | null = null;
  private liveCreds: AlpacaCredentials | null = null;

  private baseUrl(isPaper: boolean): string {
    return isPaper ? PAPER_BASE_URL : LIVE_BASE_URL;
  }

  private headers(isPaper: boolean): Record<string, string> {
    const creds = isPaper ? this.paperCreds : this.liveCreds;
    if (!creds) throw new Error(`Alpaca ${isPaper ? 'paper' : 'live'} credentials not configured`);
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
    const body = {
      symbol: params.symbol,
      qty: params.qty.toString(),
      side: params.side,
      type: params.type,
      time_in_force: params.time_in_force ?? 'day',
      ...(params.limit_price !== undefined && { limit_price: params.limit_price.toString() }),
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
}

// Singleton — load any saved credentials immediately on import
export const alpaca = new AlpacaService();
alpaca.loadConfigs();
