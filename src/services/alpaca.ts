// ============================================================================
// Alpaca Markets API Service
// ============================================================================
// Stateless REST API — API key + secret, no session, no gateway, no re-auth.
// Paper trading:  https://paper-api.alpaca.markets/v2
// Live trading:   https://api.alpaca.markets/v2
// Alpaca supports CORS natively — no proxy needed.
// ============================================================================

export interface AlpacaConfig {
  keyId: string;
  secretKey: string;
  isPaper: boolean;
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
  initial_margin: string;
  maintenance_margin: string;
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
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
  expired_at: string | null;
  canceled_at: string | null;
  failed_at: string | null;
  asset_id: string;
  symbol: string;
  asset_class: string;
  qty: string;
  filled_qty: string;
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  side: 'buy' | 'sell';
  time_in_force: 'day' | 'gtc' | 'opg' | 'cls' | 'ioc' | 'fok';
  limit_price: string | null;
  stop_price: string | null;
  filled_avg_price: string | null;
  status: string;
}

export interface CreateOrderParams {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  time_in_force?: 'day' | 'gtc' | 'opg' | 'cls' | 'ioc' | 'fok';
  limit_price?: number;
  stop_price?: number;
}

const PAPER_BASE_URL = 'https://paper-api.alpaca.markets/v2';
const LIVE_BASE_URL = 'https://api.alpaca.markets/v2';

const STORAGE_KEY = 'alpaca_config';

class AlpacaService {
  private config: AlpacaConfig | null = null;

  private get baseUrl(): string {
    if (!this.config) throw new Error('Alpaca not configured');
    return this.config.isPaper ? PAPER_BASE_URL : LIVE_BASE_URL;
  }

  private getHeaders(): Record<string, string> {
    if (!this.config) throw new Error('Alpaca not configured');
    return {
      'APCA-API-KEY-ID': this.config.keyId,
      'APCA-API-SECRET-KEY': this.config.secretKey,
      'Content-Type': 'application/json',
    };
  }

  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...(options.headers as Record<string, string> | undefined),
      },
    });
    return response;
  }

  configure(config: AlpacaConfig): void {
    this.config = config;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  loadConfig(): AlpacaConfig | null {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        this.config = JSON.parse(stored);
        return this.config;
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    return null;
  }

  clearConfig(): void {
    this.config = null;
    localStorage.removeItem(STORAGE_KEY);
  }

  isConfigured(): boolean {
    return this.config !== null && this.config.keyId.length > 0 && this.config.secretKey.length > 0;
  }

  isPaper(): boolean {
    return this.config?.isPaper ?? true;
  }

  // ========================================================================
  // API Methods
  // ========================================================================

  async getAccount(): Promise<AlpacaAccount> {
    const response = await this.request('/account');
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get account: ${response.status} ${text}`);
    }
    return response.json();
  }

  async getPositions(): Promise<AlpacaPosition[]> {
    const response = await this.request('/positions');
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get positions: ${response.status} ${text}`);
    }
    return response.json();
  }

  async getPosition(symbol: string): Promise<AlpacaPosition> {
    const response = await this.request(`/positions/${symbol}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get position for ${symbol}: ${response.status} ${text}`);
    }
    return response.json();
  }

  async createOrder(params: CreateOrderParams): Promise<AlpacaOrder> {
    const body = {
      symbol: params.symbol,
      qty: params.qty.toString(),
      side: params.side,
      type: params.type,
      time_in_force: params.time_in_force || 'day',
      ...(params.limit_price !== undefined && { limit_price: params.limit_price.toString() }),
      ...(params.stop_price !== undefined && { stop_price: params.stop_price.toString() }),
    };

    const response = await this.request('/orders', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to place order: ${response.status} ${text}`);
    }

    return response.json();
  }

  async getOrders(status = 'open'): Promise<AlpacaOrder[]> {
    const response = await this.request(`/orders?status=${status}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get orders: ${response.status} ${text}`);
    }
    return response.json();
  }

  async cancelOrder(orderId: string): Promise<void> {
    const response = await this.request(`/orders/${orderId}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) {
      const text = await response.text();
      throw new Error(`Failed to cancel order: ${response.status} ${text}`);
    }
  }

  // Convenience helpers
  async buyMarket(symbol: string, qty: number): Promise<AlpacaOrder> {
    return this.createOrder({ symbol, qty, side: 'buy', type: 'market' });
  }

  async sellMarket(symbol: string, qty: number): Promise<AlpacaOrder> {
    return this.createOrder({ symbol, qty, side: 'sell', type: 'market' });
  }

  async buyLimit(symbol: string, qty: number, limitPrice: number): Promise<AlpacaOrder> {
    return this.createOrder({ symbol, qty, side: 'buy', type: 'limit', limit_price: limitPrice, time_in_force: 'gtc' });
  }

  async sellLimit(symbol: string, qty: number, limitPrice: number): Promise<AlpacaOrder> {
    return this.createOrder({ symbol, qty, side: 'sell', type: 'limit', limit_price: limitPrice, time_in_force: 'gtc' });
  }
}

// Export singleton instance
export const alpaca = new AlpacaService();
