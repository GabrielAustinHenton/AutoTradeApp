import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Position,
  Trade,
  JournalEntry,
  TradingRule,
  PortfolioSummary,
  CandlestickPattern,
  Alert,
  TradingMode,
  PaperPortfolio,
  AutoTradeConfig,
  AutoTradeExecution,
  BacktestResult,
} from '../types';
import { ibkr, type IBKRConfig } from '../services/ibkr';

// Default candlestick pattern rules
const createPatternRule = (
  pattern: CandlestickPattern,
  type: 'buy' | 'sell',
  name: string,
  symbol: string = 'AAPL'
): TradingRule => ({
  id: crypto.randomUUID(),
  name,
  symbol,
  enabled: true,
  type,
  ruleType: 'pattern',
  pattern,
  action: { type: 'market', shares: 10 },
  createdAt: new Date(),
  autoTrade: false,
  cooldownMinutes: 5,
});

// Default auto-trade configuration - enabled for paper crypto trading
const defaultAutoTradeConfig: AutoTradeConfig = {
  enabled: true,
  maxTradesPerDay: 20,
  maxPositionSize: 10,
  tradingHoursOnly: false, // Crypto trades 24/7
};

// Default paper portfolio
const defaultPaperPortfolio: PaperPortfolio = {
  cashBalance: 10000,
  positions: [],
  trades: [],
  startingBalance: 10000,
  createdAt: new Date(),
  history: [{ date: new Date(), totalValue: 10000, cashBalance: 10000, positionsValue: 0 }],
};

// Create crypto rule with take-profit, stop-loss, confidence threshold, and volume filter
const createCryptoRule = (
  symbol: string,
  pattern: CandlestickPattern,
  patternName: string
): TradingRule => ({
  id: crypto.randomUUID(),
  name: `${symbol} ${patternName} Auto-Buy`,
  symbol,
  enabled: true,
  type: 'buy',
  ruleType: 'pattern',
  pattern,
  action: { type: 'market', shares: 1 },
  createdAt: new Date(),
  autoTrade: true,
  cooldownMinutes: 15,
  takeProfitPercent: 5,
  stopLossPercent: 3,
  minConfidence: 70, // Only execute high-confidence patterns
  volumeFilter: { enabled: true, minMultiplier: 1.5 }, // Only trade on above-average volume
});

const createCryptoSellRule = (
  symbol: string,
  pattern: CandlestickPattern,
  patternName: string
): TradingRule => ({
  id: crypto.randomUUID(),
  name: `${symbol} ${patternName} Auto-Sell`,
  symbol,
  enabled: true,
  type: 'sell',
  ruleType: 'pattern',
  pattern,
  action: { type: 'market', percentOfPortfolio: 100 },
  createdAt: new Date(),
  autoTrade: true,
  cooldownMinutes: 15,
  minConfidence: 70, // Only execute high-confidence patterns
  volumeFilter: { enabled: true, minMultiplier: 1.5 }, // Only trade on above-average volume
});

// Create stock rule with robust filtering (same as crypto)
const createStockBuyRule = (
  symbol: string,
  pattern: CandlestickPattern,
  patternName: string
): TradingRule => ({
  id: crypto.randomUUID(),
  name: `${symbol} ${patternName} Auto-Buy`,
  symbol,
  enabled: true,
  type: 'buy',
  ruleType: 'pattern',
  pattern,
  action: { type: 'market', shares: 5 },
  createdAt: new Date(),
  autoTrade: true,
  cooldownMinutes: 30, // Longer cooldown for stocks
  takeProfitPercent: 5,
  stopLossPercent: 3,
  minConfidence: 70,
  volumeFilter: { enabled: true, minMultiplier: 1.5 },
  rsiFilter: { enabled: true, period: 14, maxRSI: 70 }, // Only buy when not overbought
});

