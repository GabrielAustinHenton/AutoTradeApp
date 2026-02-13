import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Position,
  ShortPosition,
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
import { PERMANENT_WATCHLIST } from '../config/watchlist';

// Default auto-trade configuration
const defaultAutoTradeConfig: AutoTradeConfig = {
  enabled: true,
  maxTradesPerDay: 20,
  maxPositionSize: 10,
  tradingHoursOnly: true,
  // Yearly drawdown protection - stop trading if down 15% from year start
  yearlyDrawdownLimit: 15,
  yearStartPortfolioValue: null,
  drawdownStopTriggered: false,
  drawdownStopTriggeredDate: null,
};

// Default paper portfolio
const defaultPaperPortfolio: PaperPortfolio = {
  cashBalance: 10000,
  positions: [],
  shortPositions: [],  // Short positions for bearish trades
  trades: [],
  startingBalance: 10000,
  createdAt: new Date(),
  history: [{ date: new Date(), totalValue: 10000, cashBalance: 10000, positionsValue: 0 }],
};


// ============================================================================
// SWING TRADING RULES - FIXED TARGETS (NO TRAILING STOP)
// Analysis showed trailing stops exit winners too early (2-3% gains vs 10% target)
// Strategy: Fixed take profit + stop loss only, no trailing stop
// - Take profit: 5% (achievable target)
// - Stop loss: 2% (tight risk management)
// - Risk/Reward: 1:2.5 (need 40% win rate to break even)
// - No trailing stop (was killing profitable trades)
// ============================================================================

// Bullish patterns for momentum entry
const BULLISH_PATTERNS: Array<{ pattern: CandlestickPattern; name: string }> = [
  { pattern: 'bullish_breakout', name: 'Bullish Breakout' },   // Momentum breakout - best for day trading
  { pattern: 'bullish_engulfing', name: 'Bullish Engulfing' }, // Strong reversal signal
  { pattern: 'hammer', name: 'Hammer' },                        // Bottom reversal
  { pattern: 'inverted_hammer', name: 'Inverted Hammer' },      // Potential reversal
];

// Bearish patterns - DISABLED for auto-sell (trailing stop handles exits)
const BEARISH_PATTERNS: Array<{ pattern: CandlestickPattern; name: string }> = [
  { pattern: 'bearish_engulfing', name: 'Bearish Engulfing' },
  { pattern: 'shooting_star', name: 'Shooting Star' },
  { pattern: 'evening_star', name: 'Evening Star' },
  { pattern: 'bearish_breakout', name: 'Bearish Breakout' },
];

// Create a BUY rule - fixed targets, no trailing stop
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
  cooldownMinutes: 5,
  takeProfitPercent: 5,           // 5% take profit (realistic target)
  stopLossPercent: 2,             // 2% stop loss (tight risk management)
  trailingStopPercent: undefined, // NO trailing stop - was exiting winners too early
  minConfidence: 70,              // Higher confidence threshold (was 60)
  rsiFilter: { enabled: true, maxRSI: 40 },  // RSI < 40 (slightly relaxed from 35)
  volumeFilter: { enabled: true, minMultiplier: 1.5 },  // 1.5x average volume (relaxed)
});

// Create pattern ALERT rule (no auto-trade) - for manual decision making
const createPatternSellRule = (
  symbol: string,
  pattern: CandlestickPattern,
  patternName: string
): TradingRule => ({
  id: crypto.randomUUID(),
  name: `${symbol} ${patternName} Alert`,
  symbol,
  enabled: true,
  type: 'sell',
  ruleType: 'pattern',
  pattern,
  action: { type: 'market', percentOfPortfolio: 100 },
  createdAt: new Date(),
  autoTrade: false,  // DISABLED - trailing stop handles exits, this just alerts
  cooldownMinutes: 5,
  minConfidence: 60,
  volumeFilter: { enabled: false, minMultiplier: 1.0 },
});

