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
import { alpaca } from '../services/alpaca';

// ============================================================================
// Store Interface
// ============================================================================

interface SwingStoreState extends SwingTraderState {
  // Alpaca swing trader connection
  alpacaSwingConnected: boolean;
  connectAlpacaSwing: (keyId: string, secretKey: string) => void;
  disconnectAlpacaSwing: () => void;

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

  // Actions - Alpaca Sync
  syncFromAlpacaSwing: () => Promise<void>;
  detectRegimes: () => Promise<void>;
  alpacaSwingSynced: boolean;

  // Computed
  getCurrentEquity: () => number;
  getWinRate: () => number;
  getMonthlyReturns: () => Array<{ month: string; returnPercent: number }>;
}

// ============================================================================
// Default State
// ============================================================================

const defaultConfig = createDefaultSwingConfig();

const defaultConnectionState = {
  alpacaSwingConnected: false,
};

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
      ...defaultConnectionState,
      alpacaSwingSynced: false,

      // ============================
      // Alpaca Swing Connection
      // ============================

      connectAlpacaSwing: (_keyId: string, _secretKey: string) =>
        set({ alpacaSwingConnected: true }),

      disconnectAlpacaSwing: () =>
        set({ alpacaSwingConnected: false }),

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
      // Alpaca Swing Sync
      // ============================

      syncFromAlpacaSwing: async () => {
        if (!alpaca.isSwingTraderConfigured()) return;

        try {
          const [account, alpacaPositions, closedOrders] = await Promise.all([
            alpaca.getSwingAccount(),
            alpaca.getSwingPositions(),
            alpaca.getSwingOrders('closed', 200),
          ]);

          const cashBalance = parseFloat(account.cash);
          const totalValue = parseFloat(account.portfolio_value);

          // Map Alpaca positions to SwingTradePosition format
          const positions: SwingTradePosition[] = alpacaPositions.map((p) => {
            const shares = Math.abs(parseFloat(p.qty));
            const entryPrice = parseFloat(p.avg_entry_price);
            const currentPrice = parseFloat(p.current_price);
            const unrealizedPnL = parseFloat(p.unrealized_pl);
            const unrealizedPnLPercent = parseFloat(p.unrealized_plpc) * 100;
            const direction = p.side === 'long' ? 'long' as const : 'short' as const;

            return {
              id: p.asset_id,
              symbol: p.symbol,
              direction,
              shares,
              entryPrice,
              currentPrice,
              entryDate: new Date(),
              highestPrice: currentPrice,
              lowestPrice: currentPrice,
              regime: 'sideways' as MarketRegime,
              entrySignals: ['Alpaca sync'],
              unrealizedPnL,
              unrealizedPnLPercent,
            };
          });

          // Build completed trades from closed filled orders
          // Pair buy→sell for longs, sell→buy for shorts by symbol
          const filledOrders = closedOrders
            .filter((o) => o.status === 'filled' && o.filled_avg_price)
            .sort((a, b) => new Date(a.filled_at!).getTime() - new Date(b.filled_at!).getTime());

          // Group orders by symbol to pair entry/exit
          const ordersBySymbol = new Map<string, typeof filledOrders>();
          for (const order of filledOrders) {
            const arr = ordersBySymbol.get(order.symbol) || [];
            arr.push(order);
            ordersBySymbol.set(order.symbol, arr);
          }

          const completedTrades: SwingTrade[] = [];
          let winCount = 0;
          let lossCount = 0;

          for (const [symbol, orders] of ordersBySymbol) {
            // Walk through orders and pair buys with sells
            const pending: typeof filledOrders = [];
            for (const order of orders) {
              if (pending.length > 0 && pending[0].side !== order.side) {
                // This is the exit order for the pending entry
                const entry = pending.shift()!;
                const entryPrice = parseFloat(entry.filled_avg_price!);
                const exitPrice = parseFloat(order.filled_avg_price!);
                const shares = Math.min(parseFloat(entry.filled_qty), parseFloat(order.filled_qty));
                const isLong = entry.side === 'buy';
                const profitLoss = isLong
                  ? (exitPrice - entryPrice) * shares
                  : (entryPrice - exitPrice) * shares;
                const profitLossPercent = (profitLoss / (entryPrice * shares)) * 100;

                if (profitLoss > 0) winCount++;
                else lossCount++;

                completedTrades.push({
                  id: `${entry.id}-${order.id}`,
                  symbol,
                  direction: isLong ? 'long' : 'short',
                  regime: 'sideways' as MarketRegime,
                  shares,
                  entryPrice,
                  entryDate: new Date(entry.filled_at!),
                  exitPrice,
                  exitDate: new Date(order.filled_at!),
                  exitReason: 'bracket',
                  profitLoss,
                  profitLossPercent,
                  entrySignals: ['Auto-scanner'],
                });
              } else {
                pending.push(order);
              }
            }
          }

          // Sort completed trades newest first
          completedTrades.sort((a, b) =>
            new Date(b.exitDate!).getTime() - new Date(a.exitDate!).getTime()
          );

          const positionsValue = positions.reduce((sum, p) => sum + p.currentPrice * p.shares, 0);
          const equity = cashBalance + positionsValue;
          const peakEquity = Math.max(get().peakEquity, equity);
          const initialCapital = get().config.initialCapital;

          // Record one equity snapshot per day
          const existingHistory = get().equityHistory || [];
          const todayStr = new Date().toDateString();
          const lastSnap = existingHistory[existingHistory.length - 1];
          const alreadyRecordedToday = lastSnap && new Date(lastSnap.date).toDateString() === todayStr;
          const newHistory = alreadyRecordedToday
            ? existingHistory
            : [...existingHistory, {
                date: new Date(),
                equity: totalValue,
                cashBalance,
                positionsValue,
                regime: 'sideways' as MarketRegime,
                drawdownPercent: peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0,
              }].slice(-365);

          set({
            cashBalance,
            positions,
            completedTrades: completedTrades.slice(0, 500),
            winCount,
            lossCount,
            peakEquity,
            totalReturn: equity - initialCapital,
            totalReturnPercent: ((equity - initialCapital) / initialCapital) * 100,
            equityHistory: newHistory,
            alpacaSwingSynced: true,
          });
        } catch (error) {
          console.error('[SwingStore] Failed to sync from Alpaca swing:', error);
        }
      },

      // ============================
      // Regime Detection (client-side, same logic as swing-cron.ts)
      // ============================

      detectRegimes: async () => {
        if (!alpaca.isSwingTraderConfigured()) return;

        const symbols = get().config.symbols;
        if (symbols.length === 0) return;

        const regimes: Record<string, MarketRegime> = {};

        // Fetch bars for each symbol and compute regime
        const endDate = new Date().toISOString().slice(0, 10);
        const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        await Promise.allSettled(symbols.map(async (symbol) => {
          try {
            const bars = await alpaca.getSwingHistoricalBars(symbol, startDate, endDate);
            if (bars.length < 52) return;

            const closes = bars.map((b) => b.close);

            // SMA50
            const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
            const price = closes[closes.length - 1];
            const pctFromSMA = (price - sma50) / sma50;

            let regime: MarketRegime;
            if (pctFromSMA > 0.02) regime = 'uptrend';
            else if (pctFromSMA < -0.03) regime = 'downtrend';
            else regime = 'sideways';

            regimes[symbol] = regime;
          } catch (err) {
            console.warn(`[SwingStore] Failed to detect regime for ${symbol}:`, err);
          }
        }));

        if (Object.keys(regimes).length > 0) {
          set({ currentRegimes: regimes });
        }
      },

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
