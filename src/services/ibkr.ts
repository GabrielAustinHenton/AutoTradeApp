// ============================================================================
// Interactive Brokers Client Portal API Service
// ============================================================================
// Connects to IBKR via either:
//   - Local Vite proxy (development) → localhost:5000
//   - Remote CORS proxy (production/web) → your-server:5001
//
// In production, the web app connects to the IBKR CORS Proxy server
// (server/proxy.js) which runs alongside the IBKR Gateway and adds CORS
// headers + API key authentication.
// ============================================================================

import { IBKR_CONFIG } from '../config/ibkr';

export interface IBKRConfig {
  gatewayUrl: string;   // Proxy URL (e.g. https://your-server.com:5001)
  accountId: string;
  apiKey?: string;       // API key for the CORS proxy (production)
}

export interface IBKRAccount {
  id: string;
  accountId: string;
  accountVan: string;
  accountTitle: string;
  displayName: string;
  accountAlias: string;
  accountStatus: number;
  currency: string;
  type: string;
  tradingType: string;
  covestor: boolean;
  parent: { mmc: string[]; accountId: string; isMParent: boolean };
  desc: string;
}

export interface IBKRPosition {
  acctId: string;
  conid: number;
  contractDesc: string;
  position: number;
  mktPrice: number;
  mktValue: number;
  currency: string;
  avgCost: number;
  avgPrice: number;
  realizedPnl: number;
  unrealizedPnl: number;
  exchs: string;
  expiry: string;
  putOrCall: string;
  multiplier: number;
  strike: number;
  exerciseStyle: string;
  conExchMap: string[];
  assetClass: string;
  undConid: number;
  model: string;
  ticker: string;
  undComp: string;
  undSym: string;
  fullName: string;
  pageSize: number;
}

export interface IBKRAccountSummary {
  availableFunds: { amount: number; currency: string };
  buyingPower: { amount: number; currency: string };
  cushion: { amount: number };
  dayTradesRemaining: { amount: number };
  equityWithLoanValue: { amount: number; currency: string };
  excessLiquidity: { amount: number; currency: string };
  grossPositionValue: { amount: number; currency: string };
  initMarginReq: { amount: number; currency: string };
  maintMarginReq: { amount: number; currency: string };
  netLiquidation: { amount: number; currency: string };
  previousDayEquityWithLoanValue: { amount: number; currency: string };
  regTEquity: { amount: number; currency: string };
  regTMargin: { amount: number; currency: string };
  sma: { amount: number; currency: string };
  totalCashValue: { amount: number; currency: string };
}

export interface IBKROrder {
  acct: string;
  conid: number;
  conidex: string;
  secType: string;
  orderType: string;
  listingExchange: string;
  outsideRTH: boolean;
  price: number;
  side: string;
  ticker: string;
  tif: string;
  quantity: number;
  filledQuantity: number;
  status: string;
  orderId: number;
  parentId: number;
  orderRef: string;
  orderDesc: string;
  lastExecutionTime: string;
  lastExecutionTime_r: number;
  avgPrice: number;
}

export interface IBKRQuote {
  conid: number;
  minTick: number;
  lTradingTime: string;
  ask: number;
  askSize: number;
  bid: number;
  bidSize: number;
  lastPrice: number;
  lastSize: number;
  volume: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  close: number;
}

export interface CreateOrderParams {
  conid: number;
  orderType: 'MKT' | 'LMT' | 'STP' | 'STP_LIMIT';
  side: 'BUY' | 'SELL';
  quantity: number;
  price?: number; // Required for LMT orders
  tif?: 'DAY' | 'GTC' | 'IOC' | 'OPG';
}

class IBKRService {
  private config: IBKRConfig | null = null;

  /**
   * Get the base URL for API requests.
   * - In development: use Vite proxy (/api/ibkr → localhost:5000)
   * - In production: use the configured proxy URL directly
   */
  private get baseUrl(): string {
    if (!this.config) throw new Error('IBKR not configured');
    // In development, route through Vite proxy
    if (import.meta.env.DEV) {
      return '/api/ibkr';
    }
    // In production, connect to the CORS proxy server directly
    return this.config.gatewayUrl;
  }

  private get accountId(): string {
    if (!this.config) throw new Error('IBKR not configured');
    return this.config.accountId;
  }