// Create a MACD buy rule - fixed targets, no trailing stop
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
  action: { type: 'market', targetDollarAmount: 100 },
  createdAt: new Date(),
  autoTrade: true,
  cooldownMinutes: 5,
  takeProfitPercent: 5,           // 5% take profit
  stopLossPercent: 2,             // 2% stop loss
  trailingStopPercent: undefined, // NO trailing stop
  rsiFilter: { enabled: true, maxRSI: 40 },
  volumeFilter: { enabled: true, minMultiplier: 1.5 },
});

// Create a MACD sell ALERT (no auto-trade) - trailing stop handles exits
const createMACDSellRule = (symbol: string): TradingRule => ({
  id: crypto.randomUUID(),
  name: `${symbol} MACD Sell Alert`,
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
  action: { type: 'market', percentOfPortfolio: 100 },
  createdAt: new Date(),
  autoTrade: false,  // DISABLED - trailing stop handles exits
  cooldownMinutes: 5,
  volumeFilter: { enabled: false, minMultiplier: 1.0 },
});

// ============================================================================
// SHORT SELLING RULES - Profit when price goes DOWN
// Open short on bearish patterns, cover (buy back) on bullish patterns
// ============================================================================

// Create a SHORT rule - fixed targets, no trailing stop
const createPatternShortRule = (
  symbol: string,
  pattern: CandlestickPattern,
  patternName: string
): TradingRule => ({
  id: crypto.randomUUID(),
  name: `${symbol} ${patternName} Short`,
  symbol,
  enabled: true,
  type: 'short',
  ruleType: 'pattern',
  pattern,
  action: { type: 'market', targetDollarAmount: 100 },
  createdAt: new Date(),
  autoTrade: true,
  cooldownMinutes: 5,
  takeProfitPercent: 5,           // 5% take profit (price drops 5%)
  stopLossPercent: 2,             // 2% stop loss - if price rises 2%, cover
  trailingStopPercent: undefined, // NO trailing stop
  minConfidence: 70,              // Higher confidence threshold
  rsiFilter: { enabled: true, minRSI: 60 },  // Only short when RSI > 60 (overbought)
  volumeFilter: { enabled: true, minMultiplier: 1.5 },
});

// Create MACD short rule - fixed targets, no trailing stop
const createMACDShortRule = (symbol: string): TradingRule => ({
  id: crypto.randomUUID(),
  name: `${symbol} MACD Short`,
  symbol,
  enabled: true,
  type: 'short',
  ruleType: 'macd',
  macdSettings: {
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    crossoverType: 'bearish',
  },
  action: { type: 'market', targetDollarAmount: 100 },
  createdAt: new Date(),
  autoTrade: true,
  cooldownMinutes: 5,
  takeProfitPercent: 5,           // 5% take profit
  stopLossPercent: 2,             // 2% stop loss
  trailingStopPercent: undefined, // NO trailing stop
  rsiFilter: { enabled: true, minRSI: 60 },
  volumeFilter: { enabled: true, minMultiplier: 1.5 },
});

// Generate all rules for a symbol
// Buy rules for bullish patterns, Short rules for bearish patterns
const createRulesForSymbol = (symbol: string): TradingRule[] => [
  // BUY on bullish patterns
  ...BULLISH_PATTERNS.map(({ pattern, name }) => createPatternBuyRule(symbol, pattern, name)),
  // SHORT on bearish patterns (profit when price drops)
  ...BEARISH_PATTERNS.map(({ pattern, name }) => createPatternShortRule(symbol, pattern, name)),
  // MACD rules - buy on bullish crossover, short on bearish crossover
  createMACDBuyRule(symbol),
  createMACDShortRule(symbol),
];

// Generate all rules for all watchlist stocks
const defaultPatternRules: TradingRule[] = PERMANENT_WATCHLIST.flatMap(createRulesForSymbol);