const createStockSellRule = (
  symbol: string,
  pattern: CandlestickPattern,
  patternName: string
): TradingRule => ({
  id: crypto.randomUUID(),
  name: `${symbol} ${patternName} Auto-Sell`,
  symbol,
  enabled: true,
  type: 'sell',
  ruleType: 'pattern',
  pattern,
  action: { type: 'market', percentOfPortfolio: 100 },
  createdAt: new Date(),
  autoTrade: true,
  cooldownMinutes: 30,
  minConfidence: 70,
  volumeFilter: { enabled: true, minMultiplier: 1.5 },
  rsiFilter: { enabled: true, period: 14, minRSI: 30 }, // Only sell when not oversold
});

// Crypto symbols (use Binance API)
const CRYPTO_SYMBOLS = ['ETH', 'BTC', 'SOL', 'ADA', 'DOT', 'DOGE', 'AVAX', 'MATIC', 'LINK', 'XRP'];

// Watchlist stocks to create rules for
const WATCHLIST_STOCKS = ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA'];

// Bullish patterns for buy rules
const BULLISH_PATTERNS: Array<{ pattern: CandlestickPattern; name: string }> = [
  { pattern: 'hammer', name: 'Hammer' },
  { pattern: 'bullish_engulfing', name: 'Bullish Engulfing' },
  { pattern: 'inverted_hammer', name: 'Inverted Hammer' },
  { pattern: 'bullish_breakout', name: 'Bullish Breakout' },
];

// Bearish patterns for sell rules
const BEARISH_PATTERNS: Array<{ pattern: CandlestickPattern; name: string }> = [
  { pattern: 'shooting_star', name: 'Shooting Star' },
  { pattern: 'bearish_engulfing', name: 'Bearish Engulfing' },
  { pattern: 'evening_star', name: 'Evening Star' },
];

// Generate stock rules for all watchlist symbols
const stockBuyRules = WATCHLIST_STOCKS.flatMap(symbol =>
  BULLISH_PATTERNS.map(({ pattern, name }) => createStockBuyRule(symbol, pattern, name))
);

const stockSellRules = WATCHLIST_STOCKS.flatMap(symbol =>
  BEARISH_PATTERNS.map(({ pattern, name }) => createStockSellRule(symbol, pattern, name))
);

const defaultPatternRules: TradingRule[] = [
  createPatternRule('hammer', 'buy', 'Hammer - Buy Signal'),
  createPatternRule('evening_star', 'sell', 'Evening Star - Sell Signal'),
  createPatternRule('bullish_engulfing', 'sell', 'Bullish Engulfing - Sell Signal'),
  createPatternRule('shooting_star', 'sell', 'Shooting Star - Sell Signal'),
  createPatternRule('gravestone_doji', 'sell', 'Gravestone Doji - Sell Signal'),
  createPatternRule('bearish_engulfing', 'buy', 'Bearish Engulfing - Buy Signal'),
  createPatternRule('inverted_hammer', 'buy', 'Inverted Hammer - Buy Signal'),
  createPatternRule('bullish_breakout', 'buy', 'Bullish Breakout - Buy Signal'),
  createPatternRule('bearish_breakout', 'sell', 'Bearish Breakout - Sell Signal'),
  // Crypto auto-trading rules with take-profit and stop-loss
  createCryptoRule('ETH', 'hammer', 'Hammer'),
  createCryptoRule('ETH', 'bullish_engulfing', 'Bullish Engulfing'),
  createCryptoRule('ETH', 'inverted_hammer', 'Inverted Hammer'),
  createCryptoRule('ETH', 'bullish_breakout', 'Bullish Breakout'),
  createCryptoRule('BTC', 'hammer', 'Hammer'),
  createCryptoRule('BTC', 'bullish_engulfing', 'Bullish Engulfing'),
  createCryptoRule('BTC', 'inverted_hammer', 'Inverted Hammer'),
  createCryptoRule('BTC', 'bullish_breakout', 'Bullish Breakout'),
  createCryptoRule('SOL', 'hammer', 'Hammer'),
  createCryptoRule('SOL', 'bullish_engulfing', 'Bullish Engulfing'),
  createCryptoRule('SOL', 'inverted_hammer', 'Inverted Hammer'),
  createCryptoRule('SOL', 'bullish_breakout', 'Bullish Breakout'),
  // Crypto auto-sell rules for bearish patterns
  createCryptoSellRule('ETH', 'shooting_star', 'Shooting Star'),
  createCryptoSellRule('ETH', 'bearish_engulfing', 'Bearish Engulfing'),
  createCryptoSellRule('ETH', 'evening_star', 'Evening Star'),
  createCryptoSellRule('BTC', 'shooting_star', 'Shooting Star'),
  createCryptoSellRule('BTC', 'bearish_engulfing', 'Bearish Engulfing'),
  createCryptoSellRule('BTC', 'evening_star', 'Evening Star'),
  createCryptoSellRule('SOL', 'shooting_star', 'Shooting Star'),
  createCryptoSellRule('SOL', 'bearish_engulfing', 'Bearish Engulfing'),
  createCryptoSellRule('SOL', 'evening_star', 'Evening Star'),
  // Stock auto-trading rules with robust filtering
  ...stockBuyRules,
  ...stockSellRules,
];

