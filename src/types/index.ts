export interface Stock {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap?: number;
}

export interface Position {
  id: string;
  symbol: string;
  name: string;
  shares: number;
  avgCost: number;
  currentPrice: number;
  totalValue: number;
  totalGain: number;
  totalGainPercent: number;
}

export interface Trade {
  id: string;
  symbol: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  total: number;
  date: Date;
  notes?: string;
  tags?: string[];
}

export interface JournalEntry {
  id: string;
  tradeId: string;
  date: Date;
  symbol: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  reasoning: string;
  emotions?: string;
  lessonsLearned?: string;
  outcome?: 'win' | 'loss' | 'breakeven' | 'open';
  profitLoss?: number;
}

export type CandlestickPattern =
  | 'hammer'
  | 'inverted_hammer'
  | 'bullish_engulfing'
  | 'bearish_engulfing'
  | 'shooting_star'
  | 'evening_star'
  | 'gravestone_doji'
  | 'bullish_breakout'
  | 'bearish_breakout';

export interface TradingRule {
  id: string;
  name: string;
  symbol: string;
  enabled: boolean;
  type: 'buy' | 'sell';
  ruleType: 'price' | 'pattern';
  conditions?: RuleCondition[];
  pattern?: CandlestickPattern;
  action: RuleAction;
  createdAt: Date;
  lastTriggered?: Date;
  // Auto-trading fields
  autoTrade: boolean;
  cooldownMinutes: number;
  lastExecutedAt?: Date;
  // Take-profit and stop-loss for auto-sell after buy
  takeProfitPercent?: number; // Auto-sell when position gains this %
  stopLossPercent?: number;   // Auto-sell when position loses this %
}

export interface RuleCondition {
  field: 'price' | 'change' | 'changePercent' | 'volume' | 'rsi' | 'ma';
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  value: number;
}

export interface RuleAction {
  type: 'market' | 'limit';
  shares?: number;
  percentOfPortfolio?: number;
  limitPrice?: number;
}

export interface PortfolioSummary {
  totalValue: number;
  totalCost: number;
  totalGain: number;
  totalGainPercent: number;
  dayChange: number;
  dayChangePercent: number;
  cashBalance: number;
}

export interface PriceHistory {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Alert {
  id: string;
  type: 'pattern' | 'price' | 'rule';
  symbol: string;
  message: string;
  signal: 'buy' | 'sell';
  pattern?: CandlestickPattern;
  ruleId?: string;
  confidence?: number;
  timestamp: Date;
  read: boolean;
  dismissed: boolean;
}

// Trading Mode
export type TradingMode = 'live' | 'paper';

// Paper Trading Portfolio
export interface PaperPortfolio {
  cashBalance: number;
  positions: Position[];
  trades: Trade[];
  startingBalance: number;
  createdAt: Date;
}

// Auto-Trading Configuration
export interface AutoTradeConfig {
  enabled: boolean;
  maxTradesPerDay: number;
  maxPositionSize: number;
  tradingHoursOnly: boolean;
}

// Auto-Trade Execution Record
export interface AutoTradeExecution {
  id: string;
  ruleId: string;
  ruleName: string;
  alertId: string;
  symbol: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  total: number;
  status: 'pending' | 'executed' | 'failed' | 'cancelled';
  error?: string;
  mode: TradingMode;
  timestamp: Date;
}

// Backtest Configuration
export interface BacktestConfig {
  symbol: string;
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  positionSize: number;
  rules: TradingRule[];
}

// Backtest Trade
export interface BacktestTrade {
  id: string;
  ruleId: string;
  ruleName: string;
  pattern?: CandlestickPattern;
  type: 'buy' | 'sell';
  shares: number;
  entryPrice: number;
  entryDate: Date;
  exitPrice?: number;
  exitDate?: Date;
  profitLoss?: number;
  profitLossPercent?: number;
  holdingPeriodDays?: number;
}

// Backtest Result
export interface BacktestResult {
  id: string;
  config: BacktestConfig;
  trades: BacktestTrade[];
  metrics: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalReturn: number;
    totalReturnPercent: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    profitFactor: number;
    averageWin: number;
    averageLoss: number;
    largestWin: number;
    largestLoss: number;
    averageHoldingPeriod: number;
    finalCapital: number;
  };
  equityCurve: Array<{
    date: Date;
    equity: number;
  }>;
  runAt: Date;
}
