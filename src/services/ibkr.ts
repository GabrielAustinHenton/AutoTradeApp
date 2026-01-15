// Interactive Brokers Client Portal API Service
// Requires IB Gateway running locally on port 5000

export interface IBKRConfig {
  gatewayUrl: string; // Usually https://localhost:5000
  accountId: string;
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

  // Use Vite proxy in development to avoid CORS/SSL issues
  private get baseUrl(): string {
    if (!this.config) throw new Error('IBKR not configured');
    // In development, route through Vite proxy
    if (import.meta.env.DEV) {
      return '/api/ibkr';
    }
    return this.config.gatewayUrl;
  }

  private get accountId(): string {
    if (!this.config) throw new Error('IBKR not configured');
    return this.config.accountId;
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
    return null;
  }

  clearConfig(): void {
    this.config = null;
    localStorage.removeItem('ibkr_config');
  }

  isConfigured(): boolean {
    return this.config !== null && this.config.accountId.length > 0;
  }

  // Authentication status
  async getAuthStatus(): Promise<{ authenticated: boolean; competing: boolean; connected: boolean }> {
    const response = await fetch(`${this.baseUrl}/v1/api/iserver/auth/status`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error('Failed to get auth status');
    }
    return response.json();
  }

  // Keep session alive (call every few minutes)
  async tickle(): Promise<void> {
    await fetch(`${this.baseUrl}/v1/api/tickle`, {
      method: 'POST',
      credentials: 'include',
    });
  }

  // Get accounts
  async getAccounts(): Promise<IBKRAccount[]> {
    const response = await fetch(`${this.baseUrl}/v1/api/portfolio/accounts`, {
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error('Failed to get accounts');
    }
    return response.json();
  }

  // Get account summary
  async getAccountSummary(): Promise<IBKRAccountSummary> {
    const response = await fetch(
      `${this.baseUrl}/v1/api/portfolio/${this.accountId}/summary`,
      { credentials: 'include' }
    );
    if (!response.ok) {
      throw new Error('Failed to get account summary');
    }
    return response.json();
  }

  // Get positions
  async getPositions(): Promise<IBKRPosition[]> {
    const response = await fetch(
      `${this.baseUrl}/v1/api/portfolio/${this.accountId}/positions/0`,
      { credentials: 'include' }
    );
    if (!response.ok) {
      throw new Error('Failed to get positions');
    }
    return response.json();
  }

  // Search for contract by symbol
  async searchContract(symbol: string): Promise<{ conid: number; name: string; ticker: string }[]> {
    const response = await fetch(
      `${this.baseUrl}/v1/api/iserver/secdef/search?symbol=${encodeURIComponent(symbol)}`,
      { credentials: 'include' }
    );
    if (!response.ok) {
      throw new Error('Failed to search contract');
    }
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
    const response = await fetch(
      `${this.baseUrl}/v1/api/iserver/contract/${conid}/info`,
      { credentials: 'include' }
    );
    if (!response.ok) {
      throw new Error('Failed to get contract details');
    }
    return response.json();
  }

  // Get market data snapshot
  async getQuote(conids: number[]): Promise<IBKRQuote[]> {
    const fields = '31,84,85,86,87,88,7295,7296,7674,7675'; // Common quote fields
    const response = await fetch(
      `${this.baseUrl}/v1/api/iserver/marketdata/snapshot?conids=${conids.join(',')}&fields=${fields}`,
      { credentials: 'include' }
    );
    if (!response.ok) {
      throw new Error('Failed to get quote');
    }
    return response.json();
  }

  // Get orders
  async getOrders(): Promise<IBKROrder[]> {
    const response = await fetch(`${this.baseUrl}/v1/api/iserver/account/orders`, {
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error('Failed to get orders');
    }
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

    const response = await fetch(
      `${this.baseUrl}/v1/api/iserver/account/${this.accountId}/orders`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orders: [orderPayload] }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to place order: ${error}`);
    }

    return response.json();
  }

  // Confirm order (IBKR requires confirmation for some orders)
  async confirmOrder(replyId: string, confirmed: boolean): Promise<{ orderId: string; orderStatus: string }[]> {
    const response = await fetch(
      `${this.baseUrl}/v1/api/iserver/reply/${replyId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ confirmed }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to confirm order');
    }

    return response.json();
  }

  // Cancel order
  async cancelOrder(orderId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/v1/api/iserver/account/${this.accountId}/order/${orderId}`,
      {
        method: 'DELETE',
        credentials: 'include',
      }
    );

    if (!response.ok) {
      throw new Error('Failed to cancel order');
    }
  }

  // Convenience methods
  async buyMarket(conid: number, quantity: number): Promise<{ orderId: string; orderStatus: string }[]> {
    return this.placeOrder({
      conid,
      orderType: 'MKT',
      side: 'BUY',
      quantity,
    });
  }

  async sellMarket(conid: number, quantity: number): Promise<{ orderId: string; orderStatus: string }[]> {
    return this.placeOrder({
      conid,
      orderType: 'MKT',
      side: 'SELL',
      quantity,
    });
  }

  async buyLimit(conid: number, quantity: number, price: number): Promise<{ orderId: string; orderStatus: string }[]> {
    return this.placeOrder({
      conid,
      orderType: 'LMT',
      side: 'BUY',
      quantity,
      price,
    });
  }

  async sellLimit(conid: number, quantity: number, price: number): Promise<{ orderId: string; orderStatus: string }[]> {
    return this.placeOrder({
      conid,
      orderType: 'LMT',
      side: 'SELL',
      quantity,
      price,
    });
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