interface AppState {
  // Portfolio
  positions: Position[];
  portfolioSummary: PortfolioSummary;
  cashBalance: number;

  // Watchlist
  watchlist: string[];

  // Trading
  trades: Trade[];
  tradingRules: TradingRule[];

  // Journal
  journalEntries: JournalEntry[];

  // Alerts
  alerts: Alert[];
  alertsEnabled: boolean;
  soundEnabled: boolean;

  // IBKR
  ibkrConnected: boolean;
  ibkrAccountId: string;

  // Trading Mode & Paper Trading
  tradingMode: TradingMode;
  paperPortfolio: PaperPortfolio;

  // Auto-Trading
  autoTradeConfig: AutoTradeConfig;
  autoTradeExecutions: AutoTradeExecution[];

  // Backtesting
  backtestResults: BacktestResult[];

  // Pattern Scanning
  scanRequestTimestamp: number | null;

  // Actions - Portfolio
  addPosition: (position: Position) => void;
  updatePosition: (id: string, updates: Partial<Position>) => void;
  removePosition: (id: string) => void;
  setCashBalance: (amount: number) => void;
  updatePositionPrices: (prices: Map<string, number>) => void;

  // Actions - Watchlist
  addToWatchlist: (symbol: string) => void;
  removeFromWatchlist: (symbol: string) => void;
  syncRulesWithWatchlist: () => void; // Generate rules for all watchlist symbols that don't have them

  // Actions - Trades
  addTrade: (trade: Trade) => void;
  removeTrade: (id: string) => void;

  // Actions - Trading Rules
  addTradingRule: (rule: TradingRule) => void;
  updateTradingRule: (id: string, updates: Partial<TradingRule>) => void;
  removeTradingRule: (id: string) => void;
  toggleTradingRule: (id: string) => void;

  // Actions - Journal
  addJournalEntry: (entry: JournalEntry) => void;
  updateJournalEntry: (id: string, updates: Partial<JournalEntry>) => void;
  removeJournalEntry: (id: string) => void;

  // Actions - Alerts
  addAlert: (alert: Alert) => void;
  markAlertRead: (id: string) => void;
  dismissAlert: (id: string) => void;
  clearAllAlerts: () => void;
  toggleAlerts: () => void;
  toggleSound: () => void;

  // Actions - IBKR
  connectIBKR: (config: IBKRConfig) => void;
  disconnectIBKR: () => void;
  syncFromIBKR: () => Promise<void>;

