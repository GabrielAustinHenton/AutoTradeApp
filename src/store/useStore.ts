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
  CryptoPortfolio,
  CryptoTrade,
  CryptoPosition,
  DCAConfig,
  GridConfig,
} from '../types';
import { ibkr, type IBKRConfig } from '../services/ibkr';
import { PERMANENT_WATCHLIST } from '../config/watchlist';

// Default auto-trade configuration
const defaultAutoTradeConfig: AutoTradeConfig = {
  enabled: true,
  maxTradesPerDay: 20,
  maxPositionSize: 10,
  tradingHoursOnly: true,
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

// Default crypto portfolio
const defaultCryptoPortfolio: CryptoPortfolio = {
  usdBalance: 10000,
  positions: [],
  trades: [],
};

// ============================================================================
// RESEARCH-BACKED TRADING RULES
// Based on QuantifiedStrategies backtests of 75 candlestick patterns
// - Only patterns with >55% win rate and profit factor >1.5 included
// - $100 fixed position sizing (limits risk per trade)
// - 1:2 risk-reward ratio (2% stop loss, 4% take profit)
// - 2% trailing stop to lock in gains
// ============================================================================

// Proven bullish patterns (buy signals) - from backtest data
const BULLISH_PATTERNS: Array<{ pattern: CandlestickPattern; name: string }> = [
  { pattern: 'inverted_hammer', name: 'Inverted Hammer' },  // 60% win rate, best performer
  { pattern: 'hammer', name: 'Hammer' },                    // Classic reversal, ~57% win rate
  { pattern: 'bullish_engulfing', name: 'Bullish Engulfing' }, // 55-65% win rate
];

// Proven bearish patterns (sell signals)
const BEARISH_PATTERNS: Array<{ pattern: CandlestickPattern; name: string }> = [
  { pattern: 'bearish_engulfing', name: 'Bearish Engulfing' }, // Strong reversal pattern
  { pattern: 'shooting_star', name: 'Shooting Star' },      // Reliable bearish reversal
  { pattern: 'evening_star', name: 'Evening Star' },        // Strong 3-candle reversal
];

// Create a candlestick pattern buy rule - $100 position, 1:2 risk-reward
const createPatternBuyRule = (
  symbol: string,
  pattern: CandlestickPattern,
  patternName: string
): TradingRule => ({
  id: crypto.randomUUID(),
  name: `${symbol} ${patternName} Buy`,
  symbol,
  enabled: true,
  type: 'buy',
  ruleType: 'pattern',
  pattern,
  action: { type: 'market', targetDollarAmount: 100 },  // $100 per trade
  createdAt: new Date(),
  autoTrade: true,
  cooldownMinutes: 30,           // Reduced cooldown for more opportunities
  takeProfitPercent: 4,          // 4% take profit
  stopLossPercent: 2,            // 2% stop loss (1:2 risk-reward)
  trailingStopPercent: 2,        // 2% trailing stop to lock in gains
  minConfidence: 60,             // Lowered - patterns already filtered to good ones
  volumeFilter: { enabled: true, minMultiplier: 1.1 },  // Slightly lower for more trades
});

// Create a candlestick pattern sell rule - sells all holdings
const createPatternSellRule = (
  symbol: string,
  pattern: CandlestickPattern,
  patternName: string
): TradingRule => ({
  id: crypto.randomUUID(),
  name: `${symbol} ${patternName} Sell`,
  symbol,
  enabled: true,
  type: 'sell',
  ruleType: 'pattern',
  pattern,
  action: { type: 'market', percentOfPortfolio: 100 },  // Sell all
  createdAt: new Date(),
  autoTrade: true,
  cooldownMinutes: 30,
  minConfidence: 60,
  volumeFilter: { enabled: true, minMultiplier: 1.1 },
});

// Create a MACD buy rule - $100 position, 1:2 risk-reward
const createMACDBuyRule = (symbol: string): TradingRule => ({
  id: crypto.randomUUID(),
  name: `${symbol} MACD Buy`,
  symbol,
  enabled: true,
  type: 'buy',
  ruleType: 'macd',
  macdSettings: {
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    crossoverType: 'bullish',
  },
  action: { type: 'market', targetDollarAmount: 100 },  // $100 per trade
  createdAt: new Date(),
  autoTrade: true,
  cooldownMinutes: 30,
  takeProfitPercent: 4,
  stopLossPercent: 2,
  trailingStopPercent: 2,
  volumeFilter: { enabled: true, minMultiplier: 1.1 },
});

// Create a MACD sell rule - sells all holdings
const createMACDSellRule = (symbol: string): TradingRule => ({
  id: crypto.randomUUID(),
  name: `${symbol} MACD Sell`,
  symbol,
  enabled: true,
  type: 'sell',
  ruleType: 'macd',
  macdSettings: {
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    crossoverType: 'bearish',
  },
  action: { type: 'market', percentOfPortfolio: 100 },  // Sell all
  createdAt: new Date(),
  autoTrade: true,
  cooldownMinutes: 30,
  volumeFilter: { enabled: true, minMultiplier: 1.1 },
});

// Generate all rules for a symbol (3 buy patterns + 2 sell patterns + 2 MACD = 7 rules per stock)
const createRulesForSymbol = (symbol: string): TradingRule[] => [
  // Candlestick pattern rules
  ...BULLISH_PATTERNS.map(({ pattern, name }) => createPatternBuyRule(symbol, pattern, name)),
  ...BEARISH_PATTERNS.map(({ pattern, name }) => createPatternSellRule(symbol, pattern, name)),
  // MACD rules
  createMACDBuyRule(symbol),
  createMACDSellRule(symbol),
];

// Generate all rules for all watchlist stocks
const defaultPatternRules: TradingRule[] = PERMANENT_WATCHLIST.flatMap(createRulesForSymbol);

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

  // Crypto Trading
  cryptoPortfolio: CryptoPortfolio;
  dcaConfigs: DCAConfig[];
  gridConfigs: GridConfig[];

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

  // Actions - Crypto Trading
  addCryptoTrade: (trade: CryptoTrade) => void;
  addCryptoPosition: (position: CryptoPosition) => void;
  updateCryptoPosition: (id: string, updates: Partial<CryptoPosition>) => void;
  updateCryptoPositionPrices: (prices: Map<string, number>) => void;
  setCryptoUsdBalance: (amount: number) => void;
  resetCryptoPortfolio: (initialBalance?: number) => void;

  // Actions - DCA
  addDCAConfig: (config: DCAConfig) => void;
  updateDCAConfig: (id: string, updates: Partial<DCAConfig>) => void;
  removeDCAConfig: (id: string) => void;

  // Actions - Grid Trading
  addGridConfig: (config: GridConfig) => void;
  updateGridConfig: (id: string, updates: Partial<GridConfig>) => void;
  removeGridConfig: (id: string) => void;
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
    (set, get) => ({
      // Initial state
      positions: [],
      portfolioSummary: initialPortfolioSummary,
      cashBalance: 10000,
      watchlist: [...PERMANENT_WATCHLIST],
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

      // Crypto Trading
      cryptoPortfolio: defaultCryptoPortfolio,
      dcaConfigs: [],
      gridConfigs: [],

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
      addToWatchlist: (symbol) => {
        const state = get();
        // Don't add if already in watchlist
        if (state.watchlist.includes(symbol)) {
          return;
        }

        // Check if rules already exist for this symbol
        const hasRulesForSymbol = state.tradingRules.some(r => r.symbol === symbol);

        // Generate all rules (patterns + MACD) for new symbol if none exist
        const newRules: TradingRule[] = hasRulesForSymbol ? [] : createRulesForSymbol(symbol);

        const newWatchlist = [...state.watchlist, symbol];

        set({
          watchlist: newWatchlist,
          tradingRules: newRules.length > 0
            ? [...state.tradingRules, ...newRules]
            : state.tradingRules,
        });

        // Persist to file
        fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stocks: newWatchlist }),
        }).catch(console.error);
      },

      removeFromWatchlist: (symbol) => {
        const state = get();
        const newWatchlist = state.watchlist.filter((s) => s !== symbol);

        set({ watchlist: newWatchlist });

        // Persist to file
        fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stocks: newWatchlist }),
        }).catch(console.error);
      },

      // Generate rules for all watchlist symbols that don't have them
      syncRulesWithWatchlist: () =>
        set((state) => {
          const newRules: TradingRule[] = [];

          for (const symbol of state.watchlist) {
            const hasRulesForSymbol = state.tradingRules.some((r) => r.symbol === symbol);
            if (!hasRulesForSymbol) {
              newRules.push(...createRulesForSymbol(symbol));
            }
          }

          if (newRules.length === 0) {
            return {};
          }

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
        set((state) => {
          const newConfig = { ...state.autoTradeConfig, ...config };

          // When global auto-trade is toggled, update all rules accordingly
          if ('enabled' in config) {
            const updatedRules = state.tradingRules.map(rule => ({
              ...rule,
              enabled: config.enabled,
              autoTrade: config.enabled,
            }));
            return {
              autoTradeConfig: newConfig,
              tradingRules: updatedRules,
            };
          }

          return { autoTradeConfig: newConfig };
        }),

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

      // Crypto Trading actions
      addCryptoTrade: (trade) =>
        set((state) => ({
          cryptoPortfolio: {
            ...state.cryptoPortfolio,
            trades: [trade, ...state.cryptoPortfolio.trades],
          },
        })),

      addCryptoPosition: (position) =>
        set((state) => ({
          cryptoPortfolio: {
            ...state.cryptoPortfolio,
            positions: [...state.cryptoPortfolio.positions, position],
          },
        })),

      updateCryptoPosition: (id, updates) =>
        set((state) => {
          const newPositions = state.cryptoPortfolio.positions
            .map((p) => (p.id === id ? { ...p, ...updates } : p))
            .filter((p) => p.amount > 0); // Remove positions with 0 amount

          return {
            cryptoPortfolio: {
              ...state.cryptoPortfolio,
              positions: newPositions,
            },
          };
        }),

      updateCryptoPositionPrices: (prices) =>
        set((state) => ({
          cryptoPortfolio: {
            ...state.cryptoPortfolio,
            positions: state.cryptoPortfolio.positions.map((p) => {
              const newPrice = prices.get(p.symbol);
              if (newPrice === undefined) return p;
              return {
                ...p,
                currentPrice: newPrice,
              };
            }),
          },
        })),

      setCryptoUsdBalance: (amount) =>
        set((state) => ({
          cryptoPortfolio: {
            ...state.cryptoPortfolio,
            usdBalance: amount,
          },
        })),

      resetCryptoPortfolio: (initialBalance = 10000) =>
        set({
          cryptoPortfolio: {
            usdBalance: initialBalance,
            positions: [],
            trades: [],
          },
        }),

      // DCA actions
      addDCAConfig: (config) =>
        set((state) => ({
          dcaConfigs: [...state.dcaConfigs, config],
        })),

      updateDCAConfig: (id, updates) =>
        set((state) => ({
          dcaConfigs: state.dcaConfigs.map((c) =>
            c.id === id ? { ...c, ...updates } : c
          ),
        })),

      removeDCAConfig: (id) =>
        set((state) => ({
          dcaConfigs: state.dcaConfigs.filter((c) => c.id !== id),
        })),

      // Grid Trading actions
      addGridConfig: (config) =>
        set((state) => ({
          gridConfigs: [...state.gridConfigs, config],
        })),

      updateGridConfig: (id, updates) =>
        set((state) => ({
          gridConfigs: state.gridConfigs.map((c) =>
            c.id === id ? { ...c, ...updates } : c
          ),
        })),

      removeGridConfig: (id) =>
        set((state) => ({
          gridConfigs: state.gridConfigs.filter((c) => c.id !== id),
        })),
    }),
    {
      name: 'tradeapp-storage',
      // Merge function ensures permanent watchlist symbols are always present
      merge: (persistedState, currentState) => {
        try {
          const persisted = (persistedState as Partial<AppState>) || {};
          const merged = { ...currentState, ...persisted };

          // Merge permanent watchlist with user-added stocks (filter out old crypto)
          const cryptoSymbols = ['ETH', 'BTC', 'SOL', 'ADA', 'DOT', 'DOGE', 'AVAX', 'POL', 'LINK', 'XRP', 'MATIC'];
          const userStocks = (merged.watchlist || []).filter((s: string) => !cryptoSymbols.includes(s));
          merged.watchlist = [...new Set([...PERMANENT_WATCHLIST, ...userStocks])];

          // Merge trading rules: keep user settings, add missing rules for new patterns/stocks
          const existingRules = Array.isArray(persisted.tradingRules)
            ? persisted.tradingRules.filter((r): r is TradingRule => r && typeof r === 'object' && 'symbol' in r)
            : [];

          const existingRuleKeys = new Set(
            existingRules.map(r => `${r.symbol}-${r.ruleType || ''}-${r.pattern || ''}-${r.macdSettings?.crossoverType || ''}`)
          );

          // Find rules that don't exist yet
          const missingRules = defaultPatternRules.filter(r => {
            const key = `${r.symbol}-${r.ruleType || ''}-${r.pattern || ''}-${r.macdSettings?.crossoverType || ''}`;
            return !existingRuleKeys.has(key);
          });

          // Keep existing rules (preserves user's enabled/autoTrade settings) + add missing ones
          merged.tradingRules = [...existingRules, ...missingRules];

          // Preserve user data, only reset if not present
          merged.paperPortfolio = persisted.paperPortfolio || defaultPaperPortfolio;
          merged.trades = Array.isArray(persisted.trades) ? persisted.trades : [];
          merged.alerts = Array.isArray(persisted.alerts) ? persisted.alerts : [];
          merged.autoTradeExecutions = Array.isArray(persisted.autoTradeExecutions) ? persisted.autoTradeExecutions : [];
          merged.journalEntries = Array.isArray(persisted.journalEntries) ? persisted.journalEntries : [];
          merged.backtestResults = Array.isArray(persisted.backtestResults) ? persisted.backtestResults : [];

          // Preserve crypto state
          merged.cryptoPortfolio = persisted.cryptoPortfolio || defaultCryptoPortfolio;
          merged.dcaConfigs = Array.isArray(persisted.dcaConfigs) ? persisted.dcaConfigs : [];
          merged.gridConfigs = Array.isArray(persisted.gridConfigs) ? persisted.gridConfigs : [];

          return merged as AppState;
        } catch (error) {
          console.error('Error in store merge, using defaults:', error);
          return currentState;
        }
      },
    }
  )
);
