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
  highestPrice?: number; // Track highest price since purchase for trailing stop
  openedAt?: Date;       // Track when position was opened for time-based exits
}

// Short position - profit when price goes DOWN
export interface ShortPosition {
  id: string;
  symbol: string;
  name: string;
  shares: number;        // Number of shares shorted
  entryPrice: number;    // Price at which we shorted
  currentPrice: number;
  lowestPrice?: number;  // Track lowest price since short for trailing stop
  openedAt?: Date;       // Track when position was opened for time-based exits
  // P/L calculation: (entryPrice - currentPrice) * shares
  // Positive when price drops, negative when price rises
}

export interface Trade {
  id: string;
  symbol: string;
  type: 'buy' | 'sell' | 'short' | 'cover';  // short = open short, cover = close short
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
  type: 'buy' | 'sell' | 'short' | 'cover';  // short = open short position, cover = close short
  ruleType: 'price' | 'pattern' | 'macd';
  conditions?: RuleCondition[];
  pattern?: CandlestickPattern;
  // MACD crossover settings
  macdSettings?: {
    fastPeriod: number;   // Fast EMA period (default 12)
    slowPeriod: number;   // Slow EMA period (default 26)
    signalPeriod: number; // Signal line period (default 9)
    crossoverType: 'bullish' | 'bearish'; // Which crossover to trigger on
  };
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
  trailingStopPercent?: number; // Trailing stop - sells when price drops this % from highest
  // RSI filter - only trigger if RSI meets condition
  rsiFilter?: {
    enabled: boolean;
    period: number; // RSI period (default 14)
    minRSI?: number; // Only trigger if RSI >= this (e.g., 30 for oversold buy)
    maxRSI?: number; // Only trigger if RSI <= this (e.g., 70 for overbought sell)
  };
  // Minimum confidence threshold (0-100) - only execute if pattern confidence >= this
  minConfidence?: number;
  // Volume filter - only trade when volume is above average
  volumeFilter?: {
    enabled: boolean;
    minMultiplier: number; // Volume must be >= avgVolume * multiplier (e.g., 1.5 = 50% above average)
  };
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
  targetDollarAmount?: number; // Buy/sell this dollar amount worth (calculates shares from price)
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
  signal: 'buy' | 'sell' | 'short';
  pattern?: CandlestickPattern;
  ruleId?: string;
  confidence?: number;
  timestamp: Date;
  read: boolean;
  dismissed: boolean;
}

// Trading Mode
export type TradingMode = 'live' | 'paper';

// Portfolio value snapshot for tracking history
export interface PortfolioSnapshot {
  date: Date;
  totalValue: number;
  cashBalance: number;
  positionsValue: number;
}

// Paper Trading Portfolio
export interface PaperPortfolio {
  cashBalance: number;
  positions: Position[];
  shortPositions: ShortPosition[];  // Short positions
  trades: Trade[];
  startingBalance: number;
  createdAt: Date;
  history: PortfolioSnapshot[];
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
  type: 'buy' | 'sell' | 'short' | 'cover';
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

// Crypto Trading Types
export interface CryptoPosition {
  id: string;
  symbol: string;
  amount: number;
  avgCost: number;
  currentPrice: number;
  highestPrice?: number;  // Track highest price for trailing stop
  openedAt?: Date;        // Track when position was opened for time-based exits
}

// Crypto Trading Rule - extends TradingRule concept for crypto
export interface CryptoTradingRule {
  id: string;
  name: string;
  symbol: string;  // BTC, ETH, SOL, etc.
  enabled: boolean;
  type: 'buy' | 'sell';
  ruleType: 'pattern' | 'rsi';  // Crypto uses patterns and RSI (no MACD for now due to API limits)
  pattern?: CandlestickPattern;
  // RSI crossover settings
  rsiSettings?: {
    period: number;         // RSI period (default 14)
    oversoldLevel: number;  // Buy when RSI crosses above this (default 30)
    overboughtLevel: number; // Sell when RSI crosses below this (default 70)
    crossoverType: 'oversold_exit' | 'overbought_exit';
  };
  createdAt: Date;
  lastTriggered?: Date;
  // Auto-trading fields
  autoTrade: boolean;
  cooldownMinutes: number;
  lastExecutedAt?: Date;
  // Risk management
  takeProfitPercent?: number;
  stopLossPercent?: number;
  trailingStopPercent?: number;
  // Filters
  minConfidence?: number;
  volumeFilter?: {
    enabled: boolean;
    minMultiplier: number;
  };
}

export interface CryptoTrade {
  id: string;
  symbol: string;
  type: 'buy' | 'sell';
  amount: number;
  price: number;
  total: number;
  date: Date;
}

export interface CryptoPortfolio {
  usdBalance: number;
  positions: CryptoPosition[];
  trades: CryptoTrade[];
  startingBalance?: number;
  history?: CryptoPortfolioSnapshot[];
}

export interface CryptoPortfolioSnapshot {
  date: Date;
  totalValue: number;
  usdBalance: number;
  positionsValue: number;
}

// Crypto Auto-Trading Configuration
export interface CryptoAutoTradeConfig {
  enabled: boolean;
  maxTradesPerDay: number;
  maxPositionSizePercent: number;  // % of portfolio per trade
}

// Crypto Backtest Types
export interface CryptoBacktestConfig {
  symbol: string;
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  positionSizePercent: number;
  rules: CryptoTradingRule[];
}

export interface CryptoBacktestTrade {
  id: string;
  ruleId: string;
  ruleName: string;
  pattern?: CandlestickPattern;
  type: 'buy' | 'sell';
  amount: number;
  entryPrice: number;
  entryDate: Date;
  exitPrice?: number;
  exitDate?: Date;
  profitLoss?: number;
  profitLossPercent?: number;
  holdingPeriodHours?: number;
}

export interface CryptoBacktestResult {
  id: string;
  config: CryptoBacktestConfig;
  trades: CryptoBacktestTrade[];
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
    averageHoldingPeriodHours: number;
    finalCapital: number;
  };
  equityCurve: Array<{
    date: Date;
    equity: number;
  }>;
  runAt: Date;
}

// DCA (Dollar-Cost Averaging) Configuration
export interface DCAConfig {
  id: string;
  symbol: string;
  amount: number;
  interval: 'hourly' | 'daily' | 'weekly';
  enabled: boolean;
  lastExecuted?: Date;
  nextExecution?: Date;
}

// Grid Trading Configuration
export interface GridOrder {
  id: string;
  price: number;
  type: 'buy' | 'sell';
  amount: number;
  filled: boolean;
}

export interface GridConfig {
  id: string;
  symbol: string;
  lowerPrice: number;
  upperPrice: number;
  gridLevels: number;
  amountPerGrid: number;
  enabled: boolean;
  activeOrders: GridOrder[];
}