  // Actions - Trading Mode
  setTradingMode: (mode: TradingMode) => void;
  resetPaperPortfolio: (initialBalance?: number) => void;
  addPaperTrade: (trade: Trade) => void;
  updatePaperPosition: (symbol: string, shares: number, avgCost: number, currentPrice: number) => void;
  updatePaperPositionPrices: (prices: Map<string, number>) => void;
  executePaperSell: (symbol: string, shares: number, price: number) => boolean;
  recordPortfolioSnapshot: () => void;

  // Actions - Auto-Trading
  updateAutoTradeConfig: (config: Partial<AutoTradeConfig>) => void;
  addAutoTradeExecution: (execution: AutoTradeExecution) => void;
  getTodayAutoTradeCount: () => number;

  // Actions - Backtesting
  addBacktestResult: (result: BacktestResult) => void;
  removeBacktestResult: (id: string) => void;
  clearBacktestResults: () => void;

  // Actions - Pattern Scanning
  requestScan: () => void;
}

const initialPortfolioSummary: PortfolioSummary = {
  totalValue: 0,
  totalCost: 0,
  totalGain: 0,
  totalGainPercent: 0,
  dayChange: 0,
  dayChangePercent: 0,
  cashBalance: 10000,
};

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      // Initial state
      positions: [],
      portfolioSummary: initialPortfolioSummary,
      cashBalance: 10000,
      watchlist: ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA'],
      trades: [],
      tradingRules: defaultPatternRules,
      journalEntries: [],
      alerts: [],
      alertsEnabled: true,
      soundEnabled: true,
      ibkrConnected: ibkr.loadConfig() !== null,
      ibkrAccountId: ibkr.loadConfig()?.accountId || '',

      // Trading Mode & Paper Trading
      tradingMode: 'paper',
      paperPortfolio: defaultPaperPortfolio,

      // Auto-Trading
      autoTradeConfig: defaultAutoTradeConfig,
      autoTradeExecutions: [],

      // Backtesting
      backtestResults: [],

      // Pattern Scanning
      scanRequestTimestamp: null,

      // Portfolio actions
      addPosition: (position) =>
        set((state) => ({ positions: [...state.positions, position] })),

      updatePosition: (id, updates) =>
        set((state) => ({
          positions: state.positions.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        })),

      removePosition: (id) =>
        set((state) => ({
          positions: state.positions.filter((p) => p.id !== id),
        })),

      setCashBalance: (amount) => set({ cashBalance: amount }),

      updatePositionPrices: (prices) =>
        set((state) => ({
          positions: state.positions.map((p) => {
            const newPrice = prices.get(p.symbol);
            if (newPrice === undefined) return p;
            const totalValue = p.shares * newPrice;
            const totalGain = totalValue - p.shares * p.avgCost;
            const totalGainPercent = ((newPrice - p.avgCost) / p.avgCost) * 100;
            return {
              ...p,
              currentPrice: newPrice,
              totalValue,
              totalGain,
              totalGainPercent,
            };
          }),
        })),

      // Watchlist actions
      addToWatchlist: (symbol) =>
        set((state) => {
          // Don't add if already in watchlist
          if (state.watchlist.includes(symbol)) {
            return {}; // Return empty object, no changes
          }

          // Check if rules already exist for this symbol
          const hasRulesForSymbol = state.tradingRules.some(r => r.symbol === symbol && r.autoTrade);

          // Generate rules for new symbol if none exist
          let newRules: TradingRule[] = [];
          if (!hasRulesForSymbol) {
            // Check if it's a crypto symbol
            const isCrypto = CRYPTO_SYMBOLS.includes(symbol);

            if (isCrypto) {
              // Create crypto buy rules for bullish patterns
              const buyRules = BULLISH_PATTERNS.map(({ pattern, name }) =>
                createCryptoRule(symbol, pattern, name)
              );
              // Create crypto sell rules for bearish patterns
              const sellRules = BEARISH_PATTERNS.map(({ pattern, name }) =>
                createCryptoSellRule(symbol, pattern, name)
              );
              newRules = [...buyRules, ...sellRules];
            } else {
              // Create stock buy rules for bullish patterns
              const buyRules = BULLISH_PATTERNS.map(({ pattern, name }) =>
                createStockBuyRule(symbol, pattern, name)
              );
              // Create stock sell rules for bearish patterns
              const sellRules = BEARISH_PATTERNS.map(({ pattern, name }) =>
                createStockSellRule(symbol, pattern, name)
              );
              newRules = [...buyRules, ...sellRules];
            }
          }

          return {
            watchlist: [...state.watchlist, symbol],
            tradingRules: newRules.length > 0
              ? [...state.tradingRules, ...newRules]
              : state.tradingRules,
          };
        }),

      removeFromWatchlist: (symbol) =>
        set((state) => ({
          watchlist: state.watchlist.filter((s) => s !== symbol),
        })),

      // Generate rules for all watchlist symbols that don't have them
      syncRulesWithWatchlist: () =>
        set((state) => {
          const newRules: TradingRule[] = [];

          for (const symbol of state.watchlist) {
            // Check if rules already exist for this symbol
            const hasRulesForSymbol = state.tradingRules.some(
              (r) => r.symbol === symbol && r.autoTrade
            );

            if (!hasRulesForSymbol) {
              const isCrypto = CRYPTO_SYMBOLS.includes(symbol);

              if (isCrypto) {
                const buyRules = BULLISH_PATTERNS.map(({ pattern, name }) =>
                  createCryptoRule(symbol, pattern, name)
                );
                const sellRules = BEARISH_PATTERNS.map(({ pattern, name }) =>
                  createCryptoSellRule(symbol, pattern, name)
                );
                newRules.push(...buyRules, ...sellRules);
              } else {
                const buyRules = BULLISH_PATTERNS.map(({ pattern, name }) =>
                  createStockBuyRule(symbol, pattern, name)
                );
                const sellRules = BEARISH_PATTERNS.map(({ pattern, name }) =>
                  createStockSellRule(symbol, pattern, name)
                );
                newRules.push(...buyRules, ...sellRules);
              }
            }
          }

          if (newRules.length === 0) {
            return {};
          }

          console.log(`Generated ${newRules.length} rules for watchlist symbols`);
          return {
            tradingRules: [...state.tradingRules, ...newRules],
          };
        }),

      // Trade actions
      addTrade: (trade) =>
        set((state) => ({ trades: [trade, ...state.trades] })),

      removeTrade: (id) =>
        set((state) => ({
          trades: state.trades.filter((t) => t.id !== id),
        })),

      // Trading rule actions
      addTradingRule: (rule) =>
        set((state) => ({ tradingRules: [...state.tradingRules, rule] })),

      updateTradingRule: (id, updates) =>
        set((state) => ({
          tradingRules: state.tradingRules.map((r) =>
            r.id === id ? { ...r, ...updates } : r
          ),
        })),

      removeTradingRule: (id) =>
        set((state) => ({
          tradingRules: state.tradingRules.filter((r) => r.id !== id),
        })),

      toggleTradingRule: (id) =>
        set((state) => ({
          tradingRules: state.tradingRules.map((r) =>
            r.id === id ? { ...r, enabled: !r.enabled } : r
          ),
        })),

      // Journal actions
      addJournalEntry: (entry) =>
        set((state) => ({ journalEntries: [entry, ...state.journalEntries] })),

      updateJournalEntry: (id, updates) =>
        set((state) => ({
          journalEntries: state.journalEntries.map((e) =>
            e.id === id ? { ...e, ...updates } : e
          ),
        })),

      removeJournalEntry: (id) =>
        set((state) => ({
          journalEntries: state.journalEntries.filter((e) => e.id !== id),
        })),

      // Alert actions
      addAlert: (alert) =>
        set((state) => ({
          alerts: [alert, ...state.alerts].slice(0, 100), // Keep last 100 alerts
        })),

      markAlertRead: (id) =>
        set((state) => ({
          alerts: state.alerts.map((a) =>
            a.id === id ? { ...a, read: true } : a
          ),
        })),

      dismissAlert: (id) =>
        set((state) => ({
          alerts: state.alerts.map((a) =>
            a.id === id ? { ...a, dismissed: true } : a
          ),
        })),

      clearAllAlerts: () => set({ alerts: [] }),

      toggleAlerts: () =>
        set((state) => ({ alertsEnabled: !state.alertsEnabled })),

      toggleSound: () =>
        set((state) => ({ soundEnabled: !state.soundEnabled })),

      // IBKR actions
      connectIBKR: (config) => {
        ibkr.configure(config);
        set({ ibkrConnected: true, ibkrAccountId: config.accountId });
      },

      disconnectIBKR: () => {
        ibkr.clearConfig();
        set({ ibkrConnected: false, ibkrAccountId: '' });
      },

      syncFromIBKR: async () => {
        if (!ibkr.isConfigured()) return;

        try {
          // Get account summary (IBKR returns lowercase field names)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const summaryData = await ibkr.getAccountSummary() as any;
          const cashBalance = summaryData.totalcashvalue?.amount || 0;
          set({ cashBalance });

          // Get positions
          const ibkrPositions = await ibkr.getPositions();
          const positions: Position[] = ibkrPositions.map((p) => ({
            id: p.conid.toString(),
            symbol: p.ticker || p.contractDesc,
            name: p.fullName || p.contractDesc,
            shares: p.position,
            avgCost: p.avgCost,
            currentPrice: p.mktPrice,
            totalValue: p.mktValue,
            totalGain: p.unrealizedPnl,
            totalGainPercent: p.avgCost > 0 ? ((p.mktPrice - p.avgCost) / p.avgCost) * 100 : 0,
          }));

          const totalValue = summaryData.netliquidation?.amount || 0;
          const totalCost = positions.reduce((sum, p) => sum + p.shares * p.avgCost, 0);

          set({
            positions,
            portfolioSummary: {
              totalValue,
              totalCost,
              totalGain: totalValue - totalCost,
              totalGainPercent: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
              dayChange: 0, // IBKR doesn't provide this directly
              dayChangePercent: 0,
              cashBalance,
            },
          });
        } catch (error) {
          console.error('Failed to sync from IBKR:', error);
          throw error;
        }
      },

      // Trading Mode actions
      setTradingMode: (mode) => set({ tradingMode: mode }),

      resetPaperPortfolio: (initialBalance = 10000) =>
        set({
          paperPortfolio: {
            cashBalance: initialBalance,
            positions: [],
            trades: [],
            startingBalance: initialBalance,
            createdAt: new Date(),
          },
        }),

      addPaperTrade: (trade) => {
        set((state) => ({
          paperPortfolio: {
            ...state.paperPortfolio,
            trades: [trade, ...state.paperPortfolio.trades],
          },
        }));
        // Record snapshot after trade
        setTimeout(() => useStore.getState().recordPortfolioSnapshot(), 100);
      },

      updatePaperPosition: (symbol, shares, avgCost, currentPrice) =>
        set((state) => {
          const existingIndex = state.paperPortfolio.positions.findIndex(
            (p) => p.symbol === symbol
          );
          const totalValue = shares * currentPrice;
          const totalGain = totalValue - shares * avgCost;
          const totalGainPercent = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;

          const newPosition: Position = {
            id: existingIndex >= 0 ? state.paperPortfolio.positions[existingIndex].id : crypto.randomUUID(),
            symbol,
            name: symbol,
            shares,
            avgCost,
            currentPrice,
            totalValue,
            totalGain,
            totalGainPercent,
          };

          let newPositions: Position[];
          if (shares === 0) {
            // Remove position if shares are 0
            newPositions = state.paperPortfolio.positions.filter((p) => p.symbol !== symbol);
          } else if (existingIndex >= 0) {
            // Update existing position
            newPositions = state.paperPortfolio.positions.map((p) =>
              p.symbol === symbol ? newPosition : p
            );
          } else {
            // Add new position
            newPositions = [...state.paperPortfolio.positions, newPosition];
          }

          return {
            paperPortfolio: {
              ...state.paperPortfolio,
              positions: newPositions,
            },
          };
        }),

      updatePaperPositionPrices: (prices) =>
        set((state) => ({
          paperPortfolio: {
            ...state.paperPortfolio,
            positions: state.paperPortfolio.positions.map((p) => {
              const newPrice = prices.get(p.symbol);
              if (newPrice === undefined) return p;
              const totalValue = p.shares * newPrice;
              const totalGain = totalValue - p.shares * p.avgCost;
              const totalGainPercent = p.avgCost > 0 ? ((newPrice - p.avgCost) / p.avgCost) * 100 : 0;
              // Track highest price for trailing stop
              const highestPrice = Math.max(newPrice, p.highestPrice || p.avgCost);
              return {
                ...p,
                currentPrice: newPrice,
                totalValue,
                totalGain,
                totalGainPercent,
                highestPrice,
              };
            }),
          },
        })),

      executePaperSell: (symbol, shares, price) => {
        const state = useStore.getState();
        const position = state.paperPortfolio.positions.find((p) => p.symbol === symbol);

        if (!position || position.shares < shares) {
          return false;
        }

        const total = shares * price;
        const newShares = position.shares - shares;

        // Add cash from sale
        set((s) => ({
          paperPortfolio: {
            ...s.paperPortfolio,
            cashBalance: s.paperPortfolio.cashBalance + total,
          },
        }));

        // Update or remove position
        if (newShares <= 0) {
          set((s) => ({
            paperPortfolio: {
              ...s.paperPortfolio,
              positions: s.paperPortfolio.positions.filter((p) => p.symbol !== symbol),
            },
          }));
        } else {
          state.updatePaperPosition(symbol, newShares, position.avgCost, price);
        }

        // Add trade record
        state.addPaperTrade({
          id: `trade-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          symbol,
          type: 'sell',
          shares,
          price,
          total,
          date: new Date(),
          notes: 'Auto-sell (take-profit/stop-loss)',
        });

        return true;
      },

      recordPortfolioSnapshot: () => {
        const state = useStore.getState();
        const positionsValue = state.paperPortfolio.positions.reduce(
          (sum, p) => sum + p.totalValue,
          0
        );
        const totalValue = state.paperPortfolio.cashBalance + positionsValue;

        const snapshot = {
          date: new Date(),
          totalValue,
          cashBalance: state.paperPortfolio.cashBalance,
          positionsValue,
        };

        set((s) => ({
          paperPortfolio: {
            ...s.paperPortfolio,
            history: [...s.paperPortfolio.history, snapshot].slice(-100), // Keep last 100 snapshots
          },
        }));
      },

      // Auto-Trading actions
      updateAutoTradeConfig: (config) =>
        set((state) => ({
          autoTradeConfig: { ...state.autoTradeConfig, ...config },
        })),

      addAutoTradeExecution: (execution) =>
        set((state) => ({
          autoTradeExecutions: [execution, ...state.autoTradeExecutions].slice(0, 500),
        })),

      getTodayAutoTradeCount: () => {
        const state = useStore.getState();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return state.autoTradeExecutions.filter(
          (e) => new Date(e.timestamp) >= today && e.status === 'executed'
        ).length;
      },

      // Backtesting actions
      addBacktestResult: (result) =>
        set((state) => ({
          backtestResults: [result, ...state.backtestResults].slice(0, 50),
        })),

      removeBacktestResult: (id) =>
        set((state) => ({
          backtestResults: state.backtestResults.filter((r) => r.id !== id),
        })),

      clearBacktestResults: () => set({ backtestResults: [] }),

      // Pattern Scanning
      requestScan: () => set({ scanRequestTimestamp: Date.now() }),
    }),
    {
      name: 'tradeapp-storage',
    }
  )
);
