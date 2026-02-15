// ============================================================================
// Swing Trader Store - COMPLETELY SEPARATE from day trading store
// ============================================================================
// This store manages all swing trading state independently.
// It has its own portfolio, trades, watchlist, and configuration.
// Nothing is shared with the day trading useStore.
// ============================================================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  MarketRegime,
  SwingTraderConfig,
  SwingTraderState,
  SwingTradePosition,
  SwingTrade,
  SwingEquitySnapshot,
} from '../types';
import {
  createDefaultSwingConfig,
  calculateSwingEquity,
} from '../services/swingTrader';

// ============================================================================
// Store Interface
// ============================================================================

interface SwingStoreState extends SwingTraderState {
  // Actions - Config
  updateConfig: (updates: Partial<SwingTraderConfig>) => void;
  resetConfig: () => void;

  // Actions - Portfolio
  startSwingTrader: () => void;
  stopSwingTrader: () => void;
  resetSwingPortfolio: (initialCapital?: number) => void;

  // Actions - Positions
  openPosition: (position: SwingTradePosition) => void;
  closePosition: (positionId: string, exitPrice: number, exitReason: string) => void;
  updatePositionPrice: (symbol: string, price: number) => void;
  updateAllPrices: (prices: Map<string, number>) => void;

  // Actions - Regime
  updateRegime: (symbol: string, regime: MarketRegime) => void;

  // Actions - Watchlist
  addSymbol: (symbol: string) => void;
  removeSymbol: (symbol: string) => void;

  // Actions - Equity tracking
  recordSnapshot: (regime: MarketRegime) => void;

  // Actions - Trades
  clearTradeHistory: () => void;

  // Computed
  getCurrentEquity: () => number;
  getWinRate: () => number;
  getMonthlyReturns: () => Array<{ month: string; returnPercent: number }>;
}

// ============================================================================
// Default State
// ============================================================================

const defaultConfig = createDefaultSwingConfig();

const defaultState: SwingTraderState = {
  config: defaultConfig,
  cashBalance: defaultConfig.initialCapital,
  positions: [],
  completedTrades: [],
  equityHistory: [{
    date: new Date(),
    equity: defaultConfig.initialCapital,
    cashBalance: defaultConfig.initialCapital,
    positionsValue: 0,
    regime: 'sideways',
    drawdownPercent: 0,
  }],
  currentRegimes: {},
  isRunning: false,
  startedAt: null,
  peakEquity: defaultConfig.initialCapital,
  totalReturn: 0,
  totalReturnPercent: 0,
  winCount: 0,
  lossCount: 0,
  monthlyReturns: [],
};

// ============================================================================
// Store
// ============================================================================