  /**
   * Build request headers. In production, include the API key for the CORS proxy.
   */
  private getHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };

    // Add API key for production (CORS proxy authentication)
    if (!import.meta.env.DEV && this.config?.apiKey) {
      headers['X-API-Key'] = this.config.apiKey;
    }

    return headers;
  }

  /**
   * Make a fetch request with proper headers and error handling.
   * Handles both local (cookie-based) and remote (API key-based) auth.
   */
  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = this.getHeaders(options.headers as Record<string, string>);

    const fetchOptions: RequestInit = {
      ...options,
      headers,
    };

    // In development, use credentials for cookie-based auth with Vite proxy
    if (import.meta.env.DEV) {
      fetchOptions.credentials = 'include';
    }

    const response = await fetch(url, fetchOptions);
    return response;
  }

  configure(config: IBKRConfig): void {
    this.config = config;
    localStorage.setItem('ibkr_config', JSON.stringify(config));
  }

  loadConfig(): IBKRConfig | null {
    const stored = localStorage.getItem('ibkr_config');
    if (stored) {
      this.config = JSON.parse(stored);
      return this.config;
    }

    // Fall back to config file if localStorage is empty
    if (IBKR_CONFIG.accountId && IBKR_CONFIG.accountId !== 'DU123456') {
      this.config = {
        gatewayUrl: IBKR_CONFIG.baseUrl,
        accountId: IBKR_CONFIG.accountId,
      };
      // Save to localStorage for future loads
      localStorage.setItem('ibkr_config', JSON.stringify(this.config));
      return this.config;
    }

    return null;
  }

  clearConfig(): void {
    this.config = null;
    localStorage.removeItem('ibkr_config');
  }

  isConfigured(): boolean {
    return this.config !== null && this.config.accountId.length > 0;
  }

  // ========================================================================
  // API Methods
  // ========================================================================

  // Check proxy health (production only)
  async checkProxyHealth(): Promise<{ status: string; gateway: string; keepAlive: boolean; uptime: number }> {
    const response = await this.request('/health');
    if (!response.ok) throw new Error('Proxy health check failed');
    return response.json();
  }

  // Authentication status
  async getAuthStatus(): Promise<{ authenticated: boolean; competing: boolean; connected: boolean }> {
    const response = await this.request('/v1/api/iserver/auth/status', { method: 'POST' });
    if (!response.ok) throw new Error('Failed to get auth status');
    return response.json();
  }

  // Keep session alive
  async tickle(): Promise<void> {
    await this.request('/v1/api/tickle', { method: 'POST' });
  }

  // Get accounts
  async getAccounts(): Promise<IBKRAccount[]> {
    const response = await this.request('/v1/api/portfolio/accounts');
    if (!response.ok) throw new Error('Failed to get accounts');
    return response.json();
  }

  // Get account summary
  async getAccountSummary(): Promise<IBKRAccountSummary> {
    const response = await this.request(`/v1/api/portfolio/${this.accountId}/summary`);
    if (!response.ok) throw new Error('Failed to get account summary');
    return response.json();
  }

  // Get positions
  async getPositions(): Promise<IBKRPosition[]> {
    const response = await this.request(`/v1/api/portfolio/${this.accountId}/positions/0`);
    if (!response.ok) throw new Error('Failed to get positions');
    return response.json();
  }

  // Search for contract by symbol
  async searchContract(symbol: string): Promise<{ conid: number; name: string; ticker: string }[]> {
    const response = await this.request(
      `/v1/api/iserver/secdef/search?symbol=${encodeURIComponent(symbol)}`
    );
    if (!response.ok) throw new Error('Failed to search contract');
    return response.json();
  }

  // Get contract details by conid
  async getContractDetails(conid: number): Promise<{
    symbol: string;
    conid: number;
    exchange: string;
    instrument_type: string;
    company_name: string;
  }> {
    const response = await this.request(`/v1/api/iserver/contract/${conid}/info`);
    if (!response.ok) throw new Error('Failed to get contract details');
    return response.json();
  }

  // Get market data snapshot
  async getQuote(conids: number[]): Promise<IBKRQuote[]> {
    const fields = '31,84,85,86,87,88,7295,7296,7674,7675';
    const response = await this.request(
      `/v1/api/iserver/marketdata/snapshot?conids=${conids.join(',')}&fields=${fields}`
    );
    if (!response.ok) throw new Error('Failed to get quote');
    return response.json();
  }

  // Get orders
  async getOrders(): Promise<IBKROrder[]> {
    const response = await this.request('/v1/api/iserver/account/orders');
    if (!response.ok) throw new Error('Failed to get orders');
    const data = await response.json();
    return data.orders || [];
  }

  // Place order
  async placeOrder(params: CreateOrderParams): Promise<{ orderId: string; orderStatus: string }[]> {
    const orderPayload = {
      acctId: this.accountId,
      conid: params.conid,
      orderType: params.orderType,
      side: params.side,
      quantity: params.quantity,
      tif: params.tif || 'DAY',
      ...(params.orderType === 'LMT' && { price: params.price }),
    };

    const response = await this.request(
      `/v1/api/iserver/account/${this.accountId}/orders`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: [orderPayload] }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to place order: ${error}`);
    }

    return response.json();
  }

  // Confirm order
  async confirmOrder(replyId: string, confirmed: boolean): Promise<{ orderId: string; orderStatus: string }[]> {
    const response = await this.request(
      `/v1/api/iserver/reply/${replyId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed }),
      }
    );

    if (!response.ok) throw new Error('Failed to confirm order');
    return response.json();
  }

  // Cancel order
  async cancelOrder(orderId: string): Promise<void> {
    const response = await this.request(
      `/v1/api/iserver/account/${this.accountId}/order/${orderId}`,
      { method: 'DELETE' }
    );

    if (!response.ok) throw new Error('Failed to cancel order');
  }

  // Convenience methods
  async buyMarket(conid: number, quantity: number): Promise<{ orderId: string; orderStatus: string }[]> {
    return this.placeOrder({ conid, orderType: 'MKT', side: 'BUY', quantity });
  }

  async sellMarket(conid: number, quantity: number): Promise<{ orderId: string; orderStatus: string }[]> {
    return this.placeOrder({ conid, orderType: 'MKT', side: 'SELL', quantity });
  }

  async buyLimit(conid: number, quantity: number, price: number): Promise<{ orderId: string; orderStatus: string }[]> {
    return this.placeOrder({ conid, orderType: 'LMT', side: 'BUY', quantity, price });
  }

  async sellLimit(conid: number, quantity: number, price: number): Promise<{ orderId: string; orderStatus: string }[]> {
    return this.placeOrder({ conid, orderType: 'LMT', side: 'SELL', quantity, price });
  }

  // Get conid for a stock symbol (helper)
  async getConidForSymbol(symbol: string): Promise<number | null> {
    const results = await this.searchContract(symbol);
    const stock = results.find((r) => r.ticker === symbol.toUpperCase());
    return stock?.conid || results[0]?.conid || null;
  }
}

// Export singleton instance
export const ibkr = new IBKRService();