// ============================================================================
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
  resetTradingRules: () => void; // Reset to default rules (includes short selling rules)

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
  forceCloseAllPositions: () => { totalPnL: number; tradesExecuted: number };
  addPaperTrade: (trade: Trade) => void;
  updatePaperPosition: (symbol: string, shares: number, avgCost: number, currentPrice: number) => void;
  updatePaperPositionPrices: (prices: Map<string, number>) => void;
  executePaperSell: (symbol: string, shares: number, price: number, notes?: string) => boolean;
  recordPortfolioSnapshot: () => void;
  // Short position actions
  openShortPosition: (symbol: string, shares: number, price: number) => boolean;
  coverShortPosition: (symbol: string, shares: number, price: number, notes?: string) => boolean;
  updateShortPositionPrices: (prices: Map<string, number>) => void;

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

      resetTradingRules: () =>
        set((state) => ({
          tradingRules: state.watchlist.flatMap(createRulesForSymbol),
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

      forceCloseAllPositions: () => {
        const state = useStore.getState();
        let totalPnL = 0;
        let tradesExecuted = 0;

        // Close all long positions
        for (const position of state.paperPortfolio.positions) {
          const pnl = (position.currentPrice - position.avgCost) * position.shares;
          totalPnL += pnl;
          const pnlPercent = ((position.currentPrice - position.avgCost) / position.avgCost) * 100;
          const plText = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%)`;

          // Add cash from sale
          set((s) => ({
            paperPortfolio: {
              ...s.paperPortfolio,
              cashBalance: s.paperPortfolio.cashBalance + position.totalValue,
            },
          }));

          // Add trade record
          state.addPaperTrade({
            id: `trade-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            symbol: position.symbol,
            type: 'sell',
            shares: position.shares,
            price: position.currentPrice,
            total: position.totalValue,
            date: new Date(),
            notes: `Force Close | P/L: ${plText}`,
          });
          tradesExecuted++;
        }

        // Cover all short positions
        for (const shortPos of (state.paperPortfolio.shortPositions || [])) {
          const pnl = (shortPos.entryPrice - shortPos.currentPrice) * shortPos.shares;
          totalPnL += pnl;
          const pnlPercent = ((shortPos.entryPrice - shortPos.currentPrice) / shortPos.entryPrice) * 100;
          const plText = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%)`;

          // Update cash (profit or loss from short)
          set((s) => ({
            paperPortfolio: {
              ...s.paperPortfolio,
              cashBalance: s.paperPortfolio.cashBalance + pnl,
            },
          }));

          // Add trade record
          state.addPaperTrade({
            id: `trade-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            symbol: shortPos.symbol,
            type: 'cover',
            shares: shortPos.shares,
            price: shortPos.currentPrice,
            total: shortPos.shares * shortPos.currentPrice,
            date: new Date(),
            notes: `Force Close | P/L: ${plText}`,
          });
          tradesExecuted++;
        }

        // Clear all positions
        set((s) => ({
          paperPortfolio: {
            ...s.paperPortfolio,
            positions: [],
            shortPositions: [],
          },
          // Disable auto-trading
          autoTradeConfig: {
            ...s.autoTradeConfig,
            enabled: false,
          },
        }));

        console.log(`\n${'='.repeat(60)}`);
        console.log(`🛑 FORCE CLOSED ALL POSITIONS`);
        console.log(`${'='.repeat(60)}`);
        console.log(`   Trades executed: ${tradesExecuted}`);
        console.log(`   Total P/L: ${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)}`);
        console.log(`   Auto-trading: DISABLED`);
        console.log(`${'='.repeat(60)}\n`);

        return { totalPnL, tradesExecuted };
      },

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

          const existingPosition = existingIndex >= 0 ? state.paperPortfolio.positions[existingIndex] : null;
          const newPosition: Position = {
            id: existingPosition?.id || crypto.randomUUID(),
            symbol,
            name: symbol,
            shares,
            avgCost,
            currentPrice,
            totalValue,
            totalGain,
            totalGainPercent,
            openedAt: existingPosition?.openedAt || new Date(), // Preserve original open time or set new
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

      executePaperSell: (symbol, shares, price, notes) => {
        const state = useStore.getState();
        const position = state.paperPortfolio.positions.find((p) => p.symbol === symbol);

        if (!position || position.shares < shares) {
          return false;
        }

        const total = shares * price;
        const newShares = position.shares - shares;

        // Calculate P/L for the trade
        const profitLoss = (price - position.avgCost) * shares;
        const profitLossPercent = ((price - position.avgCost) / position.avgCost) * 100;
        const plText = `${profitLoss >= 0 ? '+' : ''}$${profitLoss.toFixed(2)} (${profitLossPercent >= 0 ? '+' : ''}${profitLossPercent.toFixed(1)}%)`;

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

        // Add trade record with P/L info
        state.addPaperTrade({
          id: `trade-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          symbol,
          type: 'sell',
          shares,
          price,
          total,
          date: new Date(),
          notes: notes ? `${notes} | P/L: ${plText}` : `Auto-sell | P/L: ${plText}`,
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

      // Short position actions
      openShortPosition: (symbol, shares, price) => {
        const state = useStore.getState();
        const total = shares * price;

        // For shorting, we receive cash upfront (sell borrowed shares)
        // But we need margin/collateral - require enough cash to cover potential losses
        // Require 150% of position value as collateral (standard margin requirement)
        const marginRequired = total * 1.5;
        if (state.paperPortfolio.cashBalance < marginRequired) {
          console.log(`Cannot open short: Insufficient margin. Need $${marginRequired.toFixed(2)}, have $${state.paperPortfolio.cashBalance.toFixed(2)}`);
          return false;
        }

        // Check if we already have a short position in this symbol
        const existingShort = state.paperPortfolio.shortPositions?.find((p) => p.symbol === symbol);

        if (existingShort) {
          // Add to existing short position
          const newShares = existingShort.shares + shares;
          const newEntryPrice = (existingShort.entryPrice * existingShort.shares + price * shares) / newShares;

          set((s) => ({
            paperPortfolio: {
              ...s.paperPortfolio,
              shortPositions: (s.paperPortfolio.shortPositions || []).map((p) =>
                p.symbol === symbol
                  ? { ...p, shares: newShares, entryPrice: newEntryPrice, currentPrice: price, lowestPrice: price }
                  : p
              ),
            },
          }));
        } else {
          // Create new short position
          const newShort: ShortPosition = {
            id: crypto.randomUUID(),
            symbol,
            name: symbol,
            shares,
            entryPrice: price,
            currentPrice: price,
            lowestPrice: price,
            openedAt: new Date(),
          };

          set((s) => ({
            paperPortfolio: {
              ...s.paperPortfolio,
              shortPositions: [...(s.paperPortfolio.shortPositions || []), newShort],
            },
          }));
        }

        // Add trade record
        state.addPaperTrade({
          id: `trade-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          symbol,
          type: 'short',
          shares,
          price,
          total,
          date: new Date(),
          notes: 'Auto-short (bearish pattern)',
        });

        return true;
      },

      coverShortPosition: (symbol, shares, price, notes) => {
        const state = useStore.getState();
        const shortPos = state.paperPortfolio.shortPositions?.find((p) => p.symbol === symbol);

        if (!shortPos || shortPos.shares < shares) {
          console.log(`Cannot cover: No short position in ${symbol} or insufficient shares`);
          return false;
        }

        const total = shares * price;
        // P/L = (entry price - current price) * shares
        // Positive when price dropped, negative when price rose
        const profitLoss = (shortPos.entryPrice - price) * shares;

        // Update cash: we buy back shares to return them
        // Net effect: receive entry price cash, pay current price cash
        // So cash change = profitLoss (can be negative if price went up)
        set((s) => ({
          paperPortfolio: {
            ...s.paperPortfolio,
            cashBalance: s.paperPortfolio.cashBalance + profitLoss,
          },
        }));

        const newShares = shortPos.shares - shares;

        if (newShares <= 0) {
          // Close entire position
          set((s) => ({
            paperPortfolio: {
              ...s.paperPortfolio,
              shortPositions: (s.paperPortfolio.shortPositions || []).filter((p) => p.symbol !== symbol),
            },
          }));
        } else {
          // Reduce position
          set((s) => ({
            paperPortfolio: {
              ...s.paperPortfolio,
              shortPositions: (s.paperPortfolio.shortPositions || []).map((p) =>
                p.symbol === symbol ? { ...p, shares: newShares, currentPrice: price } : p
              ),
            },
          }));
        }

        // Add trade record with P/L info
        const profitLossPercent = ((shortPos.entryPrice - price) / shortPos.entryPrice) * 100;
        const plText = `${profitLoss >= 0 ? '+' : ''}$${profitLoss.toFixed(2)} (${profitLossPercent >= 0 ? '+' : ''}${profitLossPercent.toFixed(1)}%)`;
        state.addPaperTrade({
          id: `trade-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          symbol,
          type: 'cover',
          shares,
          price,
          total,
          date: new Date(),
          notes: notes ? `${notes} | P/L: ${plText}` : `Cover short | P/L: ${plText}`,
        });

        return true;
      },

      updateShortPositionPrices: (prices) =>
        set((state) => ({
          paperPortfolio: {
            ...state.paperPortfolio,
            shortPositions: (state.paperPortfolio.shortPositions || []).map((position) => {
              const newPrice = prices.get(position.symbol) || position.currentPrice;
              // Track lowest price for trailing stop (shorts profit when price goes down)
              const lowestPrice = Math.min(position.lowestPrice || newPrice, newPrice);
              return {
                ...position,
                currentPrice: newPrice,
                lowestPrice,
              };
            }),
          },
        })),

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
          // MIGRATION v3: Remove trailing stop, use fixed targets (5% TP, 2% SL)
          // Analysis showed trailing stops were killing profits by exiting winners too early
          const migratedRules = existingRules.map(rule => {
            const isBuyRule = rule.type === 'buy';
            const isShortRule = rule.type === 'short';

            // Check if rule needs migration to v3 settings (no trailing stop)
            const needsMigration =
              rule.trailingStopPercent !== undefined ||
              rule.takeProfitPercent !== 5 ||
              rule.stopLossPercent !== 2 ||
              rule.minConfidence !== 70;

            if (needsMigration) {
              console.log(`[Store] Migrating rule "${rule.name}" - removing trailing stop, using fixed targets`);
              return {
                ...rule,
                takeProfitPercent: 5,                                  // 5% take profit (achievable)
                stopLossPercent: 2,                                    // 2% stop loss (tight)
                trailingStopPercent: undefined,                        // NO trailing stop
                minConfidence: 70,                                     // Higher confidence
                rsiFilter: isBuyRule
                  ? { enabled: true, maxRSI: 40 }                      // Buy when RSI < 40
                  : isShortRule
                    ? { enabled: true, minRSI: 60 }                    // Short when RSI > 60
                    : rule.rsiFilter,
                volumeFilter: { enabled: true, minMultiplier: 1.5 },   // 1.5x volume
              };
            }
            return rule;
          });
          merged.tradingRules = [...migratedRules, ...missingRules];

          // Preserve user data, only reset if not present
          // Ensure paper portfolio cash balance is preserved (don't reset to $10k!)
          if (persisted.paperPortfolio && typeof persisted.paperPortfolio.cashBalance === 'number') {
            merged.paperPortfolio = {
              ...defaultPaperPortfolio,
              ...persisted.paperPortfolio,
              // Ensure nested arrays are preserved
              positions: Array.isArray(persisted.paperPortfolio.positions) ? persisted.paperPortfolio.positions : [],
              trades: Array.isArray(persisted.paperPortfolio.trades) ? persisted.paperPortfolio.trades : [],
              history: Array.isArray(persisted.paperPortfolio.history) ? persisted.paperPortfolio.history : [],
            };
            console.log(`[Store] Restored paper portfolio: $${merged.paperPortfolio.cashBalance.toFixed(2)} cash, ${merged.paperPortfolio.positions.length} positions`);
          } else {
            merged.paperPortfolio = defaultPaperPortfolio;
            console.log('[Store] No existing paper portfolio, using default $10,000');
          }
          merged.trades = Array.isArray(persisted.trades) ? persisted.trades : [];
          merged.alerts = Array.isArray(persisted.alerts) ? persisted.alerts : [];
          merged.autoTradeExecutions = Array.isArray(persisted.autoTradeExecutions) ? persisted.autoTradeExecutions : [];
          merged.journalEntries = Array.isArray(persisted.journalEntries) ? persisted.journalEntries : [];
          merged.backtestResults = Array.isArray(persisted.backtestResults) ? persisted.backtestResults : [];

          return merged as AppState;
        } catch (error) {
          console.error('Error in store merge, using defaults:', error);
          return currentState;
        }
      },
    }
  )
);