export const useSwingStore = create<SwingStoreState>()(
  persist(
    (set, get) => ({
      ...defaultState,

      // ============================
      // Config Actions
      // ============================

      updateConfig: (updates) =>
        set((state) => ({
          config: { ...state.config, ...updates },
        })),

      resetConfig: () =>
        set({ config: createDefaultSwingConfig() }),

      // ============================
      // Portfolio Actions
      // ============================

      startSwingTrader: () =>
        set({
          isRunning: true,
          startedAt: new Date(),
        }),

      stopSwingTrader: () =>
        set({ isRunning: false }),

      resetSwingPortfolio: (initialCapital) => {
        const capital = initialCapital ?? get().config.initialCapital;
        set({
          cashBalance: capital,
          positions: [],
          completedTrades: [],
          equityHistory: [{
            date: new Date(),
            equity: capital,
            cashBalance: capital,
            positionsValue: 0,
            regime: 'sideways',
            drawdownPercent: 0,
          }],
          currentRegimes: {},
          isRunning: false,
          startedAt: null,
          peakEquity: capital,
          totalReturn: 0,
          totalReturnPercent: 0,
          winCount: 0,
          lossCount: 0,
          monthlyReturns: [],
          config: {
            ...get().config,
            initialCapital: capital,
          },
        });
      },

      // ============================
      // Position Actions
      // ============================

      openPosition: (position) =>
        set((state) => {
          const cost = position.shares * position.entryPrice;
          if (cost > state.cashBalance) return {};

          return {
            positions: [...state.positions, position],
            cashBalance: state.cashBalance - cost,
          };
        }),

      closePosition: (positionId, exitPrice, exitReason) =>
        set((state) => {
          const position = state.positions.find((p) => p.id === positionId);
          if (!position) return {};

          // Calculate P/L
          let profitLoss: number;
          if (position.direction === 'long') {
            profitLoss = (exitPrice - position.entryPrice) * position.shares;
          } else {
            profitLoss = (position.entryPrice - exitPrice) * position.shares;
          }
          const profitLossPercent = (profitLoss / (position.entryPrice * position.shares)) * 100;

          // Create completed trade record
          const completedTrade: SwingTrade = {
            id: position.id,
            symbol: position.symbol,
            direction: position.direction,
            regime: position.regime,
            shares: position.shares,
            entryPrice: position.entryPrice,
            entryDate: position.entryDate,
            exitPrice,
            exitDate: new Date(),
            exitReason,
            profitLoss,
            profitLossPercent,
            entrySignals: position.entrySignals,
          };

          // Return cash from closed position
          const cashReturned = position.shares * exitPrice;
          const newCash = position.direction === 'long'
            ? state.cashBalance + cashReturned
            : state.cashBalance + (position.shares * position.entryPrice) + profitLoss;

          const isWin = profitLoss > 0;
          const newWins = state.winCount + (isWin ? 1 : 0);
          const newLosses = state.lossCount + (isWin ? 0 : 1);

          const newPositions = state.positions.filter((p) => p.id !== positionId);
          const equity = calculateSwingEquity(newCash, newPositions);
          const newPeak = Math.max(state.peakEquity, equity);

          return {
            positions: newPositions,
            cashBalance: newCash,
            completedTrades: [completedTrade, ...state.completedTrades].slice(0, 500),
            winCount: newWins,
            lossCount: newLosses,
            peakEquity: newPeak,
            totalReturn: equity - state.config.initialCapital,
            totalReturnPercent: ((equity - state.config.initialCapital) / state.config.initialCapital) * 100,
          };
        }),

      updatePositionPrice: (symbol, price) =>
        set((state) => ({
          positions: state.positions.map((p) => {
            if (p.symbol !== symbol) return p;
            const unrealizedPnL = p.direction === 'long'
              ? (price - p.entryPrice) * p.shares
              : (p.entryPrice - price) * p.shares;
            const unrealizedPnLPercent = (unrealizedPnL / (p.entryPrice * p.shares)) * 100;
            return {
              ...p,
              currentPrice: price,
              highestPrice: Math.max(p.highestPrice, price),
              lowestPrice: Math.min(p.lowestPrice, price),
              unrealizedPnL,
              unrealizedPnLPercent,
            };
          }),
        })),

      updateAllPrices: (prices) =>
        set((state) => ({
          positions: state.positions.map((p) => {
            const price = prices.get(p.symbol);
            if (price === undefined) return p;
            const unrealizedPnL = p.direction === 'long'
              ? (price - p.entryPrice) * p.shares
              : (p.entryPrice - price) * p.shares;
            const unrealizedPnLPercent = (unrealizedPnL / (p.entryPrice * p.shares)) * 100;
            return {
              ...p,
              currentPrice: price,
              highestPrice: Math.max(p.highestPrice, price),
              lowestPrice: Math.min(p.lowestPrice, price),
              unrealizedPnL,
              unrealizedPnLPercent,
            };
          }),
        })),

      // ============================
      // Regime Actions
      // ============================

      updateRegime: (symbol, regime) =>
        set((state) => ({
          currentRegimes: { ...state.currentRegimes, [symbol]: regime },
        })),

      // ============================
      // Watchlist Actions
      // ============================

      addSymbol: (symbol) =>
        set((state) => {
          if (state.config.symbols.includes(symbol)) return {};
          return {
            config: {
              ...state.config,
              symbols: [...state.config.symbols, symbol],
            },
          };
        }),

      removeSymbol: (symbol) =>
        set((state) => ({
          config: {
            ...state.config,
            symbols: state.config.symbols.filter((s) => s !== symbol),
          },
        })),

      // ============================
      // Equity Tracking
      // ============================

      recordSnapshot: (regime) =>
        set((state) => {
          const equity = calculateSwingEquity(state.cashBalance, state.positions);
          const positionsValue = equity - state.cashBalance;
          const newPeak = Math.max(state.peakEquity, equity);
          const drawdownPercent = newPeak > 0 ? ((newPeak - equity) / newPeak) * 100 : 0;

          const snapshot: SwingEquitySnapshot = {
            date: new Date(),
            equity,
            cashBalance: state.cashBalance,
            positionsValue,
            regime,
            drawdownPercent,
          };

          return {
            equityHistory: [...state.equityHistory, snapshot].slice(-500),
            peakEquity: newPeak,
            totalReturn: equity - state.config.initialCapital,
            totalReturnPercent: ((equity - state.config.initialCapital) / state.config.initialCapital) * 100,
          };
        }),

      // ============================
      // Trade History
      // ============================

      clearTradeHistory: () =>
        set({
          completedTrades: [],
          winCount: 0,
          lossCount: 0,
        }),

      // ============================
      // Computed Values
      // ============================

      getCurrentEquity: () => {
        const state = get();
        return calculateSwingEquity(state.cashBalance, state.positions);
      },

      getWinRate: () => {
        const state = get();
        const total = state.winCount + state.lossCount;
        if (total === 0) return 0;
        return (state.winCount / total) * 100;
      },

      getMonthlyReturns: () => {
        const state = get();
        if (state.equityHistory.length < 2) return [];

        const monthlyMap = new Map<string, { start: number; end: number }>();

        for (const snapshot of state.equityHistory) {
          const date = new Date(snapshot.date);
          const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

          if (!monthlyMap.has(key)) {
            monthlyMap.set(key, { start: snapshot.equity, end: snapshot.equity });
          } else {
            monthlyMap.get(key)!.end = snapshot.equity;
          }
        }

        return Array.from(monthlyMap.entries()).map(([month, { start, end }]) => ({
          month,
          returnPercent: start > 0 ? ((end - start) / start) * 100 : 0,
        }));
      },
    }),
    {
      name: 'swing-trader-storage',  // Separate localStorage key from day trading
      merge: (persistedState, currentState) => {
        try {
          const persisted = (persistedState as Partial<SwingStoreState>) || {};
          const merged = { ...currentState, ...persisted };

          // Ensure arrays are preserved
          merged.positions = Array.isArray(persisted.positions) ? persisted.positions : [];
          merged.completedTrades = Array.isArray(persisted.completedTrades) ? persisted.completedTrades : [];
          merged.equityHistory = Array.isArray(persisted.equityHistory) ? persisted.equityHistory : defaultState.equityHistory;

          // Ensure config has all fields (handles adding new config fields)
          merged.config = { ...createDefaultSwingConfig(), ...(persisted.config || {}) };

          return merged as SwingStoreState;
        } catch (error) {
          console.error('[SwingStore] Error merging state, using defaults:', error);
          return currentState;
        }
      },
    }
  )
);
